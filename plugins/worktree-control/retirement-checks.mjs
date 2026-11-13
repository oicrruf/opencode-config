// The retirement checks and the evidence preservation.
//
// The blocking conditions are checked individually and reported
// individually: local changes, unpublished commits, a process with
// access, unrecognized ignored files, and an unsafe path. The report
// names the specific conditions that blocked, so the operator knows
// what to resolve rather than being told "retirement failed".
//
// A check that cannot be performed blocks the retirement: an
// unverifiable check is not a passing check.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * The checks that block a retirement.
 */
export const BLOCKING_CHECKS = [
  "localChanges",
  "unpublishedCommits",
  "processAccess",
  "unrecognizedIgnoredFiles",
  "unsafePath",
];

/**
 * Check the worktree for local changes.
 *
 * Modified, staged, and untracked files are all local changes: each of
 * them would be lost by a removal.
 */
export function checkLocalChanges(directory, deps = {}) {
  const run = deps.execFileSync ?? execFileSync;
  try {
    const out = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const changes = String(out)
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ status: line.slice(0, 2).trim() || "??", path: line.slice(3) }));
    return {
      ok: true,
      available: true,
      blocked: changes.length > 0,
      changes,
      reason: changes.length > 0 ? "the worktree holds local changes" : null,
    };
  } catch (err) {
    return {
      ok: false,
      available: false,
      blocked: true,
      reason: `the local changes could not be checked: ${err.message}`,
    };
  }
}

/**
 * Check the branch of the worktree for unpublished commits.
 *
 * A commit that exists only in the local branch would be lost by the
 * removal of the branch, so it blocks the retirement.
 */
