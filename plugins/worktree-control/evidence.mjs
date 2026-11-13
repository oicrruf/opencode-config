// The evidence preservation.
//
// The recognized verification and review reports are copied to a
// location outside the worktree, under a directory named after the
// worktree and the date, with a manifest that records the worktree, the
// branch, the reviewed commit, and the copied files.
//
// The order matters: the evidence is preserved first, and a failure to
// preserve it keeps the worktree. A removal that destroys the only copy
// of a review is a silent loss of the record that the change was
// reviewed.

import {
  chmodSync,
  copyFileSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { checkStatePath, ensureStateDir } from "./paths.mjs";

/**
 * The files the evidence policy recognizes.
 *
 * The policy is a list of names and of directory prefixes. A file the
 * policy does not recognize is not evidence, and it is not copied: the
 * worktree may hold anything, and the preservation copies only the
 * record of the review and of the verification.
 */
export const RECOGNIZED_EVIDENCE = [
  { name: "verification-report.md", kind: "verification" },
  { name: "review-report.md", kind: "review" },
  { name: "adversarial-report.md", kind: "review" },
  { name: "qa-report.md", kind: "qa" },
  { name: "evidence", kind: "directory", prefix: true },
  { name: "reviews", kind: "directory", prefix: true },
];

/**
 * True when the policy recognizes a path.
 */
export function isRecognizedEvidence(relativePath, policy = RECOGNIZED_EVIDENCE) {
  const normalized = relativePath.split(/[\\/]/).join("/");
  for (const entry of policy) {
    if (entry.prefix) {
      if (normalized === entry.name || normalized.startsWith(`${entry.name}/`)) return true;
      continue;
    }
    if (normalized === entry.name) return true;
  }
  return false;
}

/**
 * The files of the worktree that the policy recognizes.
 */
export function collectRecognizedEvidence(directory, policy = RECOGNIZED_EVIDENCE) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const full = join(directory, entry.name);
    const rel = relative(directory, full);
    if (!isRecognizedEvidence(rel, policy)) continue;
    if (entry.isDirectory()) {
      for (const nested of readdirSync(full, { withFileTypes: true })) {
        if (!nested.isFile()) continue;
        const nestedFull = join(full, nested.name);
        const nestedRel = relative(directory, nestedFull);
        if (!isRecognizedEvidence(nestedRel, policy)) continue;
        found.push({ path: nestedRel, absolute: nestedFull });
      }
      continue;
    }
    if (entry.isFile()) found.push({ path: rel, absolute: full });
  }
  return found;
}

/**
 * Screen a file for a credential.
 *
 * A file that looks like a credential is not evidence and is not
 * copied, whatever the policy says about its name.
 */
export function looksLikeCredential(content) {
  if (typeof content !== "string") return false;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) return true;
  if (/\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*["']?[^\s"',;]{8,}/i.test(content)) {
    return true;
  }
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(content)) return true;
  if (/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/.test(content)) return true;
  if (/\bAKIA[0-9A-Z]{16}\b/.test(content)) return true;
  return false;
}

/**
 * The normalized name of an evidence directory.
 *
 * The name comes from the request, so it is reduced to a safe set of
 * characters. A name that holds nothing usable is refused rather than
 * turned into a shared name that would collide with another
 * worktree's evidence.
 */
export function normalizeEvidenceName(name) {
  const normalized = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  return normalized;
}

/**
 * Preserve the evidence of a worktree.
 *
 * The copy lands outside the worktree, under a directory named after
 * the worktree and the date. The manifest ties the copied files to the
 * worktree, the branch, and the reviewed commit.
 *
 * A failure to preserve keeps the worktree: the caller checks the
 * result before it removes anything.
 */
export function preserveEvidence(input) {
  const {
    root,
    directory,
    worktreeName,
    branch,
    head,
    date = new Date().toISOString().slice(0, 10),
    policy = RECOGNIZED_EVIDENCE,
  } = input ?? {};

  if (!directory) return { ok: false, reason: "the evidence preservation needs a worktree" };
  if (!worktreeName) return { ok: false, reason: "the evidence preservation needs a worktree name" };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return { ok: false, reason: "the evidence date is not a safe YYYY-MM-DD date" };
  }

  const ensured = ensureStateDir(root, ["evidence"]);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };
  const base = ensured.dir;

  // The name of the worktree becomes a directory name, so it is
  // normalized and the result is verified to be inside the evidence
  // area. A name that carries a path separator would otherwise write
  // outside it.
  const safeName = normalizeEvidenceName(worktreeName);
  if (!safeName) {
    return { ok: false, reason: `the worktree name cannot name an evidence directory: ${worktreeName}` };
  }

  const targetName = `${safeName}-${date}`;
  const target = join(base, targetName);
  const rel = relative(base, target);
  if (rel === "" || rel === ".." || rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, reason: `the evidence destination escapes the evidence area: ${worktreeName}` };
  }

  // Never reuse a dated evidence directory. Exclusive creation prevents a
  // later retirement with the same name from overwriting prior evidence.
  try {
    mkdirSync(target, { mode: 0o700 });
  } catch (err) {
    const reason = err.code === "EEXIST"
      ? `the evidence destination already exists and was left unchanged: ${target}`
      : `the evidence destination could not be created: ${err.message}`;
    return { ok: false, reason, target };
  }
  const safeTarget = checkStatePath(root, ["evidence", targetName], "directory");
  if (!safeTarget.ok) return { ok: false, reason: safeTarget.reason, target };

  const recognized = collectRecognizedEvidence(directory, policy);
  const copied = [];
  const skipped = [];

  for (const file of recognized) {
    let content;
    try {
      content = readFileSync(file.absolute, "utf8");
    } catch (err) {
      return {
        ok: false,
        reason: `the evidence could not be read: ${err.message}`,
        copied,
        skipped,
      };
    }

    if (looksLikeCredential(content)) {
      // A file that looks like a credential is left out and reported.
      skipped.push({ path: file.path, reason: "the file looks like a credential" });
      continue;
    }

    const destination = join(target, file.path);
    const parentPath = resolve(destination, "..");
    try {
      if (!existsSync(parentPath)) mkdirSync(parentPath, { mode: 0o700 });
      const parentStat = lstatSync(parentPath);
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
        return { ok: false, reason: `the evidence path is unsafe: ${parentPath}`, target };
      }
    } catch (err) {
      return { ok: false, reason: `the evidence directory could not be created: ${err.message}`, target };
    }
    try {
      copyFileSync(file.absolute, destination, constants.COPYFILE_EXCL);
      // The copy does not inherit the permissions of the source. The
      // evidence can carry a review of sensitive material, so it is
      // readable only by the identity that runs the control.
      chmodSync(destination, 0o600);
    } catch (err) {
      // A failure to copy keeps the worktree: the evidence must be
      // recoverable.
      return {
        ok: false,
        reason: `the evidence could not be copied: ${err.message}`,
        copied,
        skipped,
        target,
      };
    }
    copied.push({ path: file.path, bytes: statSync(destination).size });
  }

  const manifest = {
    version: 1,
    worktree: { name: worktreeName, directory, branch: branch ?? null, head: head ?? null },
    preservedAt: new Date().toISOString(),
    files: copied,
    skipped,
  };

  try {
    writeFileSync(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `the evidence manifest could not be written: ${err.message}`,
      copied,
      skipped,
      target,
    };
  }

  return { ok: true, target, manifest, copied, skipped };
}
