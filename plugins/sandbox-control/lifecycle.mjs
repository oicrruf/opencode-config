import { withSandboxOperation, ownsSandboxOperation, readTransition } from "./operation.mjs";
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

import { randomUUID, createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, unlinkSync, rmdirSync, renameSync } from "node:fs";
import { join, relative, resolve, sep, isAbsolute } from "node:path";
import { acquireReservation, releaseReservation, verifyOwner, readReservation } from "./reservation.mjs";
import { takeCapture, prepareIndependentRepository, verifyFixtureCapture, verifyFixtureSource } from "./sandbox-capture.mjs";
import { checkFixtureRuntimeInputs, readFixtureSnapshot, discardFixtureSnapshot } from "./fixture-inputs.mjs";
import { readSandboxConfig, checkDependencies, verifyConfigurationSnapshot, configurationEvidence } from "./sandbox-config.mjs";
import {
  buildBuildArguments,
  buildRunArguments,
  buildNetworkArguments,
  labelArguments,
  LABEL_KEY,
} from "./docker-adapter.mjs";
import { ensureDir, reportDir, captureRootDir, resolveRepositoryRoot } from "./paths.mjs";
import { screenValue } from "./secret-screen.mjs";

import { inspectLocalEngine, boundDocker } from "./engine.mjs";
import { armSupervisor, disarmSupervisor } from "./execution.mjs";

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
  if (typeof executionId !== "string" || !/^[a-z0-9-]+$/i.test(executionId)) {
    return { ok: false, reason: "the execution identity is invalid" };
  }
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
function writeSecretFileImpl(cwd, executionId, secrets = []) {
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
async function startSandboxImpl(input, deps = {}) {
  const {
    workId,
    workName,
    worktreePath,
    sessionId = "",
    projectID = null,
    configPath = null,
    maxDurationSeconds = null,
    cwd = process.cwd(),
  } = input ?? {};

  if (!workId) return { ok: false, reason: "the start needs a work identifier" };
  if (!worktreePath) return { ok: false, reason: "the start needs a worktree path" };
  if (maxDurationSeconds !== null && (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0)) {
    return { ok: false, reason: "the maximum duration must be a positive finite number of seconds" };
  }

  const projectRoot = deps.projectRoot ?? worktreePath;
  const config = readSandboxConfig(projectRoot, configPath);
  if (!config.ok) {
    return { ok: false, blocked: true, reason: config.reason, missing: config.missing };
  }
  if (deps.expectedConfigurationFingerprint && config.config.fingerprint !== deps.expectedConfigurationFingerprint) {
    return { ok: false, blocked: true, reason: "the replacement configuration changed after validation" };
  }

  const engine = inspectLocalEngine(deps);
  if (!engine.ok) return engine;
  let run;
  try { run = boundDocker(engine.binding, deps); }
  catch (error) { return { ok: false, blocked: true, reason: error.message }; }

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
  const identity = deps.preparedExecution?.identity ?? buildExecutionIdentity(workId, workName);
  const deadlineAt = maxDurationSeconds
    ? new Date(Date.now() + maxDurationSeconds * 1000).toISOString()
    : null;
  const acquired = deps.preparedExecution?.reservation ?? acquireReservation(cwd, {
    workId,
    workName,
    scope: "sandbox",
    executionId: identity.executionId,
    deadlineAt,
    supervisorPid: String(process.pid),
    sessionId,
    executable: null,
  });
  if (!acquired.ok) {
    return { ok: false, blocked: true, reason: acquired.reason, heldBy: acquired.heldBy };
  }
  if (deps.preparedExecution && !verifyOwner(cwd, acquired.token, { executionId: identity.executionId, generation: acquired.reservation.generation }).ok) {
    return { ok: false, blocked: true, reason: "the prepared successor does not own the current reservation" };
  }

  const record = {
    ...identity,
    engine: engine.binding,
    schemaVersion: 2,
    generation: acquired.reservation.generation,
    sessionId,
    projectID,
    startedAt: new Date().toISOString(),
    source: { checkout: resolve(worktreePath) },
    configuration: configurationEvidence(config.config),
    phase: "preparing",
    result: null,
    capture: null,
    image: null,
    container: null,
    network: null,
    resources: { containers: [], images: [], networks: [], volumes: [] },
    secretNames: [],
    reportPath: null,
    deadlineAt,
  };

  // Persist the recovery identity before creating capture or secret state.
  // Any later preflight failure can then be recovered through the same
  // token-checked execution path if safe cleanup cannot be verified.
  const initialRecord = writeExecutionRecord(cwd, record);
  if (!initialRecord.ok) {
    const released = releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: initialRecord.reason, phase: "record", quotaReleased: released.ok, ...(!released.ok ? { executionId: identity.executionId, token: acquired.token } : {}) };
  }

  const capture = takeCapture({
    worktreePath,
    workId,
    workName,
    executionId: identity.executionId,
    cwd,
    ...(config.config.fixtureInputs ? {
      fixtureInputs: config.config.fixtureInputs,
      fixtureSourceIdentity: config.config.fixtureSourceIdentity,
      dockerfile: config.config.dockerfileRelative,
      context: config.config.contextRelative,
      configurationFingerprint: config.config.fingerprint,
    } : { include: config.config.include }),
    protectedPaths: [config.config.relativePath],
    onBeforeCompare: deps.onBeforeCaptureCompare,
  });
  if (!capture.ok) {
    return failBeforeResources(capture.reason, "capture", capture.refused, capture.refusals);
  }
  record.capture = {
    destination: capture.destination,
    manifest: capture.manifest,
  };

  const configurationStable = verifyConfigurationSnapshot(projectRoot, config.config);
  if (!configurationStable.ok) return failBeforeResources(configurationStable.reason, "configuration");

  if (config.config.fixtureInputs) {
    const dockerfileSnapshot = readFixtureSnapshot(capture.destination, [config.config.dockerfileRelative]);
    if (!dockerfileSnapshot.ok ||
        dockerfileSnapshot.files[0].fingerprint !== capture.manifest.files.find((file) => file.path === config.config.dockerfileRelative)?.fingerprint) {
      return failBeforeResources("the fixture Dockerfile changed or became unverifiable", "fixture dependencies");
    }
    const runtime = checkFixtureRuntimeInputs(dockerfileSnapshot.files[0].bytes, run);
    if (!runtime.ok) return failBeforeResources(runtime.reason, "fixture dependencies");
    record.fixtureRuntimeInputs = runtime.images;
  }

  const secrets = writeSecretFile(cwd, identity.executionId, config.config.testSecrets);
  if (!secrets.ok) {
    return failBeforeResources(secrets.reason, "secrets");
  }
  record.secretNames = secrets.names;

  const imageTag = `sandbox/${identity.normalizedWorkName}:${identity.executionId}`;

  // The declared Dockerfile and the declared context are mapped onto the
  // captured tree. A path that does not map is refused: the build would
  // otherwise use a different file than the project declared.
  const mappedDockerfile = relativeToCapture(capture.destination, config.config.dockerfileRelative, projectRoot);
  if (!mappedDockerfile.ok) {
    return failBeforeResources(mappedDockerfile.reason, "dockerfile");
  }
  const mappedContext = relativeToCapture(capture.destination, config.config.contextRelative, projectRoot);
  if (!mappedContext.ok) {
    return failBeforeResources(mappedContext.reason, "context");
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
    return failBeforeResources(build.reason, "build arguments");
  }

  // The record is persisted before the first resource is created, so a
  // failure after that point leaves a record the recovery can act on.
  // When the record cannot be persisted, no resource is created at all:
  // a resource the recovery cannot find is a resource nobody owns.
  record.phase = "building";
  const persisted = writeExecutionRecord(cwd, record);
  if (!persisted.ok) {
    const cleanup = removePreflightState();
    const released = cleanup.ok ? releaseReservation(cwd, acquired.token, { resourcesAbsent: true }) : { ok: false };
    return {
      ok: false,
      reason: persisted.reason,
      phase: "record",
      quotaReleased: released.ok,
      resourcesKept: !released.ok,
      ...(!released.ok ? { executionId: identity.executionId, token: acquired.token } : {}),
    };
  }

  function removePreflightState() {
    try {
      // Keep the durable execution record until the capture is confirmed gone.
      const captureSegments = [".opencode", "state", "sandbox", "captures", identity.executionId];
      const capturePath = verifyManagedPath(cwd, captureSegments);
      if (!capturePath.ok) throw new Error(capturePath.reason);
      if (config.config.fixtureInputs) {
        const root = captureRootDir(cwd);
        if (!root.ok || !discardFixtureSnapshot(root.dir, identity.executionId)) throw new Error("fixture capture cleanup could not be verified");
      } else removeManagedTree(cwd, captureSegments);
      if (existsSync(capturePath.path)) throw new Error("the capture still exists after preflight cleanup");

      const executionSegments = [".opencode", "state", "sandbox", "executions", identity.executionId];
      const executionPath = verifyManagedPath(cwd, executionSegments);
      if (!executionPath.ok) throw new Error(executionPath.reason);
      removeManagedTree(cwd, executionSegments);
      if (existsSync(executionPath.path)) throw new Error("the execution record still exists after preflight cleanup");
      return { ok: true };
    } catch (error) { return { ok: false, reason: error.message }; }
  }

  function failBeforeResources(reason, phase, refused, refusals) {
    // Fixture refusal evidence survives removal of private staging and quota
    // release. Raw input bytes and credential-shaped findings never enter it.
    let evidence;
    if (config.config.fixtureInputs) {
      record.result = "blocked";
      record.phase = phase;
      record.failure = reason;
      const report = buildReport(record, { result: "blocked", steps: [`fixture blocked in ${phase}`, screenValue(reason) ? "unsafe input refused" : reason] });
      evidence = report.ok ? writeReport(cwd, identity.executionId, report.report) : report;
      if (!evidence.ok) {
        record.phase = "cleanup-pending";
        writeExecutionRecord(cwd, record);
        return {
          ok: false, blocked: true, reason: evidence.reason, phase,
          quotaReleased: false, resourcesKept: true,
          executionId: identity.executionId, token: acquired.token,
        };
      }
      record.reportPath = evidence.path;
    }
    const cleanup = removePreflightState();
    if (!cleanup.ok && config.config.fixtureInputs) writeExecutionRecord(cwd, { ...record, phase: "cleanup-pending" });
    const released = cleanup.ok ? releaseReservation(cwd, acquired.token, { resourcesAbsent: true }) : { ok: false };
    return {
      ok: false, blocked: Boolean(config.config.fixtureInputs), reason, phase, quotaReleased: released.ok, resourcesKept: !released.ok,
      ...(evidence?.path ? { reportPath: evidence.path } : {}),
      ...(refused ? { refused } : {}), ...(refusals ? { refusals } : {}),
      ...(!released.ok ? { executionId: identity.executionId, token: acquired.token } : {}),
    };
  }

  // A failure after this point must not release the quota while the
  // resources it created are still present: the quota is released only
  // after the labeled cleanup has verified their absence.
  const abandon = (reason, phase) => {
    const evidence = preserveClosure(cwd, record, `start failed in ${phase ?? record.phase}`);
    if (!evidence.ok) return {
      ok: false, phase, reason: evidence.reason, quotaReleased: false, resourcesKept: true,
      executionId: identity.executionId, token: acquired.token,
    };
    const cleanup = cleanupExecution(cwd, identity.executionId, { ...deps, preserveExecutionRecord: true });
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
      ...(record.reportPath ? { reportPath: record.reportPath } : {}),
      ...(!quotaReleased ? { executionId: identity.executionId, token: acquired.token } : {}),
    };
  };

  if (config.config.fixtureInputs) {
    deps.onBeforeFixtureBuild?.(capture.destination);
    const stableConfig = verifyConfigurationSnapshot(projectRoot, config.config);
    const stableSource = verifyFixtureSource(capture.manifest);
    const stableCapture = verifyFixtureCapture(capture.destination, capture.manifest);
    if (!stableConfig.ok || !stableSource.ok || !stableCapture.ok) {
      return failBeforeResources(stableConfig.reason ?? stableSource.reason ?? stableCapture.reason, "fixture revalidation");
    }
  }

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

  if (record.deadlineAt) {
    const supervisor = await armSupervisor(cwd, {
      executionId: identity.executionId,
      workId,
      workName,
      deadlineAt: record.deadlineAt,
      token: acquired.token,
    }, { spawn: deps.supervisorSpawn });
    if (!supervisor.ok) return abandon(supervisor.reason, "supervisor");
  }

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
      engine: record.record.engine ?? null,
      image: record.record.image,
      container: record.record.container,
      captureFingerprint: record.record.capture?.manifest?.files?.length ?? null,
      captureMode: record.record.configuration?.parameters?.captureMode ?? "full-checkout",
      ...(record.record.configuration?.parameters?.captureMode === "fixture-inputs" ? {
        scope: "selected fixture inputs only",
        selectedInputCount: record.record.configuration.parameters.fixtureInputs.length,
      } : {}),
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
function writeExecutionRecordImpl(cwd, record) {
  const dir = executionDir(cwd, record.executionId);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const ensured = ensureDir(dir.dir);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };
  const temporary = join(dir.dir, `${RECORD_FILE}.${randomUUID()}.tmp`);
  try {
    const safe = verifyManagedPath(cwd, [".opencode", "state", "sandbox", "executions", record.executionId, RECORD_FILE]);
    if (!safe.ok) return safe;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(dir.dir, RECORD_FILE));
    return { ok: true, path: join(dir.dir, RECORD_FILE) };
  } catch (err) {
    try { unlinkSync(temporary); } catch { /* the prior canonical record remains intact */ }
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
function finishSandboxImpl(cwd, executionId, input, deps = {}) {
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
    const verified = verifyOwner(cwd, token, { executionId, ...(record.record.generation ? { generation: record.record.generation } : {}) });
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
      quotaReleased: false,
      note: "the resources are kept because the evidence could not be preserved",
    };
  }

  const cleanup = cleanupExecution(cwd, executionId, { ...deps, preserveExecutionRecord: true });
  record.record.result = result;
  record.record.phase = cleanup.ok ? "closed" : "cleanup-pending";
  record.record.reportPath = written.path;
  const terminal = writeExecutionRecord(cwd, record.record);
  if (!terminal.ok) return { ...terminal, quotaReleased: false, reportPath: written.path };

  // The quota is released only after the evidence is preserved and the
  // absence of the resources is verified. A cleanup that could not
  // complete keeps the block.
  let quotaReleased = false;
  if (cleanup.ok && token && record.record.tokenRequired !== false) {
    const disarmed = disarmSupervisor(cwd, executionId);
    if (!disarmed.ok) {
      writeExecutionRecord(cwd, { ...record.record, phase: "cleanup-pending" });
      return { ...disarmed, quotaReleased: false };
    }
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
  const safeDifferences = [];
  const screenReportValues = (values, label, safeValues) => {
    for (const [index, value] of (Array.isArray(values) ? values : []).entries()) {
      let serialized;
      try { serialized = typeof value === "string" ? value : JSON.stringify(value); }
      catch { problems.push({ field: label, index, reason: "value could not be serialized" }); continue; }
      const reason = screenValue(serialized);
      if (reason) problems.push({ field: label, index, reason });
      else safeValues.push(value);
    }
  };
  screenReportValues(steps, "steps", safeSteps);
  screenReportValues(differencesFromProduction, "differencesFromProduction", safeDifferences);
  const resultReason = screenValue(String(result ?? ""));
  if (resultReason) problems.push({ field: "result", reason: resultReason });
  if (problems.length > 0) {
    return {
      ok: false,
      reason: `the report was refused: ${problems.length} caller-supplied value(s) contain a credential-shaped value or cannot be serialized`,
      problems,
    };
  }

  const report = {
      version: 1,
      result,
      executionId: record.executionId,
      workId: record.workId,
      workName: record.workName,
      source: record.source ?? null,
      configuration: record.configuration ?? null,
      startedAt: record.startedAt,
      concludedAt: new Date().toISOString(),
      capture: {
        mode: record.configuration?.parameters?.captureMode ?? "full-checkout",
        ...(record.configuration?.parameters?.captureMode === "fixture-inputs" ? {
          selectedPaths: record.configuration.parameters.fixtureInputs,
          configurationFingerprint: record.configuration.fingerprint,
          inputFiles: record.capture?.manifest?.files ?? [],
          runtimeImages: record.fixtureRuntimeInputs ?? [],
          scope: "selected fixture inputs only; not a whole-checkout certification",
        } : {}),
        branch: record.capture?.manifest?.branch ?? null,
        head: record.capture?.manifest?.head ?? null,
        files: record.capture?.manifest?.files?.length ?? 0,
        fingerprint: captureFingerprint(record),
      },
      engine: record.engine ?? null,
      image: record.image,
      container: record.container,
      network: record.network,
      steps: safeSteps,
      differencesFromProduction: safeDifferences,
      secretNames: record.secretNames,
      approved: false,
      note: "starting the environment does not approve the product",
  };
  let serialized;
  try { serialized = JSON.stringify(report); }
  catch { return { ok: false, reason: "the report was refused: caller-supplied values could not be serialized" }; }
  if (screenValue(serialized)) {
    return { ok: false, reason: "the report was refused: a caller-supplied value contains a credential-shaped value" };
  }
  return { ok: true, report };
}

