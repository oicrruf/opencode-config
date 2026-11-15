// The creation of a worktree through OpenCode's worktree API.
//
// The control does not create a directory by hand and does not maintain
// its own layout: it asks OpenCode to create the worktree, and OpenCode
// places it in the worktree directory it manages, partitioned per
// project.
//
// A worktree inside the repository would pollute the working tree,
// appear in the `git status` of the canonical checkout, and be
// committed by accident. The control therefore refuses a creation whose
// result landed inside the checkout.

import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { recordWorktree, findByWorkId, reconcileInventory } from "./inventory.mjs";
import { resolveProjectRoot, resolveProjectId, resolveWorktreeRoot } from "./paths.mjs";
import { evaluateCapacityForCreation, reportCapacity } from "./capacity.mjs";
import { acquireLock, releaseLock } from "./lock.mjs";

/**
 * The name a worktree carries.
 *
 * The name is the work it isolates, normalized so it is safe in a
 * directory name and in a branch name.
 */
export function normalizeWorkName(workId) {
  return String(workId ?? "work")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "work";
}

/**
 * True when a path is inside another one.
 */
function isInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  if (rel === "") return true;
  return !rel.startsWith(`..${sep}`) && rel !== ".." && !resolve(rel).startsWith(sep);
}

/**
 * Create a worktree for a work.
 *
 * The creation goes through the worktree API, the result is checked to
 * be outside the canonical checkout, and the worktree is recorded in the
 * inventory. A repeated request for the same work returns the existing
 * worktree instead of creating a second one, and it never resets it.
 */
export async function createWorktree(input, deps = {}) {
  const { workId, worktreeApi, cwd = process.cwd(), branch = null } = input ?? {};

  if (!workId) return { ok: false, reason: "the creation needs a work identifier" };
  if (!worktreeApi || typeof worktreeApi.create !== "function") {
    return { ok: false, reason: "the worktree API is not available" };
  }

  const project = resolveProjectRoot(cwd);
  if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };

  // The listing has to be trustworthy before anything is created. An
  // API that could not answer leaves the state unknown, and an unknown
  // state must not produce a second worktree for a work that already
  // has one.
  let actual = deps.actualWorktrees ?? null;
  let listingVerified = deps.listingVerified !== false;
  if (!actual) {
    const listing = await listWorktrees(worktreeApi, cwd);
    actual = listing.worktrees;
    listingVerified = listing.verified;
  }
  if (!listingVerified) {
    return {
      ok: false,
      blocked: true,
      reason: deps.listingReason ?? "the worktrees could not be listed",
      unverified: true,
    };
  }

  // A worktree that the inventory already records for this work is
  // returned as it is. It is never reset and never recreated.
  const existing = findByWorkId(project.root, workId);
  if (existing.ok && existing.entry) {
    const reconciled = reconcileInventory(project.root, actual);
    const live = reconciled.present.find((entry) => entry.directory === existing.entry.directory);
    if (live) {
      return {
        ok: true,
        created: false,
        reused: true,
        worktree: {
          workId,
          directory: live.directory,
          branch: live.branch ?? existing.entry.branch ?? null,
        },
      };
    }
  }

  // The capacity is measured, and only a measurement of exactly zero
  // available bytes blocks the creation.
  const worktreeRoot = resolveWorktreeRoot(resolveProjectId(project.root), deps);
  const capacity = reportCapacity(worktreeRoot, actual.length);
  const decision = evaluateCapacityForCreation(capacity);
  if (decision.blocked) {
    return { ok: false, blocked: true, reason: decision.reason, capacity };
  }

  // The operation that mutates the worktree state runs under the lock.
  const locked = acquireLock(project.root, { scope: "create" });
  if (!locked.ok) {
    return {
      ok: false,
      blocked: true,
      reason: locked.reason,
      heldBy: locked.heldBy ?? null,
    };
  }

  const name = normalizeWorkName(workId);
  try {
    let created;
    try {
      created = await worktreeApi.create({ name, branch: branch ?? undefined });
    } catch (err) {
      // A failed creation records nothing and leaves no partial
      // directory behind: the API owns the directory, so the control
      // only reports the failure.
      return { ok: false, reason: `the worktree could not be created: ${err.message}` };
    }

    const directory = created?.data?.directory ?? created?.directory ?? null;
    const createdBranch = created?.data?.branch ?? created?.branch ?? branch ?? null;

    if (!directory) {
      return { ok: false, reason: "the worktree API did not report a directory" };
    }
    if (!existsSync(directory)) {
      return {
        ok: false,
        reason: "the worktree API reported a directory that does not exist",
      };
    }

    // A worktree inside the canonical checkout would pollute the
    // working tree. The control refuses it rather than accepting it.
    if (isInside(project.root, directory)) {
      return {
        ok: false,
        reason: "the created worktree is inside the canonical checkout",
        directory,
      };
    }

    const recorded = recordWorktree(project.root, {
      workId,
      directory,
      branch: createdBranch,
      createdAt: new Date().toISOString(),
    });
    if (!recorded.ok) {
      return { ok: false, reason: recorded.reason, directory };
    }

    return {
      ok: true,
      created: true,
      reused: false,
      worktree: { workId, directory, branch: createdBranch },
      capacity,
    };
  } finally {
    // The lock is released when the operation finishes, whatever the
    // outcome.
    releaseLock(project.root, { ownerPid: locked.lock.ownerPid });
  }
}

/**
 * List the worktrees of the project through the API.
 *
 * The result states whether the listing is trustworthy. An API that
 * could not answer returns `verified: false` with an empty list: the
 * callers must not read that as "there are no worktrees", because the
 * reconciliation would then report every recorded worktree as missing
 * and a creation would duplicate an existing one.
 */
export async function listWorktrees(worktreeApi, cwd = process.cwd()) {
  if (!worktreeApi || typeof worktreeApi.list !== "function") {
    return { worktrees: [], verified: false, reason: "the worktree API is not available" };
  }
  try {
    const result = await worktreeApi.list({ directory: cwd });
    const data = result?.data ?? result;
    const worktrees = Array.isArray(data) ? data : Array.isArray(data?.worktrees) ? data.worktrees : [];
    return { worktrees, verified: true, reason: null };
  } catch (err) {
    return {
      worktrees: [],
      verified: false,
      reason: `the worktrees could not be listed: ${err.message}`,
    };
  }
}
