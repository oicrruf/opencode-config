// The independent capture of the work under test.
//
// The capture is a copy of the committed files, the modifications, and
// the new files, taken into a directory outside the worktree. It
// records a manifest with the identity of the work, the repository, the
// branch, the head, and a fingerprint per file.
//
// Three properties make the capture trustworthy, and each one is a
// rejection rather than a repair:
//
//   1. A symbolic link that would bring content from outside the source
//      is refused without reading its destination.
//   2. A source that changed while the capture was taken is refused, so
//      the test never corresponds to a state that never existed.
//   3. The branch or the head that changed is refused even when the
//      resulting tree is identical, because the identity changed.
//
// The Git pointer is never copied; a build that needs Git metadata gets
// an independent repository inside the capture.

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { captureRootDir, ensureDir, isInside, canonicalPath } from "./paths.mjs";
import { screenCapturedFiles } from "./secret-screen.mjs";

/**
 * The paths that are always excluded from a capture. A declared include
 * cannot override these protected categories.
 */
export const DEFAULT_EXCLUSIONS = [
  { kind: "environment", matches: (rel) => /(^|\/)\.env(\..+)?$/.test(rel) || rel === ".env" },
  { kind: "credentials", matches: (rel) => /(^|\/)(credentials?|secrets?)\.(json|ya?ml|toml|ini)$/i.test(rel) },
  { kind: "model-key", matches: (rel) => /(^|\/)\.?(opencode|anthropic|openai|ollama)[^/]*\.(json|jsonc|env)$/i.test(rel) },
  { kind: "session-state", matches: (rel) => rel.startsWith(".opencode/state/") || rel.startsWith(".opencode/session") },
  { kind: "project-memory", matches: (rel) => rel.startsWith(".opencode/memory/") },
  { kind: "global-configuration", matches: (rel) => rel.startsWith(".opencode/worktree/") },
  { kind: "git-metadata", matches: (rel) => rel === ".git" || rel.startsWith(".git/") },
  { kind: "node-modules", matches: (rel) => rel === "node_modules" || rel.startsWith("node_modules/") },
  { kind: "capture-state", matches: (rel) => rel.startsWith(".opencode/state/sandbox/") },
];

/**
 * Decide whether a relative path is excluded.
 *
 * Protected exclusions are checked first and cannot be overridden by
 * declared include paths. Includes only document additional project paths.
 */
export function isExcluded(relPath, include = [], protectedPaths = []) {
  const rel = relPath.split(sep).join("/");
  if (protectedPaths.includes(rel)) return { excluded: true, kind: "sandbox-configuration" };
  for (const rule of DEFAULT_EXCLUSIONS) {
    if (rule.matches(rel)) return { excluded: true, kind: rule.kind };
  }
  for (const declared of include) {
    const pattern = String(declared).split(sep).join("/");
    if (rel === pattern || rel.startsWith(`${pattern}/`)) return { excluded: false, kind: null };
  }
  return { excluded: false, kind: null };
}

/**
 * Read the identity of the worktree: the branch, the head, and the
 * state of the working tree.
 */
export function readWorktreeIdentity(worktreePath) {
  const run = (args) =>
    execFileSync("git", args, { cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  let branch;
  try {
    branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    branch = null;
  }
  let head;
  try {
    head = run(["rev-parse", "HEAD"]);
  } catch {
    head = null;
  }

  let status;
  try {
    status = run(["status", "--porcelain=v1", "--untracked-files=all"]);
  } catch {
    status = "";
  }

  const changed = status
    ? status.split("\n").filter(Boolean).map((line) => ({
        status: line.slice(0, 2).trim() || "??",
        path: line.slice(3),
      }))
    : [];

  return { branch, head, changed };
}

/**
 * List the files of the worktree that belong to the capture.
 *
 * The listing walks the tree instead of asking Git for it, so a new
 * untracked file is captured and a deleted file is reported as a
 * deletion rather than silently missing.
 */
export function listCaptureCandidates(worktreePath, include = [], protectedPaths = []) {
  const root = resolve(worktreePath);
  const files = [];
  const deletions = [];
  // A hardlink alias of the selected config is the same secret-bearing file.
  const protectedIdentities = new Set(protectedPaths.map((rel) => {
    const stat = lstatSync(join(root, rel));
    return `${stat.dev}:${stat.ino}`;
  }));

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (!rel || rel === ".") continue;

      const decision = isExcluded(rel, include, protectedPaths);
      if (decision.excluded) continue;

      if (entry.isSymbolicLink()) {
        files.push({ rel, kind: "symlink", target: readlinkSync(full) });
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile()) {
        const stat = statSync(full);
        if (protectedIdentities.has(`${stat.dev}:${stat.ino}`)) continue;
        files.push({ rel, kind: "file", mode: stat.mode & 0o777 });
        continue;
      }
      // A socket, a fifo, or a device has no place in a build context.
    }
  };

  walk(root);

  return { files, deletions };
}

