import { withSandboxOperation, ownsSandboxOperation, readTransition } from "./operation.mjs";
// The per-project quota and the local execution reservation.
//
// One application runs at a time per project. The quota is held by a
// reservation that records its owner, and it is released only when the
// identity of the owner and the absence of the resources are both
// verified. Age is never a release condition, and the death of a
// coordinator is never enough on its own.
//
// The token is the only way to stop the application, so it is treated as
// a secret: it is generated with a cryptographic source, it is stored as
// a salted verifier rather than in clear text, and it is never written to
// a log, a report, or an error message.
//
// The module is engine-free so the reservation rules can be tested
// without a running application.

import { randomBytes, timingSafeEqual, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  existsSync,
  chmodSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { ensureDir, reservationDir } from "./paths.mjs";

const RECORD_FILE = "reservation.json";
const TOKEN_BYTES = 32;
const SALT_BYTES = 16;
const SCRYPT_KEYLEN = 64;

/**
 * A reservation that is held.
 *
 * @typedef {object} Reservation
 * @property {string} workId        the work that owns the reservation
 * @property {string} workName      the normalized work name
 * @property {string} scope         what holds the quota: "application" or "sandbox"
 * @property {string} ownerTokenId  the opaque identifier of the owner token
 * @property {string} ownerHash     the salted verifier of the owner token
 * @property {string} ownerSalt     the salt of the verifier
 * @property {string} supervisorPid the supervisor process identity
 * @property {string} startedAt     the ISO time the reservation was taken
 * @property {number|null} processGroup the process group the reservation started
 * @property {string} sessionId     the session that took the reservation
 * @property {string|null} executable the name of the executable, never its arguments
 * @property {string|null} recoveredFrom the reservation a recovery acted on
 */

/**
 * Generate an owner token. The token is a high-entropy opaque string:
 * it authorizes stopping one process group, so it must not be guessable
 * and must not be derived from anything the caller can influence.
 */
export function generateOwnerToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Derive the verifier stored on disk. The token itself is never stored:
 * a stolen reservation file must not be enough to stop the application.
 */
export function deriveTokenVerifier(token, salt) {
  return scryptSync(token, salt, SCRYPT_KEYLEN).toString("base64");
}

/**
 * Compare a presented token with the stored verifier in constant time.
 */
export function tokenMatches(token, salt, expectedHash) {
  if (typeof token !== "string" || !token) return false;
  const actual = Buffer.from(deriveTokenVerifier(token, salt), "base64");
  let expected;
  try {
    expected = Buffer.from(expectedHash, "base64");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function recordPath(cwd) {
  const dir = reservationDir(cwd);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  return { ok: true, path: join(dir.dir, RECORD_FILE) };
}

/**
 * Read the current reservation. A missing record means the quota is
 * free. An unreadable record is reported as an unknown state, which
 * blocks a start rather than silently freeing the quota.
 */
export function readReservation(cwd = process.cwd()) {
  const path = recordPath(cwd);
  if (!path.ok) return { ok: false, reason: path.reason, state: "unknown" };
  if (!existsSync(path.path)) return { ok: true, state: "free", reservation: null };
  try {
    const record = JSON.parse(readFileSync(path.path, "utf8"));
    return { ok: true, state: "held", reservation: record };
  } catch (err) {
    return {
      ok: false,
      state: "unknown",
      reason: `the reservation record could not be read: ${err.message}`,
    };
  }
}

function writeReservationImpl(cwd, record) {
  const path = recordPath(cwd);
  if (!path.ok) return { ok: false, reason: path.reason };
  const dir = ensureDir(path.path.slice(0, path.path.length - RECORD_FILE.length - 1));
  if (!dir.ok) return { ok: false, reason: dir.reason };
  try {
    const temporary = `${path.path}.${randomBytes(12).toString("hex")}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path.path);
    try {
      chmodSync(path.path, 0o600);
    } catch {
      // A filesystem that refuses the mode is reported through the
      // result of the operation, not through a thrown error.
    }
    return { ok: true, record };
  } catch (err) {
    return { ok: false, reason: `the reservation could not be written: ${err.message}` };
  }
}

/** Internal replacement path: the project slot is overwritten atomically,
 * never released. Only a verified closed transition under the private
 * operation context authorizes minting successor ownership. */
export function replaceSandboxReservation(cwd, expected, successor) {
  if (!ownsSandboxOperation(cwd)) return { ok: false, blocked: true, reason: "replacement needs exclusive operation ownership" };
  const current = readReservation(cwd);
  const journal = readTransition(cwd);
  const old = current.reservation;
  if (!current.ok || current.state !== "held" || old.scope !== "sandbox" || !old.generation ||
      old.executionId !== expected.executionId || old.generation !== expected.generation || old.ownerTokenId !== expected.ownerTokenId ||
      !journal.ok || journal.transition?.phase !== "closed" || journal.transition.previousExecutionId !== old.executionId ||
      journal.transition.previousGeneration !== old.generation || journal.transition.workId !== old.workId ||
      journal.transition.successorExecutionId !== successor.executionId || journal.transition.successorGeneration !== successor.generation ||
      journal.transition.sessionId !== successor.sessionId) {
    return { ok: false, blocked: true, reason: "the closed transition does not authorize this reservation replacement" };
  }
  const token = generateOwnerToken();
  const salt = randomBytes(SALT_BYTES).toString("base64");
  const record = {
    ...old, schemaVersion: 2, executionId: successor.executionId, generation: successor.generation,
    sessionId: successor.sessionId, ownerTokenId: randomBytes(8).toString("hex"),
    ownerHash: deriveTokenVerifier(token, salt), ownerSalt: salt,
    supervisorPid: String(process.pid), ownerStartIdentity: processStartIdentity(process.pid),
    processGroup: null, deadlineAt: null, startedAt: new Date().toISOString(),
  };
  const written = writeReservation(cwd, record);
  return written.ok ? { ok: true, reservation: record, token } : written;
}

/**
 * Acquire the quota for a work.
 *
 * A start is refused before anything is launched when another session
 * already holds the reservation, and the refusal names the work that
 * holds it. The refusal never releases the existing reservation.
 *
 * The acquisition is exclusive: the record is created with an
 * exclusive open, so two sessions that observe the quota as free at the
 * same time cannot both write a reservation. The loser is refused, and
 * the quota stays with a single owner.
 */
function acquireReservationImpl(cwd, input) {
  const {
    workId,
    workName,
    scope = "application",
    supervisorPid = String(process.pid),
    sessionId = "",
    executable = null,
    processGroup = null,
    executionId = null,
    deadlineAt = null,
    ownerStartIdentity = processStartIdentity(supervisorPid),
  } = input ?? {};

  if (!workId || typeof workId !== "string") {
    return { ok: false, reason: "the reservation needs a work identifier" };
  }

  const path = recordPath(cwd);
  if (!path.ok) return { ok: false, reason: path.reason };
  const dir = ensureDir(path.path.slice(0, path.path.length - RECORD_FILE.length - 1));
  if (!dir.ok) return { ok: false, reason: dir.reason };

  const token = generateOwnerToken();
  const salt = randomBytes(SALT_BYTES).toString("base64");
  const record = {
    schemaVersion: 2,
    generation: randomBytes(16).toString("hex"),
    workId,
    workName: workName ?? workId,
    scope,
    ownerTokenId: randomBytes(8).toString("hex"),
    ownerHash: deriveTokenVerifier(token, salt),
    ownerSalt: salt,
    supervisorPid,
    ownerStartIdentity,
    executionId,
    deadlineAt,
    startedAt: new Date().toISOString(),
    processGroup,
    sessionId,
    executable,
    recoveredFrom: null,
  };

  // The exclusive create is the mutual exclusion. `wx` fails when the
  // record already exists, so the quota cannot be taken twice.
  let handle;
  try {
    handle = openSync(path.path, "wx", 0o600);
  } catch (err) {
    if (err.code === "EEXIST") {
      const current = readReservation(cwd);
      return {
        ok: false,
        blocked: true,
        reason: "the project quota is held by another session",
        heldBy: current.ok && current.state === "held"
          ? {
              workId: current.reservation.workId,
              workName: current.reservation.workName,
              scope: current.reservation.scope,
              startedAt: current.reservation.startedAt,
            }
          : null,
      };
    }
    return { ok: false, reason: `the reservation could not be created: ${err.message}` };
  }

  try {
    writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`);
  } catch (err) {
    try {
      closeSync(handle);
    } catch {
      // The handle is already unusable.
    }
    try {
      unlinkSync(path.path);
    } catch {
      // A failed write must not leave a reservation nobody owns.
    }
    return { ok: false, reason: `the reservation could not be written: ${err.message}` };
  }
  try {
    closeSync(handle);
  } catch {
    // The content is already on disk.
  }

  return { ok: true, reservation: record, token };
}

function processStartIdentity(pid) {
  if (process.platform === "win32") return null;
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function readProcessStartIdentity(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return null;
  return processStartIdentity(Number(pid));
}

/**
 * Record the process group of a held reservation.
 *
 * The group is written only when the token owns the reservation, so a
 * caller cannot attach a group to someone else's reservation.
 */
function updateReservationProcessGroupImpl(cwd, token, processGroup) {
  const verified = verifyOwner(cwd, token);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  const record = { ...verified.reservation, processGroup, processGroupStartIdentity: processStartIdentity(processGroup) };
  const written = writeReservation(cwd, record);
  if (!written.ok) return written;
  return { ok: true, reservation: record };
}

/**
 * Verify that a presented token owns the reservation.
 *
 * The comparison never signals anything: a wrong token is reported and
 * the reservation is left untouched.
 */
export function verifyOwner(cwd, token, expected = {}) {
  const current = readReservation(cwd);
  if (!current.ok) return { ok: false, reason: current.reason, verified: false };
  if (current.state !== "held") {
    return { ok: false, verified: false, reason: "there is no reservation to stop" };
  }
  if ((expected.executionId !== undefined && current.reservation.executionId !== expected.executionId) ||
      (expected.generation !== undefined && current.reservation.generation !== expected.generation)) {
    return { ok: false, verified: false, reason: "the reservation does not own this exact execution and generation" };
  }
  const verified = tokenMatches(token, current.reservation.ownerSalt, current.reservation.ownerHash);
  if (!verified) {
    return { ok: false, verified: false, reason: "the presented token does not own the reservation" };
  }
  return { ok: true, verified: true, reservation: current.reservation };
}

/**
 * Release the quota.
 *
 * The release happens only when the identity is verified and the caller
 * confirms that the resources are gone. A release that cannot verify its
 * preconditions keeps the block.
 */
function releaseReservationImpl(cwd, token, options = {}) {
  const { resourcesAbsent = false, recoveredFrom = null } = options;

  const verified = verifyOwner(cwd, token);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason, released: false };
  }
  if (!resourcesAbsent) {
    return {
      ok: false,
      released: false,
      reason: "the reservation is kept because the resources it owns are still present",
    };
  }

  const path = recordPath(cwd);
  if (!path.ok) return { ok: false, reason: path.reason, released: false };
  try {
    unlinkSync(path.path);
  } catch (err) {
    return { ok: false, reason: `the reservation could not be released: ${err.message}`, released: false };
  }

  return {
    ok: true,
    released: true,
    recoveredFrom: recoveredFrom ?? verified.reservation.workId,
  };
}

/**
 * Decide whether an abandoned reservation can be recovered.
 *
 * The recovery proceeds only when the exact owner is confirmed to have
 * ended and its group no longer has processes. It never proceeds on age,
 * and the decision is recorded so a retry does not act on a different
 * reservation.
 */
export function evaluateRecovery(cwd, input = {}) {
  const { ownerEnded = null, groupHasProcesses = null, groupStateKnown = true } = input;

  const current = readReservation(cwd);
  if (!current.ok) return { ok: false, reason: current.reason, recoverable: false };
  if (current.state !== "held") {
    return { ok: true, recoverable: false, reason: "there is no reservation to recover" };
  }

  if (ownerEnded !== true) {
    return {
      ok: true,
      recoverable: false,
      reason: "the owner of the reservation could not be confirmed to have ended",
    };
  }
  if (groupStateKnown === false || groupHasProcesses !== false) {
    return {
      ok: true,
      recoverable: false,
      reason: "the process group of the reservation is not confirmed to be empty",
    };
  }

  return {
    ok: true,
    recoverable: true,
    reason: "the owner ended and its process group is empty",
    reservation: current.reservation,
  };
}

export { writeReservation, recordPath };

// All mutating entrypoints share the same cross-process operation boundary.
function writeReservation(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "writeReservation", () => writeReservationImpl(...args));
}

