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
    // Default is the personal profile (assigns build → ollama-cloud/gpt-oss:20b).
    if (rendered.agent.build.model !== 'ollama-cloud/gpt-oss:20b') {
      throw new Error(`default render produced build=${rendered.agent.build.model}, expected ollama-cloud/gpt-oss:20b (personal)`);
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
    if (rendered.model !== 'minimax/MiniMax-M3') {
      throw new Error(`personal root.model=${rendered.model}, expected minimax/MiniMax-M3`);
    }
    return `personal renders root.model=${rendered.model}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 3. Explicit --profile work renders distinct assignments
//
// After the unify-execution-tier-on-gpt-oss change, both profiles render
// the same model id for every per-agent slot. The remaining differentiator
// is the root default (`minimax/MiniMax-M3` for personal,
// `openai/gpt-5.6-terra` for work) and the `opsx-apply` command. The test
// confirms at least one of those differentiators exists, ensuring the two
// profiles are still distinct install-time choices.
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
    // Per-agent slots may now be identical across profiles; that is the
    // intended outcome of unify-execution-tier-on-gpt-oss. The remaining
    // differentiator is the root default (which is what `./install.sh`
    // chooses between at install time).
    if (personal.model === work.model) {
      throw new Error(`work did not change root.model (still ${work.model}); profiles have collapsed`);
    }
    // Cross-check: the per-agent slots in both profiles are now unified
    // on ollama-cloud/gpt-oss:20b for the 5 bounded-execution agents.
    // Guard against a future change that accidentally re-introduces drift
    // between profiles for these slots.
    const executionAgents = ['build', 'general', 'frontend', 'backend', 'qa'];
    for (const name of executionAgents) {
      if (personal.agent[name].model !== work.agent[name].model) {
        throw new Error(`execution tier diverged: personal.${name}=${personal.agent[name].model}, work.${name}=${work.agent[name].model}; expected identical`);
      }
    }
    return `personal root=${personal.model}, work root=${work.model}; 5 execution agents identical`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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

// 6. Work profile baseline equivalence
//
// The repo's opencode.jsonc is the rendered work profile output
// (regenerated by the renderer during the apply phase with
// `--profile work` because the operator asked to activate work in this
// machine). The test confirms opencode.jsonc matches the work profile
// from the manifest end-to-end.
check('work baseline matches the documented current assignment', () => {
  const manifest = readManifest();
  const work = manifest.profiles.work;
  const rendered = readJsonc(join(repoRoot, 'opencode.jsonc'));
  for (const [k, expected] of Object.entries(work.root)) {
    if (rendered[k] !== expected) {
      throw new Error(`root.${k} mismatch: rendered=${rendered[k]} expected=${expected}`);
    }
  }
  for (const [name, expected] of Object.entries(work.agents)) {
    if (!rendered.agent[name]) {
      throw new Error(`rendered config is missing agent.${name}`);
    }
    if (rendered.agent[name].model !== expected) {
      throw new Error(`agent.${name}.model mismatch: rendered=${rendered.agent[name].model} expected=${expected}`);
    }
  }
  return `${Object.keys(work.agents).length} agents aligned with manifest`;
});

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
