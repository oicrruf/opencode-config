// The retirement operation and the candidate listing.
//
// A retirement happens only on an explicit request that carries a
// complete identity, only after every blocking check passed, and only
// after the evidence was preserved. The order is deliberate: the
// evidence is preserved first, and a failure to preserve it keeps the
// worktree.
//
// The candidate listing is informational. Listing never retires, and
// the age of a worktree only orders the list.

import { resolveProjectRoot, resolveProjectId, resolveWorktreeRoot } from "./paths.mjs";
import { relative, resolve, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { acquireLock, releaseLock } from "./lock.mjs";
import { forgetWorktree, reconcileInventory } from "./inventory.mjs";
import { runBlockingChecks } from "./retirement-checks.mjs";
import { preserveEvidence } from "./evidence.mjs";
import {
  validateRetirementRequest,
  removeWorktree,
  removeLocalBranch,
  refuseRemoteDeletion,
  verifyRetirementIdentity,
} from "./removal.mjs";
import { listWorktrees } from "./creation.mjs";

/**
 * Retire a worktree.
 *
 * The sequence is: validate the request, take the lock, run the
 * blocking checks, preserve the evidence, remove the worktree, remove
 * the local branch, and release the lock.
 */
export async function retireWorktree(input, deps = {}) {
  const {
    request,
    worktreeApi,
    cwd = process.cwd(),
    recognizedIgnored = [],
    expectedRoot = null,
  } = input ?? {};

  // A request to delete the remote branch is refused before anything
  // else happens.
  const remote = refuseRemoteDeletion(request);
  if (!remote.ok) {
    return {
      ok: false,
      reason: remote.reason,
      remotePreserved: true,
      removed: false,
    };
  }

  const validated = validateRetirementRequest(request);
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.reason,
      missing: validated.missing,
      removed: false,
    };
  }

  const project = resolveProjectRoot(cwd);
  if (!project.ok) {
    return { ok: false, reason: project.reason, unavailable: true, removed: false };
  }

  const locked = acquireLock(project.root, { scope: "retire" });
  if (!locked.ok) {
    return {
      ok: false,
      blocked: true,
      reason: locked.reason,
      heldBy: locked.heldBy ?? null,
      removed: false,
    };
  }

  try {
    const { worktree, branch, head } = validated.request;

    // The worktree has to live under the directory the control
    // manages. A request that names a path outside it is refused
    // before anything is inspected or removed: the control must never
    // act on a directory the operator did not name.
    const managedRoot =
      expectedRoot ?? resolveWorktreeRoot(resolveProjectId(project.root), deps);
    const containment = checkContainment(worktree, managedRoot);
    if (!containment.ok) {
      return {
        ok: false,
        reason: containment.reason,
        unsafePath: true,
        removed: false,
      };
    }

    const verifyIdentity = deps.verifyRetirementIdentity ?? verifyRetirementIdentity;
    const identity = verifyIdentity(validated.request, project.root, deps);
    if (!identity.ok) {
      return {
        ok: false,
        reason: identity.reason,
        blocked: true,
        identityMismatch: true,
        removed: false,
      };
    }

    // The checks run against the directory, not against the inventory:
    // a worktree that was created outside the control is retired by
    // the same rules.
    const checks = runBlockingChecks({
      directory: worktree,
      branch,
      expectedRoot: managedRoot,
      recognizedIgnored,
      deps,
    });

    if (!checks.canRetire) {
      return {
        ok: false,
        reason: "the worktree is kept because a blocking condition is present",
        checks,
        blocked: checks.blocked,
        unavailable: checks.unavailable,
        removed: false,
      };
    }

    // The evidence is preserved before anything is removed. A failure
    // keeps the worktree.
    const preservation = preserveEvidence({
      root: project.root,
      directory: worktree,
      worktreeName: validated.request.worktreeName ?? basenameOf(worktree),
      branch,
      head,
    });
    if (!preservation.ok) {
      return {
        ok: false,
        reason: preservation.reason,
        checks,
        evidencePreserved: false,
        removed: false,
      };
    }

    // The conditions are revalidated immediately before the removal.
    // The window between the first check and the removal is real: the
    // lock serializes this control, not Git and not the other
    // processes of the host. A change that appeared in the meantime is
    // therefore detected here instead of being lost.
    const revalidation = runBlockingChecks({
      directory: worktree,
      branch,
      expectedRoot: managedRoot,
      recognizedIgnored,
      deps,
    });
    const identityRevalidation = verifyIdentity(validated.request, project.root, deps);
    if (!identityRevalidation.ok) {
      return {
        ok: false,
        reason: identityRevalidation.reason,
        blocked: true,
        identityMismatch: true,
        checks,
        revalidated: true,
        evidencePreserved: true,
        evidence: preservation.target,
        removed: false,
      };
    }
    if (!revalidation.canRetire) {
      return {
        ok: false,
        reason:
          "the worktree is kept because a condition appeared between the checks and the removal",
        checks,
        revalidated: true,
        blocked: revalidation.blocked,
        unavailable: revalidation.unavailable,
        evidencePreserved: true,
        evidence: preservation.target,
        removed: false,
      };
    }

    const removal = await removeWorktree(worktree, worktreeApi, cwd);
    if (!removal.ok) {
      return {
        ok: false,
        reason: removal.reason,
        checks,
        evidencePreserved: true,
        evidence: preservation.target,
        removed: false,
      };
    }

    forgetWorktree(project.root, worktree);

    // The branch is reported separately from the retirement: a branch
    // that could not be removed does not make the retirement a
    // failure.
    const branchResult = removeLocalBranch({
      root: project.root,
      directory: worktree,
      branch,
      expectedHead: head,
      worktreeApi,
      cwd,
      execFileSync: deps.execFileSync,
    });

    return {
      ok: true,
      removed: true,
      checks,
      evidencePreserved: true,
      evidence: preservation.target,
      evidenceFiles: preservation.copied,
      evidenceSkipped: preservation.skipped,
      branch: {
        removed: branchResult.ok === true,
        pending: branchResult.pending === true,
        reason: branchResult.reason ?? null,
      },
      remotePreserved: true,
    };
  } finally {
    releaseLock(project.root, { ownerPid: locked.lock.ownerPid });
  }
}