export function acquireReservation(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "acquireReservation", () => acquireReservationImpl(...args));
}

export function updateReservationProcessGroup(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "updateReservationProcessGroup", () => updateReservationProcessGroupImpl(...args));
}

export function releaseReservation(...args) {
  return withSandboxOperation(args[0] ?? process.cwd(), "releaseReservation", () => releaseReservationImpl(...args));
}

/**
 * Release a reservation after a permission-gated control operation has
 * independently verified its exact owner identity and runtime absence.
 * This deliberately accepts no token and is usable only while the caller
 * owns the project operation lock.
 */
export function releaseVerifiedReservation(cwd, expected, { resourcesAbsent = false } = {}) {
  if (!ownsSandboxOperation(cwd)) return { ok: false, blocked: true, reason: "verified release needs exclusive operation ownership" };
  const current = readReservation(cwd);
  if (!current.ok || current.state !== "held" || !expected ||
      current.reservation.generation !== expected.generation ||
      current.reservation.ownerTokenId !== expected.ownerTokenId ||
      current.reservation.workId !== expected.workId || current.reservation.scope !== expected.scope) {
    return { ok: false, blocked: true, released: false, reason: "the reservation changed before verified release" };
  }
  if (resourcesAbsent !== true) return { ok: false, blocked: true, released: false, reason: "the owned runtime resources are not confirmed absent" };
  const path = recordPath(cwd);
  if (!path.ok) return { ok: false, blocked: true, released: false, reason: path.reason };
  try { unlinkSync(path.path); }
  catch (err) { return { ok: false, blocked: true, released: false, reason: `the reservation could not be released: ${err.message}` }; }
  return { ok: true, released: true, workId: expected.workId, scope: expected.scope };
}

