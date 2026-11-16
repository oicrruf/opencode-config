import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { clearCredentialOwnership, readCredentialOwnership, writeCredentialOwnership } from "./credential-ownership.mjs";
import { isContainedPath, secureFileOperation } from "./secure-files.mjs";

function summarizeEntries(entries) {
  if (!Array.isArray(entries)) return null;
  const servers = new Map();
  let configPresent = false;
  for (const entry of entries) {
    if (entry?.type !== "document" || !entry.info || typeof entry.info !== "object") continue;
    configPresent = true;
    const definitions = entry.info.mcp?.servers;
    if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) continue;
    for (const [name, definition] of Object.entries(definitions)) {
      if (!name || !definition || typeof definition !== "object" || Array.isArray(definition)) continue;
      servers.set(name, { enabled: definition.enabled !== false, entry });
    }
  }
  return { configPresent, servers };
}

/** Public safe summary: never expose values which may contain credentials. */
export function summarizeMcpConfig(entries) {
  const summary = summarizeEntries(entries);
  if (!summary) return { ok: false, configured: false, reason: "effective configuration is unavailable" };
  const servers = [...summary.servers].map(([name, value]) => ({ name, enabled: value.enabled }));
  return {
    ok: true,
    configPresent: summary.configPresent,
    configured: servers.length > 0,
    servers,
    connectionStatus: "unknown",
  };
}

function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
    } else if (current === "/" && next === "/") {
      output += "  ";
      index += 1;
      while (index + 1 < input.length && input[index + 1] !== "\n") {
        output += " ";
        index += 1;
      }
    } else if (current === "/" && next === "*") {
      output += "  ";
      index += 1;
      while (index + 1 < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        output += input[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index + 1 >= input.length) throw new Error("invalid JSONC");
      output += "  ";
      index += 1;
    } else {
      output += current;
    }
  }

  let clean = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const current = output[index];
    if (inString) {
      clean += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      clean += current;
      continue;
    }
    if (current === ",") {
      let next = index + 1;
      while (/\s/.test(output[next] ?? "")) next += 1;
      if (output[next] === "}" || output[next] === "]") continue;
    }
    clean += current;
  }
  return clean;
}

function rawServerDefinitions(entry) {
  if (typeof entry?.path !== "string" || !isAbsolute(entry.path)) return { ok: true, definitions: {} };
  try {
    const path = realpathSync(resolve(entry.path));
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, definitions: {} };
    const raw = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
    const definitions = raw?.mcp?.servers;
    return { ok: true, definitions: definitions && typeof definitions === "object" && !Array.isArray(definitions) ? definitions : {} };
  } catch {
    return { ok: false, definitions: {} };
  }
}

function fileReferences(value, found = []) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{file:([^}]+)\}/g)) {
      if (match[1].trim()) found.push(match[1].trim());
    }
  } else if (Array.isArray(value)) {
    for (const item of value) fileReferences(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) fileReferences(item, found);
  }
  return found;
}

function expandFileReference(configPath, reference) {
  if (reference.startsWith("~/")) return resolve(homedir(), reference.slice(2));
  if (isAbsolute(reference)) return resolve(reference);
  return resolve(dirname(configPath), reference);
}

function parseAllowlist(value) {
  if (value == null || value === "") return { ok: true, paths: new Set() };
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      return { ok: false, paths: new Set() };
    }
    const paths = new Set();
    for (const item of parsed) {
      const normalized = item.replaceAll("\\", "/");
      const segments = normalized.split("/");
      if (!normalized || isAbsolute(normalized) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        return { ok: false, paths: new Set() };
      }
      paths.add(normalized);
    }
    return { ok: true, paths };
  } catch {
    return { ok: false, paths: new Set() };
  }
}

function forbiddenCredentialPath(path) {
  return path.split("/").some((segment) => /^\.env(?:$|\.)/i.test(segment));
}

