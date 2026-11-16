import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("./secure-file-ops.py", import.meta.url));

function safeRelativePath(value) {
  if (typeof value !== "string" || !value || isAbsolute(value)) return false;
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

function canonicalDirectory(path) {
  const resolved = resolve(path);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("unsafe directory");
  return realpathSync(resolved);
}

/** Run the descriptor-relative helper without passing file contents via argv/stdout. */
export function secureFileOperation(operation, input = {}, options = {}) {
  const python = options.python ?? "python3";
  const payload = { operation, ...input };

  if (operation === "copy") {
    if (!safeRelativePath(payload.sourceRelative) || !safeRelativePath(payload.destinationRelative)) {
      return { ok: false, reason: "credential path is unsafe" };
    }
  }
  if (["inspect", "remove"].includes(operation) && !safeRelativePath(payload.relative)) {
    return { ok: false, reason: "credential path is unsafe" };
  }
  try {
    if (operation === "copy") {
      payload.sourceRoot = canonicalDirectory(payload.sourceRoot);
      payload.destinationRoot = canonicalDirectory(payload.destinationRoot);
    } else if (["inspect", "remove"].includes(operation)) {
      payload.root = canonicalDirectory(payload.root);
    } else {
      return { ok: false, reason: "secure file operation is unavailable" };
    }
    const output = execFileSync(python, [helperPath], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 1024 * 1024,
    });
    const response = JSON.parse(output);
    return response && typeof response === "object"
      ? response
      : { ok: false, reason: "secure file operation failed" };
  } catch {
    return { ok: false, reason: "secure file operation is unavailable or failed" };
  }
}

export function isContainedPath(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
