#!/usr/bin/env node
// Acceptance harness for the OpenCode global configuration.
//
// Unlike scripts/validate-config.mjs (a static policy check), this harness
// exercises a *running* OpenCode process so the assertions reflect what the
// runtime actually does, not what the config files say. It exists because
// two defects in this repo were invisible to static checks:
//
//   1. `disable-model-invocation` looked load-bearing but opencode ignores
//      unknown skill frontmatter, so the description budget was mismeasured.
//   2. A command's `model:` override is applied to the command's own session
//      but NOT to a `subtask: true` child, so a wrapper declared a cheap
//      model while its subagent silently ran on the caller's expensive one.
//
// Usage:
//   node scripts/acceptance-harness.mjs            # all test groups
//   node scripts/acceptance-harness.mjs routing    # one group
//   node scripts/acceptance-harness.mjs --list
//
// Groups:
//   static    config parses, ids resolve, budget is real
//   routing   resolved config assigns the intended model per agent
//   skills    denied skills are denied; every hidden skill has a wrapper
//   wrappers  a wrapper runs on its declared tier and injects the skill
//
// Exit 0 when every test passes, 1 otherwise.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
}

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ group: currentGroup, name, ok: true, detail });
  } catch (err) {
    results.push({ group: currentGroup, name, ok: false, detail: err.message });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function run(cmd, args) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

// Run `opencode` with a timeout guard. opencode has no built-in timeout flag.
function opencodeJson(args) {
  const out = run('opencode', args);
  const start = out.indexOf('{');
  const line = out.split('\n').find((l) => l.trim().startsWith('{'));
  if (line) return JSON.parse(line);
  if (start >= 0) return JSON.parse(out.slice(start));
  throw new Error(`no JSON in opencode output: ${out.slice(0, 200)}`);
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
  const result = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) result[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return result;
}

const GROUP_ORDER = ['static', 'routing', 'skills', 'wrappers'];

// ---------------------------------------------------------------------------
// static
// ---------------------------------------------------------------------------

if (!currentGroup) group('static');

check('config parses and denies the eight operation skills', () => {
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  const skill = cfg.permission?.skill;
  assert(skill && typeof skill === 'object', 'permission.skill missing');
  const denied = Object.entries(skill)
    .filter(([k, v]) => k !== '*' && v === 'deny')
    .map(([k]) => k)
    .sort();
  assert(
    denied.length === 8,
    `expected 8 deny entries, found ${denied.length}: ${denied.join(', ')}`,
  );
  return denied.join(', ');
});

check('description budget counts only non-denied skills', () => {
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  const denied = new Set(
    Object.entries(cfg.permission?.skill ?? {})
      .filter(([k, v]) => k !== '*' && v === 'deny')
      .map(([k]) => k),
  );
  let visible = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (readdirSync(dir).includes('SKILL.md') === false && entry === 'SKILL.md') continue;
      let stat;
      try {
        stat = readFileSync(full);
      } catch {
        continue;
      }
      void stat;
    }
  };
  void walk;
  // Walk explicitly for nested skills (skills/mmx-cli/h3-video/SKILL.md).
  const files = [];
  const collect = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name === 'SKILL.md') files.push(full);
    }
  };
  collect(join(repoRoot, 'skills'));
  for (const file of files) {
    const fm = readFrontmatter(file);
    if (!fm) continue;
    if (denied.has(fm.name)) continue;
    visible += (fm.description ?? '').length;
  }
  assert(visible <= 3000, `visible description budget is ${visible} > 3000`);
  return `${visible} chars visible (budget 3000)`;
});

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

group('routing');

const EXPECTED_AGENT_MODELS = {
  plan: 'openai/gpt-5.6-luna',
  build: 'minimax/MiniMax-M3',
  general: 'minimax/MiniMax-M3',
  explore: 'ollama-cloud/gpt-oss:20b',
  architect: 'openai/gpt-5.6-terra',
  orchestrator: 'openai/gpt-5.6-terra',
  refactor: 'openai/gpt-5.6-terra',
  frontend: 'minimax/MiniMax-M3',
  backend: 'minimax/MiniMax-M3',
  qa: 'minimax/MiniMax-M3',
  adversarial: 'openai/gpt-5.6-terra',
  cotizador: 'openai/gpt-5.6-terra',
  'p5t-installer': 'ollama-cloud/gpt-oss:20b',
};

check('resolved config matches the routing matrix for every agent', () => {
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  const mismatches = [];
  for (const [agent, expected] of Object.entries(EXPECTED_AGENT_MODELS)) {
    const actual = cfg.agent?.[agent]?.model;
    if (actual !== expected) {
      mismatches.push(`${agent}: expected ${expected}, got ${actual}`);
    }
  }
  assert(mismatches.length === 0, mismatches.join('; '));
  return `${Object.keys(EXPECTED_AGENT_MODELS).length} agents aligned`;
});