function basenameOf(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "worktree";
}

/**
 * Verify that a worktree lives under the directory the control
 * manages.
 *
 * The comparison is made on the canonical form of both paths, so a
 * symbolic link cannot carry a path outside the managed area, and a
 * path that names it directly is refused.
 */
export function checkContainment(directory, managedRoot) {  if (!directory) {
    return { ok: false, reason: "the retirement request names no worktree" };
  }
  if (!managedRoot) {
    // Without a managed directory the containment cannot be verified,
    // and an unverifiable containment is not a passing one.
    return {
      ok: false,
      reason: "the managed worktree directory could not be resolved, so the path cannot be verified",
    };
  }

  const target = canonicalPath(directory);
  const root = canonicalPath(managedRoot);
  const rel = relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      reason: `the worktree is outside the managed worktree directory: ${directory}`,
    };
  }
  return { ok: true, target, root };
}

/**
 * List the worktrees that are safe to consider for a retirement.
 *
 * The list carries the state that makes each one a candidate and the
 * state that would block it. Listing performs no retirement, and the
 * age of a worktree only orders the list.
 */
export async function listRetirementCandidates(input, deps = {}) {
  const { worktreeApi, cwd = process.cwd(), recognizedIgnored = [], expectedRoot = null } = input ?? {};

  const project = resolveProjectRoot(cwd);
  if (!project.ok) {
    return { ok: false, reason: project.reason, unavailable: true, candidates: [] };
  }

  const listing = await listWorktrees(worktreeApi, cwd);
  const reconciled = reconcileInventory(project.root, listing.worktrees, {
    verified: listing.verified,
  });
  if (!reconciled.ok) {
    return { ok: false, reason: reconciled.reason, candidates: [] };
  }
  if (!reconciled.verified) {
    // The listing could not be read. The candidates would be
    // incomplete, and a candidate that is missing from an incomplete
    // list is a worktree that looks safe to retire.
    return {
      ok: false,
      reason: listing.reason ?? "the worktrees could not be listed",
      unverified: true,
      candidates: [],
    };
  }

  const entries = [...reconciled.present, ...reconciled.unrecorded];
  const candidates = [];

  for (const entry of entries) {
    const checks = runBlockingChecks({
      directory: entry.directory,
      branch: entry.branch,
      expectedRoot,
      recognizedIgnored,
      deps,
    });
    candidates.push({
      workId: entry.workId ?? null,
      directory: entry.directory,
      branch: entry.branch ?? null,
      createdAt: entry.createdAt ?? null,
      age: ageOf(entry.createdAt),
      candidate: checks.canRetire,
      reason: checks.canRetire
        ? "no blocking condition was found"
        : checks.blocked.map((item) => item.reason).join("; ") ||
          checks.unavailable.map((item) => item.reason).join("; "),
      wouldBlock: checks.blocked.map((item) => item.check),
      checks,
    });
  }

  // The age orders the list and nothing else.
  candidates.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));

  return {
    ok: true,
    candidates,
    total: candidates.length,
    retired: 0,
    note: "listing never retires; a retirement requires an explicit request",
  };
}

function ageOf(createdAt) {
  if (!createdAt) return null;
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return null;
  return Date.now() - then;
}

/**
 * The canonical form of a path.
 *
 * A temporary directory lives under `/var` on macOS, which is a
 * symbolic link to `/private/var`, and the two spellings name the same
 * directory.
 */
function canonicalPath(path) {
  const resolved = resolve(path);
  try {
    return resolve(realpathSync(resolved));
  } catch {
    return resolved;
  }
}
