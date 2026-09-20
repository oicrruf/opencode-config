#!/usr/bin/env node
// Static validator for the OpenCode global configuration.
//
// Checks:
//   1. No agent in `agent/*.md` declares the deprecated `tools:` block.
//   2. No agent in `agent/*.md` declares `permission: allow` (broad allow-all).
//   3. No agent in `opencode.jsonc` declares the deprecated `tools:` block.
//   4. MCP server names declared in `opencode.jsonc` are referenced by at
//      least one agent's `permission` block (so unused MCPs surface) OR are
//      explicitly disabled.
//   5. Model-invoked skill descriptions stay under the union budget
//      (default 3000 characters) and have no duplicate clauses longer than
//      12 words.
//   6. The agent-routing matrix in `agent/routing.md` references an existing
//      `agent/build.md`.
//   7. The `install.sh` references the validator before the link calls.
//   8. Every configured `provider/model` id resolves against the OpenCode
//      models catalog (`~/.cache/opencode/models.json`) when it is present.
//
// Exit code 0 when all checks pass, non-zero otherwise. Each failure names
// the file and the offending line so the operator can fix it directly.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function fail(file, message) {
  errors.push(`${relative(repoRoot, file)}: ${message}`);
}

function readJsonc(file) {
  const raw = readFileSync(file, 'utf8');
  // Strip // line comments and /* block comments */ before parsing.
  const stripped = raw
    .replace(/^\s*\/\/[^\n]*\n/gm, '')
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '');
  return JSON.parse(stripped);
}

function readFrontmatter(file) {
  const raw = readFileSync(file, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const body = match[1];
  const result = {};
  // Simple key:value parser; supports nested maps for `permission:`.
  const lines = body.split('\n');
  let currentKey = null;
  let currentMap = null;
  for (const line of lines) {
    if (/^[a-zA-Z_]/.test(line)) {
      const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (!m) continue;
      currentKey = m[1];
      const value = m[2];
      if (value === '') {
        currentMap = {};
        result[currentKey] = currentMap;
      } else {
        currentMap = null;
        result[currentKey] = value.replace(/^["']|["']$/g, '');
      }
    } else if (currentMap && /^\s+/.test(line)) {
      const m = line.match(/^\s+["']?([\w*?*-]+)["']?:\s*(\w+)\s*$/);
      if (m) currentMap[m[1]] = m[2];
    }
  }
  return result;
}

function listAgentFiles() {
  const dir = join(repoRoot, 'agent');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f));
}

function listSkillFiles() {
  const dir = join(repoRoot, 'skills');
  if (!existsSync(dir)) return [];
  const out = [];
  function walk(current) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry === 'SKILL.md') out.push(full);
    }
  }
  walk(dir);
  return out;
}

// Check 1: no deprecated `tools:` block in any agent file.
for (const file of listAgentFiles()) {
  const fm = readFrontmatter(file);
  if (fm && 'tools' in fm) {
    fail(file, `deprecated 'tools' block in frontmatter; migrate to 'permission'`);
  }
}

// Check 2: no agent declares a broad `permission: allow` (string shorthand).
for (const file of listAgentFiles()) {
  const fm = readFrontmatter(file);
  if (!fm || !fm.permission) continue;
  if (typeof fm.permission === 'string' && fm.permission === 'allow') {
    fail(file, `permission: "allow" grants everything; declare a granular map`);
  }
}

// Check 3: opencode.jsonc has no `tools` field at the top level or per agent.
const cfgPath = join(repoRoot, 'opencode.jsonc');
if (existsSync(cfgPath)) {
  const cfg = readJsonc(cfgPath);
  if (cfg.tools) fail(cfgPath, `deprecated 'tools' field at top level`);
  if (cfg.permission && typeof cfg.permission === 'string' && cfg.permission === 'allow') {
    fail(cfgPath, `top-level permission: "allow"; use a deny-by-default map`);
  }
  if (cfg.agent) {
    for (const [name, value] of Object.entries(cfg.agent)) {
      if (value && typeof value === 'object' && 'tools' in value) {
        fail(cfgPath, `agent.${name}: deprecated 'tools' field`);
      }
    }
  }

  // Check 4: every MCP server in opencode.jsonc is referenced by at least one
  // agent permission or has `enabled: false`.
  if (cfg.mcp) {
    const mcpNames = Object.keys(cfg.mcp).filter((n) => cfg.mcp[n] && cfg.mcp[n].enabled !== false);
    const agentPerms = Object.values(cfg.agent || {})
      .map((a) => JSON.stringify(a?.permission || ''))
      .join('\n');
    for (const name of mcpNames) {
      const token = `${name}_*`;
      if (!agentPerms.includes(token) && !agentPerms.includes(name)) {
        fail(cfgPath, `MCP '${name}' is enabled but no agent references '${name}_*' or '${name}' in permission`);
      }
    }
  }
}

// Check 5: model-invoked skill description budget and duplicate clauses.
//
// The hidden set is derived from the `deny` patterns under
// `permission.skill` in opencode.jsonc — the mechanism opencode actually
// implements. A skill-declared `disable-model-invocation` flag is NOT
// trusted: opencode ignores unknown frontmatter fields, so honouring the
// flag here made the validator certify a budget it was not measuring.
const deniedSkills = new Set();
if (existsSync(cfgPath)) {
  const cfg = readJsonc(cfgPath);
  const skillPerm = cfg.permission && cfg.permission.skill;
  if (skillPerm && typeof skillPerm === 'object') {
    for (const [name, action] of Object.entries(skillPerm)) {
      if (name !== '*' && action === 'deny') deniedSkills.add(name);
    }
  }
}

