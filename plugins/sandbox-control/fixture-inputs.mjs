// Fixture paths are literal, portable, checkout-relative names, never patterns.
// Fixed ceilings cannot be raised by project configuration.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { screenValue } from "./secret-screen.mjs";

export const FIXTURE_LIMITS = Object.freeze({
  count: 256, pathBytes: 1024, segmentBytes: 255,
  fileBytes: 2 * 1024 * 1024, totalBytes: 16 * 1024 * 1024,
});

export function literalFixturePath(path) {
  return typeof path === "string" && path.length > 0 &&
    Buffer.byteLength(path) <= FIXTURE_LIMITS.pathBytes &&
    !/[\p{C}\s\\:*?[\]{}!<>|"`$]/u.test(path) &&
    path.normalize("NFC") === path &&
    path.split("/").every((part) => part && part !== "." && part !== ".." &&
      !part.endsWith(".") && Buffer.byteLength(part) <= FIXTURE_LIMITS.segmentBytes);
}

export function protectedFixturePath(path, protectedPaths = []) {
  return protectedPaths.some((protectedPath) => protectedPath.toLowerCase() === path.toLowerCase()) ||
    /(^|\/)(?:\.opencode|\.git|node_modules|\.ssh|\.aws|\.azure|\.config|\.gnupg)(?:\/|$)/i.test(path) ||
    /(^|\/)(?:opencode-sandbox\.json|\.opencode-sandbox-capture\.json|\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)(?:\..*)?)$/i.test(path) ||
    /(^|\/)\.?(?:opencode|anthropic|openai|ollama)[^/]*\.(?:json|jsonc|env)$/i.test(path) ||
    /\.(?:pem|key|p12|pfx)$/i.test(path);
}

export function validateFixtureInputs(inputs, { include, dockerfile, context = ".", protectedPaths = [] } = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > FIXTURE_LIMITS.count ||
      include !== undefined || !literalFixturePath(dockerfile) ||
      (context !== "." && !literalFixturePath(context))) {
    return { ok: false, reason: "fixtureInputs requires a bounded nonempty literal file list, a literal Dockerfile/context, and no include declaration" };
  }
  const seen = new Set();
  for (const path of inputs) {
    const key = typeof path === "string" ? path.toLowerCase() : "";
    if (!literalFixturePath(path) || screenValue(path) || protectedFixturePath(path, protectedPaths) ||
        seen.has(key) || (context !== "." && !path.startsWith(`${context}/`))) {
      return { ok: false, reason: "fixtureInputs contains an unsafe, protected, duplicate or out-of-context path" };
    }
    seen.add(key);
  }
  if (!inputs.includes(dockerfile)) return { ok: false, reason: "fixtureInputs must select the declared Dockerfile" };
  return { ok: true, paths: [...inputs].sort() };
}

// The Python reader reuses the existing descriptor-relative no-follow helpers.
// Bytes travel only over a private pipe; failures never echo source content.
export function readFixtureSnapshot(root, paths) {
  try {
    const output = execFileSync("python3", ["-I", "-B", fileURLToPath(new URL("./fixture-reader.py", import.meta.url))], {
      input: JSON.stringify({ root, paths, limits: FIXTURE_LIMITS }),
      encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 24 * 1024 * 1024, timeout: 15000,
    });
    const result = JSON.parse(output);
    if (!result.ok) throw new Error("unverifiable");
    return { ok: true, files: result.files.map((file) => {
      const bytes = Buffer.from(file.bytes, "base64");
      return { ...file, bytes, fingerprint: createHash("sha256").update(bytes).digest("hex") };
    }) };
  } catch {
    return { ok: false, reason: "fixture inputs are missing, aliased, unsafe, over a limit or unverifiable" };
  }
}

export function fixtureIdentity(files) {
  return JSON.stringify(files.map(({ path, fingerprint, identity, ancestors, mode, size }) =>
    ({ path, fingerprint, identity, ancestors, mode, size })));
}

export function stageFixtureSnapshot(root, name, files) {
  try {
    const output = execFileSync("python3", ["-I", "-B", fileURLToPath(new URL("./fixture-reader.py", import.meta.url))], {
      input: JSON.stringify({ action: "stage", root, name,
        files: files.map(({ path, mode, bytes }) => ({ path, mode, bytes: bytes.toString("base64") })) }),
      encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 15000,
    });
    return JSON.parse(output).ok === true;
  } catch { return false; }
}

export function discardFixtureSnapshot(root, name) {
  try {
    const output = execFileSync("python3", ["-I", "-B", fileURLToPath(new URL("./fixture-reader.py", import.meta.url))], {
      input: JSON.stringify({ action: "discard", root, name }),
      encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 15000,
    });
    return JSON.parse(output).ok === true;
  } catch { return false; }
}

/**
 * --pull=false is not an offline guarantee for an absent image. Resolve every
 * external image reference locally before build. Dynamic references, remote
 * frontends and remote ADD are refused rather than provisioned.
 */
export function checkFixtureRuntimeInputs(dockerfileBytes, run) {
  const stages = new Set();
  const images = new Set();
  let stageCount = 0;
  const text = dockerfileBytes.toString("utf8");
  const blocked = () => ({ ok: false, reason: "fixture runtime inputs require pinned locally available images and no remote or dynamic build inputs" });
  if (/^\s*#\s*(?:syntax|escape)\s*=/im.test(text)) return blocked();
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*(?:#|$)/.test(line)) continue;
    if (/^\s*ONBUILD\b/i.test(line) || /<<|--mount\b|--network\b/i.test(line)) return blocked();
    if (/^\s*ADD\b/i.test(line)) {
      let operands = line;
      const jsonStart = line.indexOf("[");
      if (jsonStart >= 0) {
        try { operands = JSON.parse(line.slice(jsonStart)).join(" "); } catch { return blocked(); }
      }
      if (/\$|[a-z][a-z0-9+.-]*:\/\/|git@/i.test(operands)) return blocked();
    }
    const from = line.match(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+([a-z0-9_-]+))?\s*$/i);
    const copy = /^\s*COPY\b/i.test(line) ? [...line.matchAll(/--from=([^\s]+)/gi)] : [];
    if (copy.length > 1) return blocked();
    if (/^\s*FROM\b/i.test(line) && !from) return blocked();
    const image = from?.[1] ?? copy[0]?.[1];
    const knownIndex = copy.length === 1 && /^\d+$/.test(image) && Number(image) < stageCount;
    if (image && !(from && image.toLowerCase() === "scratch") && !stages.has(image.toLowerCase()) && !knownIndex) {
      if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/i.test(image)) return blocked();
      images.add(image);
    }
    if (from) stageCount++;
    if (from?.[2]) stages.add(from[2].toLowerCase());
    // A spaced or variable --from must not escape the reference inventory.
    if (/^\s*COPY\b/i.test(line) && /--from\b/i.test(line) && !copy.length) return blocked();
  }
  if (!stageCount) return blocked();
  for (const image of images) {
    try {
      const inspected = JSON.parse(String(run("docker", ["image", "inspect", image], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
      if (!Array.isArray(inspected) || inspected.length !== 1 || !inspected[0]?.Id ||
          (inspected[0].Config?.OnBuild?.length ?? 0) > 0) return blocked();
    } catch {
      return { ok: false, reason: "a required pinned fixture image is unavailable locally; no dependency was provisioned" };
    }
  }
  return { ok: true, images: [...images] };
}
