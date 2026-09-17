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
//
// Exit code 0 when all checks pass, non-zero otherwise. Each failure names
// the file and the offending line so the operator can fix it directly.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const skillFiles = listSkillFiles();
let totalDescChars = 0;
const descClauses = [];
for (const file of skillFiles) {
  const fm = readFrontmatter(file);
  if (!fm) continue;
  if (fm['disable-model-invocation'] === 'true' || fm['disable-model-invocation'] === true) continue;
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

if (errors.length === 0) {
  console.log('validate-config: OK');
  process.exit(0);
}
for (const e of errors) console.error(`validate-config: ${e}`);
process.exit(1);
