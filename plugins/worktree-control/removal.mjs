// The removal of a worktree and the handling of its branch.
//
// The worktree is removed through the worktree API only after every
// blocking check passed and the evidence was preserved.
//
// The local branch is removed only after the published state is
// verified, only when the branch is not a symbolic reference, and only
// when no other worktree uses it. A branch that cannot be removed is
// reported as pending, separately from the retirement itself, so a
// partial result is never reported as a failure and never as a success.
//
// The remote branch and the published commits are never removed: they
// are the operator's safety net.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { forgetWorktree } from "./inventory.mjs";
import { acquireLock, releaseLock } from "./lock.mjs";

/**
 * The elements a retirement request must carry.
 */
export const REQUIRED_REQUEST_FIELDS = [
  { name: "worktree", description: "the directory of the worktree" },
  { name: "branch", description: "the branch of the worktree" },
  { name: "base", description: "the base the work integrates into" },
  { name: "head", description: "the expected head of the worktree" },
  { name: "evidence", description: "the evidence that the work was integrated" },
];

/**
 * Validate a retirement request.
 *
 * A request that does not carry a complete identity is refused, and the
 * missing elements are named. The control never infers the identity
 * from the current session: inferring it is how a control retires the
 * wrong directory.
 */
export function validateRetirementRequest(request) {
  const missing = [];
  for (const field of REQUIRED_REQUEST_FIELDS) {
    const value = request?.[field.name];
    if (value === undefined || value === null || value === "") {
      missing.push({ field: field.name, description: field.description });
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "the retirement request does not carry a complete identity",
      missing,
    };
  }
  return { ok: true, request };
}

/**
 * Verify the identity carried by a retirement request against Git itself.
 * The worktree must be attached to the expected branch at the expected
 * commit, and that commit must be present in both the named local base and
 * a published remote-tracking copy of that base.
 */
