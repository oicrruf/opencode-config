#!/usr/bin/env node
// Structural exercise of the interruption-handoff fixture.
//
// Live runtime exhaustion cannot be exercised deterministically in
// CI without an authenticated provider and a real model run, and the
// design forbids lowering production defaults. This script exercises
// the static contract: it reads AGENTS.md, agent/routing.md, the
// fixture, and the agent prompt that would consume the fixture, and
// confirms that the policy text and the fixture text agree on the
// five required sections, the specialist structured fields, and the
// runtime-exhaustion caveats.
//
// A pass here is necessary but not sufficient; the live observation
// remains a follow-up. The script does not pretend otherwise.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(
  repoRoot,
  'docs/contracts/interruption-handoff.md',
);
const agentsPath = join(repoRoot, 'AGENTS.md');
const buildPath = join(repoRoot, 'agent/build.md');

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

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

console.log('interruption-handoff fixture exercise (structural)');

if (!existsSync(fixturePath)) {
  console.error(`exercise-handoff: fixture missing at ${fixturePath}`);
  process.exit(2);
}
const fixture = readFileSync(fixturePath, 'utf8');
const agentsText = readFileSync(agentsPath, 'utf8');
const buildText = readFileSync(buildPath, 'utf8');

check('AGENTS.md declares the Interruption handoff policy', () => {
  assert(/Interruption handoff/.test(agentsText), 'policy block missing');
  return 'policy block present';
});

check('fixture has both primary and specialist handoff sections', () => {
  assert(fixture.includes('## Primary agent handoff'), 'primary section missing');
  assert(fixture.includes('## Specialist handoff'), 'specialist section missing');
  return 'both variants present';
});

check('primary handoff has the five required sections', () => {
  const primary = fixture.split('## Specialist handoff')[0];
  for (const heading of ['completed', 'pending', 'verification run', 'verification not run', 'risks', 'next manual action']) {
    assert(new RegExp(heading, 'i').test(primary), `primary missing '${heading}'`);
  }
  return 'completed/pending/verification/risks/next-action all present';
});

check('specialist handoff preserves the structured return fields', () => {
  const specialist = fixture.split('## Specialist handoff')[1] || '';
  for (const field of ['classification', 'decision', 'changed files', 'verification results', 'blockers', 'OpenSpec task impact']) {
    assert(new RegExp(field, 'i').test(specialist), `specialist missing '${field}'`);
  }
  return 'classification/decision/changed/verification/blockers/OpenSpec task impact all present';
});

check('fixture records the structural-not-runtime caveat', () => {
  assert(
    /structural/i.test(fixture) && /runtime/i.test(fixture) && /not\s+(?:sufficient|verified)/i.test(fixture),
    'fixture must call out that static checks are not a runtime observation',
  );
  return 'caveat is visible to a future operator';
});

check('build agent prompt references the shared guidance', () => {
  assert(
    /AGENTS\.md/i.test(buildText) || /interruption handoff/i.test(buildText),
    'agent/build.md must reference the shared interruption-handoff guidance',
  );
  return 'coordinator knows where to find the policy';
});

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall structural checks passed; live runtime observation remains a follow-up');
process.exit(0);
