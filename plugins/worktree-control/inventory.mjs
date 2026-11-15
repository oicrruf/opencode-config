// The inventory of the worktrees of a project.
//
// The inventory file records what the control believes exists, but every
// read reconciles it against the worktrees that actually exist. An
// entry whose directory is gone is reported as missing, and a worktree
// that exists without an entry is reported as unrecorded.
//
// The reconciliation is what makes the inventory trustworthy after a
// crash, a manual removal, or a move of the checkout.

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync, openSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkStatePath, ensureStateDir, inventoryPath } from "./paths.mjs";

/**
 * The canonical form of a path.
 *
 * The same directory can be named by two spellings, and a temporary
 * directory lives under `/var` on macOS, which is a symbolic link to
 * `/private/var`. The comparison of a recorded entry with a listed
 * worktree has to be made on the canonical form, or the same worktree
 * is reported as missing and as unrecorded at the same time.
 */
function canonicalPath(path) {
  const resolved = resolve(path);
  try {
    return resolve(realpathSync(resolved));
  } catch {
    return resolved;
  }
}

/**
 * Read the recorded inventory.
 *
 * A missing inventory is not an error: the control may never have
 * created a worktree. An unreadable inventory is reported, because a
 * corrupted record must not be mistaken for an empty one.
 */
export function readInventory(root) {
  const safe = checkStatePath(root, ["inventory.json"], "file");
  if (!safe.ok) {
    return { ok: false, reason: safe.reason, entries: [], missing: false, unsafePath: true };
  }
  const path = inventoryPath(root);
  if (!existsSync(path)) {
    return { ok: true, entries: [], missing: false };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return { ok: true, entries, missing: false };
  } catch (err) {
    return {
      ok: false,
      reason: `the inventory could not be read: ${err.message}`,
      entries: [],
      missing: false,
    };
  }
}

/**
 * Write the inventory atomically: a temporary file and a rename, so an
 * interrupted write never leaves a half-written record.
 */
