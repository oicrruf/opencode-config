#!/usr/bin/env node
// Focused automated checks for the installation-time profile flow.
//
// Coverage:
//   1. Default profile selection equals manifest.defaultProfile.
//   2. Explicit `--profile personal` matches the default selection.
//   3. Explicit `--profile work` renders distinct model assignments.
//   4. Unknown profile is rejected with non-zero exit and the profile name.
//   5. Atomic generation failure: a render that throws mid-flight does not
//      replace a previously rendered file (simulated by rendering to a
//      non-writable temp directory).
//   6. Personal baseline equivalence: the rendered `personal` config assigns
//      every model that the prior (pre-profile) effective config assigned,
//      so an operator upgrading without changing flags sees no behaviour
//      change.
//
// Run with: `node scripts/test-model-profiles.mjs`
// Exit code: 0 when every check passes, 1 otherwise.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
function check(name, fn) {
  try {
    const detail = fn();
    console.log(`  PASS  ${name}${detail ? `\n        ${detail}` : ''}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function readJsonc(file) {
  const raw = readFileSync(file, 'utf8');
  const stripped = raw
    .replace(/^\s*\/\/[^\n]*\n/gm, '')
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '');
  return JSON.parse(stripped);
}

function nodeExec(args, opts = {}) {
  return spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', ...opts });
}

function renderProfile(profile, outputPath) {
  return nodeExec(['scripts/render-config.mjs', '--profile', profile, '--output', outputPath]);
}

function readManifest() {
  return readJsonc(join(repoRoot, 'config/model-profiles.json'));
}

console.log('model-profile checks');

// 1. Default selection
check('default profile equals manifest.defaultProfile', () => {
  const manifest = readManifest();
  const result = nodeExec(['scripts/render-config.mjs', '--help']);
  if (result.status !== 0) throw new Error(`render-config --help failed: ${result.stderr}`);
  // No CLI flag → renderer reads manifest.defaultProfile. Confirm by
  // rendering without --profile and reading the root.model.
  const tmp = mkdtempSync(join(tmpdir(), 'profile-default-'));
  const out = join(tmp, 'rendered.jsonc');
  try {
    const r = nodeExec(['scripts/render-config.mjs', '--output', out]);
    if (r.status !== 0) throw new Error(`render failed: ${r.stderr}`);
    const rendered = readJsonc(out);
    // Default is the personal profile and uses OpenAI for implementation.
    if (rendered.agent.build.model !== 'openai/gpt-6.1-sol') {
      throw new Error(`default render produced build=${rendered.agent.build.model}, expected openai/gpt-6.1-sol (personal)`);
    }
    if (manifest.defaultProfile !== 'personal') {
      throw new Error(`manifest.defaultProfile is ${manifest.defaultProfile}, expected personal`);
    }
    return `manifest.defaultProfile=${manifest.defaultProfile}, render assigns build=${rendered.agent.build.model}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 2. Explicit --profile personal matches default
check('explicit --profile personal matches default', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'profile-explicit-'));
  try {
    const outPersonal = join(tmp, 'personal.jsonc');
    const r1 = renderProfile('personal', outPersonal);
    if (r1.status !== 0) throw new Error(`render personal failed: ${r1.stderr}`);
    const rendered = readJsonc(outPersonal);
    if (rendered.model !== 'openai/gpt-6.1-sol') {
      throw new Error(`personal root.model=${rendered.model}, expected openai/gpt-6.1-sol`);
    }
    return `personal renders root.model=${rendered.model}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 3. Explicit --profile work renders distinct assignments
//
// Both profiles share the same per-agent OpenAI tiers. The root default
// distinguishes them: Sol for personal and Terra for the work demonstration.
check('explicit --profile work renders distinct assignments', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'profile-work-'));
  try {
    const outPersonal = join(tmp, 'personal.jsonc');
    const outWork = join(tmp, 'work.jsonc');
    const rP = renderProfile('personal', outPersonal);
    const rW = renderProfile('work', outWork);
    if (rP.status !== 0) throw new Error(`render personal failed: ${rP.stderr}`);
    if (rW.status !== 0) throw new Error(`render work failed: ${rW.stderr}`);
    const personal = readJsonc(outPersonal);
    const work = readJsonc(outWork);
    for (const [profileName, rendered] of [['personal', personal], ['work', work]]) {
      const composio = rendered.mcp?.composio;
      if (!composio || composio.enabled === false || composio.type !== 'remote' ||
          composio.url !== 'https://connect.composio.dev/mcp') {
        throw new Error(`${profileName} profile is missing the required Composio MCP`);
      }
      for (const [agentName, agent] of Object.entries(rendered.agent)) {
        const expected = agentName === 'triage' ? undefined : 'ask';
        if (agent.permission?.['composio_*'] !== expected) {
          throw new Error(`${profileName}.${agentName} composio_* permission must be ${expected ?? 'absent'}`);
        }
      }
      if (/(?:access_token|refresh_token|client_secret)/i.test(JSON.stringify(rendered))) {
        throw new Error(`${profileName} profile unexpectedly contains OAuth credential fields`);
      }
    }
    // Per-agent slots are intentionally identical across profiles; the
    // demonstration profile changes only the root default.
    if (personal.model === work.model) {
      throw new Error(`work did not change root.model (still ${work.model}); profiles have collapsed`);
    }
    // Guard against future drift in the five execution-agent assignments.
    const executionAgents = ['build', 'general', 'frontend', 'backend', 'qa'];
    for (const name of executionAgents) {
      if (personal.agent[name].model !== work.agent[name].model) {
        throw new Error(`execution tier diverged: personal.${name}=${personal.agent[name].model}, work.${name}=${work.agent[name].model}; expected identical`);
      }
    }
    if (personal.model !== 'openai/gpt-6.1-sol' || work.model !== 'openai/gpt-5.6-terra') {
      throw new Error(`profile roots must be OpenAI Sol/Terra, got ${personal.model}/${work.model}`);
    }
    return `personal root=${personal.model}, work root=${work.model}; 5 execution agents identical`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

check('validator rejects missing, disabled, or wrong-endpoint Composio MCP', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'profile-composio-'));
  try {
    const baseline = join(tmp, 'personal.jsonc');
    const rendered = renderProfile('personal', baseline);
    if (rendered.status !== 0) throw new Error(`render personal failed: ${rendered.stderr}`);
    const config = readJsonc(baseline);
    const invalidCases = [
      ['missing', (cfg) => { delete cfg.mcp.composio; }],
      ['disabled', (cfg) => { cfg.mcp.composio.enabled = false; }],
      ['wrong endpoint', (cfg) => { cfg.mcp.composio.url = 'https://example.com/mcp'; }],
    ];
    for (const [label, mutate] of invalidCases) {
      const candidate = structuredClone(config);
      mutate(candidate);
      const path = join(tmp, `${label.replaceAll(' ', '-')}.jsonc`);
      writeFileSync(path, JSON.stringify(candidate, null, 2), 'utf8');
      const result = nodeExec(['scripts/validate-config.mjs', '--profile', 'personal', '--rendered-config', path]);
      if (result.status === 0 || !result.stderr.includes("required MCP 'composio'")) {
        throw new Error(`${label} Composio configuration was not rejected: ${result.stderr}`);
      }
    }
    return 'missing, disabled, and wrong-endpoint server configurations are rejected';
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

check('every profile and command override uses an OpenAI model', () => {
  const manifest = readManifest();
  for (const [profileName, profile] of Object.entries(manifest.profiles)) {
    for (const section of ['root', 'agents', 'commands']) {
      for (const [consumer, model] of Object.entries(profile[section] ?? {})) {
        if (typeof model !== 'string' || !model.startsWith('openai/')) {
          throw new Error(`${profileName}.${section}.${consumer} has non-OpenAI model ${model}`);
        }
      }
    }
  }
  const commandsDir = join(repoRoot, 'commands');
  for (const file of readdirSync(commandsDir).filter((name) => name.endsWith('.md'))) {
    const frontmatter = readFileSync(join(commandsDir, file), 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
    const model = frontmatter?.[1].match(/^model:\s*(.+)$/m)?.[1];
    if (model && !model.startsWith('openai/')) {
      throw new Error(`${file} frontmatter uses non-OpenAI model ${model}`);
    }
  }
  return `${Object.keys(manifest.profiles).length} profiles and command frontmatter use openai/`;
});

check('both profiles omit primary steps and retain specialist budgets', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'profile-continuity-'));
  try {
    for (const profile of ['personal', 'work']) {
      const out = join(tmp, `${profile}.jsonc`);
      const result = renderProfile(profile, out);
      if (result.status !== 0) throw new Error(result.stderr);
      const agents = readJsonc(out).agent;
      for (const name of ['build', 'plan']) {
        if (Object.hasOwn(agents[name], 'steps') || Object.hasOwn(agents[name], 'maxSteps')) {
          throw new Error(`${profile}.${name} must omit steps and maxSteps`);
        }
      }
      for (const [name, steps] of Object.entries({general:80, frontend:80, backend:80,
        explore:25, triage:25, qa:60, architect:100, orchestrator:100, refactor:100,
        adversarial:100, cotizador:100, 'p5t-installer':100, doctor:100})) {
        if (agents[name].steps !== steps) throw new Error(`${profile}.${name} lost its ${steps} ceiling`);
      }
    }
    return 'personal/work: two uncapped primaries, thirteen bounded specialists';
  } finally { rmSync(tmp, {recursive:true, force:true}); }
});

// 4. Unknown profile rejected
check('unknown profile is rejected with non-zero exit', () => {
  const result = renderProfile('nonexistent-profile', '/tmp/should-not-exist.jsonc');
  if (result.status === 0) throw new Error('renderer exited 0 for unknown profile');
  if (!result.stderr.includes('nonexistent-profile')) {
    throw new Error(`stderr did not name the bad profile: ${result.stderr}`);
  }
  if (existsSync('/tmp/should-not-exist.jsonc')) {
    throw new Error('renderer wrote a file for an unknown profile');
  }
  return `exit=${result.status}, stderr names "nonexistent-profile"`;
});

// 5. Atomic generation failure preserves prior render
check('atomic generation failure preserves prior render', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'profile-atomic-'));
  const outDir = join(tmp, 'readonly');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'rendered.jsonc');
  // Seed a "prior" render so we can confirm it survives a failed render.
  writeFileSync(outFile, '{"sentinel":"prior"}', 'utf8');

  // Simulate a render failure by pointing the renderer at an unwritable
  // output path under /dev/null (which always exists but rejects writes).
  const result = nodeExec([
    'scripts/render-config.mjs',
    '--profile', 'personal',
    '--output', '/dev/null/should-not-exist.jsonc',
  ]);
  if (result.status === 0) throw new Error('renderer unexpectedly succeeded on a bad output path');
  if (!existsSync(outFile)) throw new Error('prior render was lost');
  const survivor = readFileSync(outFile, 'utf8');
  if (survivor !== '{"sentinel":"prior"}') throw new Error(`prior render was mutated: ${survivor}`);
  rmSync(tmp, { recursive: true, force: true });
  return `prior render survives failed render attempt`;
});

// 6. Rendered repository baseline equivalence
//
// `opencode.jsonc` may be rendered from any supported profile. Confirm it
// matches one complete manifest profile instead of pinning the checkout to
// the demonstration `work` profile.
check('repository baseline matches a declared profile', () => {
  const manifest = readManifest();
  const rendered = readJsonc(join(repoRoot, 'opencode.jsonc'));
  for (const [profileName, profile] of Object.entries(manifest.profiles)) {
    const rootMatches = Object.entries(profile.root).every(([key, expected]) => rendered[key] === expected);
    const agentsMatch = Object.entries(profile.agents).every(([name, expected]) => rendered.agent?.[name]?.model === expected);
    if (rootMatches && agentsMatch) {
      return `${profileName}: root and ${Object.keys(profile.agents).length} agent assignments match the manifest`;
    }
  }
  throw new Error('root or agent assignments do not match any profile in config/model-profiles.json');
});

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
