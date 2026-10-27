// Credential screening for the sandbox control.
//
// The capture, the reservation, and the report all flow values that a
// developer may not want persisted: an API key passed to a local
// application, a token in a command-line argument, a secret in an
// environment file. The screen is a deny list of shapes that look like
// credentials. It is deliberately conservative: a false positive blocks
// one value and is reported, while a false negative persists a secret.
//
// The screen is engine-free and dependency-free so it can be tested
// without Docker or a running OpenCode.

import { readFileSync, statSync } from "node:fs";

// A key that carries a name, an assignment, and a value. The value part
// is what makes it a credential rather than a mention.
const ASSIGNMENT_PATTERNS = [
  /\b(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|private[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer[_-]?token|encryption[_-]?key|signing[_-]?key)\b\s*[:=]\s*["']?([^\s"',;]{8,})/gi,
  /\b(?:password|passwd|pwd|secret|token)\b\s*[:=]\s*["']?([^\s"',;]{8,})/gi,
];

// A provider-shaped key on its own, with no assignment around it.
const PROVIDER_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

// A PEM block, private or public, in any of the shapes a tool writes.
const PEM_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g;

/**
 * The reasons a value can be refused. The reason is part of the result
 * so a caller can report it without re-deriving the classification.
 */
export const REFUSAL_REASONS = {
  assignment: "the value looks like a named credential assignment",
  provider: "the value looks like a provider credential",
  privateKey: "the value looks like a private key block",
  argument: "the argument looks like a credential",
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Screen a single string. Returns `null` when the value is safe and a
 * reason when it is not.
 */
export function screenValue(value) {
  if (typeof value !== "string" || value.length === 0) return null;

  for (const pattern of ASSIGNMENT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(value)) return REFUSAL_REASONS.assignment;
  }
  for (const pattern of PROVIDER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(value)) return REFUSAL_REASONS.provider;
  }
  const pem = new RegExp(PEM_PATTERN.source, PEM_PATTERN.flags);
  if (pem.test(value)) return REFUSAL_REASONS.privateKey;

  return null;
}

/**
 * Screen a command-line argument. An argument that names a credential is
 * refused even when the value itself looks harmless, because the value
 * may be a file path that holds the secret.
 */
export function screenArgument(argument) {
  if (typeof argument !== "string" || argument.length === 0) return null;
  if (screenValue(argument)) return REFUSAL_REASONS.argument;
  // A flag that names a credential is refused even when the value is a
  // separate argument: `--api-key` and `--api-key=VALUE` are the same
  // declaration, and the value may be a path that holds the secret.
  const named = /^--?(?:api[-_]?key|token|secret|password|passwd|pwd|credential|auth)$/i;
  const inline = /^--?(?:api[-_]?key|token|secret|password|passwd|pwd|credential|auth)=/i;
  if (named.test(argument) || inline.test(argument)) return REFUSAL_REASONS.argument;
  return null;
}

/**
 * Screen every argument of a command. Returns the offending argument and
 * the reason, or `null` when all of them are safe.
 */
export function screenArguments(args) {
  for (const argument of args ?? []) {
    const reason = screenArgument(argument);
    if (reason) return { argument, reason };
  }
  return null;
}

/**
 * Screen the content of a captured file. Only text-shaped files are
 * screened: a binary file is screened by its name and by the paths the
 * exclusion policy removed, not by decoding its bytes.
 */
export function screenFileContent(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;

  let content;
  try {
    const buffer = readFileSync(path);
    // A file with a NUL byte in the first block is binary; decoding it
    // as text would produce a meaningless match.
    if (buffer.subarray(0, 4096).includes(0)) return null;
    content = buffer.toString("utf8");
  } catch {
    return null;
  }

  return screenValue(content);
}

/**
 * Screen a whole set of captured files and return every refusal.
 */
export function screenCapturedFiles(files) {
  const refusals = [];
  for (const file of files ?? []) {
    const reason = screenFileContent(file);
    if (reason) refusals.push({ file, reason });
  }
  return refusals;
}

export { escapeRegExp };