function inspectLocalFile(root, relativePath) {
  let current;
  try { current = realpathSync(root); }
  catch { return { ok: false, reason: "MCP file location is unavailable" }; }
  const parts = relativePath.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink()) return { ok: false, reason: "MCP file path contains a symbolic link" };
      if (index < parts.length - 1 && !info.isDirectory()) return { ok: false, reason: "MCP file parent is not a directory" };
      if (index === parts.length - 1) {
        if (!info.isFile()) return { ok: false, reason: "MCP file is not a regular file" };
        return { ok: true, state: "present" };
      }
    } catch (error) {
      if (error.code === "ENOENT") return { ok: true, state: "missing" };
      return { ok: false, reason: "MCP file path could not be inspected" };
    }
  }
  return { ok: false, reason: "MCP file path is invalid" };
}

function inspectAbsoluteFile(path) {
  try {
    const original = lstatSync(path);
    if (original.isSymbolicLink()) return { ok: false, reason: "MCP file is a symbolic link" };
    const canonical = realpathSync(path);
    if (!statSync(canonical).isFile()) return { ok: false, reason: "MCP file is not a regular file" };
    return { ok: true, state: "present" };
  } catch (error) {
    if (error.code === "ENOENT") return { ok: true, state: "missing" };
    return { ok: false, reason: "MCP file path could not be inspected" };
  }
}

function ownershipState(root, worktree) {
  return readCredentialOwnership(root, worktree);
}

/**
 * Read effective config at `directory`; only active MCP `{file:path}` refs
 * may trigger local materialization. The source path itself is never returned.
 */
export async function inspectMcpConfiguration(directory, configApi, options = {}) {
  if (typeof directory !== "string" || !directory || typeof configApi?.get !== "function") {
    return { ok: false, configured: false, reason: "effective configuration is unavailable" };
  }

  let response;
  try {
    response = await configApi.get({ location: { directory } });
  } catch {
    return { ok: false, configured: false, reason: "effective configuration could not be inspected" };
  }
  const entries = response?.data ?? response;
  const summary = summarizeEntries(entries);
  if (!summary) return { ok: false, configured: false, reason: "effective configuration could not be inspected" };

  const projectRoot = options.projectRoot;
  const worktree = resolve(directory);
  let owned = { ok: true, files: [] };
  if (projectRoot) {
    try { owned = ownershipState(projectRoot, realpathSync(worktree)); }
    catch { return { ok: false, configured: summary.servers.size > 0, reason: "credential ownership state is unsafe" }; }
    if (!owned.ok) return { ok: false, configured: summary.servers.size > 0, reason: owned.reason };
    if (owned.transaction) {
      return { ok: false, configured: summary.servers.size > 0, reason: "credential retirement metadata needs manual recovery" };
    }
  }
  const ownedByPath = new Map(owned.files.map((file) => [file.path, file]));
  const allowlist = parseAllowlist(options.credentialFiles ?? process.env.OPENCODE_WORKTREE_CREDENTIAL_FILES);

  // Track the exact source document that supplied each effective server; later
  // config entries override earlier entries as OpenCode documents do.
  const effective = new Map();
  for (const entry of entries) {
    if (entry?.type !== "document" || !entry.info || typeof entry.info !== "object") continue;
    const definitions = entry.info.mcp?.servers;
    if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) continue;
    const raw = rawServerDefinitions(entry);
    for (const [name, definition] of Object.entries(definitions)) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) continue;
      effective.set(name, {
        enabled: definition.enabled !== false,
        sourcePath: entry.path,
        rawAvailable: raw.ok,
        rawDefinition: raw.definitions?.[name] ?? null,
      });
    }
  }

  const prepared = [];
  for (const [serverName, definition] of effective) {
    if (!definition.enabled) continue;
    if (projectRoot && (typeof definition.sourcePath !== "string" || !definition.rawDefinition || !definition.rawAvailable)) {
      return { ok: false, configured: true, reason: "an enabled MCP configuration source could not be safely inspected" };
    }
    if (!definition.rawDefinition || typeof definition.sourcePath !== "string") continue;
    for (const reference of fileReferences(definition.rawDefinition)) {
      const referencedPath = expandFileReference(definition.sourcePath, reference);
      const isLocal = isContainedPath(worktree, referencedPath);
      const destinationRelative = isLocal
        ? relative(worktree, referencedPath).split(sep).join("/")
        : null;
      const priorOwnership = isLocal ? ownedByPath.get(destinationRelative) : null;
      const alreadyPresent = isLocal && priorOwnership
        ? secureFileOperation("inspect", { root: worktree, relative: destinationRelative })
        : isLocal
          ? inspectLocalFile(worktree, destinationRelative)
        : inspectAbsoluteFile(referencedPath);
      if (priorOwnership) {
        if (!alreadyPresent.ok || alreadyPresent.state !== "present" || JSON.stringify(alreadyPresent.identity) !== JSON.stringify(priorOwnership.identity)) {
          return { ok: false, configured: true, reason: "an owned MCP file changed and needs manual review" };
        }
        continue;
      }
      if (alreadyPresent.ok && alreadyPresent.state === "present") continue;
      if (!alreadyPresent.ok || !projectRoot || !isLocal) {
        return { ok: false, configured: true, reason: "a required MCP file is unavailable or unsafe" };
      }

      if (!allowlist.ok || !allowlist.paths.has(destinationRelative) || forbiddenCredentialPath(destinationRelative)) {
        return { ok: false, configured: true, reason: "a required local MCP file is not explicitly authorized" };
      }
      const sourcePath = resolve(projectRoot, destinationRelative);
      if (!isContainedPath(projectRoot, sourcePath)) {
        return { ok: false, configured: true, reason: "an authorized MCP file source is unavailable or unsafe" };
      }

      const copied = secureFileOperation("copy", {
        sourceRoot: projectRoot,
        sourceRelative: destinationRelative,
        destinationRoot: worktree,
        destinationRelative,
      });
      if (!copied.ok) return { ok: false, configured: true, reason: copied.reason };

      const nextFiles = [...owned.files.filter((file) => file.path !== destinationRelative), {
        path: destinationRelative,
        identity: copied.identity,
        server: serverName,
      }];
      const recorded = writeCredentialOwnership(projectRoot, realpathSync(worktree), nextFiles);
      if (!recorded.ok) {
        secureFileOperation("remove", { root: worktree, relative: destinationRelative, identity: copied.identity });
        return { ok: false, configured: true, reason: recorded.reason };
      }
      owned.files = nextFiles;
      ownedByPath.set(destinationRelative, nextFiles[nextFiles.length - 1]);
      prepared.push(destinationRelative);
    }
  }

  let finalSummary = summarizeMcpConfig(entries);
  if (prepared.length > 0) {
    try {
      const refreshedResponse = await configApi.get({ location: { directory } });
      finalSummary = summarizeMcpConfig(refreshedResponse?.data ?? refreshedResponse);
    } catch {
      return { ok: false, configured: true, reason: "effective configuration could not be rechecked after preparation" };
    }
    if (!finalSummary.ok) {
      return { ok: false, configured: true, reason: "effective configuration could not be rechecked after preparation" };
    }
  }

  return {
    ok: true,
    configPresent: finalSummary.configPresent,
    configured: finalSummary.configured,
    servers: finalSummary.servers,
    connectionStatus: "unknown",
    preparedFiles: prepared.length,
  };
}

