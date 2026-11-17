import { withSandboxOperation } from "./operation.mjs";
// The local execution start, the stop, and the process supervisor.
//
// An application is launched directly — never through a shell — so no
// argument is interpreted by an intermediate program. The reservation
// owns the process group; the stop signals that group and nothing else.
//
// The supervisor is a detached child that outlives the coordinator. It
// watches the reservation and closes the descendants that remain when
// the application ends on its own, so a group is never left running
// because nobody was watching.
//
// The module is engine-free: the process helpers are injectable so the
// rules can be tested without launching a real application.

import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync, lstatSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { screenArguments } from "./secret-screen.mjs";
import {
  acquireReservation,
  verifyOwner,
  releaseReservation,
  evaluateRecovery,
  tokenMatches,
  updateReservationProcessGroup,
  readReservation,
  activateApplicationHandoff,
} from "./reservation.mjs";
import { ensureDir, reservationDir, canonicalPath, isInside } from "./paths.mjs";
import { inspectLocalEngine, boundDocker } from "./engine.mjs";
import { readComposePersistentMounts, persistentMountSetsMatch } from "./compose-resources.mjs";

const SUPERVISOR_FILE = "supervisor.json";

function verifiedComposeFile(rootPath, filePath) {
  const root = canonicalPath(rootPath);
  const file = canonicalPath(filePath);
  if (!isInside(root, file) || file !== filePath) return false;
  let cursor = root;
  for (const part of relative(root, file).split(sep)) {
    cursor = join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) return false; } catch { return false; }
  }
  try { return statSync(file).isFile(); } catch { return false; }
}

function inspectComposeApplicationAbsence(reservation, deps) {
  if (!reservation.composeProject) {
    const executable = String(reservation.executable ?? "").toLowerCase();
    if (executable === "docker" || executable === "docker-compose" || executable === "podman-compose") {
      return { ok: false, reason: "the container runtime reservation has no recorded Compose project identity" };
    }
    return { ok: true, absent: true };
  }
  try {
    const engine = inspectLocalEngine(deps);
    if (!engine.ok || engine.binding.id !== reservation.composeEngineId) return { ok: false, reason: "the recorded Compose engine is unavailable or changed" };
    const docker = boundDocker(engine.binding, deps);
    const ids = String(docker("docker", ["ps", "--all", "--no-trunc", "--filter", `label=com.docker.compose.project=${reservation.composeProject}`, "--format", "{{.ID}}"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024,
    })).trim();
    return { ok: true, absent: !ids };
  } catch { return { ok: false, reason: "the Compose resources cannot be reconciled on the recorded engine" }; }
}

/**
 * Confirm that a managed worktree exists for the work.
 *
 * The sandbox and the reservation depend on the managed worktree
 * control, so the confirmation goes through the worktree API rather
 * than through a file format. The caller supplies the API; the control
 * never invents one.
 */
export async function confirmManagedWorktree(worktreeApi, workId) {
  if (!worktreeApi || typeof worktreeApi.list !== "function") {
    return { ok: false, reason: "the managed worktree control is not available" };
  }
  let entries;
  try {
    entries = await worktreeApi.list();
  } catch (err) {
    return { ok: false, reason: `the managed worktrees could not be listed: ${err.message}` };
  }
  const data = entries?.data ?? entries;
  const match = (Array.isArray(data) ? data : []).find((entry) => entry?.workId === workId && entry?.exists === true && typeof entry?.directory === "string");
  if (!match) {
    return { ok: false, reason: `the work ${workId} has no managed worktree` };
  }
  return { ok: true, worktree: match };
}

/**
 * Start a local application under the reservation.
 *
 * The executable is launched without a shell, the arguments are screened
 * for credential shapes before they are used, and only the name of the
 * executable is stored. The owner token is returned to the caller and
 * never recorded in the reservation in clear text.
 */
