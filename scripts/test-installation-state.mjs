import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPlan, applyPlan, MANIFEST, RESOURCE_SOURCES, digest } from './resource-manifest.mjs';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'installation-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stubDir = path.join(dir, 'bin'); fs.mkdirSync(stubDir);
  for (const bin of ['openspec', 'lazygit', 'lazydocker', 'codegraph', 'serena']) {
    fs.writeFileSync(path.join(stubDir, bin), '#!/bin/sh\nprintf \'{"changes":[]}\\n\'\n', { mode: 0o755 });
  }
  fs.mkdirSync(path.join(dir, 'home')); fs.mkdirSync(path.join(dir, 'tmp'));
  const env = { ...process.env, HOME: path.join(dir, 'home'), XDG_CONFIG_HOME: path.join(dir, 'xdg'), TMPDIR: path.join(dir, 'tmp'),
    PATH: stubDir + path.delimiter + process.env.PATH, OPENCODE_INSTALL_NERD_FONTS: '0',
    OPENCODE_SKIP_PROFILE_TESTS: '1', OPENCODE_SKIP_JEV_CLIENT_TESTS: '1', OPENCODE_SKIP_ACCEPTANCE: '1', OPENCODE_SKIP_OPENSPEC_VALIDATE: '1', OPENCODE_DOCTOR: '0' };
  delete env.OPENCODE_CONFIG;
  return { dir, env, configDir: path.join(env.XDG_CONFIG_HOME, 'opencode'), repoRoot };
}
function run(f, command, args) { return spawnSync(command, args, { cwd: repoRoot, env: f.env, encoding: 'utf8', timeout: 30000 }); }
function bash(f, args) { return run(f, 'bash', ['install.sh', ...args]); }
function doctor(f, args) { return run(f, process.execPath, ['scripts/doctor.mjs', ...args]); }
function snap(dir) {
  const entries = {};
  if (!fs.existsSync(dir)) return entries;
  function walk(p, rel) {
    for (const name of fs.readdirSync(p).sort()) {
      const file = path.join(p, name); const id = path.join(rel, name); const s = fs.lstatSync(file);
      entries[id] = [s.mode, s.mtimeMs, s.isSymbolicLink() ? fs.readlinkSync(file) : s.isDirectory() ? 'dir' : digest(fs.readFileSync(file))];
      if (s.isDirectory()) walk(file, id);
    }
  }
  walk(dir, ''); return entries;
}
// 2.1–2.3: exercise the public shell entrypoint with a disposable HOME/XDG.
test('installer installs once, checks without writes, and switches profile safely', t => {
  const f = fixture(t); let r = bash(f, ['--profile', 'personal']); assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /PARTIAL.*4 skipped/);
  let before = snap(f.configDir); r = bash(f, ['--check']); assert.equal(r.status, 0, r.stderr + r.stdout); assert.deepEqual(snap(f.configDir), before);
  r = bash(f, ['--profile=personal']); assert.equal(r.status, 0, r.stderr + r.stdout); assert.deepEqual(snap(f.configDir), before);
  r = bash(f, ['--profile', 'work']); assert.equal(r.status, 0, r.stderr + r.stdout);
  before = snap(f.configDir); r = bash(f, ['--check']); assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /profile=work/); assert.deepEqual(snap(f.configDir), before);
  r = bash(f, ['--check', '--profile', 'personal']); assert.equal(r.status, 1); assert.deepEqual(snap(f.configDir), before);
});
// 2.2: arguments and checks must not create any installation in a fresh HOME.
test('check absent, unknown arguments and profiles produce explicit codes without writes', t => {
  const f = fixture(t); const before = snap(f.dir);
  assert.equal(bash(f, ['--check']).status, 1);
  for (const args of [['--unknown'], ['--profile'], ['--profile='], ['--profile', '--check'], ['--check', '--profile', 'missing']]) assert.equal(bash(f, args).status, 2, args.join(' '));
  assert.deepEqual(snap(f.dir), before);
});
// 2.1/2.3: a foreign path blocks before root creation, fonts, or any gate mutation.
test('foreign resources, corrupt manifest and alternate root block shell installation', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.configDir, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(f.configDir, 'skills/personal.md'), 'mine');
  let before = snap(f.configDir); let r = bash(f, []); assert.equal(r.status, 1, r.stderr + r.stdout); assert.deepEqual(snap(f.configDir), before);
  fs.rmSync(path.join(f.configDir, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(f.configDir, MANIFEST), '{}'); before = snap(f.configDir);
  assert.equal(bash(f, []).status, 2); assert.deepEqual(snap(f.configDir), before);
  fs.unlinkSync(path.join(f.configDir, MANIFEST));
  fs.writeFileSync(path.join(f.configDir, 'opencode.json'), '{}'); before = snap(f.configDir);
  assert.equal(bash(f, []).status, 1); assert.deepEqual(snap(f.configDir), before);
});
// 3.1: read-only doctor recognizes a rendered file; dry-run never calls repair.
test('doctor recognizes rendered root and leaves check-only and dry-run unchanged', t => {
  const f = fixture(t); applyPlan(createPlan(f)); const before = snap(f.configDir);
  for (const args of [['--check-only'], ['--apply-safe', '--dry-run']]) {
    const r = doctor(f, args); assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /opencode.jsonc: identity verified \(file\)/); assert.doesNotMatch(r.stdout, /not a symlink/);
    assert.deepEqual(snap(f.configDir), before);
  }
  const r = doctor(f, ['--check-only', '--apply-safe']); assert.equal(r.status, 2); assert.deepEqual(snap(f.configDir), before);
});
// 3.2: only an absence with prior ownership can be recreated by doctor.
test('doctor repairs recorded absences and preserves modified links, roots and Herdr', t => {
  const f = fixture(t); applyPlan(createPlan(f));
  fs.unlinkSync(path.join(f.configDir, 'agents')); fs.unlinkSync(path.join(f.configDir, 'opencode.jsonc'));
  let r = doctor(f, ['--apply-safe']); assert.equal(r.status, 0, r.stderr + r.stdout); assert(fs.lstatSync(path.join(f.configDir, 'opencode.jsonc')).isFile());
  for (const id of ['agents', 'plugins/herdr-agent-state.js']) {
    fs.unlinkSync(path.join(f.configDir, id)); fs.symlinkSync('/foreign', path.join(f.configDir, id));
  }
  fs.writeFileSync(path.join(f.configDir, 'opencode.jsonc'), '{"custom":true}'); const before = snap(f.configDir);
  r = doctor(f, ['--apply-safe']); assert.equal(r.status, 1); assert.deepEqual(snap(f.configDir), before);
});
// 3.2: doctor must not bootstrap missing ownership through a repair shortcut.
test('doctor refuses resource repair with a missing manifest', t => {
  const f = fixture(t); applyPlan(createPlan(f)); fs.unlinkSync(path.join(f.configDir, MANIFEST)); const before = snap(f.configDir);
  assert.equal(doctor(f, ['--apply-safe']).status, 1); assert.deepEqual(snap(f.configDir), before);
});
// 3.3: entrypoint imports resolve their sibling modules from installed links.
// This asserts importability/surface uniqueness, not runtime discovery by OpenCode.
test('both installed plugins import without duplicate tool names', async t => {
  const f = fixture(t); applyPlan(createPlan(f)); const names = new Set();
  for (const [id, symbol] of [['plugins/worktree-control.js', 'WorktreeControlPlugin'], ['plugins/sandbox-control.js', 'SandboxControlPlugin']]) {
    assert(RESOURCE_SOURCES[id]); const module = await import(pathToFileURL(path.join(f.configDir, id)).href); const surface = await module[symbol]();
    for (const name of Object.keys(surface.tool)) { assert(!names.has(name)); names.add(name); }
  }
  assert(names.has('worktree_create')); assert(names.has('sandbox_start'));
});

// 2.4: help describes the supported shells and check without touching the home.
test('help preserves four supported shells and documents check exit codes', t => {
  const f = fixture(t); const before = snap(f.dir); const r = bash(f, ['--help']);
  assert.equal(r.status, 0);
  for (const token of ['--check', 'Check exit codes', 'Linux bash', 'macOS bash', 'WSL Ubuntu bash', 'Git Bash on Windows']) assert(r.stdout.includes(token), token);
  assert.deepEqual(snap(f.dir), before);
});