export function ownedMcpCredentialFiles(projectRoot, worktree) {
  let canonical;
  try { canonical = realpathSync(worktree); }
  catch { return { ok: false, reason: "credential ownership state is unavailable" }; }
  const owned = ownershipState(projectRoot, canonical);
  if (!owned.ok) return owned;
  if (owned.transaction) {
    return { ok: false, reason: "a prior credential retirement transaction needs manual recovery" };
  }
  const present = [];
  const absent = [];
  for (const file of owned.files) {
    const current = secureFileOperation("inspect", { root: canonical, relative: file.path });
    if (!current.ok) {
      return { ok: false, reason: "an owned MCP file path is unsafe or cannot be verified" };
    }
    if (current.state === "missing") {
      absent.push(file);
      continue;
    }
    if (current.state !== "present" || JSON.stringify(current.identity) !== JSON.stringify(file.identity)) {
      return { ok: false, reason: "an owned MCP file changed and needs manual review" };
    }
    present.push(file);
  }
  return { ok: true, files: present, absent, manifest: owned.manifest };
}

export function clearOwnedMcpCredentialMetadata(projectRoot, worktree) {
  let canonical;
  try { canonical = realpathSync(worktree); }
  catch {
    // After a successful worktree removal, its former canonical path no
    // longer resolves. The ownership key was canonical when created, and
    // the managed path supplied to retirement is the same stable path.
    canonical = resolve(worktree);
  }
  return clearCredentialOwnership(projectRoot, canonical);
}