async function startLocalExecutionImpl(cwd, input, deps = {}) {
  const {
    workId,
    workName,
    executable,
    args = [],
    cwd: programCwd,
    env = {},
    sessionId = "",
    worktreeApi = null,
    token = null,
    composeFile = null,
  } = input ?? {};

  if (!workId) return { ok: false, reason: "the start needs a work identifier" };
  if (!executable) return { ok: false, reason: "the start needs an executable" };

  const argumentProblem = screenArguments(args);
  if (argumentProblem) {
    return {
      ok: false,
      reason: `the argument was refused because ${argumentProblem.reason}`,
      argument: argumentProblem.argument,
    };
  }

  const worktree = await confirmManagedWorktree(worktreeApi, workId);
  if (!worktree.ok) return { ok: false, reason: worktree.reason };

  // The quota is acquired before the process is launched, so a second
  // session is refused before anything runs. The reservation is
  // released again if the launch fails.
  const existing = readReservation(cwd);
  let acquired;
  let resumingHandoff = false;
  let handoffRuntime = null;
  if (!existing.ok) return { ok: false, blocked: true, reason: "the project reservation is unverifiable" };
  if (existing.state === "held") {
    const record = existing.reservation;
    if (record.scope !== "application" || record.awaitingStart !== true || record.workId !== workId ||
        record.sessionId !== sessionId || !record.handoffComposeFile || !Array.isArray(record.handoffPersistentMounts)) {
      return { ok: false, blocked: true, reason: "the project application slot is held by another owner or is not awaiting this handoff" };
    }
    const owner = verifyOwner(cwd, token);
    if (!owner.ok) return { ok: false, blocked: true, reason: owner.reason };
    if (typeof composeFile !== "string" || composeFile !== record.handoffComposeFile || !verifiedComposeFile(worktree.worktree.directory, record.handoffComposeFile) ||
        programCwd && programCwd !== worktree.worktree.directory || executable.split(/[\\/]/).pop() !== "docker" ||
        JSON.stringify(args) !== JSON.stringify(["compose", "--project-directory", record.handoffComposeFile.slice(0, record.handoffComposeFile.lastIndexOf("/")), "-f", record.handoffComposeFile, "up"])) {
      return { ok: false, blocked: true, reason: "handoff start must run the exact verified destination Compose file in foreground mode" };
    }
    const engine = inspectLocalEngine(deps);
    if (!engine.ok) return { ok: false, blocked: true, reason: engine.reason };
    try {
      const docker = boundDocker(engine.binding, deps);
      const target = readComposePersistentMounts(docker, { worktreePath: worktree.worktree.directory, composeFilePath: record.handoffComposeFile });
      if (!target.ok || !persistentMountSetsMatch(record.handoffPersistentMounts, target.mounts)) {
        return { ok: false, blocked: true, reason: "the destination persistent mounts changed after handoff; the reservation remains awaiting-start" };
      }
      if (target.projectName !== record.handoffComposeProject || engine.binding.id !== record.handoffEngineId) {
        return { ok: false, blocked: true, reason: "the destination Compose project or engine changed after handoff" };
      }
      handoffRuntime = { composeProject: target.projectName, engineId: engine.binding.id };
    } catch { return { ok: false, blocked: true, reason: "the destination Compose file could not be reverified before start" }; }
    acquired = { ok: true, token };
    resumingHandoff = true;
  } else {
    acquired = acquireReservation(cwd, {
      workId, workName, scope: "application", supervisorPid: String(process.pid), sessionId,
      executable: executable.split(/[\\/]/).pop(), processGroup: null,
    });
    if (!acquired.ok) {
      return { ok: false, blocked: true, reason: acquired.reason, heldBy: acquired.heldBy };
    }
  }

  const spawnFn = deps.spawn ?? spawn;
  let child;
  try {
    child = spawnFn(executable, args, {
      cwd: programCwd ?? worktree.worktree.directory,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
  } catch (err) {
    // The launch failed, so the reservation is given back with the same
    // verification every release requires.
    if (!resumingHandoff) releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: `the application could not be started: ${err.message}` };
  }

  // A process that cannot be launched reports the failure through an
  // asynchronous `error` event rather than by throwing. The reservation
  // is held until the process is known to exist, so a failed launch
  // gives it back instead of blocking the next start forever.
  const launch = await waitForLaunch(child, deps.launchTimeoutMs ?? 1000);

  if (!launch.ok) {
    if (!resumingHandoff) releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return {
      ok: false,
      reason: `the application could not be started: ${launch.reason}`,
    };
  }

  const processGroup = child.pid ?? null;

  // The process group is recorded on the reservation, so a stop knows
  // which group it owns.
  const updated = resumingHandoff
    ? activateApplicationHandoff(cwd, acquired.token, processGroup, handoffRuntime)
    : updateReservationProcessGroup(cwd, acquired.token, processGroup);
  if (!updated.ok) return { ok: false, blocked: true, reason: updated.reason, token: acquired.token, processGroup };

  return {
    ok: true,
    token: acquired.token,
    reservation: readReservation(cwd).reservation,
    processGroup,
    worktree: worktree.worktree,
  };
}

/**
 * Wait until the launched process is known to exist.
 *
 * A spawn that fails asynchronously emits `error`; a spawn that
 * succeeds emits `spawn`. The reservation is held only after one of
 * them arrives, so a failed launch never leaves the quota blocked.
 */
export function waitForLaunch(child, timeoutMs = 1000) {
  if (!child || typeof child.once !== "function") {
    // A spawn implementation that reports no events is taken at its
    // word: the caller owns the reservation it just took.
    return Promise.resolve({ ok: true });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      // The process emitted nothing within the window: it is treated as
      // launched, because a long-lived application does not emit
      // anything after `spawn`.
      finish({ ok: true });
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    child.once("spawn", () => finish({ ok: true }));
    child.once("error", (err) => finish({ ok: false, reason: err.message }));
  });
}

