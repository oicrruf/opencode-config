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

function writeReservation(cwd, record) {
  const path = recordPath(cwd);
  if (!path.ok) return { ok: false, reason: path.reason };
  const dir = ensureDir(path.path.slice(0, path.path.length - RECORD_FILE.length - 1));
  if (!dir.ok) return { ok: false, reason: dir.reason };
  try {
    const temporary = `${path.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
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
export function acquireReservation(cwd, input) {
  const {
    workId,
    workName,
    scope = "application",
    supervisorPid = String(process.pid),
    sessionId = "",
    executable = null,
    processGroup = null,
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
    workId,
    workName: workName ?? workId,
    scope,
    ownerTokenId: randomBytes(8).toString("hex"),
    ownerHash: deriveTokenVerifier(token, salt),
    ownerSalt: salt,
    supervisorPid,
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

/**
 * Record the process group of a held reservation.
 *
 * The group is written only when the token owns the reservation, so a
 * caller cannot attach a group to someone else's reservation.
 */
export function updateReservationProcessGroup(cwd, token, processGroup) {
  const verified = verifyOwner(cwd, token);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  const path = recordPath(cwd);
  if (!path.ok) return { ok: false, reason: path.reason };
  const record = { ...verified.reservation, processGroup };
  try {
    writeFileSync(path.path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  } catch (err) {
    return { ok: false, reason: `the process group could not be recorded: ${err.message}` };
  }
  return { ok: true, reservation: record };
}

/**
 * Verify that a presented token owns the reservation.
 *
 * The comparison never signals anything: a wrong token is reported and
 * the reservation is left untouched.
 */
export function verifyOwner(cwd, token) {
  const current = readReservation(cwd);
  if (!current.ok) return { ok: false, reason: current.reason, verified: false };
  if (current.state !== "held") {
    return { ok: false, verified: false, reason: "there is no reservation to stop" };
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
export function releaseReservation(cwd, token, options = {}) {
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
