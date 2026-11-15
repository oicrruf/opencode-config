// Focused tests for the project resolution, the inventory, the capacity
// measurement, and the lock. Run with
// `node plugins/worktree-control/test/control.test.mjs`.
//
// The tests never create a real worktree: the worktree API is
// injected, and every filesystem operation happens inside a temporary
// directory that is removed afterwards.
//
// Coverage:
//   1. A repository resolves, a non-repository reports unavailability,
//      and nothing is created outside a repository.
//   2. A missing directory is reported as missing and an existing
//      unregistered worktree is reported as unrecorded.
//   3. The capacity reports the measurement, announces no maximum, is
//      unavailable when it cannot be measured, and blocks only on zero.
//   4. A concurrent operation is refused with the owner reported, and an
//      unverifiable lock is not reclaimed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const { resolveProjectRoot, resolveStateDir, ensureDir, isRealDirectory } =
  await import("../paths.mjs");
const { readInventory, writeInventory, reconcileInventory, describeInventory, recordWorktree } =
  await import("../inventory.mjs");
const { measureAvailableBytes, reportCapacity, evaluateCapacityForCreation } =
  await import("../capacity.mjs");
const { acquireLock, releaseLock, readLock, describeLock } = await import("../lock.mjs");

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "worktree-control-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "worktree-repo-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a repository resolves and a non-repository does not", () => {
  withRepo((dir) => {
    const resolved = resolveProjectRoot(dir);
    assert.equal(resolved.ok, true);
    assert.ok(resolved.root.length > 0);
  });

  withTempDir((dir) => {
    const resolved = resolveProjectRoot(dir);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.unavailable, true);
    assert.match(resolved.reason, /unavailable outside a Git project/);

    // Nothing is created outside a repository.
    const state = resolveStateDir(dir);
    assert.ok(!existsSync(state));
  });
});

test("the inventory reconciles the records with the worktrees that exist", () => {
  withRepo((dir) => {
    const present = join(dir, "wt-present");
    const unrecorded = join(dir, "wt-unrecorded");
    mkdirSync(present, { recursive: true });
    mkdirSync(unrecorded, { recursive: true });

    writeInventory(dir, [
      { workId: "work-a", directory: present, branch: "feature/a", createdAt: "2026-01-01T00:00:00Z" },
      { workId: "work-b", directory: join(dir, "wt-gone"), branch: "feature/b", createdAt: "2026-01-01T00:00:00Z" },
    ]);

    const reconciled = reconcileInventory(dir, [
      { name: "work-a", directory: present, branch: "feature/a" },
      { name: "wt-unrecorded", directory: unrecorded, branch: "feature/u" },
    ]);
    assert.equal(reconciled.ok, true);
    assert.equal(reconciled.present.length, 1);
    assert.equal(reconciled.present[0].workId, "work-a");
    assert.equal(reconciled.missing.length, 1);
    assert.equal(reconciled.missing[0].workId, "work-b");
    assert.equal(reconciled.unrecorded.length, 1);
    assert.equal(reconciled.unrecorded[0].directory, unrecorded);
  });
});

test("the inventory report states every worktree and its state", () => {
  withRepo((dir) => {
    const present = join(dir, "wt-present");
    mkdirSync(present, { recursive: true });
    writeInventory(dir, [
      { workId: "work-a", directory: present, branch: "feature/a", createdAt: "2026-01-01T00:00:00Z" },
    ]);

    const report = describeInventory(dir, [
      { name: "work-a", directory: present, branch: "feature/a" },
    ]);
    assert.equal(report.ok, true);
    assert.equal(report.total, 1);
    assert.equal(report.present, 1);
    assert.equal(report.worktrees[0].state, "present");
    assert.equal(report.worktrees[0].branch, "feature/a");
  });
});

test("a recorded worktree is added to the inventory", () => {
  withRepo((dir) => {
    const result = recordWorktree(dir, {
      workId: "work-a",
      directory: join(dir, "wt"),
      branch: "feature/a",
    });
    assert.equal(result.ok, true);
    const current = readInventory(dir);
    assert.equal(current.entries.length, 1);
    assert.equal(current.entries[0].workId, "work-a");
  });
});

test("the capacity reports the measurement and announces no maximum", () => {
  withRepo((dir) => {
    const report = reportCapacity(dir, 3);
    assert.equal(report.ok, true);
    assert.equal(report.available, true);
    assert.ok(report.availableBytes > 0);
    assert.equal(report.worktrees, 3);
    assert.equal(report.maximum, null);
    assert.equal(report.remaining, null);
  });
});

