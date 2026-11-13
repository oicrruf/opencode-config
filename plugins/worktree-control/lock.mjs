// The lock that serializes the mutating operations of a project.
//
// The operations that mutate the worktree state run under a lock that
// records its owner, the time it was taken, and the scope it covers.
//
// A lock whose owner cannot be verified is preserved. Age, an isolated
// process identifier, and the absence of a response are not evidence
// that the owner is gone: the failure mode of a wrong reclaim is
// corrupting a live operation, while the failure mode of keeping a lock
// is a blockage the operator can see and resolve.

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync } from "node:fs";
import { checkStatePath, ensureStateDir, lockPath } from "./paths.mjs";

/**
 * Read the lock of the project.
 */
export function readLock(root) {
  const safe = checkStatePath(root, ["lock.json"], "file");
  if (!safe.ok) {
    return { ok: false, held: true, lock: null, reason: safe.reason, unsafePath: true };
  }
  const path = lockPath(root);
  if (!existsSync(path)) return { ok: true, held: false, lock: null };
  try {
    const lock = JSON.parse(readFileSync(path, "utf8"));
    return { ok: true, held: true, lock };
  } catch (err) {
    return {
      ok: false,
      held: true,
      lock: null,
      reason: `the lock could not be read: ${err.message}`,
    };
  }
}

/**
 * Verify that the owner of the lock is still running.
 *
 * A lock whose owner cannot be verified is reported as unverifiable
 * rather than as free. The check is deliberately conservative.
 */
export function verifyLockOwner(lock, deps = {}) {
  if (!lock?.ownerPid) {
    return { ok: false, verified: false, reason: "the lock records no owner identity" };
  }

  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  try {
    const alive = isAlive(lock.ownerPid);
    if (alive === true) return { ok: true, verified: true };
    if (alive === false) {
      return {
        ok: true,
        verified: false,
        ended: true,
        reason: "the owner of the lock has ended",
      };
    }
    return {
      ok: false,
      verified: false,
      reason: "the state of the owner of the lock could not be determined",
    };
  } catch (err) {
    return {
      ok: false,
      verified: false,
      reason: `the state of the owner of the lock could not be determined: ${err.message}`,
    };
  }
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists and belongs to another user.
    if (err.code === "EPERM") return true;
    if (err.code === "ESRCH") return false;
    // Any other failure is an unknown state, not a dead process.
    return null;
  }
}

/**
 * Take the lock for a mutating operation.
 *
 * The lock is created with an exclusive create, so two operations that
 * observe the lock as free at the same time cannot both take it. The
 * loser is refused and the owner of the existing lock is reported.
 */
export function acquireLock(root, input = {}) {
  const { scope = "worktree", ownerPid = String(process.pid), ownerId = null } = input;

  const dir = ensureStateDir(root);
  if (!dir.ok) return { ok: false, reason: dir.reason };

  const path = lockPath(root);
  const safe = checkStatePath(root, ["lock.json"], "file");
  if (!safe.ok) return { ok: false, reason: safe.reason, unsafePath: true };
  const lock = {
    ownerPid: String(ownerPid),
    ownerId: ownerId ?? `${ownerPid}`,
    scope,
    takenAt: new Date().toISOString(),
  };

  let handle;
  try {
    handle = openSync(path, "wx", 0o600);
  } catch (err) {
    if (err.code !== "EEXIST") {
      return { ok: false, reason: `the lock could not be created: ${err.message}` };
    }
    // A lock already exists. Its owner is reported; the lock is never
    // reclaimed here.
    const current = readLock(root);
    if (!current.ok) return { ok: false, reason: current.reason, blocked: true };
    const verification = verifyLockOwner(current.lock);
    return {
      ok: false,
      blocked: true,
      reason: "another operation holds the lock of the project",
      heldBy: {
        ownerPid: current.lock?.ownerPid ?? null,
        ownerId: current.lock?.ownerId ?? null,
        scope: current.lock?.scope ?? null,
        takenAt: current.lock?.takenAt ?? null,
      },
      ownerVerifiable: verification.verified,
    };
  }

  try {
    writeFileSync(handle, `${JSON.stringify(lock, null, 2)}\n`);
  } catch (err) {
    try {
      closeSync(handle);
    } catch {
      // The handle is already unusable.
    }
    try {
      unlinkSync(path);
    } catch {
      // A failed write must not leave a lock nobody owns.
    }
    return { ok: false, reason: `the lock could not be written: ${err.message}` };
  }
  try {
    closeSync(handle);
  } catch {
    // The content is already on disk.
  }

  return { ok: true, lock, path };
}

/**
 * Release the lock.
 *
 * The release is refused when the lock is held by another owner: a
 * process must not release a lock it does not own.
 */
export function releaseLock(root, input = {}) {
  const { ownerPid = String(process.pid) } = input;
  const path = lockPath(root);
  if (!existsSync(path)) return { ok: true, released: false, reason: "there is no lock to release" };

  const current = readLock(root);
  if (!current.ok) return { ok: false, reason: current.reason };
  if (current.lock?.ownerPid && current.lock.ownerPid !== String(ownerPid)) {
    return {
      ok: false,
      released: false,
      reason: "the lock is held by another owner and was not released",
    };
  }

  try {
    unlinkSync(path);
  } catch (err) {
    return { ok: false, released: false, reason: `the lock could not be released: ${err.message}` };
  }
  return { ok: true, released: true };
}

/**
 * Report the state of the lock.
 *
 * A lock whose owner cannot be verified is preserved and reported as
 * unverifiable: the operator resolves it, the control does not reclaim
 * it.
 */
export function describeLock(root, deps = {}) {
  const current = readLock(root);
  if (!current.ok) return { ok: false, reason: current.reason };
  if (!current.held) return { ok: true, held: false, lock: null, ownerVerifiable: null };

  const verification = verifyLockOwner(current.lock, deps);
  return {
    ok: true,
    held: true,
    lock: {
      ownerPid: current.lock?.ownerPid ?? null,
      ownerId: current.lock?.ownerId ?? null,
      scope: current.lock?.scope ?? null,
      takenAt: current.lock?.takenAt ?? null,
    },
    ownerVerifiable: verification.verified,
    ownerEnded: verification.ended === true,
    reason: verification.reason,
    preserved: verification.verified !== true,
  };
}