/**
 * Signal a process group. The signal reaches the group and nothing
 * else; a group that cannot be signalled is reported.
 */
export function stopProcessGroup(processGroup, deps = {}) {
  if (processGroup == null) {
    return { ok: false, reason: "the reservation has no process group" };
  }
  const killFn = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    killFn(-processGroup, "SIGTERM");
    return { ok: true, signalled: processGroup };
  } catch (err) {
    return { ok: false, reason: `the process group could not be signalled: ${err.message}` };
  }
}

/**
 * Inspect the state of a process group.
 *
 * The inspection is conservative: when the state cannot be determined,
 * the caller is told so, and an unverifiable state blocks a release
 * rather than permitting one.
 */
export function inspectProcessGroup(processGroup, deps = {}) {
  if (processGroup == null) {
    return { ok: false, known: false, hasProcesses: null, reason: "the reservation has no process group" };
  }
  const listFn = deps.listProcesses ?? defaultListProcesses;
  let processes;
  try {
    processes = listFn(processGroup);
  } catch (err) {
    return {
      ok: false,
      known: false,
      hasProcesses: null,
      reason: `the process state could not be inspected: ${err.message}`,
    };
  }
  if (!Array.isArray(processes)) {
    return {
      ok: false,
      known: false,
      hasProcesses: null,
      reason: "the process state could not be inspected",
    };
  }
  return { ok: true, known: true, hasProcesses: processes.length > 0, processes };
}

/**
 * List the processes that belong to a process group. The listing is
 * best-effort: a platform that cannot answer returns an empty list and
 * reports that the state is unknown.
 */
function defaultListProcesses(processGroup) {
  if (process.platform === "win32") throw new Error("process-group inspection is unavailable on this platform");
  // `ps` reports the process group as PGID. The listing is the honest
  // source: when the platform cannot answer, the caller is told that the
  // state is unknown rather than that the group is empty.
  const out = execFileSync("ps", ["-eo", "pid=,pgid="], { encoding: "utf8" });
  const target = String(processGroup);
  const found = [];
  for (const line of out.split("\n")) {
    const [pid, pgid] = line.trim().split(/\s+/);
    if (!pid || !pgid) continue;
    if (pgid === target) found.push({ pid: Number(pid), pgid: Number(pgid) });
  }
  return found;
}

/**
 * Stop an application through the token that owns it.
 *
 * A wrong token refuses the stop and signals nothing. A token that owns
 * the reservation signals only the managed group, and the reservation
 * is released only after the group is confirmed to be gone.
 */
async function stopLocalExecutionImpl(cwd, token, deps = {}) {
  const verified = verifyOwner(cwd, token);
  if (!verified.ok) {
    return { ok: false, signalled: false, released: false, reason: verified.reason };
  }

  const reservation = verified.reservation;
  const signalled = stopProcessGroup(reservation.processGroup, deps);
  if (!signalled.ok) {
    return { ok: false, signalled: false, released: false, reason: signalled.reason };
  }

  // The release waits for the absence of the resources. When the group
  // cannot be confirmed to be empty, the reservation is kept.
  const state = inspectProcessGroup(reservation.processGroup, deps);
  if (!state.ok || state.hasProcesses !== false) {
    return {
      ok: false,
      signalled: true,
      released: false,
      reason: "the process group is not confirmed to be empty, so the reservation is kept",
    };
  }

  const composeState = inspectComposeApplicationAbsence(reservation, deps);
  if (!composeState.ok || !composeState.absent) {
    return { ok: false, signalled: true, released: false, reason: composeState.reason ?? "Compose containers remain, so the reservation is kept" };
  }

  const released = releaseReservation(cwd, token, { resourcesAbsent: true });
  if (!released.ok) {
    return { ok: false, signalled: true, released: false, reason: released.reason };
  }
  return { ok: true, signalled: true, released: true };
}

