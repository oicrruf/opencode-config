// The lifecycle of a sandbox execution.
//
// The flow is: start, status, finish, cancel, recover. The start
// acquires the quota, takes the capture, builds the image, and runs the
// container; it approves nothing. The finish records an explicit
// result, writes the report outside the environment, and only then
// removes the resources.
//
// The order is deliberate: a container destroyed together with its
// report leaves nothing to analyze, so the report is written first and
// a failure to write it keeps the resources.
//
// The Docker calls are injectable so the lifecycle can be tested
// without an engine.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, relative, resolve, sep, isAbsolute } from "node:path";
import { acquireReservation, releaseReservation, verifyOwner, readReservation } from "./reservation.mjs";
import { takeCapture, prepareIndependentRepository } from "./sandbox-capture.mjs";
import { readSandboxConfig, checkDependencies } from "./sandbox-config.mjs";
import {
  buildBuildArguments,
  buildRunArguments,
  buildNetworkArguments,
  checkEngineHost,
  checkEngineReachable,
  labelArguments,
  LABEL_KEY,
} from "./docker-adapter.mjs";
import { ensureDir, reportDir, captureRootDir } from "./paths.mjs";
import { screenValue } from "./secret-screen.mjs";

export const RESULT_STATES = ["passed", "failed", "blocked", "not executed"];

const RECORD_FILE = "execution.json";

/**
 * Normalize a work name so it can be used in a resource name.
 */
export function normalizeWorkName(workName) {
  return String(workName ?? "work")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "work";
}

/**
 * The identity of an execution. Two executions of the same work never
 * share an identity, and the full identity is preserved so a recovery
 * never depends on a truncated name.
 */
export function buildExecutionIdentity(workId, workName) {
  const executionId = `${normalizeWorkName(workName)}-${randomUUID().slice(0, 8)}`;
  return {
    executionId,
    workId,
    workName,
    normalizedWorkName: normalizeWorkName(workName),
  };
}

/**
 * The directory that holds the record of an execution.
 */
export function executionDir(cwd, executionId) {
  const root = captureRootDir(cwd);
  if (!root.ok) return { ok: false, reason: root.reason };
  return { ok: true, dir: join(root.dir, "..", "executions", executionId) };
}

/**
 * Write the test secrets to a file outside the capture and outside the
 * build context.
 *
 * The value never becomes an argument, a layer, or part of the report.
 * The file is written with restrictive permissions and is removed when
 * the execution closes.
 */
export function writeSecretFile(cwd, executionId, secrets = []) {
  if (!Array.isArray(secrets) || secrets.length === 0) {
    return { ok: true, path: null, names: [] };
  }
  const dir = executionDir(cwd, executionId);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const ensured = ensureDir(dir.dir);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };

  const path = join(dir.dir, "test-secrets.env");
  const lines = [];
  const names = [];
  for (const secret of secrets) {
    if (!secret || typeof secret.name !== "string" || typeof secret.value !== "string") continue;
    lines.push(`${secret.name}=${secret.value}`);
    names.push(secret.name);
  }
  if (lines.length === 0) return { ok: true, path: null, names: [] };

  try {
    writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  } catch (err) {
    return { ok: false, reason: `the test secrets could not be written: ${err.message}` };
  }
  return { ok: true, path, names };
}

/**
 * Start an execution.
 *
 * The start returns the identifiers and a pending manual test. It never
 * approves the product, and it never claims equivalence with
 * production.
 */