/** Rotate an application reservation after verified Compose closure, keeping
 * the project slot occupied for one target worktree's explicit start. */
export function handoffApplicationReservation(cwd, expected, successor) {
  if (!ownsSandboxOperation(cwd)) return { ok: false, blocked: true, reason: "application handoff needs exclusive operation ownership" };
  const current = readReservation(cwd);
  const old = current.reservation;
  if (!current.ok || current.state !== "held" || old.scope !== "application" ||
      old.generation !== expected.generation || old.ownerTokenId !== expected.ownerTokenId || old.workId !== expected.workId ||
      successor?.resourcesAbsent !== true || typeof successor.workId !== "string" || !successor.workId ||
      typeof successor.sessionId !== "string" || !successor.sessionId || !Array.isArray(successor.persistentMounts) ||
      !successor.persistentMounts.length || typeof successor.composeFile !== "string" || !successor.composeFile.startsWith("/") ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(successor.composeProject ?? "") ||
      typeof successor.engineId !== "string" || !successor.engineId || successor.engineId.length > 255) {
    return { ok: false, blocked: true, reason: "verified closure or target handoff identity is incomplete" };
  }
  const token = generateOwnerToken();
  const salt = randomBytes(SALT_BYTES).toString("base64");
  const record = {
    ...old, generation: randomBytes(16).toString("hex"), workId: successor.workId,
    workName: successor.workName ?? successor.workId, sessionId: successor.sessionId,
    ownerTokenId: randomBytes(8).toString("hex"), ownerHash: deriveTokenVerifier(token, salt), ownerSalt: salt,
    supervisorPid: String(process.pid), ownerStartIdentity: processStartIdentity(process.pid),
    processGroup: null, processGroupStartIdentity: null, startedAt: new Date().toISOString(), awaitingStart: true,
    handoffComposeFile: successor.composeFile, handoffPersistentMounts: successor.persistentMounts,
    handoffComposeProject: successor.composeProject, handoffEngineId: successor.engineId,
    handoffFrom: { workId: old.workId, generation: old.generation },
  };
  const saved = writeReservation(cwd, record);
  return saved.ok ? { ok: true, reservation: record, token } : saved;
}

/** Complete only the exact target handoff after its new process is spawned. */
export function activateApplicationHandoff(cwd, token, processGroup, runtime = {}) {
  if (!ownsSandboxOperation(cwd)) return { ok: false, blocked: true, reason: "application handoff activation needs exclusive operation ownership" };
  const verified = verifyOwner(cwd, token);
  if (!verified.ok || verified.reservation.awaitingStart !== true || !Number.isSafeInteger(processGroup) || processGroup <= 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(runtime.composeProject ?? "") ||
      typeof runtime.engineId !== "string" || !runtime.engineId || runtime.engineId.length > 255) {
    return { ok: false, blocked: true, reason: "the awaiting-start reservation cannot be activated" };
  }
  const record = { ...verified.reservation, awaitingStart: false, processGroup,
    processGroupStartIdentity: processStartIdentity(processGroup), composeProject: runtime.composeProject,
    composeEngineId: runtime.engineId, handoffCompletedAt: new Date().toISOString() };
  delete record.handoffComposeFile;
  delete record.handoffPersistentMounts;
  delete record.handoffComposeProject;
  delete record.handoffEngineId;
  const saved = writeReservation(cwd, record);
  return saved.ok ? { ok: true, reservation: record } : saved;
}