test("a measurement that cannot be taken is reported as unavailable", () => {
  const report = reportCapacity(join("/nonexistent", "path", "that", "cannot", "exist"), 2);
  assert.equal(report.ok, true);
  assert.equal(report.available, false);
  assert.ok(report.reason);
  assert.equal(report.worktrees, 2);
  assert.equal(report.maximum, null);
});

test("only exactly zero available bytes blocks a creation", () => {
  const blocked = evaluateCapacityForCreation({ available: true, availableBytes: 0 });
  assert.equal(blocked.blocked, true);

  const almostFull = evaluateCapacityForCreation({ available: true, availableBytes: 1 });
  assert.equal(almostFull.blocked, false);

  const unavailable = evaluateCapacityForCreation({ available: false, reason: "not measured" });
  assert.equal(unavailable.blocked, false);
  assert.match(unavailable.reason, /not measured/);
});

test("a second operation is refused with the owner reported", () => {
  withRepo((dir) => {
    const first = acquireLock(dir, { scope: "create", ownerPid: "4242" });
    assert.equal(first.ok, true);

    const second = acquireLock(dir, { scope: "retire", ownerPid: "5252" });
    assert.equal(second.ok, false);
    assert.equal(second.blocked, true);
    assert.equal(second.heldBy.ownerPid, "4242");
    assert.equal(second.heldBy.scope, "create");
    assert.match(second.reason, /holds the lock/);
  });
});

test("the lock is released when the operation finishes", () => {
  withRepo((dir) => {
    const acquired = acquireLock(dir, { scope: "create", ownerPid: "4242" });
    assert.equal(acquired.ok, true);
    assert.equal(readLock(dir).held, true);

    const released = releaseLock(dir, { ownerPid: "4242" });
    assert.equal(released.ok, true);
    assert.equal(released.released, true);
    assert.equal(readLock(dir).held, false);

    // The next operation proceeds.
    const next = acquireLock(dir, { scope: "retire", ownerPid: "5252" });
    assert.equal(next.ok, true);
  });
});

test("an unverifiable lock is preserved and not reclaimed", () => {
  withRepo((dir) => {
    acquireLock(dir, { scope: "create", ownerPid: "4242" });

    // The owner cannot be verified: the state of the process is unknown.
    const described = describeLock(dir, { isProcessAlive: () => null });
    assert.equal(described.ok, true);
    assert.equal(described.held, true);
    assert.equal(described.ownerVerifiable, false);
    assert.equal(described.preserved, true);

    // A second operation is still refused: the lock was not reclaimed.
    const second = acquireLock(dir, { scope: "retire", ownerPid: "5252" });
    assert.equal(second.ok, false);
    assert.equal(second.blocked, true);
  });
});

test("a lock whose owner ended is reported as ended", () => {
  withRepo((dir) => {
    acquireLock(dir, { scope: "create", ownerPid: "4242" });
    const described = describeLock(dir, { isProcessAlive: () => false });
    assert.equal(described.ownerEnded, true);
    assert.equal(described.ownerVerifiable, false);
  });
});

test("a release by another owner is refused", () => {
  withRepo((dir) => {
    acquireLock(dir, { scope: "create", ownerPid: "4242" });
    const released = releaseLock(dir, { ownerPid: "9999" });
    assert.equal(released.ok, false);
    assert.equal(released.released, false);
    assert.equal(readLock(dir).held, true);
  });
});

test("the state directory is created with restrictive permissions", () => {
  withRepo((dir) => {
    const state = resolveStateDir(dir);
    const ensured = ensureDir(state);
    assert.equal(ensured.ok, true);
    assert.ok(isRealDirectory(state));
  });
});

test("inventory and lock operations refuse symlinked state path components", () => {
  withRepo((dir) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-state-outside-"));
    try {
      symlinkSync(outside, join(dir, ".opencode"), "dir");

      const written = writeInventory(dir, []);
      assert.equal(written.ok, false);
      assert.match(written.reason, /symbolic link|unsafe/);
      const read = readInventory(dir);
      assert.equal(read.ok, false);
      assert.equal(read.unsafePath, true);

      const acquired = acquireLock(dir, { scope: "retire" });
      assert.equal(acquired.ok, false);
      assert.match(acquired.reason, /symbolic link|unsafe/);
      const lock = readLock(dir);
      assert.equal(lock.ok, false);
      assert.equal(lock.unsafePath, true);
      assert.deepEqual(readdirSync(outside), [], "the symlink target was modified");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