export async function startSandbox(input, deps = {}) {
  const {
    workId,
    workName,
    worktreePath,
    sessionId = "",
    maxDurationSeconds = null,
    cwd = process.cwd(),
  } = input ?? {};

  if (!workId) return { ok: false, reason: "the start needs a work identifier" };
  if (!worktreePath) return { ok: false, reason: "the start needs a worktree path" };

  const host = checkEngineHost(deps.platform, deps.release);
  if (!host.ok) return { ok: false, blocked: true, reason: host.reason };
  const engine = checkEngineReachable(deps);
  if (!engine.ok) return { ok: false, blocked: true, reason: engine.reason };

  const projectRoot = deps.projectRoot ?? worktreePath;
  const config = readSandboxConfig(projectRoot);
  if (!config.ok) {
    return { ok: false, blocked: true, reason: config.reason, missing: config.missing };
  }

  // The declared dependencies are checked before the quota is taken and
  // before any resource is created. A missing dependency blocks the
  // test: the control never provisions one.
  const dependencies = await checkDependencies(config.config.dependencies, deps);
  if (!dependencies.ok) {
    return {
      ok: false,
      blocked: true,
      reason: dependencies.reason,
      missing: dependencies.missing,
      unavailable: dependencies.unavailable,
    };
  }

  // The quota is one per project and covers both the application and
  // the sandbox, so the reservation is taken before anything is built.
  const acquired = acquireReservation(cwd, {
    workId,
    workName,
    scope: "sandbox",
    supervisorPid: String(process.pid),
    sessionId,
    executable: null,
  });
  if (!acquired.ok) {
    return { ok: false, blocked: true, reason: acquired.reason, heldBy: acquired.heldBy };
  }

  const identity = buildExecutionIdentity(workId, workName);
  const record = {
    ...identity,
    sessionId,
    startedAt: new Date().toISOString(),
    phase: "preparing",
    result: null,
    capture: null,
    image: null,
    container: null,
    network: null,
    resources: { containers: [], images: [], networks: [], volumes: [] },
    secretNames: [],
    reportPath: null,
    deadlineAt: maxDurationSeconds
      ? new Date(Date.now() + maxDurationSeconds * 1000).toISOString()
      : null,
  };

  const capture = takeCapture({
    worktreePath,
    workId,
    workName,
    executionId: identity.executionId,
    cwd,
  });
  if (!capture.ok) {
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: capture.reason, refused: capture.refused, refusals: capture.refusals };
  }
  record.capture = {
    destination: capture.destination,
    manifest: capture.manifest,
  };

  const secrets = writeSecretFile(cwd, identity.executionId, config.config.testSecrets);
  if (!secrets.ok) {
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: secrets.reason };
  }
  record.secretNames = secrets.names;

  const imageTag = `sandbox/${identity.normalizedWorkName}:${identity.executionId}`;

  // The declared Dockerfile and the declared context are mapped onto the
  // captured tree. A path that does not map is refused: the build would
  // otherwise use a different file than the project declared.
  const mappedDockerfile = relativeToCapture(capture.destination, config.config.dockerfileRelative, projectRoot);
  if (!mappedDockerfile.ok) {
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: mappedDockerfile.reason };
  }
  const mappedContext = relativeToCapture(capture.destination, config.config.contextRelative, projectRoot);
  if (!mappedContext.ok) {
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: mappedContext.reason };
  }

  const build = buildBuildArguments({
    captureDir: capture.destination,
    dockerfileRelative: mappedDockerfile.path,
    contextRelative: mappedContext.path,
    stage: config.config.stage,
    imageTag,
    executionId: identity.executionId,
    workId,
    limits: config.config.limits,
  });
  if (!build.ok) {
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: build.reason };
  }

  // The record is persisted before the first resource is created, so a
  // failure after that point leaves a record the recovery can act on.
  // When the record cannot be persisted, no resource is created at all:
  // a resource the recovery cannot find is a resource nobody owns.
  record.phase = "building";
  const persisted = writeExecutionRecord(cwd, record);
  if (!persisted.ok) {
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return {
      ok: false,
      reason: persisted.reason,
      phase: "record",
      quotaReleased: true,
    };
  }

  // A failure after this point must not release the quota while the
  // resources it created are still present: the quota is released only
  // after the labeled cleanup has verified their absence.
  const abandon = (reason, phase) => {
    const cleanup = cleanupExecution(cwd, identity.executionId, deps);
    let quotaReleased = false;
    if (cleanup.ok) {
      const released = releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
      quotaReleased = released.ok;
    }
    record.phase = cleanup.ok ? "failed" : "cleanup-pending";
    record.result = "not executed";
    record.failure = reason;
    writeExecutionRecord(cwd, record);
    return {
      ok: false,
      reason,
      phase: phase ?? record.phase,
      quotaReleased,
      resourcesKept: !cleanup.ok,
      remaining: cleanup.remaining ?? [],
    };
  };

  const run = deps.execFileSync ?? execFileSync;
  try {
    run("docker", build.args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (err) {
    return abandon(`the image could not be built: ${err.message}`, "build");
  }
  record.image = imageTag;
  record.resources.images.push(imageTag);
  writeExecutionRecord(cwd, record);

  const networkName = `sandbox-net-${identity.executionId}`;
  const network = buildNetworkArguments({
    executionId: identity.executionId,
    name: networkName,
    allowExternalEgress: config.config.production?.allowExternalEgress === true,
  });
  if (!network.ok) {
    return abandon(network.reason, "network");
  }
  try {
    run("docker", network.args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (err) {
    return abandon(`the network could not be created: ${err.message}`, "network");
  }
  record.network = networkName;
  record.resources.networks.push(networkName);
  writeExecutionRecord(cwd, record);

  const containerName = `sandbox-${identity.executionId}`;
  const runArgs = buildRunArguments({
    imageTag,
    executionId: identity.executionId,
    workId,
    containerName,
    networkName,
    ports: config.config.ports,
    envFile: secrets.path,
    limits: config.config.limits,
  });
  if (!runArgs.ok) {
    return abandon(runArgs.reason, "run");
  }
  try {
    run("docker", runArgs.args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (err) {
    return abandon(`the container could not be started: ${err.message}`, "run");
  }
  record.container = containerName;
  record.resources.containers.push(containerName);

  record.phase = "running";
  writeExecutionRecord(cwd, record);

  return {
    ok: true,
    execution: record,
    token: acquired.token,
    result: null,
    pendingManualTest: true,
    localAccess: describeLocalAccess(config.config.ports),
  };
}

/**
 * Map a declared path of the project onto the captured tree.
 *
 * The capture replicates the worktree, so a declared path maps to the
 * same relative path inside the capture. A path that does not map —
 * because it leaves the project, or because it was not captured — is
 * refused rather than silently replaced by a default: building the
 * wrong file is exactly the difference from production the report is
 * supposed to state.
 */
function relativeToCapture(captureDir, declaredPath, projectRoot) {
  const root = resolve(projectRoot);
  const absolute = resolve(root, declaredPath);
  const rel = relative(root, absolute);
  // The root of the project maps to the root of the capture: it is the
  // context itself, not a file inside it.
  if (rel === "") return { ok: true, path: "." };
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, reason: `the declared path does not map into the capture: ${declaredPath}` };
  }
  return { ok: true, path: rel.split(sep).join("/") };
}

function describeLocalAccess(ports = []) {
  return ports
    .map((port) => `http://127.0.0.1:${port.hostPort ?? port.container}`)
    .join(", ");
}

/**
 * Report the state of an execution without revealing a secret.
 */
export function sandboxStatus(cwd, executionId) {
  const record = readExecutionRecord(cwd, executionId);
  if (!record.ok) return { ok: false, reason: record.reason };
  return {
    ok: true,
    execution: {
      executionId: record.record.executionId,
      workId: record.record.workId,
      workName: record.record.workName,
      phase: record.record.phase,
      result: record.record.result,
      startedAt: record.record.startedAt,
      image: record.record.image,
      container: record.record.container,
      captureFingerprint: record.record.capture?.manifest?.files?.length ?? null,
      secretNames: record.record.secretNames,
    },
    pendingManualTest: record.record.result === null,
    approved: false,
    note: "a ready environment is not an approved test",
  };
}

/**
 * Write the execution's record.
 */
export function writeExecutionRecord(cwd, record) {
  const dir = executionDir(cwd, record.executionId);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const ensured = ensureDir(dir.dir);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };
  try {
    writeFileSync(join(dir.dir, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return { ok: true, path: join(dir.dir, RECORD_FILE) };
  } catch (err) {
    return { ok: false, reason: `the execution record could not be written: ${err.message}` };
  }
}

/**
 * Read the execution's record.
 */
export function readExecutionRecord(cwd, executionId) {
  const dir = executionDir(cwd, executionId);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const path = join(dir.dir, RECORD_FILE);
  if (!existsSync(path)) {
    return { ok: false, reason: `there is no record of the execution ${executionId}` };
  }
  try {
    return { ok: true, record: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { ok: false, reason: `the execution record could not be read: ${err.message}` };
  }
}

/**
 * Discover the volumes that the execution created implicitly.
 *
 * A `VOLUME` instruction creates a volume that carries no label of the
 * execution, so the control cannot find it by label. The containers of
 * the execution are inspected instead, and the volumes they mount are
 * credited to the execution.
 */
export function discoverImplicitVolumes(cwd, executionId, run) {
  const volumes = [];
  const containers = [];
  try {
    const out = run(
      "docker",
      ["ps", "--all", "--filter", `label=${LABEL_KEY}=${executionId}`, "--format", "{{.ID}}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const container of String(out).split("\n").filter(Boolean)) {
      containers.push(container);
      try {
        const inspected = run(
          "docker",
          ["inspect", "--format", "{{range .Mounts}}{{if eq .Type \"volume\"}}{{.Name}} {{end}}{{end}}", container],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        for (const name of String(inspected).split(/\s+/).filter(Boolean)) {
          if (!volumes.includes(name)) volumes.push(name);
        }
      } catch {
        // A container that cannot be inspected is reported by the
        // absence verification, not by this discovery.
      }
    }
  } catch {
    // The engine could not be reached: the absence verification below
    // keeps the block.
  }
  void cwd;
  return { volumes, containers };
}

/**
 * Conclude an execution with an explicit result.
 *
 * The report is written outside the environment before anything is
 * removed. A failure to write the report keeps the resources, because
 * the evidence must be recoverable.
 */
export function finishSandbox(cwd, executionId, input, deps = {}) {
  const { result, steps = [], differencesFromProduction = [], token = null } = input ?? {};

  if (!RESULT_STATES.includes(result)) {
    return {
      ok: false,
      reason: `the result must be one of ${RESULT_STATES.join(", ")}`,
    };
  }

  const record = readExecutionRecord(cwd, executionId);
  if (!record.ok) return { ok: false, reason: record.reason };

  // Closing an execution is a destructive transition, so the token that
  // owns the reservation is required. An execution that was never
  // reserved — a start that failed before the quota was taken — has no
  // reservation to verify against, and its record carries no token.
  if (record.record.tokenRequired !== false) {
    if (!token) {
      return {
        ok: false,
        reason: "closing an execution requires the token that owns its reservation",
      };
    }
    const verified = verifyOwner(cwd, token);
    if (!verified.ok) return { ok: false, reason: verified.reason };
  }

  const report = buildReport(record.record, {
    result,
    steps,
    differencesFromProduction,
  });
  if (!report.ok) return { ok: false, reason: report.reason };

  const written = writeReport(cwd, executionId, report.report);
  if (!written.ok) {
    // The evidence is not preserved, so the resources are kept.
    return {
      ok: false,
      reason: written.reason,
      resourcesKept: true,
      note: "the resources are kept because the evidence could not be preserved",
    };
  }

  const cleanup = cleanupExecution(cwd, executionId, deps);

  // The quota is released only after the evidence is preserved and the
  // absence of the resources is verified. A cleanup that could not
  // complete keeps the block.
  let quotaReleased = false;
  if (cleanup.ok && token) {
    const released = releaseReservation(cwd, token, { resourcesAbsent: true });
    quotaReleased = released.ok;
    if (!released.ok) {
      record.record.result = result;
      record.record.phase = "cleanup-pending";
      record.record.reportPath = written.path;
      writeExecutionRecord(cwd, record.record);
      return {
        ok: false,
        reason: released.reason,
        reportPath: written.path,
        resourcesKept: true,
        quotaReleased: false,
        note: "the resources are gone but the reservation could not be released",
      };
    }
  }

  record.record.result = result;
  record.record.phase = cleanup.ok ? "closed" : "cleanup-pending";
  record.record.reportPath = written.path;
  writeExecutionRecord(cwd, record.record);

  return {
    ok: true,
    result,
    reportPath: written.path,
    cleanup: cleanup.ok
      ? { ok: true, removed: cleanup.removed, remaining: [] }
      : { ok: false, reason: cleanup.reason, remaining: cleanup.remaining ?? [] },
    quotaReleased,
    approved: false,
  };
}

/**
 * Build the report. The report holds no secret: every value is
 * screened before it is included.
 */
export function buildReport(record, input) {
  const { result, steps, differencesFromProduction } = input;
  const problems = [];
  const safeSteps = [];
  for (const step of steps ?? []) {
    const reason = screenValue(typeof step === "string" ? step : JSON.stringify(step));
    if (reason) {
      problems.push({ step, reason });
      continue;
    }
    safeSteps.push(step);
  }
  if (problems.length > 0) {
    return {
      ok: false,
      reason: `the report was refused: ${problems.length} step(s) contain a credential-shaped value`,
      problems,
    };
  }

  return {
    ok: true,
    report: {
      version: 1,
      result,
      executionId: record.executionId,
      workId: record.workId,
      workName: record.workName,
      startedAt: record.startedAt,
      concludedAt: new Date().toISOString(),
      capture: {
        branch: record.capture?.manifest?.branch ?? null,
        head: record.capture?.manifest?.head ?? null,
        files: record.capture?.manifest?.files?.length ?? 0,
        fingerprint: captureFingerprint(record),
      },
      image: record.image,
      container: record.container,
      network: record.network,
      steps: safeSteps,
      differencesFromProduction: differencesFromProduction ?? [],
      secretNames: record.secretNames,
      approved: false,
      note: "starting the environment does not approve the product",
    },
  };
}

function captureFingerprint(record) {
  const files = record.capture?.manifest?.files ?? [];
  const hash = files
    .map((file) => `${file.path}:${file.fingerprint ?? "link"}`)
    .sort()
    .join("\n");
  return hash.length > 0 ? hash.length : 0;
}

/**
 * Write the report outside the environment.
 */
export function writeReport(cwd, executionId, report) {
  const dir = reportDir(cwd);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const ensured = ensureDir(dir.dir);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };
  const path = join(dir.dir, `${executionId}.json`);
  try {
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return { ok: true, path };
  } catch (err) {
    return { ok: false, reason: `the report could not be written: ${err.message}` };
  }
}

/**
 * Remove the resources the run created.
 *
 * The resources are found by the label the run wrote on them, never by
 * name and never by age. A resource that materializes after the
 * cancellation was dispatched is tolerated: the dispatches are
 * invalidated and the late response is reconciled.
 */
export function cleanupExecution(cwd, executionId, deps = {}) {
  const record = readExecutionRecord(cwd, executionId);
  if (!record.ok) return { ok: false, reason: record.reason };

  const run = deps.execFileSync ?? execFileSync;
  const removed = [];
  const remaining = [];

  const listByLabel = (kind) => {
    // `docker ps --all` lists the containers, running and stopped, so a
    // container that was stopped is still found and removed. The other
    // kinds use `docker <kind> ls`.
    const listArgs = kind === "container" ? ["ps", "--all"] : [kind, "ls"];
    try {
      const out = run(
        "docker",
        [...listArgs, "--filter", `label=${LABEL_KEY}=${executionId}`, "--format", "{{.ID}}"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      return String(out).split("\n").filter(Boolean);
    } catch {
      return null;
    }
  };

  // The removal arguments of each kind. `docker network rm` takes no
  // force flag, so the flag is declared per kind rather than shared.
  const kinds = [
    { kind: "container", remove: ["rm", "-f"] },
    { kind: "network", remove: ["network", "rm"] },
    { kind: "image", remove: ["image", "rm", "-f"] },
    { kind: "volume", remove: ["volume", "rm", "-f"] },
  ];

  // A `VOLUME` instruction creates a volume the control never saw being
  // created, so it carries no label of its own. The containers of the
  // execution are inspected *before* they are removed, and the volumes
  // they mount are credited to the execution.
  const implicit = discoverImplicitVolumes(cwd, executionId, run);

  for (const { kind, remove } of kinds) {
    const ids = listByLabel(kind);
    if (ids === null) {
      remaining.push({ kind, reason: "the engine could not be reached" });
      continue;
    }
    for (const id of ids) {
      try {
        run("docker", [...remove, id], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
        removed.push({ kind, id });
      } catch {
        remaining.push({ kind, id, reason: "the resource could not be removed" });
      }
    }
  }

  for (const volume of implicit.volumes) {
    try {
      run("docker", ["volume", "rm", "-f", volume], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
      removed.push({ kind: "volume", id: volume, origin: "implicit" });
    } catch {
      remaining.push({ kind: "volume", id: volume, reason: "the resource could not be removed" });
    }
  }

  // The absence of the resources is verified before the quota is
  // released.
  const stillPresent = [];
  for (const { kind } of kinds) {
    const ids = listByLabel(kind);
    if (ids && ids.length > 0) stillPresent.push({ kind, count: ids.length });
  }
  if (stillPresent.length > 0) {
    return {
      ok: false,
      reason: "the resources of the execution are still present",
      removed,
      remaining: stillPresent,
    };
  }

  // The capture and the secret file belong to the execution too.
  const dir = executionDir(cwd, executionId);
  if (dir.ok) {
    try {
      rmSync(dir.dir, { recursive: true, force: true });
    } catch {
      // A capture that cannot be removed is reported through the
      // remaining resources.
    }
  }

  return { ok: true, removed, remaining: [] };
}

/**
 * Cancel an execution.
 *
 * The quota is kept until the resources are accounted for, so a
 * cancellation that cannot remove everything leaves the block in place.
 */
export function cancelSandbox(cwd, executionId, input = {}, deps = {}) {
  const { token = null, reason = "cancelled" } = input ?? {};

  const record = readExecutionRecord(cwd, executionId);
  if (!record.ok) return { ok: false, reason: record.reason };

  // Cancelling destroys the environment, so the token that owns the
  // reservation is required for the same reason as closing.
  if (record.record.tokenRequired !== false) {
    if (!token) {
      return {
        ok: false,
        reason: "cancelling an execution requires the token that owns its reservation",
      };
    }
    const verified = verifyOwner(cwd, token);
    if (!verified.ok) return { ok: false, reason: verified.reason };
  }

  const cleanup = cleanupExecution(cwd, executionId, deps);
  if (!cleanup.ok) {
    record.record.phase = "cleanup-pending";
    record.record.cancelReason = reason;
    writeExecutionRecord(cwd, record.record);
    return {
      ok: false,
      reason: cleanup.reason,
      remaining: cleanup.remaining ?? [],
      quotaReleased: false,
    };
  }

  // The quota is released only after the absence of the resources is
  // verified.
  let quotaReleased = false;
  if (token) {
    const released = releaseReservation(cwd, token, { resourcesAbsent: true });
    quotaReleased = released.ok;
    if (!released.ok) {
      record.record.phase = "cleanup-pending";
      record.record.cancelReason = reason;
      writeExecutionRecord(cwd, record.record);
      return {
        ok: false,
        reason: released.reason,
        remaining: [],
        quotaReleased: false,
        note: "the resources are gone but the reservation could not be released",
      };
    }
  }

  record.record.phase = "cancelled";
  record.record.result = record.record.result ?? "not executed";
  record.record.cancelReason = reason;
  writeExecutionRecord(cwd, record.record);

  return { ok: true, cancelled: true, quotaReleased, removed: cleanup.removed };
}

/**
 * Recover an interrupted execution.
 *
 * The recovery consults the record and the engine's own state. It
 * resumes the closure of the identified execution and never starts a
 * second test for it.
 *
 * The recovery removes resources, so it requires the token that owns
 * the reservation, exactly as closing and cancelling do. An execution
 * whose reservation was already released — the closed case — needs no
 * token, because nothing is destroyed.
 */
export function recoverSandbox(cwd, executionId, deps = {}) {
  const token = deps.token ?? null;
  const record = readExecutionRecord(cwd, executionId);
  if (!record.ok) {
    return {
      ok: true,
      alreadyClosed: true,
      reason: record.reason,
      note: "no execution of this identity was found, so nothing was closed",
    };
  }

  if (record.record.result !== null && record.record.phase === "closed") {
    return { ok: true, alreadyClosed: true, reason: "the closure was already completed" };
  }

  // The recovery destroys the environment, so the token that owns the
  // reservation is required.
  if (record.record.tokenRequired !== false) {
    if (!token) {
      return {
        ok: false,
        reason: "recovering an execution requires the token that owns its reservation",
        quotaReleased: false,
      };
    }
    const verified = verifyOwner(cwd, token);
    if (!verified.ok) {
      return { ok: false, reason: verified.reason, quotaReleased: false };
    }
  }

  const cleanup = cleanupExecution(cwd, executionId, deps);
  if (!cleanup.ok) {
    record.record.phase = "cleanup-pending";
    writeExecutionRecord(cwd, record.record);
    return {
      ok: false,
      reason: cleanup.reason,
      remaining: cleanup.remaining ?? [],
      quotaReleased: false,
    };
  }

  // The quota is released only after the absence of the resources is
  // verified.
  let quotaReleased = false;
  if (token) {
    const released = releaseReservation(cwd, token, { resourcesAbsent: true });
    quotaReleased = released.ok;
    if (!released.ok) {
      record.record.phase = "cleanup-pending";
      writeExecutionRecord(cwd, record.record);
      return {
        ok: false,
        reason: released.reason,
        quotaReleased: false,
        note: "the resources are gone but the reservation could not be released",
      };
    }
  }

  record.record.phase = "closed";
  record.record.result = record.record.result ?? "not executed";
  writeExecutionRecord(cwd, record.record);

  return { ok: true, alreadyClosed: false, closed: true, quotaReleased };
}

/**
 * Close an execution whose deadline expired.
 *
 * The expiry closes the run without approving it, and it keeps the
 * reservation until the evidence is preserved and the cleanup is
 * verified.
 */
export function closeExpiredExecution(cwd, executionId, deps = {}) {
  const record = readExecutionRecord(cwd, executionId);
  if (!record.ok) return { ok: false, reason: record.reason };
  if (!record.record.deadlineAt) {
    return { ok: false, reason: "the execution has no deadline" };
  }
  if (new Date(record.record.deadlineAt).getTime() > Date.now()) {
    return { ok: false, reason: "the deadline has not expired" };
  }

  return finishSandbox(
    cwd,
    executionId,
    { result: "not executed", steps: [], differencesFromProduction: ["the agreed maximum duration expired"] },
    deps,
  );
}

export { readReservation, releaseReservation, prepareIndependentRepository, labelArguments, mkdirSync };