/**
 * Close the descendants that remain in the reservation's group when the
 * application ended on its own.
 */
function closeRemainingDescendantsImpl(cwd, token, deps = {}) {
  const verified = verifyOwner(cwd, token);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const reservation = verified.reservation;
  const state = inspectProcessGroup(reservation.processGroup, deps);
  if (!state.ok) {
    return { ok: false, reason: state.reason, closed: false };
  }
  if (!state.hasProcesses) {
    const composeState = inspectComposeApplicationAbsence(reservation, deps);
    if (!composeState.ok || !composeState.absent) return { ok: false, reason: composeState.reason ?? "Compose containers remain; the reservation is kept", closed: false, released: false };
    const released = releaseReservation(cwd, token, { resourcesAbsent: true });
    return {
      ok: true,
      closed: true,
      released: released.ok,
      reason: released.ok ? undefined : released.reason,
    };
  }
  const signalled = stopProcessGroup(reservation.processGroup, deps);
  return { ok: true, closed: signalled.ok, signalled: signalled.ok, reason: signalled.reason };
}

/**
 * Decide whether an ambiguous reservation blocks the next start.
 *
 * The conditions are the ones the specification names: the owner's
 * identity does not match, the group still has processes, or the process
 * state cannot be inspected. Each of them blocks and is reported.
 */
export function evaluateAmbiguity(cwd, input = {}) {
  const { identityMatches = true, groupHasProcesses = false, groupStateKnown = true } = input;

  const current = evaluateRecovery(cwd, {
    ownerEnded: identityMatches ? false : true,
    groupHasProcesses,
    groupStateKnown,
  });
  if (!current.ok) {
    return { blocked: true, reason: current.reason };
  }
  if (!identityMatches) {
    return {
      blocked: true,
      reason: "the recorded owner's identity does not match the process that holds the reservation",
    };
  }
  if (!groupStateKnown) {
    return { blocked: true, reason: "the process state of the reservation is unverifiable" };
  }
  if (groupHasProcesses) {
    return { blocked: true, reason: "the reservation's process group still has processes" };
  }
  return { blocked: false, reason: undefined };
}

/**
 * Recover an abandoned reservation.
 *
 * The recovery acts only when the exact owner is confirmed to have ended
 * and its group is empty, and it records the reservation it acted on so
 * a retry does not release a different one.
 */
function recoverReservationImpl(cwd, input = {}, deps = {}) {
  const { token = null } = input;
  const current = readReservation(cwd);
  if (!current.ok || current.state !== "held") return { ok: false, released: false, reason: current.reason ?? "there is no held reservation" };
  const reservation = current.reservation;
  if (reservation.scope === "sandbox") {
    return { ok: false, released: false, reason: `sandbox reservations require sandbox_recover for execution ${reservation.executionId ?? "with its recorded execution identity"}` };
  }
  const owner = (deps.inspectOwner ?? inspectOwner)(reservation);
  if (!owner.ok) return { ok: false, released: false, reason: owner.reason };
  const group = inspectProcessGroup(reservation.processGroup, deps);
  const decision = evaluateRecovery(cwd, { ownerEnded: owner.ended, groupHasProcesses: group.hasProcesses, groupStateKnown: group.ok });
  if (!decision.ok) return { ok: false, released: false, reason: decision.reason };
  if (!decision.recoverable) {
    return { ok: false, released: false, reason: decision.reason };
  }

  const composeState = inspectComposeApplicationAbsence(reservation, deps);
  if (!composeState.ok || !composeState.absent) return { ok: false, released: false, reason: composeState.reason ?? "Compose containers remain; recovery keeps the reservation" };

  if (!token || !tokenMatchesForReservation(token, reservation)) {
    return {
      ok: false,
      released: false,
      reason: "the recovery did not present the token of the reservation it recovered",
    };
  }

  const released = releaseReservation(cwd, token, {
    resourcesAbsent: true,
    recoveredFrom: reservation.workId,
  });
  if (!released.ok) return { ok: false, released: false, reason: released.reason };
  return { ok: true, released: true, recoveredFrom: reservation.workId };
}

function tokenMatchesForReservation(token, reservation) {
  return tokenMatches(token, reservation.ownerSalt, reservation.ownerHash);
}

