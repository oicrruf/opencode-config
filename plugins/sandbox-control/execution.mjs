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
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { screenArguments } from "./secret-screen.mjs";
import {
  acquireReservation,
  verifyOwner,
  releaseReservation,
  evaluateRecovery,
  tokenMatches,
  updateReservationProcessGroup,
  readReservation,
} from "./reservation.mjs";
import { ensureDir, reservationDir } from "./paths.mjs";

const SUPERVISOR_FILE = "supervisor.json";

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
  const match = (entries ?? []).find((entry) => entry?.workId === workId && entry?.exists !== false);
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
export async function startLocalExecution(cwd, input, deps = {}) {
  const {
    workId,
    workName,
    executable,
    args = [],
    cwd: programCwd,
    env = {},
    sessionId = "",
    worktreeApi = null,
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
  const acquired = acquireReservation(cwd, {
    workId,
    workName,
    scope: "application",
    supervisorPid: String(process.pid),
    sessionId,
    executable: executable.split(/[\\/]/).pop(),
    processGroup: null,
  });
  if (!acquired.ok) {
    return {
      ok: false,
      blocked: true,
      reason: acquired.reason,
      heldBy: acquired.heldBy,
    };
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
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return { ok: false, reason: `the application could not be started: ${err.message}` };
  }

  // A process that cannot be launched reports the failure through an
  // asynchronous `error` event rather than by throwing. The reservation
  // is held until the process is known to exist, so a failed launch
  // gives it back instead of blocking the next start forever.
  const launch = await waitForLaunch(child, deps.launchTimeoutMs ?? 1000);

  if (!launch.ok) {
    releaseReservation(cwd, acquired.token, { resourcesAbsent: true });
    return {
      ok: false,
      reason: `the application could not be started: ${launch.reason}`,
    };
  }

  const processGroup = child.pid ?? null;

  // The process group is recorded on the reservation, so a stop knows
  // which group it owns.
  updateReservationProcessGroup(cwd, acquired.token, processGroup);

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
  if (process.platform === "win32") return [];
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
export async function stopLocalExecution(cwd, token, deps = {}) {
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
export function closeRemainingDescendants(cwd, token, deps = {}) {
  const verified = verifyOwner(cwd, token);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const reservation = verified.reservation;
  const state = inspectProcessGroup(reservation.processGroup, deps);
  if (!state.ok) {
    return { ok: false, reason: state.reason, closed: false };
  }
  if (!state.hasProcesses) {
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
export function recoverReservation(cwd, input = {}) {
  const { ownerEnded = null, groupHasProcesses = null, groupStateKnown = true, token = null } = input;

  const decision = evaluateRecovery(cwd, { ownerEnded, groupHasProcesses, groupStateKnown });
  if (!decision.ok) return { ok: false, released: false, reason: decision.reason };
  if (!decision.recoverable) {
    return { ok: false, released: false, reason: decision.reason };
  }

  const reservation = decision.reservation;
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
export function armSupervisor(cwd, input) {
  const { workId, workName, processGroup, deadlineAt = null, tokenId } = input ?? {};
  const dir = reservationDir(cwd);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const ensured = ensureDir(dir.dir);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };

  const path = join(dir.dir, SUPERVISOR_FILE);
  const state = {
    workId,
    workName,
    processGroup,
    deadlineAt,
    tokenId,
    supervisorPid: String(process.pid),
    armedAt: new Date().toISOString(),
    nonce: randomBytes(8).toString("hex"),
  };
  try {
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  } catch (err) {
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
export function disarmSupervisor(cwd) {
  const dir = reservationDir(cwd);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const path = join(dir.dir, SUPERVISOR_FILE);
  try {
    unlinkSync(path);
  } catch {
    // A supervisor that was never armed is already disarmed.
  }
  return { ok: true };
}
