// Resolve the source from the verified V2 session, never from a caller's
// workId/path or from the Git common directory used for project-wide state.
import { execFileSync } from "node:child_process";
import { canonicalPath, resolveRepositoryRoot } from "./paths.mjs";
import { listWorktrees } from "../worktree-control/creation.mjs";
import { reconcileInventory } from "../worktree-control/inventory.mjs";

const blocked = (reason) => ({ ok: false, blocked: true, reason });
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

/** `context` must come from the V2 adapter, not from a tool's input. */
export async function resolveSandboxSource(context) {
  if (!nonempty(context?.directory) || !nonempty(context?.sessionID) || !nonempty(context?.projectID)) {
    return blocked("the sandbox needs a verified active session, directory and project identity");
  }

  let checkout;
  try {
    checkout = canonicalPath(execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: context.directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim());
  } catch {
    return blocked("the effective session checkout could not be resolved with Git");
  }
  const project = resolveRepositoryRoot(checkout);
  if (!project.ok) return blocked(project.reason);

  // The adapter scopes this public API to the active V2 project. A session
  // cannot substitute an unrelated checkout just by supplying its path.
  const listing = await listWorktrees(context.worktree, context.directory);
  if (!listing.verified) return blocked(listing.reason ?? "the managed worktree listing is unverified");
  let inventory;
  try {
    inventory = reconcileInventory(project.root, listing.worktrees, { verified: true });
  } catch {
    return blocked("the managed worktree inventory has invalid identity or path records");
  }
  if (!inventory.ok) return blocked(inventory.reason);
  const candidates = inventory.present.filter((entry) => canonicalPath(entry.directory) === checkout);
  if (candidates.length !== 1 || !nonempty(candidates[0]?.workId)) {
    return blocked("the effective checkout has no unique verified managed work identity");
  }
  const entry = candidates[0];
  if (inventory.present.filter((candidate) => candidate.workId === entry.workId).length !== 1) {
    return blocked("the managed work identity is ambiguous across checkouts");
  }

  return {
    ok: true,
    projectRoot: canonicalPath(project.root),
    worktreePath: checkout,
    workId: entry.workId,
    workName: entry.workId,
    sessionId: context.sessionID,
    projectID: context.projectID,
  };
}
