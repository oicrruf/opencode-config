// Canonical locations for the sandbox control's local state.
//
// Everything the control writes lives under the project's own state area
// (`.opencode/state/sandbox/`) so a run never leaves artifacts outside the
// repository it belongs to. The state area is local and unversioned; the
// repository's ignore rules keep it out of Git.
//
// The module is engine-free and dependency-free on purpose: every path
// decision must be testable under plain Node without Docker, Git, or a
// running OpenCode.

import { mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const STATE_DIR_SEGMENTS = [".opencode", "state", "sandbox"];

/**
 * Resolve the repository root of `cwd` through Git's common directory.
 *
 * The common directory is the main checkout's `.git` directory, so a
 * session that starts inside a linked worktree still reaches the main
 * checkout's state area instead of creating a second one. When Git
 * cannot answer, the caller is told so instead of receiving a guessed
 * path: a wrong root would place the run's evidence in the wrong place.
 */
export function resolveRepositoryRoot(cwd = process.cwd()) {
  let commonDir;
  try {
    commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    return { ok: false, reason: "the repository root could not be resolved with Git" };
  }

  if (!commonDir) {
    return { ok: false, reason: "the repository root could not be resolved with Git" };
  }

  // The common directory is `<root>/.git` for a normal checkout. A
  // repository whose common directory is not named `.git` (a bare
  // repository, or a worktree of one) has no checkout to anchor on.
  const resolved = resolve(commonDir);
  if (resolved.endsWith(`${sep}.git`)) {
    return { ok: true, root: dirname(resolved) };
  }
  return {
    ok: false,
    reason: `the repository has no main checkout to anchor the state area (git common dir: ${resolved})`,
  };
}

/**
 * The project's state area for the sandbox control.
 */
export function sandboxStateDir(cwd = process.cwd()) {
  const root = resolveRepositoryRoot(cwd);
  if (!root.ok) return { ok: false, reason: root.reason };
  return { ok: true, dir: join(root.root, ...STATE_DIR_SEGMENTS) };
}

/**
 * The directory that holds the captures. A capture is a copy of the work
 * under test, so it never belongs inside the worktree it copies: a build
 * that writes into its own context would otherwise modify the source.
 */
export function captureRootDir(cwd = process.cwd()) {
  const state = sandboxStateDir(cwd);
  if (!state.ok) return { ok: false, reason: state.reason };
  return { ok: true, dir: join(state.dir, "captures") };
}

/**
 * The directory that holds the reports. A report is evidence and must
 * survive the removal of the environment it describes, so it is written
 * here, outside every container and outside the capture.
 */
export function reportDir(cwd = process.cwd()) {
  const state = sandboxStateDir(cwd);
  if (!state.ok) return { ok: false, reason: state.reason };
  return { ok: true, dir: join(state.dir, "reports") };
}

/**
 * The directory that holds the reservation record. The quota is one per
 * project, so it lives in the project's state area and not in a session
 * directory.
 */
export function reservationDir(cwd = process.cwd()) {
  const state = sandboxStateDir(cwd);
  if (!state.ok) return { ok: false, reason: state.reason };
  return { ok: true, dir: join(state.dir, "reservation") };
}

/**
 * Create a directory and report the failure instead of throwing. The
 * control never turns a filesystem problem into a session failure.
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
 * True when `candidate` is inside `parent` after both are resolved.
 * The comparison is path-based, not string-based, so `/a/bc` is not
 * inside `/a/b`.
 */
export function isInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  if (rel === "") return true;
  return !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/**
 * True when the path exists and is a regular file or directory (not a
 * symbolic link). The capture refuses to write through a link, so the
 * check is the same for the source and the destination.
 */
export function isRegularPath(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a path to its real location. A path that does not exist
 * resolves to itself, so callers can compare a declared path with a
 * path that has not been created yet.
 */
export function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