export function checkUnpublishedCommits(directory, branch, deps = {}) {
  const run = deps.execFileSync ?? execFileSync;
  if (!branch) {
    return {
      ok: false,
      available: false,
      blocked: true,
      reason: "the worktree has no branch, so the published state cannot be checked",
    };
  }

  const git = (args) => {
    try {
      return run("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      return null;
    }
  };

  // The branch has to exist: a branch that is not there cannot hold
  // unpublished commits, and the condition is reported as such instead
  // of as a failure of the check.
  const branchExists = git(["rev-parse", "--verify", `refs/heads/${branch}`]);
  if (!branchExists) {
    return {
      ok: true,
      available: true,
      blocked: false,
      commits: 0,
      reason: null,
      note: `the branch ${branch} does not exist in the worktree`,
    };
  }

  const countLocalCommits = () => {
    const local = git(["rev-list", branch]);
    return local ? local.split("\n").filter(Boolean).length : 0;
  };

  // The remote the branch would be published to. A branch with no
  // remote counterpart has every commit unpublished.
  const remotes = (git(["remote"]) ?? "").split("\n").filter(Boolean);
  if (remotes.length === 0) {
    const count = countLocalCommits();
    return {
      ok: true,
      available: true,
      blocked: count > 0,
      commits: count,
      reason:
        count > 0
          ? "the branch has commits that are not published: the project has no remote"
          : null,
    };
  }

  const remote = remotes[0];
  const published = git(["rev-parse", "--verify", `${remote}/${branch}`]);
  if (!published) {
    const count = countLocalCommits();
    return {
      ok: true,
      available: true,
      blocked: count > 0,
      commits: count,
      reason: count > 0 ? `the branch is not published on ${remote}` : null,
    };
  }

  const unpublished = git(["rev-list", `${remote}/${branch}..${branch}`]);
  const commits = unpublished ? unpublished.split("\n").filter(Boolean) : [];
  return {
    ok: true,
    available: true,
    blocked: commits.length > 0,
    commits: commits.length,
    commitList: commits,
    reason: commits.length > 0 ? "the branch has commits that are not published" : null,
  };
}

/**
 * Check whether a process has the worktree open.
 *
 * The check is a scan of the process table for a working directory
 * inside the worktree. A host where the process state cannot be
 * inspected reports the check as unavailable, and an unavailable check
 * blocks the retirement.
 *
 * The check inspects the working directory of each process, not the
 * open handles: the working directory is what tells a process apart
 * from one that merely has the path in its arguments.
 */
export function checkProcessAccess(directory, deps = {}) {
  const listProcesses = deps.listProcesses ?? defaultListProcesses;
  let processes;
  try {
    processes = listProcesses();
  } catch (err) {
    return {
      ok: false,
      available: false,
      blocked: true,
      reason: `the process state could not be inspected: ${err.message}`,
    };
  }
  if (!Array.isArray(processes)) {
    return {
      ok: false,
      available: false,
      blocked: true,
      reason: "the process state could not be inspected",
    };
  }

  const target = canonicalPath(directory);
  const holders = processes.filter((process) => {
    const cwd = process?.cwd ?? process?.workingDirectory ?? null;
    if (!cwd) return false;
    const resolved = canonicalPath(cwd);
    return resolved === target || resolved.startsWith(`${target}${sep}`);
  });

  return {
    ok: true,
    available: true,
    blocked: holders.length > 0,
    processes: holders.map((process) => ({ pid: process.pid ?? null, cwd: process.cwd ?? null })),
    reason: holders.length > 0 ? "a process has the worktree open" : null,
  };
}

/**
 * List the processes of the host with their working directory.
 *
 * `lsof` reports the working directory of every process, which is what
 * the check needs. A host without it, or one where the listing cannot
 * be read, returns `null` and the check reports itself as
 * unavailable, which blocks the retirement.
 */
function defaultListProcesses() {
  if (process.platform === "win32") return null;
  try {
    const out = execFileSync("lsof", ["-a", "-d", "cwd", "-F", "pcn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    const processes = [];
    let current = null;
    for (const line of out.split("\n")) {
      if (!line) continue;
      const tag = line[0];
      const value = line.slice(1);
      if (tag === "p") {
        current = { pid: Number(value), command: null, cwd: null };
        processes.push(current);
        continue;
      }
      if (!current) continue;
      if (tag === "c") current.command = value;
      if (tag === "n") current.cwd = value;
    }
    return processes;
  } catch {
    // The listing could not be read: the check reports itself as
    // unavailable rather than as "no process holds the worktree".
    return null;
  }
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

/**
 * Check the ignored files of the worktree.
 *
 * An ignored file is a file the repository does not track. The control
 * recognizes the ones the evidence policy knows about; any other
 * ignored file is unrecognized and blocks the retirement, because the
 * removal would destroy it silently.
 */
export function checkIgnoredFiles(directory, recognizedPatterns = [], deps = {}) {
  const run = deps.execFileSync ?? execFileSync;
  try {
    const out = run("git", ["status", "--porcelain=v1", "--ignored", "--untracked-files=all"], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ignored = String(out)
      .split("\n")
      .filter((line) => line.startsWith("!!"))
      .map((line) => line.slice(3).trim())
      .filter(Boolean);

    const unrecognized = ignored.filter(
      (path) => !recognizedPatterns.some((pattern) => matchesPattern(path, pattern)),
    );

    return {
      ok: true,
      available: true,
      blocked: unrecognized.length > 0,
      ignored,
      unrecognized,
      reason:
        unrecognized.length > 0
          ? "the worktree holds ignored files the evidence policy does not recognize"
          : null,
    };
  } catch (err) {
    return {
      ok: false,
      available: false,
      blocked: true,
      reason: `the ignored files could not be checked: ${err.message}`,
    };
  }
}

function matchesPattern(path, pattern) {
  const normalized = String(pattern).split(sep).join("/");
  const candidate = path.split(sep).join("/");
  if (normalized.includes("*")) {
    const source = `^${normalized.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`;
    return new RegExp(source).test(candidate);
  }
  return candidate === normalized || candidate.startsWith(`${normalized}/`);
}

/**
 * Check that the path of the worktree is safe.
 *
 * A path that is a symbolic link, or that resolves outside the expected
 * location, is unsafe: the removal would act on a directory the
 * operator did not name.
 */
export function checkPathSafety(directory, expectedRoot, deps = {}) {
  try {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink()) {
      return {
        ok: true,
        available: true,
        blocked: true,
        reason: "the path of the worktree is a symbolic link",
      };
    }
  } catch (err) {
    return {
      ok: false,
      available: false,
      blocked: true,
      reason: `the path of the worktree could not be inspected: ${err.message}`,
    };
  }

  if (expectedRoot) {
    const real = realpathSync(directory);
    const root = realpathSync(expectedRoot);
    const rel = relative(root, real);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
      return {
        ok: true,
        available: true,
        blocked: true,
        reason: "the path of the worktree resolves outside the expected location",
      };
    }
  }

  return { ok: true, available: true, blocked: false, reason: null };
}

/**
 * Run every blocking check and report each of them.
 *
 * The report names the specific conditions that blocked. A check that
 * could not be performed is reported as unavailable and blocks, because
 * an unverifiable check is not a passing check.
 */
export function runBlockingChecks(input) {
  const {
    directory,
    branch,
    expectedRoot = null,
    recognizedIgnored = [],
    deps = {},
  } = input ?? {};

  const checks = {
    localChanges: checkLocalChanges(directory, deps),
    unpublishedCommits: checkUnpublishedCommits(directory, branch, deps),
    processAccess: checkProcessAccess(directory, deps),
    unrecognizedIgnoredFiles: checkIgnoredFiles(directory, recognizedIgnored, deps),
    unsafePath: checkPathSafety(directory, expectedRoot, deps),
  };

  const blocked = [];
  const unavailable = [];
  for (const name of BLOCKING_CHECKS) {
    const check = checks[name];
    if (check.available === false) {
      unavailable.push({ check: name, reason: check.reason });
      continue;
    }
    if (check.blocked) {
      blocked.push({ check: name, reason: check.reason, detail: check });
    }
  }

  return {
    ok: true,
    checks,
    performed: BLOCKING_CHECKS,
    blocked,
    unavailable,
    canRetire: blocked.length === 0 && unavailable.length === 0,
  };
}