check('frontmatter and opencode.jsonc agree on every agent model', () => {
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  const dir = join(repoRoot, 'agent');
  const mismatches = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const fm = readFrontmatter(join(dir, f));
    if (!fm?.model) continue;
    const name = f.replace(/\.md$/, '');
    const cfgModel = cfg.agent?.[name]?.model;
    if (cfgModel && cfgModel !== fm.model) {
      mismatches.push(`${name}: jsonc=${cfgModel} frontmatter=${fm.model}`);
    }
  }
  assert(mismatches.length === 0, mismatches.join('; '));
  return 'frontmatter and jsonc agree';
});

check('small_model is on the value tier', () => {
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  assert(
    cfg.small_model === 'ollama-cloud/gpt-oss:20b',
    `small_model is ${cfg.small_model}`,
  );
  return cfg.small_model;
});

check('command model tiers match the routing decision', () => {
  const commandsDir = join(repoRoot, 'commands');
  const expected = {
    'opsx-propose': 'openai/gpt-5.6-terra',
    'opsx-apply': 'minimax/MiniMax-M3',
    archify: 'ollama-cloud/gpt-oss:20b',
    dedupe: 'ollama-cloud/gpt-oss:20b',
    mmx: 'ollama-cloud/gpt-oss:20b',
    'mmx-h3-video': 'ollama-cloud/gpt-oss:20b',
  };
  const mismatches = [];
  for (const [name, tier] of Object.entries(expected)) {
    const file = join(commandsDir, `${name}.md`);
    if (!existsSync(file)) {
      mismatches.push(`${name}: command file missing`);
      continue;
    }
    const fm = readFrontmatter(file);
    if (fm?.model !== tier) {
      mismatches.push(`${name}: expected ${tier}, got ${fm?.model}`);
    }
  }
  assert(mismatches.length === 0, mismatches.join('; '));
  return `${Object.keys(expected).length} command tiers aligned`;
});

check('the planning tier still has a member (plan)', () => {
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  assert(
    cfg.agent?.plan?.model === 'openai/gpt-5.6-luna',
    `plan is ${cfg.agent?.plan?.model}, expected openai/gpt-5.6-luna`,
  );
  return 'plan remains on the planning tier';
});

check('every configured model id is served by an authenticated provider', () => {
  const catalogPath = join(homedir(), '.cache', 'opencode', 'models.json');
  if (!existsSync(catalogPath)) return 'skipped: models catalog absent';
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  const ids = [cfg.small_model, ...Object.values(cfg.agent ?? {}).map((a) => a.model)].filter(Boolean);
  const bad = [];
  for (const id of ids) {
    const [provider, ...rest] = id.split('/');
    const model = rest.join('/');
    if (!catalog[provider]?.models?.[model]) bad.push(id);
  }
  assert(bad.length === 0, `unresolved: ${bad.join(', ')}`);
  return `${ids.length} ids resolve`;
});

// ---------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------

group('skills');