export function writeInventory(root, entries) {
  const dir = ensureStateDir(root);
  if (!dir.ok) return { ok: false, reason: dir.reason };

  const path = inventoryPath(root);
  const safe = checkStatePath(root, ["inventory.json"], "file");
  if (!safe.ok) return { ok: false, reason: safe.reason };
  const temporaryName = `inventory.json.${process.pid}.${Date.now()}.tmp`;
  const temporary = join(dirname(path), temporaryName);
  const safeTemporary = checkStatePath(root, [temporaryName], "file");
  if (!safeTemporary.ok) return { ok: false, reason: safeTemporary.reason };
  let handle;
  try {
    handle = openSync(temporary, "wx", 0o600);
    writeFileSync(handle, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries }, null, 2)}\n`);
    closeSync(handle);
    handle = undefined;
    renameSync(temporary, path);
    return { ok: true, path, entries };
  } catch (err) {
    if (handle !== undefined) {
      try {
        closeSync(handle);
      } catch {
        // The descriptor may already have been closed.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file was never created.
    }
    return { ok: false, reason: `the inventory could not be written: ${err.message}` };
  }
}

/**
 * Reconcile the recorded inventory with the worktrees that exist.
 *
 * The result carries three groups: the entries that are present, the
 * entries whose directory is gone, and the worktrees that exist without
 * a record. Nothing is dropped silently.
 *
 * The `verified` flag states whether the listing of the actual
 * worktrees is trustworthy. An unverified listing does not produce
 * "missing" entries: a worktree that could not be listed is unknown,
 * not gone, and reporting it as gone would make a creation duplicate
 * it.
 */
export function reconcileInventory(root, actualWorktrees = [], options = {}) {
  const verified = options.verified !== false;
  const recorded = readInventory(root);
  if (!recorded.ok) {
    return { ok: false, reason: recorded.reason, present: [], missing: [], unrecorded: [], verified };
  }

  const actual = new Map();
  for (const worktree of actualWorktrees ?? []) {
    if (!worktree?.directory) continue;
    // The paths are canonicalized before they are indexed: the same
    // directory can be named by two spellings, and a temporary
    // directory lives under a symbolic link on macOS. Without the
    // canonical form the same worktree would be reported as missing
    // and as unrecorded at the same time.
    actual.set(canonicalPath(worktree.directory), worktree);
  }

  const present = [];
  const missing = [];
  const unknown = [];
  const seen = new Set();

  for (const entry of recorded.entries) {
    const key = canonicalPath(entry.directory);
    const worktree = actual.get(key);
    if (worktree) {
      seen.add(key);
      present.push({
        ...entry,
        branch: worktree.branch ?? entry.branch ?? null,
        exists: true,
        recorded: true,
      });
      continue;
    }
    if (!verified) {
      // The listing could not be read: the entry's state is unknown,
      // and an unknown entry is never reported as gone.
      unknown.push({ ...entry, exists: null, recorded: true });
      continue;
    }
    // The directory is gone. The entry is reported as missing rather
    // than dropped, so the operator sees that a worktree disappeared.
    missing.push({ ...entry, exists: false, recorded: true });
  }

  const unrecorded = [];
  for (const [key, worktree] of actual) {
    if (seen.has(key)) continue;
    unrecorded.push({
      workId: worktree.name ?? null,
      directory: worktree.directory,
      branch: worktree.branch ?? null,
      createdAt: null,
      exists: true,
      recorded: false,
    });
  }

  return { ok: true, present, missing, unrecorded, unknown, entries: recorded.entries, verified };
}

/**
 * The full report of the worktrees the project holds.
 */
export function describeInventory(root, actualWorktrees = [], options = {}) {
  const reconciled = reconcileInventory(root, actualWorktrees, options);
  if (!reconciled.ok) return { ok: false, reason: reconciled.reason };

  const all = [
    ...reconciled.present,
    ...reconciled.unrecorded,
    ...reconciled.missing,
    ...reconciled.unknown,
  ];
  return {
    ok: true,
    verified: reconciled.verified,
    worktrees: all.map((entry) => ({
      workId: entry.workId ?? null,
      directory: entry.directory,
      branch: entry.branch ?? null,
      createdAt: entry.createdAt ?? null,
      state:
        entry.exists === false
          ? "missing"
          : entry.exists === null
            ? "unknown"
            : entry.recorded
              ? "present"
              : "unrecorded",
    })),
    total: all.length,
    present: reconciled.present.length,
    missing: reconciled.missing.length,
    unrecorded: reconciled.unrecorded.length,
    unknown: reconciled.unknown.length,
  };
}

/**
 * Record a worktree in the inventory.
 */
export function recordWorktree(root, entry) {
  const current = readInventory(root);
  if (!current.ok) return { ok: false, reason: current.reason };

  // The directory is compared on its canonical form, so the same
  // worktree is not recorded twice under two spellings.
  const key = canonicalPath(entry.directory);
  const entries = current.entries.filter(
    (existing) => canonicalPath(existing.directory) !== key,
  );
  entries.push({
    workId: entry.workId ?? null,
    directory: entry.directory,
    branch: entry.branch ?? null,
    createdAt: entry.createdAt ?? new Date().toISOString(),
  });

  const written = writeInventory(root, entries);
  if (!written.ok) return { ok: false, reason: written.reason };
  return { ok: true, entry: written.entries[written.entries.length - 1] };
}

/**
 * Find the recorded worktree of a work.
 */
export function findByWorkId(root, workId) {
  const current = readInventory(root);
  if (!current.ok) return { ok: false, reason: current.reason };
  const entry = current.entries.find((candidate) => candidate.workId === workId);
  return { ok: true, entry: entry ?? null };
}

/**
 * Remove a worktree from the inventory.
 */
export function forgetWorktree(root, directory) {
  const current = readInventory(root);
  if (!current.ok) return { ok: false, reason: current.reason };
  const entries = current.entries.filter((entry) => entry.directory !== directory);
  const written = writeInventory(root, entries);
  if (!written.ok) return { ok: false, reason: written.reason };
  return { ok: true, entries };
}