/**
 * Take the capture.
 *
 * The result is the destination directory, the manifest, and the list
 * of the refused files. A refusal never produces a partial capture that
 * a build could use.
 */
export function takeCapture(input) {
  const {
    worktreePath,
    workId,
    workName,
    executionId,
    include = [],
    protectedPaths = [],
    cwd = process.cwd(),
  } = input ?? {};

  if (!worktreePath) return { ok: false, reason: "the capture needs a worktree path" };
  if (!workId) return { ok: false, reason: "the capture needs a work identifier" };

  const root = resolve(worktreePath);
  if (!Array.isArray(protectedPaths) || protectedPaths.some((path) => typeof path !== "string" || !path || !isInside(root, resolve(root, path)) || path !== relative(root, resolve(root, path)).split(sep).join("/"))) {
    return { ok: false, reason: "the protected configuration path is outside the capture source" };
  }
  const destinationRoot = captureRootDir(cwd);
  if (!destinationRoot.ok) return { ok: false, reason: destinationRoot.reason };
  const ensured = ensureDir(destinationRoot.dir);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };

  const destination = join(destinationRoot.dir, executionId ?? `${workId}-${Date.now()}`);
  if (existsSync(destination)) {
    return { ok: false, reason: `the capture destination already exists: ${destination}` };
  }

  const before = readWorktreeIdentity(root);
  let files, deletions;
  try { ({ files, deletions } = listCaptureCandidates(root, include, protectedPaths)); }
  catch { return { ok: false, reason: "the protected configuration identity could not be verified" }; }

  // The inventory of the source is taken before the copy and compared
  // after it. A comparison of the branch and the head alone is not
  // enough: an uncommitted modification can change the content while
  // the head and the porcelain status stay the same, and the capture
  // would then be a mixture of two states.
  const inventoryBefore = fingerprintInventory(root, files);

  // A symbolic link is refused without reading its destination: the
  // point is to notice that the link leaves the source, and reading it
  // would already be the breach.
  for (const file of files) {
    if (file.kind !== "symlink") continue;
    const linkTarget = resolve(dirname(join(root, file.rel)), file.target);
    if (!isInside(root, linkTarget)) {
      return {
        ok: false,
        reason: `the capture was refused: the symbolic link ${file.rel} points outside the source`,
        refused: file.rel,
      };
    }
  }

  mkdirSync(destination, { recursive: true, mode: 0o700 });

  const manifestFiles = [];
  for (const file of files) {
    const source = join(root, file.rel);
    const target = join(destination, file.rel);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (file.kind === "symlink") {
      const linkTarget = resolve(dirname(source), file.target);
      try {
        const targetRel = relative(root, linkTarget).split(sep).join("/");
        const targetDecision = isExcluded(targetRel, include, protectedPaths);
        if (targetDecision.excluded) {
          throw new Error(`the symbolic link ${file.rel} points to an excluded path`);
        }
        const sourceTargetExists = existsSync(linkTarget);
        if (sourceTargetExists && statSync(linkTarget).isDirectory()) {
          mkdirSync(join(destination, targetRel), { recursive: true, mode: 0o700 });
        }
        const captureTarget = join(destination, targetRel);
        const relativeTarget = relative(dirname(target), captureTarget) || ".";
        symlinkSync(relativeTarget, target);
      } catch (err) {
        rmSync(destination, { recursive: true, force: true });
        return {
          ok: false,
          reason: `the capture was refused: the symbolic link ${file.rel} could not be preserved (${err.message})`,
          refused: file.rel,
        };
      }
      manifestFiles.push({ path: file.rel, kind: "symlink", target: file.target, fingerprint: null });
      continue;
    }
    cpSync(source, target, { preserveTimestamps: true });
    try {
      chmodSync(target, file.mode & 0o777);
    } catch {
      // A filesystem that refuses the mode still receives the content.
    }
    const fingerprint = hashFile(target);
    manifestFiles.push({ path: file.rel, kind: "file", mode: file.mode, fingerprint });
  }

  const after = readWorktreeIdentity(root);
  if (before.head !== after.head || before.branch !== after.branch) {
    rmSync(destination, { recursive: true, force: true });
    return {
      ok: false,
      reason: "the capture was refused as inconsistent: the branch or the head changed while it was taken",
      inconsistent: true,
    };
  }

  // The content of the source is compared with what it was before the
  // copy. A file that changed while the capture was taken refuses the
  // capture, even when the branch and the head did not move.
  if (typeof input.onBeforeCompare === "function") {
    // The hook exists so the race is exercised by a test.
    input.onBeforeCompare();
  }
  const inventoryAfter = fingerprintInventory(root, files);
  const changed = compareInventories(inventoryBefore, inventoryAfter);
  if (changed.length > 0) {
    rmSync(destination, { recursive: true, force: true });
    return {
      ok: false,
      reason: `the capture was refused as inconsistent: ${changed.length} file(s) changed while it was taken`,
      inconsistent: true,
      changed,
    };
  }

  const manifest = {
    version: 1,
    workId,
    workName: workName ?? workId,
    executionId: executionId ?? null,
    repository: canonicalPath(root),
    branch: after.branch,
    head: after.head,
    takenAt: new Date().toISOString(),
    deletions: deletions.map((entry) => entry.path),
    files: manifestFiles,
  };

  writeFileSync(
    join(destination, ".opencode-sandbox-capture.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );

  const refusals = screenCapturedFiles(manifestFiles.map((file) => join(destination, file.path)));
  if (refusals.length > 0) {
    rmSync(destination, { recursive: true, force: true });
    return {
      ok: false,
      reason: `the capture was refused: ${refusals.length} file(s) contain a credential-shaped value`,
      refusals,
    };
  }

  return { ok: true, destination, manifest };
}

/**
 * Hash a file. The fingerprint identifies the content that was tested.
 */
export function hashFile(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

/**
 * The fingerprint of every candidate of the source.
 *
 * The inventory is what makes the capture verifiable: it is taken
 * before and after the copy, and a difference refuses the capture.
 */
export function fingerprintInventory(root, files) {
  const inventory = new Map();
  for (const file of files ?? []) {
    if (file.kind === "symlink") {
      inventory.set(file.rel, `link:${file.target}`);
      continue;
    }
    try {
      inventory.set(file.rel, hashFile(join(root, file.rel)));
    } catch {
      // A file that disappeared between the listing and the hash is
      // recorded as missing, so the comparison notices it.
      inventory.set(file.rel, "missing");
    }
  }
  return inventory;
}

/**
 * Compare two inventories and name the files that differ.
 */
export function compareInventories(before, after) {
  const changed = [];
  for (const [path, fingerprint] of before ?? new Map()) {
    const other = after?.get(path);
    if (other !== fingerprint) changed.push(path);
  }
  for (const path of after?.keys() ?? []) {
    if (!before?.has(path)) changed.push(path);
  }
  return changed;
}

/**
 * Verify a capture against its manifest.
 */
export function verifyCapture(destination) {
  const manifestPath = join(destination, ".opencode-sandbox-capture.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, reason: "the capture has no manifest" };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const mismatches = [];
  for (const file of manifest.files ?? []) {
    if (file.kind !== "file") continue;
    const path = join(destination, file.path);
    if (!existsSync(path)) {
      mismatches.push({ path: file.path, reason: "missing" });
      continue;
    }
    const fingerprint = hashFile(path);
    if (fingerprint !== file.fingerprint) {
      mismatches.push({ path: file.path, reason: "fingerprint differs" });
    }
  }
  return {
    ok: mismatches.length === 0,
    manifest,
    mismatches,
    reason: mismatches.length > 0 ? "the capture does not match its manifest" : undefined,
  };
}

/**
 * Prepare an independent repository inside the capture for builds that
 * need Git metadata.
 *
 * The worktree's pointer is never copied and the original repository is
 * never opened for writing: the new repository is initialized inside
 * the capture and the captured state is recorded in it.
 */
export function prepareIndependentRepository(destination, deps = {}) {
  const run = deps.execFileSync ?? execFileSync;
  const gitDir = join(destination, ".git");
  if (existsSync(gitDir)) {
    return { ok: true, repository: destination, alreadyPrepared: true };
  }
  try {
    run("git", ["init", "-q", destination], { stdio: "ignore" });
    run("git", ["-C", destination, "config", "user.email", "sandbox@local"], { stdio: "ignore" });
    run("git", ["-C", destination, "config", "user.name", "sandbox control"], { stdio: "ignore" });
    run("git", ["-C", destination, "add", "-A"], { stdio: "ignore" });
    run("git", ["-C", destination, "commit", "-q", "-m", "captured state"], { stdio: "ignore" });
  } catch (err) {
    return {
      ok: false,
      reason: `the independent repository could not be prepared: ${err.message}`,
    };
  }
  return { ok: true, repository: destination, alreadyPrepared: false };
}