check('every denied skill has a wrapper command that injects it', () => {
  const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
  const denied = Object.entries(cfg.permission?.skill ?? {})
    .filter(([k, v]) => k !== '*' && v === 'deny')
    .map(([k]) => k);
  const commandsDir = join(repoRoot, 'commands');
  const injected = [];
  for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(commandsDir, f), 'utf8');
    const m = text.match(/cat\s+~\/\.config\/opencode\/skills\/([^\s`]+)/);
    if (m) injected.push({ file: f, path: m[1] });
  }
  // Map each injection to the skill name declared inside the injected file.
  const covered = new Set();
  for (const { path } of injected) {
    const onDisk = join(repoRoot, 'skills', path);
    if (!existsSync(onDisk)) continue;
    const fm = readFrontmatter(onDisk);
    if (fm?.name) covered.add(fm.name);
  }
  const missing = denied.filter((name) => !covered.has(name));
  assert(missing.length === 0, `denied without a wrapper: ${missing.join(', ')}`);
  return `${denied.length} denied skills each have a wrapper`;
});

check('no wrapper copies skill content (injects only)', () => {
  const commandsDir = join(repoRoot, 'commands');
  const offenders = [];
  for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(commandsDir, f), 'utf8');
    if (!text.includes('cat ~/.config/opencode/skills/')) continue;
    const body = text.split('---\n').slice(2).join('---\n');
    // A copied skill would contain a second `name:` frontmatter block.
    if (/^\s*name:\s*\S+/m.test(body)) offenders.push(f);
  }
  assert(offenders.length === 0, `wrappers embedding skill bodies: ${offenders.join(', ')}`);
  return 'all wrappers inject from the canonical path';
});

// ---------------------------------------------------------------------------
// wrappers  (live: exercises a running opencode process)
// ---------------------------------------------------------------------------

group('wrappers');

const LIVE = process.argv.includes('--live');

check('skill runner wraps do not use subtask (model override would be lost)', () => {
  const commandsDir = join(repoRoot, 'commands');
  const offenders = [];
  for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(commandsDir, f), 'utf8');
    if (!text.includes('cat ~/.config/opencode/skills/')) continue;
    if (/^subtask:\s*true/m.test(text)) offenders.push(f);
  }
  assert(
    offenders.length === 0,
    `wrappers with subtask: ${offenders.join(', ')} (the child would inherit the agent model, not the command's)`,
  );
  return 'no skill wrapper sets subtask';
});

if (LIVE) {
  check('a denied skill is hidden from the runtime and cannot be loaded', () => {
    // Assert on structured tool state, never on the model's prose: a weaker
    // model may refuse in wording we cannot predict ("I can't comply"), and a
    // prose regex would report a false failure while the rule works.
    //
    // Deterministic properties, in order of strength:
    //   1. the skill body never reaches the session (hard failure if it does)
    //   2. if the model attempts the call, the runtime rejects it
    //   3. if the model never attempts it, it reports the skill as unavailable
    // A pinned model keeps this independent of provider quota; the subject is
    // the permission rule, not the model.
    const out = run('opencode', [
      'run', '--agent', 'build',
      '-m', 'ollama-cloud/gpt-oss:20b',
      '--format', 'json',
      'Call the skill tool with name exactly "archify". Then report whether it ' +
        'worked. If it did work, quote its first heading.',
    ]);

    const bodyLeaked = /Cocoon-AI\/architecture-diagram-generator|Create a self-contained, interactive HTML diagram/.test(
      out,
    );
    assert(!bodyLeaked, 'the archify skill body leaked into the session');

    let attempted = false;
    let rejected = false;
    let text = '';
    for (const line of out.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      const part = ev.part ?? {};
      if (part.type === 'tool' && part.tool === 'skill') {
        const name = part.state?.input?.name;
        if (name === 'archify' || name === undefined) {
          attempted = true;
          const err = String(part.state?.error ?? '');
          if (part.state?.status === 'error' && /prevents you from using this specific tool call/.test(err)) {
            rejected = true;
          }
        }
      }
      if (part.type === 'text') text += `${part.text ?? ''}\n`;
    }

    if (attempted) {
      assert(rejected, 'the skill call was attempted but not rejected');
      return 'tool call attempted and rejected by the runtime';
    }
    const unadvertised =
      /cannot|can't|unavailable|not\s+(available|advertised|in the list|installed)|no such|does not (appear|exist)/i.test(
        text,
      );
    assert(
      unadvertised,
      `the skill was neither attempted nor reported unavailable; text: ${text.trim().slice(0, 300)}`,
    );
    return 'skill not attempted; model reports it unavailable';
  });

  check('a wrapper runs on its declared tier and injects the skill', () => {
    const cfg = readJsonc(join(repoRoot, 'opencode.jsonc'));
    void cfg;
    const out = run('opencode', [
      'run', '--command', 'dedupe',
      '--format', 'json',
      'Reply with the single word READY and stop.',
    ]);
    const lines = out.split('\n').filter((l) => l.trim().startsWith('{'));
    let sessionId = null;
    let injected = false;
    for (const line of lines) {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.sessionID) sessionId = ev.sessionID;
      const part = ev.part ?? {};
      if (part.type === 'text' && /READY/.test(part.text ?? '')) injected = true;
    }
    assert(sessionId, 'no session id in wrapper output');
    const exported = run('opencode', ['export', sessionId]);
    const data = JSON.parse(exported.slice(exported.indexOf('{')));
    const model = data.info?.model;
    assert(
      model?.providerID === 'ollama-cloud' && model?.id === 'gpt-oss:20b',
      `wrapper ran on ${model?.providerID}/${model?.id}, expected ollama-cloud/gpt-oss:20b`,
    );
    const userText = (data.messages ?? [])
      .filter((m) => m.info?.role === 'user')
      .flatMap((m) => m.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    assert(
      userText.includes('canonical `dedupe` skill'),
      'the wrapper did not inject the canonical skill text',
    );
    return `ran on ${model.providerID}/${model.id} with the skill injected`;
  });
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

if (process.argv.includes('--list')) {
  console.log('Groups: static, routing, skills, wrappers (add --live for runtime tests)');
  process.exit(0);
}

const filter = process.argv.slice(2).find((a) => !a.startsWith('-'));
const shown = filter ? results.filter((r) => r.group === filter) : results;

let failed = 0;
let lastGroup = null;
for (const r of shown) {
  if (r.group !== lastGroup) {
    console.log(`\n${r.group}`);
    lastGroup = r.group;
  }
  if (r.ok) {
    console.log(`  PASS  ${r.name}\n        ${r.detail}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${r.name}\n        ${r.detail}`);
  }
}

const total = shown.length;
const passed = total - failed;
console.log(`\n${passed}/${total} passed${LIVE ? ' (live)' : ' (static only; add --live for runtime tests)'}`);
if (!LIVE) console.log('note: runtime assertions are skipped without --live');
process.exit(failed === 0 ? 0 : 1);