/**
 * Arm the detached supervisor that watches a reservation.
 *
 * The supervisor is a separate process so a coordinator that dies does
 * not take the watch with it. Its state is persisted next to the
 * reservation.
 */
async function armSupervisorImpl(cwd, input, deps = {}) {
  const { workId, workName, processGroup, deadlineAt = null, tokenId, executionId, token } = input ?? {};
  const dir = reservationDir(cwd);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const ensured = ensureDir(dir.dir);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };

  const path = join(dir.dir, SUPERVISOR_FILE);
  if (existsSync(path)) return { ok: false, reason: "a deadline supervisor record already exists for this project" };
  const state = {
    workId,
    workName,
    processGroup,
    executionId,
    deadlineAt,
    tokenId,
    supervisorPid: null,
    armedAt: new Date().toISOString(),
    nonce: randomBytes(8).toString("hex"),
  };
  if (!deadlineAt || !executionId || !token) return { ok: false, reason: "a deadline, execution identity, and owner token are required" };
  const spawnFn = deps.spawn ?? spawn;
  const helper = fileURLToPath(new URL("./deadline-supervisor.mjs", import.meta.url));
  let child;
  try {
    child = spawnFn(process.execPath, [helper], {
      cwd: process.cwd(), detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true,
    });
    if (!child?.pid || !child.stdin) throw new Error("the detached helper did not start");
    const launch = await waitForLaunch(child, 1000);
    if (!launch.ok) throw new Error(launch.reason);
    state.supervisorPid = String(child.pid);
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    child.stdin.end(JSON.stringify({ cwd, executionId, deadlineAt, token, supervisorPath: path }));
    child.unref?.();
  } catch (err) {
    try { child?.kill?.(); } catch { /* best-effort cleanup of an unarmed helper */ }
    return { ok: false, reason: `the supervisor could not be armed: ${err.message}` };
  }
  return { ok: true, supervisor: state, path };
}

/**
 * Read the armed supervisor's state.
 */
export function readSupervisor(cwd) {
  const dir = reservationDir(cwd);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const path = join(dir.dir, SUPERVISOR_FILE);
  if (!existsSync(path)) return { ok: true, supervisor: null };
  try {
    return { ok: true, supervisor: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { ok: false, reason: `the supervisor state could not be read: ${err.message}` };
  }
}

/**
 * Disarm the supervisor once the run is closed.
 */
function disarmSupervisorImpl(cwd, executionId = null) {
  const dir = reservationDir(cwd);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const path = join(dir.dir, SUPERVISOR_FILE);
  if (executionId !== null) {
    const current = readSupervisor(cwd);
    if (!current.ok || (current.supervisor && current.supervisor.executionId !== executionId)) {
      return { ok: false, blocked: true, reason: "the supervisor does not belong to this execution" };
    }
  }
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") return { ok: false, reason: "the supervisor record could not be removed" };
  }
  return { ok: true };
}

function inspectOwner(reservation) {
  if (!reservation?.supervisorPid || !reservation.ownerStartIdentity) {
    return { ok: false, ended: null, reason: "the recorded owner identity is incomplete; recovery is blocked" };
  }
  if (process.platform === "win32") {
    return { ok: false, ended: null, reason: "the owner process identity cannot be verified on this platform" };
  }
  const pid = Number(reservation.supervisorPid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { ok: false, ended: null, reason: "the recorded owner PID is invalid" };
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return { ok: true, ended: true };
    return { ok: false, ended: null, reason: `the recorded owner process could not be inspected: ${error.message}` };
  }
  try {
    const observed = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!observed) return { ok: false, ended: null, reason: "the recorded owner process identity could not be verified" };
    return { ok: true, ended: observed !== reservation.ownerStartIdentity };
  } catch (error) {
    return { ok: false, ended: null, reason: `the recorded owner process could not be inspected: ${error.message}` };
  }
}

// All mutating entrypoints share the same cross-process operation boundary.
export function startLocalExecution(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "startLocalExecution", () => startLocalExecutionImpl(...args));
}

export function stopLocalExecution(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "stopLocalExecution", () => stopLocalExecutionImpl(...args));
}

export function closeRemainingDescendants(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "closeRemainingDescendants", () => closeRemainingDescendantsImpl(...args));
}

export function recoverReservation(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "recoverReservation", () => recoverReservationImpl(...args));
}

export function armSupervisor(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "armSupervisor", () => armSupervisorImpl(...args));
}

export function disarmSupervisor(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "disarmSupervisor", () => disarmSupervisorImpl(...args));
}