const skillFiles = listSkillFiles();
let totalDescChars = 0;
const descClauses = [];
for (const file of skillFiles) {
  const fm = readFrontmatter(file);
  if (!fm) continue;
  const name = typeof fm.name === 'string' ? fm.name : '';
  if (deniedSkills.has(name)) continue;
  const desc = typeof fm.description === 'string' ? fm.description : '';
  totalDescChars += desc.length;
  // Collect clauses (sentences or comma-separated fragments) of >= 12 words.
  const sentences = desc.split(/(?<=[.!?])\s+/).filter(Boolean);
  for (const s of sentences) {
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length >= 12) descClauses.push({ file, clause: s.trim() });
  }
}
const DESC_BUDGET = 3000;
if (totalDescChars > DESC_BUDGET) {
  fail(join(repoRoot, 'skills'), `model-invoked skill descriptions total ${totalDescChars} chars; budget is ${DESC_BUDGET}`);
}
const seen = new Map();
for (const { file, clause } of descClauses) {
  if (seen.has(clause)) {
    fail(file, `duplicate description clause '${clause.slice(0, 60)}...' also in ${relative(repoRoot, seen.get(clause).file)}`);
  } else {
    seen.set(clause, { file });
  }
}

// Check 5b: every skill path a wrapper command injects exists on disk, so a
// renamed or removed skill fails validation instead of silently injecting
// nothing.
const commandsDir = join(repoRoot, 'commands');
if (existsSync(commandsDir)) {
  const injected = /!\s*`cat\s+~\/\.config\/opencode\/skills\/([^\s`]+)`/g;
  for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
    const file = join(commandsDir, f);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(injected)) {
      const rel = match[1];
      const onDisk = join(repoRoot, 'skills', rel);
      if (!existsSync(onDisk)) {
        fail(file, `injects '${rel}' but skills/${rel} does not exist`);
      }
    }
  }
}

// Check 6: agent/build.md exists and references agent/routing.md.
const buildPath = join(repoRoot, 'agent/build.md');
const routingPath = join(repoRoot, 'agent/routing.md');
if (!existsSync(buildPath)) fail(buildPath, 'agent/build.md missing');
else {
  const buildText = readFileSync(buildPath, 'utf8');
  if (!buildText.includes('agent/routing.md')) {
    fail(buildPath, 'agent/build.md does not reference agent/routing.md');
  }
}
if (!existsSync(routingPath)) fail(routingPath, 'agent/routing.md missing');

// Check 7: install.sh references the validator before the link calls.
const installPath = join(repoRoot, 'install.sh');
if (existsSync(installPath)) {
  const installText = readFileSync(installPath, 'utf8');
  if (!installText.includes('validate-config.mjs')) {
    fail(installPath, 'install.sh does not call scripts/validate-config.mjs');
  }
  const validatorIdx = installText.indexOf('validate-config.mjs');
  const firstLinkIdx = installText.indexOf('link "$repo_dir/opencode.jsonc"');
  if (validatorIdx > firstLinkIdx) {
    fail(installPath, 'validator must run before the first link call in install.sh');
  }
}

// Check 8: every configured provider/model id resolves against the catalog.
//
// Collects the model ids from agent frontmatter, the `model:` values in
// commands/*.md, and opencode.jsonc (`agent.*.model` plus `small_model`).
// A missing or unparseable catalog is a skip with a printed notice, so a
// machine that has never started OpenCode still installs.
function collectModelIds() {
  const found = [];
  for (const file of listAgentFiles()) {
    const fm = readFrontmatter(file);
    if (fm && typeof fm.model === 'string') found.push({ file, id: fm.model });
  }
  const commandsDir = join(repoRoot, 'commands');
  if (existsSync(commandsDir)) {
    for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
      const file = join(commandsDir, f);
      const fm = readFrontmatter(file);
      if (fm && typeof fm.model === 'string') found.push({ file, id: fm.model });
    }
  }
  if (existsSync(cfgPath)) {
    const cfg = readJsonc(cfgPath);
    if (typeof cfg.small_model === 'string') {
      found.push({ file: cfgPath, id: cfg.small_model });
    }
    for (const [name, value] of Object.entries(cfg.agent || {})) {
      if (value && typeof value === 'object' && typeof value.model === 'string') {
        found.push({ file: cfgPath, id: value.model, agent: name });
      }
    }
  }
  return found;
}

const catalogPath = join(homedir(), '.cache', 'opencode', 'models.json');
if (!existsSync(catalogPath)) {
  console.log(`validate-config: skip — models catalog not found at ${catalogPath}`);
} else {
  let catalog = null;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch {
    console.log(`validate-config: skip — models catalog at ${catalogPath} is not parseable`);
  }
  if (catalog) {
    for (const { file, id, agent } of collectModelIds()) {
      const slash = id.indexOf('/');
      if (slash <= 0) {
        fail(file, `${agent ? `agent.${agent}: ` : ''}model '${id}' is not a 'provider/model' id`);
        continue;
      }
      const provider = id.slice(0, slash);
      const modelId = id.slice(slash + 1);
      const entry = catalog[provider];
      if (!entry) {
        fail(file, `${agent ? `agent.${agent}: ` : ''}model '${id}' names provider '${provider}' that is not in the catalog`);
      } else if (!entry.models || !entry.models[modelId]) {
        fail(file, `${agent ? `agent.${agent}: ` : ''}model '${id}' is not served by provider '${provider}'`);
      }
    }
  }
}

if (errors.length === 0) {
  console.log('validate-config: OK');
  process.exit(0);
}
for (const e of errors) console.error(`validate-config: ${e}`);
process.exit(1);
