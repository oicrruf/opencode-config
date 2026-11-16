import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkStatePath, ensureStateDir } from "./paths.mjs";

function manifestName(worktree) {
  return `${createHash("sha256").update(String(worktree)).digest("hex")}.json`;
}

function manifestLocation(root, worktree) {
  const name = manifestName(worktree);
  const check = checkStatePath(root, ["credentials", name], "file");
  return { name, path: check.path, check };
}

function validateManifest(value, worktree) {
  if (value?.version !== 1 || value.worktree !== worktree || !Array.isArray(value.files)) return false;
  const validFiles = value.files.every((file) =>
    typeof file?.path === "string" &&
    file.path.length > 0 &&
    !file.path.startsWith("/") &&
    !file.path.split("/").some((part) => !part || part === "." || part === "..") &&
    Array.isArray(file.identity) &&
    file.identity.length === 4 &&
    file.identity.every((part) => typeof part === "string" && /^\d+$/.test(part)),
  );
  const validTransaction = value.transaction == null || (
    value.transaction.state === "retiring" &&
    typeof value.transaction.escrowName === "string" &&
    /^\.opencode-mcp-retire-[a-f0-9]+$/.test(value.transaction.escrowName) &&
    Array.isArray(value.transaction.staged) &&
    value.transaction.staged.every((file) =>
      typeof file?.path === "string" &&
      value.files.some((owned) => owned.path === file.path) &&
      typeof file.escrowName === "string" &&
      /^[a-f0-9]+$/.test(file.escrowName) &&
      (file.identity == null || (
        Array.isArray(file.identity) &&
        file.identity.length === 4 &&
        file.identity.every((part) => typeof part === "string" && /^\d+$/.test(part))
      )),
    )
  );
  return validFiles && validTransaction;
}

export function readCredentialOwnership(root, worktree) {
  const location = manifestLocation(root, worktree);
  if (!location.check.ok) return { ok: false, reason: "credential ownership state is unsafe" };
  if (!location.check.exists) return { ok: true, files: [], manifest: null };
  try {
    const parsed = JSON.parse(readFileSync(location.path, "utf8"));
    if (!validateManifest(parsed, worktree)) {
      return { ok: false, reason: "credential ownership state is invalid" };
    }
    return { ok: true, files: parsed.files, transaction: parsed.transaction ?? null, manifest: location.path };
  } catch {
    return { ok: false, reason: "credential ownership state could not be read" };
  }
}

export function writeCredentialOwnership(root, worktree, files) {
  const current = readCredentialOwnership(root, worktree);
  if (!current.ok) return current;
  return writeCredentialManifest(root, worktree, {
    version: 1,
    worktree,
    files,
    ...(current.transaction ? { transaction: current.transaction } : {}),
  });
}

function writeCredentialManifest(root, worktree, value) {
  const directory = ensureStateDir(root, ["credentials"]);
  if (!directory.ok) return { ok: false, reason: "credential ownership state is unsafe" };
  const location = manifestLocation(root, worktree);
  if (!location.check.ok) return { ok: false, reason: "credential ownership state is unsafe" };
  if (!validateManifest(value, worktree)) {
    return { ok: false, reason: "credential ownership state is invalid" };
  }

  const temporaryName = `${location.name}.${process.pid}.${Date.now()}.tmp`;
  const temporary = join(directory.dir, temporaryName);
  const safeTemporary = checkStatePath(root, ["credentials", temporaryName], "file");
  if (!safeTemporary.ok) return { ok: false, reason: "credential ownership state is unsafe" };
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, location.path);
    return { ok: true, manifest: location.path };
  } catch {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    try { unlinkSync(temporary); } catch {}
    return { ok: false, reason: "credential ownership state could not be saved" };
  }
}

/** Remove only the ownership metadata, never a credential file. */
export function clearCredentialOwnership(root, worktree) {
  const location = manifestLocation(root, worktree);
  if (!location.check.ok) return { ok: false, reason: "credential ownership state is unsafe" };
  if (!location.check.exists) return { ok: true, removed: false };
  try {
    unlinkSync(location.path);
    return { ok: true, removed: true };
  } catch {
    return { ok: false, reason: "credential ownership state could not be cleared" };
  }
}
