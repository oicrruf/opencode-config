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
//   5b. Every skill path a wrapper command injects exists on disk.
//   6. The agent-routing matrix in `agent/routing.md` references an existing
//      `agent/build.md`.
//   7. The `install.sh` references the validator before the first link call.
//   8. The selected profile in `config/model-profiles.json` covers every
//      configured model consumer and its IDs resolve against the OpenCode
//      models catalog (`~/.cache/opencode/models.json`) when it is present.
//      When `--rendered-config <path>` is given, the rendered file is parsed
//      and its model assignments are checked against the selected profile.
//
// Exit code 0 when all checks pass, non-zero otherwise. Each failure names
// the file and the offending line so the operator can fix it directly.
//
// Usage:
//   node scripts/validate-config.mjs [--profile <name>] [--rendered-config <path>]
//   --profile <name>       profile name to validate (default: manifest's
//                          defaultProfile).
//   --rendered-config <p>  path to a rendered opencode.jsonc to validate
//                          structurally and against the profile. When this
//                          is supplied, the validator also reports any
//                          mismatch between the rendered config's model
//                          assignments and the profile.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function fail(file, message) {
  errors.push(`${relative(repoRoot, file)}: ${message}`);
}

function parseArgs(argv) {
  const out = { profile: null, renderedConfig: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--profile') {
      const v = argv[++i];
      if (v === undefined) {
        console.error('validate-config: --profile requires a value');
        process.exit(2);
      }
      out.profile = v;
    } else if (a.startsWith('--profile=')) {
      out.profile = a.slice('--profile='.length);
    } else if (a === '--rendered-config') {
      const v = argv[++i];
      if (v === undefined) {
        console.error('validate-config: --rendered-config requires a value');
        process.exit(2);
      }
      out.renderedConfig = v;
    } else if (a.startsWith('--rendered-config=')) {
      out.renderedConfig = a.slice('--rendered-config='.length);
    } else {
      console.error(`validate-config: unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-config.mjs [--profile <name>] [--rendered-config <path>]

Validates the OpenCode configuration files in this repository and, when a
profile is selected, ensures the profile covers every configured model
consumer and its IDs resolve against the authenticated OpenCode catalog.

Options:
  --profile <name>       profile name from config/model-profiles.json
                          (default: manifest's defaultProfile)
  --rendered-config <p>  also validate a rendered opencode.jsonc at <p>
  --help, -h             show this help
`);
}

function readJsonc(file) {
  const raw = readFileSync(file, 'utf8');
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

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Manifest loaders.
// ---------------------------------------------------------------------------

function loadManifest() {
  const file = join(repoRoot, 'config/model-profiles.json');
  if (!existsSync(file)) return { file, manifest: null };
  return { file, manifest: readJsonc(file) };
}

function loadTemplate() {
  const file = join(repoRoot, 'config/opencode.template.jsonc');
  if (!existsSync(file)) return { file, template: null };
  return { file, template: readJsonc(file) };
}

function resolveProfileName(manifest) {
  if (args.profile) return args.profile;
  if (manifest && typeof manifest.defaultProfile === 'string') return manifest.defaultProfile;
  return null;
}

// ---------------------------------------------------------------------------
// Checks 1-7: structural and policy assertions (unchanged from the previous
// validator; the rendered-config path uses a different file but the checks
// themselves apply to whichever JSONC is in scope).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Check 9: LF line endings for shell and runtime files in the Git index.
// ---------------------------------------------------------------------------
//
// Reads every tracked file in the Git index and fails when any file with a
// shell or runtime extension has CRLF line endings. The check inspects the
// Git index (via `git show :<path>`) rather than the working tree, so the
// result reflects what is committed, not what the operator's local
// `core.autocrlf` materialized on disk.
//
// `.gitattributes` (`* text=auto eol=lf`) declares the contract; this check
// enforces it on the artifacts the installer actually parses.

const CRLF_BYTES = Buffer.from([0x0d, 0x0a]);
const SHELL_RUNTIME_EXTS = new Set([
  '.sh', '.ps1', '.mjs', '.js', '.ts', '.tsx', '.cjs', '.mts', '.cts',
]);

function runLineEndingChecks() {
  let filesBuf;
  try {
    filesBuf = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    // git not on PATH or repo not a git repo: skip silently. The other
    // checks still report their findings.
    return;
  }
  const files = filesBuf.toString('utf8').split('\u0000').filter(Boolean);

  for (const rel of files) {
    if (rel.includes('node_modules/')) continue;
    const lower = rel.toLowerCase();
    let matched = false;
    for (const ext of SHELL_RUNTIME_EXTS) {
      if (lower.endsWith(ext)) { matched = true; break; }
    }
    if (!matched) continue;

    let blob;
    try {
      blob = execFileSync('git', ['show', `:${rel}`], {
        cwd: repoRoot,
        encoding: null,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (e) {
      // File present in ls-files but missing in the index (e.g. submodule
      // with unpopulated contents): skip.
      continue;
    }
    if (!blob || blob.length === 0) continue;

    if (blob.includes(CRLF_BYTES)) {
      fail(
        join(repoRoot, rel),
        'file has CRLF line endings; repository requires LF (see .gitattributes)',
      );
    }
  }
}

function runStructuralChecks() {
  // Check 1: no deprecated `tools:` block in any agent file.
  for (const file of listAgentFiles()) {
    const fm = readFrontmatter(file);
    if (fm && 'tools' in fm) {
      fail(file, `deprecated 'tools' block in frontmatter; migrate to 'permission'`);
    }
  }

  // Check 2: no agent declares a broad `permission: allow`.
  for (const file of listAgentFiles()) {
    const fm = readFrontmatter(file);
    if (!fm || !fm.permission) continue;
    if (typeof fm.permission === 'string' && fm.permission === 'allow') {
      fail(file, `permission: "allow" grants everything; declare a granular map`);
    }
  }

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
}

function runSkillBudgetChecks() {
  // Check 5: skill-description budget and duplicate clauses.
  const cfgPath = join(repoRoot, 'opencode.jsonc');
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

  // Check 5b: every skill path a wrapper command injects exists on disk.
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
}

function runInstallScriptChecks() {
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

  // Check 7: install.sh references the validator before the first link call.
  const installPath = join(repoRoot, 'install.sh');
  if (existsSync(installPath)) {
    const installText = readFileSync(installPath, 'utf8');
    if (!installText.includes('validate-config.mjs')) {
      fail(installPath, 'install.sh does not call scripts/validate-config.mjs');
    }
    const validatorIdx = installText.indexOf('validate-config.mjs');
    const firstLinkIdx = installText.indexOf('link "$repo_dir/');
    if (firstLinkIdx !== -1 && validatorIdx > firstLinkIdx) {
      fail(installPath, 'validator must run before the first link call in install.sh');
    }
  }
}

// ---------------------------------------------------------------------------
// Check 8: profile-aware catalog validation.
// ---------------------------------------------------------------------------

function runProfileChecks() {
  const { file: manifestFile, manifest } = loadManifest();
  if (!manifest) {
    fail(manifestFile, `manifest is missing at ${manifestFile}`);
    return { manifest: null, profile: null, profileIds: [] };
  }

  if (!manifest.defaultProfile || typeof manifest.defaultProfile !== 'string') {
    fail(manifestFile, `manifest is missing a string defaultProfile field`);
  }
  if (!manifest.profiles || typeof manifest.profiles !== 'object') {
    fail(manifestFile, `manifest is missing a profiles object`);
  }

  const profileName = resolveProfileName(manifest);
  if (!profileName) {
    fail(manifestFile, `cannot resolve a profile (no --profile argument and no defaultProfile)`);
    return { manifest, profile: null, profileIds: [] };
  }

  const profile = manifest.profiles[profileName];
  if (!profile) {
    fail(
      manifestFile,
      `profile '${profileName}' is not declared in the manifest; available: ${Object.keys(manifest.profiles || {}).join(', ')}`,
    );
    return { manifest, profile: null, profileIds: [] };
  }

  if (!profile.root || typeof profile.root !== 'object') {
    fail(manifestFile, `profile '${profileName}' is missing a root object`);
  }
  if (!profile.agents || typeof profile.agents !== 'object') {
    fail(manifestFile, `profile '${profileName}' is missing an agents object`);
  }
  if (!profile.commands || typeof profile.commands !== 'object') {
    fail(manifestFile, `profile '${profileName}' is missing a commands object`);
  }

  // Coverage: every agent in the template (or installed config) must be in
  // the profile, and every command with a `model:` frontmatter must be in
  // the profile's commands block.
  const { template } = loadTemplate();
  const templateAgents = template && template.agent ? Object.keys(template.agent) : [];
  for (const name of templateAgents) {
    if (!profile.agents[name]) {
      fail(manifestFile, `profile '${profileName}' is missing agent '${name}'`);
    }
  }
  for (const name of Object.keys(profile.agents)) {
    if (template && template.agent && !template.agent[name]) {
      fail(manifestFile, `profile '${profileName}' references agent '${name}' not in the template`);
    }
  }

  const commandsDir = join(repoRoot, 'commands');
  if (existsSync(commandsDir)) {
    for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
      const name = f.replace(/\.md$/, '');
      const fm = readFrontmatter(join(commandsDir, f));
      if (fm && typeof fm.model === 'string') {
        if (!profile.commands[name]) {
          fail(manifestFile, `profile '${profileName}' is missing command '${name}'`);
        }
      }
    }
    for (const name of Object.keys(profile.commands)) {
      if (!existsSync(join(commandsDir, `${name}.md`))) {
        fail(manifestFile, `profile '${profileName}' references command '${name}' not in commands/`);
      }
    }
  }

  // Collect every model id the profile assigns, including root and commands.
  const profileIds = [];
  if (profile.root) {
    for (const [k, v] of Object.entries(profile.root)) {
      if (typeof v === 'string') profileIds.push({ file: manifestFile, id: v, consumer: `root.${k}`, profile: profileName });
    }
  }
  if (profile.agents) {
    for (const [k, v] of Object.entries(profile.agents)) {
      if (typeof v === 'string') profileIds.push({ file: manifestFile, id: v, consumer: `agent.${k}`, profile: profileName });
    }
  }
  if (profile.commands) {
    for (const [k, v] of Object.entries(profile.commands)) {
      if (typeof v === 'string') profileIds.push({ file: manifestFile, id: v, consumer: `command.${k}`, profile: profileName });
    }
  }

  // Resolve ids against the catalog.
  const catalogPath = join(homedir(), '.cache', 'opencode', 'models.json');
  if (!existsSync(catalogPath)) {
    console.log(
      `validate-config: skip — models catalog not found at ${catalogPath}; ` +
        `ollama-cloud/minimax-m3, ollama-cloud/gpt-oss:20b and other provider/model ids are not checked`,
    );
  } else {
    let catalog = null;
    try {
      catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    } catch {
      console.log(
        `validate-config: skip — models catalog at ${catalogPath} is not parseable; ` +
          `ollama-cloud/minimax-m3, ollama-cloud/gpt-oss:20b and other provider/model ids are not checked`,
      );
    }
    if (catalog) {
      for (const entry of profileIds) {
        const slash = entry.id.indexOf('/');
        if (slash <= 0) {
          fail(entry.file, `${entry.consumer}: model '${entry.id}' is not a 'provider/model' id (profile '${entry.profile}')`);
          continue;
        }
        const provider = entry.id.slice(0, slash);
        const modelId = entry.id.slice(slash + 1);
        const catalogEntry = catalog[provider];
        if (!catalogEntry) {
          fail(entry.file, `${entry.consumer}: model '${entry.id}' names provider '${provider}' that is not in the catalog (profile '${entry.profile}')`);
        } else if (!catalogEntry.models || !catalogEntry.models[modelId]) {
          fail(entry.file, `${entry.consumer}: model '${entry.id}' is not served by provider '${provider}' (profile '${entry.profile}')`);
        }
      }
    }
  }

  // When --rendered-config is supplied, also validate the rendered file
  // structurally and against the profile.
  if (args.renderedConfig) {
    const renderedPath = args.renderedConfig;
    if (!existsSync(renderedPath)) {
      fail(renderedPath, `rendered configuration not found at ${renderedPath}`);
    } else {
      let rendered;
      try {
        rendered = readJsonc(renderedPath);
      } catch (e) {
        fail(renderedPath, `cannot parse rendered JSONC: ${e.message}`);
        return { manifest, profile, profileIds };
      }

      if (!rendered.model || typeof rendered.model !== 'string') {
        fail(renderedPath, `rendered config is missing root.model`);
      } else if (profile.root && profile.root.model !== rendered.model) {
        fail(renderedPath, `rendered root.model '${rendered.model}' does not match profile '${profileName}' ('${profile.root.model}')`);
      }
      if (!rendered.small_model || typeof rendered.small_model !== 'string') {
        fail(renderedPath, `rendered config is missing root.small_model`);
      } else if (profile.root && profile.root.small_model !== rendered.small_model) {
        fail(renderedPath, `rendered root.small_model '${rendered.small_model}' does not match profile '${profileName}' ('${profile.root.small_model}')`);
      }
      if (!rendered.agent || typeof rendered.agent !== 'object') {
        fail(renderedPath, `rendered config is missing an agent object`);
      } else {
        for (const [name, model] of Object.entries(profile.agents)) {
          if (!rendered.agent[name]) {
            fail(renderedPath, `rendered config is missing agent '${name}'`);
          } else if (rendered.agent[name].model !== model) {
            fail(renderedPath, `rendered agent.${name}.model '${rendered.agent[name].model}' does not match profile '${profileName}' ('${model}')`);
          }
        }
      }
    }
  }

  return { manifest, profile, profileIds };
}

runStructuralChecks();
runSkillBudgetChecks();
runInstallScriptChecks();
runProfileChecks();
runLineEndingChecks();

if (errors.length === 0) {
  console.log('validate-config: OK');
  process.exit(0);
}
for (const e of errors) console.error(`validate-config: ${e}`);
process.exit(1);
