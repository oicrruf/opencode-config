// The project resolution of the worktree control.
//
// The control is installed globally, so it runs in every project on the
// host. Outside a Git repository it reports that it is unavailable and
// creates nothing: that inertness is what keeps it harmless in the many
// directories on a host that are not projects.
//
// The worktree directory is the one OpenCode manages for the project,
// partitioned by the first characters of the project identifier. The
// control does not create that layout by hand; it only resolves it.

import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const STATE_SEGMENTS = [".opencode", "state", "worktrees"];

/**
 * Resolve the main checkout of the repository that holds `cwd`.
 *
 * The common directory of Git is the main checkout's `.git`, so a
 * session that starts inside a linked worktree still resolves the main
 * checkout rather than the worktree.
 */
export function resolveProjectRoot(cwd = process.cwd()) {
  let commonDir;
  try {
    commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    return {
      ok: false,
      reason: "the worktree control is unavailable outside a Git project",
      unavailable: true,
    };
  }

  if (!commonDir) {
    return {
      ok: false,
      reason: "the worktree control is unavailable outside a Git project",
      unavailable: true,
    };
  }

  const resolved = resolve(commonDir);
  if (!resolved.endsWith("/.git") && !resolved.endsWith("\\.git")) {
    return {
      ok: false,
      reason: "the project has no main checkout to manage worktrees for",
      unavailable: true,
    };
  }

  return { ok: true, root: dirname(resolved) };
}

/**
 * The identifier of the project, used to partition the worktree
 * directory. The identifier is stable for a checkout and does not
 * contain a path separator.
 */
export function resolveProjectId(root) {
  try {
    const id = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return id;
  } catch {
    return resolve(root);
  }
}

/**
 * The worktree directory OpenCode manages for the project.
 *
 * The layout is the one OpenCode uses: the worktrees live under the
 * data directory, partitioned by the first characters of the project
 * identifier. The control resolves it and never creates it by hand.
 */
export function resolveWorktreeRoot(projectId, options = {}) {
  const dataDir = options.dataDir ?? join(homedir(), ".local", "share", "opencode", "worktree");
  const partition = String(projectId ?? "project").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 2);
  return join(dataDir, partition);
}

/**
 * The directory that holds the inventory and the lock of the project.
 */
export function resolveStateDir(root) {
  return join(root, ...STATE_SEGMENTS);
}

/**
 * The path of the inventory file.
 */
export function inventoryPath(root) {
  return join(resolveStateDir(root), "inventory.json");
}

/**
 * The path of the lock file.
 */
export function lockPath(root) {
  return join(resolveStateDir(root), "lock.json");
}

/**
 * The directory that holds the preserved evidence of the retired
 * worktrees. It lives outside the worktrees themselves, so the evidence
 * outlives them.
 */
export function evidenceDir(root) {
  return join(resolveStateDir(root), "evidence");
}

/**
 * Create a directory and report the failure instead of throwing.
 */
export function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, reason: `the directory ${dir} could not be created: ${err.message}` };
  }
}

/**
 * Inspect a state path without following symbolic-link components.
 * `extraSegments` are names below `.opencode/state/worktrees`; callers
 * choose whether the final component must be a file or a directory.
 */
export function checkStatePath(root, extraSegments = [], finalKind = "directory") {
  let current;
  try {
    current = realpathSync(resolve(root));
  } catch (err) {
    return { ok: false, unsafe: true, reason: `the project root could not be resolved: ${err.message}` };
  }

  const segments = [...STATE_SEGMENTS, ...extraSegments];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = String(segments[index]);
    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
      return { ok: false, unsafe: true, reason: `the state path contains an unsafe component: ${segment}` };
    }
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (err) {
      if (err.code === "ENOENT") return { ok: true, exists: false, path: current };
      return { ok: false, unsafe: true, reason: `the state path could not be inspected: ${err.message}` };
    }
    if (stat.isSymbolicLink()) {
      return { ok: false, unsafe: true, reason: `the state path contains a symbolic link: ${current}` };
    }
    const isFinal = index === segments.length - 1;
    if ((!isFinal || finalKind === "directory") && !stat.isDirectory()) {
      return { ok: false, unsafe: true, reason: `the state path component is not a directory: ${current}` };
    }
    if (isFinal && finalKind === "file" && !stat.isFile()) {
      return { ok: false, unsafe: true, reason: `the state path is not a regular file: ${current}` };
    }
  }
  return { ok: true, exists: true, path: current };
}

/** Create state directories one component at a time, refusing symlinks. */
export function ensureStateDir(root, extraSegments = []) {
  let current;
  try {
    current = realpathSync(resolve(root));
  } catch (err) {
    return { ok: false, reason: `the project root could not be resolved: ${err.message}` };
  }

  for (const segmentValue of [...STATE_SEGMENTS, ...extraSegments]) {
    const segment = String(segmentValue);
    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
      return { ok: false, reason: `the state path contains an unsafe component: ${segment}` };
    }
    current = join(current, segment);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (err) {
      if (err.code !== "EEXIST") {
        return { ok: false, reason: `the state directory ${current} could not be created: ${err.message}` };
      }
    }
    let stat;
    try {
      stat = lstatSync(current);
    } catch (err) {
      return { ok: false, reason: `the state path could not be inspected: ${err.message}` };
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { ok: false, reason: `the state path is unsafe: ${current}` };
    }
  }
  return { ok: true, dir: current };
}

/**
 * True when the path exists and is a directory that is not a symbolic
 * link. The control refuses to work with a path that is a link: the
 * evidence and the inventory must land where the operator expects.
 */
export function isRealDirectory(path) {
  try {
    const stat = statSync(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when the path exists at all.
 */
export function pathExists(path) {
  return existsSync(path);
}