function captureFingerprint(record) {
  const files = record.capture?.manifest?.files ?? [];
  const hash = files
    .map((file) => `${file.path}:${file.kind === "symlink" ? `symlink:${file.target}` : `file:${file.fingerprint ?? "unknown"}`}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(hash).digest("hex");
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
function cleanupExecutionImpl(cwd, executionId, deps = {}) {
  const record = readExecutionRecord(cwd, executionId);
  if (!record.ok) return { ok: false, reason: record.reason };

  let run;
  try { run = boundDocker(record.record.engine, deps); }
  catch (error) { return { ok: false, blocked: true, reason: error.message, remaining: ["engine identity unverified"] }; }
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
    if (ids === null) stillPresent.push({ kind, reason: "absence could not be verified" });
    else if (ids.length > 0) stillPresent.push({ kind, count: ids.length });
  }
  if (stillPresent.length > 0 || remaining.length > 0) {
    return {
      ok: false,
      reason: "the resources of the execution are still present",
      removed,
      remaining: [...remaining, ...stillPresent],
    };
  }

  // Remove the capture before its recovery record. If capture cleanup is
  // blocked, the durable record and token-checked recovery path remain.
  const captureRoot = captureRootDir(cwd);
  const expectedCapture = captureRoot.ok ? join(captureRoot.dir, executionId) : null;
  const recordedCapture = record.record.capture?.destination;
  const noCapturePrepared = record.record.capture === null && ["preparing", "closed", "cancelled", "failed"].includes(record.record.phase) && !existsSync(expectedCapture);
  const verifiedCapture = verifyManagedPath(cwd, [".opencode", "state", "sandbox", "captures", executionId]);
  if (!captureRoot.ok || !verifiedCapture.ok || resolve(verifiedCapture.path) !== resolve(expectedCapture) || (!noCapturePrepared && (typeof recordedCapture !== "string" || resolve(recordedCapture) !== resolve(expectedCapture)))) {
    remaining.push({ kind: "capture", reason: verifiedCapture.reason ?? "the recorded capture path is not the execution's verified capture path" });
  } else {
    try {
      if (existsSync(expectedCapture)) {
        if (lstatSync(expectedCapture).isSymbolicLink()) throw new Error("the capture path is a symbolic link");
        rmSync(expectedCapture, { recursive: true, force: false });
      }
      if (existsSync(expectedCapture)) throw new Error("the capture still exists after removal");
    } catch (error) {
      remaining.push({ kind: "capture", reason: `the capture could not be removed and verified: ${error.message}` });
    }
  }
  if (remaining.length > 0) {
    return { ok: false, reason: "the resources of the execution are still present", removed, remaining };
  }

  const dir = executionDir(cwd, executionId);
  if (dir.ok) {
    const verified = verifyManagedPath(cwd, [".opencode", "state", "sandbox", "executions", executionId]);
    try {
      if (!verified.ok || resolve(verified.path) !== resolve(dir.dir)) throw new Error(verified.reason ?? "the execution path does not match the managed root");
      if (deps.preserveExecutionRecord === true) {
        for (const name of readdirSync(dir.dir)) {
          if (name === RECORD_FILE) continue;
          // Only the known per-execution secret file and interrupted atomic
          // record writes belong to this control; unknown state is a block.
          if (name !== "test-secrets.env" && !new RegExp(`^${RECORD_FILE.replaceAll(".", "\\.")}\\.[a-f0-9-]+\\.tmp$`).test(name)) throw new Error("unrecognized execution state");
          const path = join(dir.dir, name);
          if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("unsafe execution secret/state path");
          unlinkSync(path);
          if (existsSync(path)) throw new Error("execution secret/state remains");
        }
      } else {
        removeManagedTree(cwd, [".opencode", "state", "sandbox", "executions", executionId]);
        if (existsSync(dir.dir)) throw new Error("the execution directory still exists after removal");
      }
    } catch (error) {
      remaining.push({ kind: "execution", reason: `the execution directory could not be removed and verified: ${error.message}` });
    }
  } else remaining.push({ kind: "execution", reason: dir.reason });

  if (remaining.length > 0) return { ok: false, reason: "the resources of the execution are still present", removed, remaining };

  return { ok: true, removed, remaining: [] };
}

function removeManagedTree(cwd, segments) {
  const checked = verifyManagedPath(cwd, segments);
  if (!checked.ok) throw new Error(checked.reason);
  const path = checked.path;
  if (!existsSync(path)) return;
  const rootStat = lstatSync(path);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("managed execution directory changed during cleanup");
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const childSegments = [...segments, entry.name];
    const parent = verifyManagedPath(cwd, segments);
    if (!parent.ok) throw new Error(parent.reason);
    const childPath = join(parent.path, entry.name);
    const stat = lstatSync(childPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) removeManagedTree(cwd, childSegments);
    else unlinkSync(childPath);
  }
  const parent = verifyManagedPath(cwd, segments.slice(0, -1));
  if (!parent.ok) throw new Error(parent.reason);
  rmdirSync(path);
}

function verifyManagedPath(cwd, segments) {
  const repository = resolveRepositoryRoot(cwd);
  if (!repository.ok) return { ok: false, reason: repository.reason };
  let path = repository.root;
  for (const [index, segment] of segments.entries()) {
    path = join(path, segment);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return { ok: false, reason: `a managed state path is a symbolic link: ${segment}` };
      if (index < segments.length - 1 && !stat.isDirectory()) return { ok: false, reason: `a managed state path is not a directory: ${segment}` };
    } catch (error) {
      if (error.code === "ENOENT") return { ok: true, path };
      return { ok: false, reason: `a managed state path could not be verified: ${error.message}` };
    }
  }
  return { ok: true, path };
}

function preserveClosure(cwd, record, reason) {
  // A retry/cancel must not replace the original runtime observations.
  const directory = reportDir(cwd);
  if (!directory.ok) return directory;
  const existing = join(directory.dir, `${record.executionId}.json`);
  if (existsSync(existing)) {
    try {
      const original = JSON.parse(readFileSync(existing, "utf8"));
      if (original.executionId !== record.executionId || !RESULT_STATES.includes(original.result)) throw new Error("invalid report");
      record.reportPath = existing;
      return { ok: true, path: existing };
    } catch {
      return { ok: false, reason: "existing execution evidence could not be verified; resources are preserved" };
    }
  }
  const report = buildReport(record, { result: record.result ?? "not executed", steps: [reason], differencesFromProduction: [] });
  if (!report.ok) return report;
  const saved = writeReport(cwd, record.executionId, report.report);
  if (saved.ok) record.reportPath = saved.path;
  return saved;
}

/**
 * Cancel an execution.
 *
 * The quota is kept until the resources are accounted for, so a
 * cancellation that cannot remove everything leaves the block in place.
 */
function cancelSandboxImpl(cwd, executionId, input = {}, deps = {}) {
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
    const verified = verifyOwner(cwd, token, { executionId, ...(record.record.generation ? { generation: record.record.generation } : {}) });
    if (!verified.ok) return { ok: false, reason: verified.reason };
  }

  const evidence = preserveClosure(cwd, record.record, "execution cancelled");
  if (!evidence.ok) return { ...evidence, quotaReleased: false };
  const cleanup = cleanupExecution(cwd, executionId, { ...deps, preserveExecutionRecord: true });
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
  record.record.phase = "cancelled";
  record.record.result = record.record.result ?? "not executed";
  record.record.cancelReason = reason;
  const terminal = writeExecutionRecord(cwd, record.record);
  if (!terminal.ok) return { ...terminal, quotaReleased: false };

  let quotaReleased = false;
  if (token && record.record.tokenRequired !== false) {
    const disarmed = disarmSupervisor(cwd, executionId);
    if (!disarmed.ok) {
      writeExecutionRecord(cwd, { ...record.record, phase: "cleanup-pending" });
      return { ...disarmed, quotaReleased: false };
    }
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
function recoverSandboxImpl(cwd, executionId, deps = {}) {
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
    const current = readReservation(cwd);
    if (!current.ok) return { ok: false, blocked: true, reason: current.reason, quotaReleased: false };
    if (current.state === "free" || current.reservation.executionId !== executionId) {
      return { ok: true, alreadyClosed: true, reason: "the closure was already completed" };
    }
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
    const verified = verifyOwner(cwd, token, { executionId, ...(record.record.generation ? { generation: record.record.generation } : {}) });
    if (!verified.ok) {
      return { ok: false, reason: verified.reason, quotaReleased: false };
    }
  }

  const evidence = preserveClosure(cwd, record.record, "interrupted execution recovery");
  if (!evidence.ok) return { ...evidence, quotaReleased: false };
  const cleanup = cleanupExecution(cwd, executionId, { ...deps, preserveExecutionRecord: true });
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
  record.record.phase = "closed";
  record.record.result = record.record.result ?? "not executed";
  const terminal = writeExecutionRecord(cwd, record.record);
  if (!terminal.ok) return { ...terminal, quotaReleased: false };

  let quotaReleased = false;
  if (token && record.record.tokenRequired !== false) {
    const disarmed = disarmSupervisor(cwd, executionId);
    if (!disarmed.ok) {
      writeExecutionRecord(cwd, { ...record.record, phase: "cleanup-pending" });
      return { ...disarmed, quotaReleased: false };
    }
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


  return { ok: true, alreadyClosed: false, closed: true, quotaReleased };
}

/**
 * Close an execution whose deadline expired.
 *
 * The expiry closes the run without approving it, and it keeps the
 * reservation until the evidence is preserved and the cleanup is
 * verified.
 */
function closeExpiredExecutionImpl(cwd, executionId, deps = {}) {
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
    { result: "not executed", token: deps.token ?? null, steps: [], differencesFromProduction: ["the agreed maximum duration expired"] },
    deps,
  );
}

export { readReservation, releaseReservation, prepareIndependentRepository, labelArguments, mkdirSync };

/** Close resources for a journaled replacement without releasing its slot.
 * This is not a tool: ordinary callers still need the owner token. */
export function closeTransitionExecution(cwd, executionId, deps = {}) {
  if (!ownsSandboxOperation(cwd)) return { ok: false, blocked: true, reason: "transition closure needs exclusive operation ownership" };
  const journal = readTransition(cwd);
  const current = readReservation(cwd);
  const execution = readExecutionRecord(cwd, executionId);
  const transition = journal.transition;
  const generation = transition?.previousExecutionId === executionId ? transition.previousGeneration :
    transition?.successorExecutionId === executionId ? transition.successorGeneration : null;
  if (!journal.ok || !transition || !generation || !current.ok || !execution.ok || current.state !== "held" ||
      current.reservation.scope !== "sandbox" || current.reservation.executionId !== executionId ||
      current.reservation.generation !== generation || execution.record.generation !== generation ||
      current.reservation.workId !== transition.workId || execution.record.workId !== transition.workId) {
    return { ok: false, blocked: true, reason: "the transition, reservation and execution identity do not match" };
  }
  const evidence = preserveClosure(cwd, execution.record, "explicit sandbox replacement or transition recovery");
  if (!evidence.ok) return { ...evidence, quotaReleased: false };
  const cleanup = cleanupExecution(cwd, executionId, { ...deps, preserveExecutionRecord: true });
  if (!cleanup.ok) return { ...cleanup, quotaReleased: false };
  const supervisor = disarmSupervisor(cwd, executionId);
  if (!supervisor.ok) return { ...supervisor, quotaReleased: false };
  const saved = writeExecutionRecord(cwd, { ...execution.record, phase: "closed", result: execution.record.result ?? "not executed", reportPath: evidence.path ?? execution.record.reportPath });
  if (!saved.ok) return { ...saved, quotaReleased: false };
  return { ok: true, closed: true, quotaReleased: false, reportPath: evidence.path ?? execution.record.reportPath };
}

// All mutating entrypoints share the same cross-process operation boundary.
export function startSandbox(...args) {
  return withSandboxOperation(args[0]?.cwd ?? process.cwd(), "startSandbox", () => startSandboxImpl(...args));
}

export function finishSandbox(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "finishSandbox", () => finishSandboxImpl(...args));
}

export function cancelSandbox(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "cancelSandbox", () => cancelSandboxImpl(...args));
}

export function recoverSandbox(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "recoverSandbox", () => recoverSandboxImpl(...args));
}

export function closeExpiredExecution(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "closeExpiredExecution", () => closeExpiredExecutionImpl(...args));
}

export function cleanupExecution(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "cleanupExecution", () => cleanupExecutionImpl(...args));
}

export function writeExecutionRecord(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "writeExecutionRecord", () => writeExecutionRecordImpl(...args));
}

export function writeSecretFile(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "writeSecretFile", () => writeSecretFileImpl(...args));
}