export function verifyRetirementIdentity(request, root, deps = {}) {
  const run = deps.execFileSync ?? execFileSync;
  const { worktree, branch, base, head } = request ?? {};
  const git = (args, cwd = root) => {
    try {
      return String(run("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })).trim();
    } catch {
      return null;
    }
  };
  const mismatch = (reason) => ({ ok: false, blocked: true, reason });

  if (git(["check-ref-format", "--branch", branch]) === null) {
    return mismatch("the requested worktree branch is not a valid local branch name");
  }
  if (git(["check-ref-format", "--branch", base]) === null) {
    return mismatch("the requested integration base is not a valid local branch name");
  }
  if (branch === base) {
    return mismatch("the integration base must be distinct from the retiring branch");
  }

  const actualBranch = git(["branch", "--show-current"], worktree);
  const actualHead = git(["rev-parse", "--verify", "HEAD^{commit}"], worktree);
  const expectedHead = git(["rev-parse", "--verify", "--end-of-options", `${head}^{commit}`], worktree);
  const branchHead = git(["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`], root);
  if (!actualBranch || !actualHead || !expectedHead || !branchHead) {
    return mismatch("the worktree branch or expected commit could not be verified");
  }
  if (actualBranch !== branch || branchHead !== actualHead || expectedHead !== actualHead) {
    return mismatch(
      `the retirement identity does not match the worktree (branch ${actualBranch}, head ${actualHead})`,
    );
  }

  const worktreeCommonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktree);
  const projectCommonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  if (!worktreeCommonDir || !projectCommonDir || canonicalPath(worktreeCommonDir) !== canonicalPath(projectCommonDir)) {
    return mismatch("the requested directory is not a worktree of this project");
  }

  const localBase = git(["rev-parse", "--verify", "--end-of-options", `refs/heads/${base}^{commit}`], root);
  if (!localBase || git(["merge-base", "--is-ancestor", actualHead, localBase], root) === null) {
    return mismatch(`the expected head is not integrated into the local base ${base}`);
  }

  const remotes = (git(["remote"], root) ?? "").split("\n").filter(Boolean);
  const publishedBase = remotes.some((remote) => {
    const ref = `refs/remotes/${remote}/${base}^{commit}`;
    const remoteBase = git(["rev-parse", "--verify", "--end-of-options", ref], root);
    return remoteBase !== null && git(["merge-base", "--is-ancestor", actualHead, remoteBase], root) !== null;
  });
  if (!publishedBase) {
    return mismatch(`the expected head is not present in a published remote base ${base}`);
  }

  return {
    ok: true,
    branch: actualBranch,
    head: actualHead,
    base,
    published: true,
  };
}

/**
 * Remove the worktree through the worktree API.
 *
 * The removal happens only after the checks and the preservation. The
 * API owns the directory, so the control does not remove anything by
 * hand.
 */
export async function removeWorktree(directory, worktreeApi, cwd = process.cwd()) {
  if (!worktreeApi || typeof worktreeApi.remove !== "function") {
    return { ok: false, reason: "the worktree API is not available" };
  }
  try {
    const result = await worktreeApi.remove({ directory, directory_: undefined, ...{ directory } }, { directory: cwd });
    void result;
    return { ok: true, removed: true, directory };
  } catch (err) {
    return { ok: false, reason: `the worktree could not be removed: ${err.message}` };
  }
}

/**
 * Verify the published state of a branch and remove the local branch.
 *
 * The removal is refused when the published state does not match, when
 * the branch is a symbolic reference, or when another worktree uses it.
 * The removal is never forced.
 */
export function removeLocalBranch(input) {
  const { root, directory, branch, expectedHead, worktreeApi, cwd = process.cwd() } = input ?? {};
  const run = input?.execFileSync ?? execFileSync;

  if (!branch) {
    return { ok: false, pending: true, reason: "the worktree has no branch to remove" };
  }

  // The branch lives in the repository, not in the worktree. The
  // worktree is already removed when this runs, so every command is
  // executed in the main checkout: a command in a directory that no
  // longer exists fails for the wrong reason and would report a
  // branch that does exist as missing.
  const repository = root ?? cwd;
  const git = (args, workdir = repository) => {
    try {
      return run("git", args, {
        cwd: workdir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      // A command that fails answers `null`, which the callers treat
      // as "not present" rather than as a crash.
      return null;
    }
  };

  // A symbolic reference is never removed: `HEAD` and the other
  // symbolic names are not branches. The check is about the branch
  // being removed, not about the branch the repository happens to
  // have checked out.
  //
  // The detection uses `symbolic-ref` on the branch itself: `cat-file
  // -t` would resolve the reference and report the type of the object
  // it points at, which is `commit` for a symbolic branch, and the
  // protection would never trigger.
  const symbolicBranch = git(["symbolic-ref", "--quiet", `refs/heads/${branch}`]);
  if (symbolicBranch) {
    return {
      ok: false,
      pending: true,
      reason: "the branch is a symbolic reference and is not removed",
    };
  }

  const refType = git(["cat-file", "-t", `refs/heads/${branch}`]);
  if (refType === null) {
    return { ok: false, pending: true, reason: "the local branch does not exist" };
  }

  // The branch may be the symbolic HEAD of the checkout that is
  // running the control. That is a checked-out branch, not a symbolic
  // reference to another one, and it is removed by name below.
  const symbolic = git(["symbolic-ref", "--quiet", "HEAD"]);
  if (symbolic === `refs/heads/${branch}`) {
    // The branch is checked out here. Its removal would change the
    // branch of the checkout, so it is reported as pending.
    return {
      ok: false,
      pending: true,
      reason: "the branch is checked out in the repository and is not removed",
    };
  }

  // Another worktree that uses the branch keeps it. The worktree that
  // is being retired is excluded: its own branch is the one that is
  // being removed.
  const worktreeList = git(["worktree", "list", "--porcelain"], root) ?? "";
  const retiring = canonicalPath(directory);
  const usedElsewhere = worktreeList
    .split("\n\n")
    .map((block) => block.split("\n"))
    .some((block) => {
      const head = block.find((line) => line.startsWith("branch "));
      if (!head) return false;
      if (head.slice("branch ".length) !== `refs/heads/${branch}`) return false;
      const path = block.find((line) => line.startsWith("worktree "));
      if (!path) return false;
      // The main checkout holds the branch by definition; the
      // comparison is against the worktree being retired, so the
      // branch of the main checkout is not another worktree.
      return canonicalPath(path.slice("worktree ".length)) !== retiring;
    });
  if (usedElsewhere) {
    return {
      ok: false,
      pending: true,
      reason: "the branch is checked out in another worktree",
    };
  }

  // The published state must match the expected head. A branch whose
  // commits exist only locally is not removed.
  const remotes = (git(["remote"], root) ?? "").split("\n").filter(Boolean);
  let publishedHead = null;
  for (const remote of remotes) {
    const candidate = git(["rev-parse", "--verify", `${remote}/${branch}`], root);
    if (candidate) {
      publishedHead = candidate;
      break;
    }
  }
  if (!publishedHead) {
    return {
      ok: false,
      pending: true,
      reason: "the branch is not published, so its published state cannot be verified",
    };
  }
  if (expectedHead && publishedHead !== expectedHead) {
    return {
      ok: false,
      pending: true,
      reason: `the published state does not match the expected head: ${publishedHead} != ${expectedHead}`,
    };
  }

  // The removal is never forced.
  const removed = git(["branch", "-d", branch], root);
  if (removed === null) {
    return {
      ok: false,
      pending: true,
      reason: "the local branch could not be removed and was not forced",
    };
  }

  return { ok: true, pending: false, removed: true, branch, publishedHead };
}

/**
 * Refuse a request to delete the remote branch.
 *
 * The remote branch and the published commits are the operator's safety
 * net. Their removal is unrecoverable, so the control refuses it and
 * reports why.
 */
export function refuseRemoteDeletion(request) {
  const asksRemote = Boolean(
    request?.deleteRemoteBranch ||
      request?.removeRemoteBranch ||
      request?.pushDeletion ||
      request?.deleteRemote,
  );
  if (!asksRemote) return { ok: true, refused: false };

  return {
    ok: false,
    refused: true,
    reason:
      "the remote branch and the published commits are preserved: the control never pushes a deletion",
  };
}

/**
 * The canonical form of a path.
 *
 * The comparison of two worktree paths has to be made on their
 * canonical form: a temporary directory lives under `/var` on macOS,
 * which is a symbolic link to `/private/var`, and the two spellings
 * name the same directory.
 */
function canonicalPath(path) {
  const resolved = resolve(path);
  try {
    return resolve(realpathSync(resolved));
  } catch {
    return resolved;
  }
}
