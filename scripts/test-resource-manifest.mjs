import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlan, applyPlan, validateManifest, validateResourceInventory, readManifest, RESOURCE_SOURCES, MANIFEST, JOURNAL, LOCK, digest } from './resource-manifest.mjs';
import { renderProfile } from './render-config.mjs';

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resource-test-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repoRoot = path.join(base, 'repo');
  const configDir = path.join(base, 'xdg', 'opencode');
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  const profiles = {};
  for (const name of ['personal', 'work']) profiles[name] = { root: { model: `test/${name}`, small_model: 'test/small' }, agents: { build: `test/${name}` }, commands: {} };
  fs.writeFileSync(path.join(repoRoot, 'config/model-profiles.json'), JSON.stringify({ defaultProfile: 'personal', profiles }));
  fs.writeFileSync(path.join(repoRoot, 'config/opencode.template.jsonc'), JSON.stringify({ agent: { build: {} } }));
  for (const relative of Object.values(RESOURCE_SOURCES)) {
    const file = path.join(repoRoot, relative);
    if (['agent', 'commands', 'skills'].includes(relative)) fs.mkdirSync(file, { recursive: true });
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '// fixture\n'); }
  }
  return { repoRoot, configDir, base };
}
function put(f, id, bytes) { const p = path.join(f.configDir, id); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); }
function plan(f, extra = {}) { return createPlan({ ...f, ...extra }); }
function install(f, extra = {}) { return applyPlan(plan(f, extra)); }
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const result = {};
  function walk(p, rel) {
    for (const name of fs.readdirSync(p).sort()) {
      const file = path.join(p, name); const id = path.join(rel, name); const s = fs.lstatSync(file);
      result[id] = [s.mode, s.mtimeMs, s.isSymbolicLink() ? fs.readlinkSync(file) : s.isDirectory() ? 'directory' : digest(fs.readFileSync(file))];
      if (s.isDirectory()) walk(file, id);
    }
  }
  walk(dir, ''); return result;
}

// AT-188 1.1: inventory roundtrip, including both plugin entrypoints and rendered root.
test('new install records the full inventory and is idempotent', t => {
  const f = fixture(t); install(f);
  const m = readManifest(f.configDir, f.repoRoot);
  assert.equal(m.entries.length, Object.keys(RESOURCE_SOURCES).length + 1);
  assert.deepEqual(validateManifest(JSON.parse(JSON.stringify(m)), f.repoRoot), m);
  assert.equal(fs.lstatSync(path.join(f.configDir, 'opencode.jsonc')).isFile(), true);
  const before = snapshot(f.configDir);
  assert.deepEqual(install(f), { changed: false, code: 0 });
  assert.deepEqual(snapshot(f.configDir), before);
});
// 1.1/1.2: malformed metadata cannot become an ownership claim.
test('manifest validation rejects malformed, duplicate, unsafe and foreign entries', t => {
  const f = fixture(t); install(f); const valid = readManifest(f.configDir, f.repoRoot);
  const cases = [null, [], { ...valid, version: 2 }, { ...valid, repoRoot: '/' }, { ...valid, entries: [] },
    { ...valid, entries: [...valid.entries, valid.entries[0]] },
    { ...valid, entries: [{ id: '../outside', kind: 'file', digest: '0'.repeat(64) }] },
    { ...valid, entries: [{ id: 'auth.json', kind: 'file', digest: '0'.repeat(64) }] },
    { ...valid, entries: valid.entries.map(e => e.id === 'agents' ? { ...e, source: '/outside' } : e) }];
  for (const c of cases) assert.throws(() => validateManifest(c, f.repoRoot));
});
// 1.2/1.4: preflight conflicts leave every destination byte- and mtime-identical.
test('foreign directory blocks the entire install before root or backups are written', t => {
  const f = fixture(t); put(f, 'skills/personal.md', 'mine');
  const before = snapshot(f.configDir); const p = plan(f);
  assert.equal(p.conflicts[0].id, 'skills'); assert.throws(() => applyPlan(p), /conflicts/);
  assert.deepEqual(snapshot(f.configDir), before);
});
// 1.2: neither broken nor redirected links are blindly repaired.
test('modified and broken links preserve their destinations', t => {
  const f = fixture(t); install(f);
  const agents = path.join(f.configDir, 'agents'); fs.unlinkSync(agents); fs.symlinkSync(path.join(f.base, 'missing'), agents);
  assert.equal(plan(f).conflicts.find(a => a.id === 'agents').before.kind, 'symlink');
  const before = snapshot(f.configDir); assert.throws(() => install(f)); assert.deepEqual(snapshot(f.configDir), before);
});
// 1.2: prevent filesystem traversal even through a legitimate-looking plugin path.
test('symlink parents and symlink manifest are rejected', t => {
  const f = fixture(t); const outside = path.join(f.base, 'outside'); fs.mkdirSync(outside);
  fs.mkdirSync(f.configDir, { recursive: true }); fs.symlinkSync(outside, path.join(f.configDir, 'plugins'));
  assert.throws(() => plan(f), /unsafe parent/); assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(f.configDir, 'plugins')); fs.writeFileSync(path.join(outside, 'data'), '{}');
  fs.symlinkSync(path.join(outside, 'data'), path.join(f.configDir, MANIFEST));
  assert.throws(() => plan(f), /regular file/);
});
// 1.3: no manifest is not permission to take over local edits.
test('exact legacy links and root can be adopted without rewriting resources', t => {
  const f = fixture(t); install(f); fs.unlinkSync(path.join(f.configDir, MANIFEST));
  const before = snapshot(f.configDir); const p = plan(f);
  assert.equal(p.conflicts.length, 0); assert(p.actions.every(a => a.action === 'adopt'));
  applyPlan(p); const after = snapshot(f.configDir); delete after[MANIFEST]; assert.deepEqual(after, before);
});
// 1.3: byte identity must be unambiguous, independently of defaultProfile.
test('legacy render with ambiguous profiles needs explicit selection', t => {
  const f = fixture(t); const file = path.join(f.repoRoot, 'config/model-profiles.json');
  const m = JSON.parse(fs.readFileSync(file)); m.profiles.work = m.profiles.personal; fs.writeFileSync(file, JSON.stringify(m));
  put(f, 'opencode.jsonc', renderProfile('personal', f.repoRoot));
  assert(plan(f).conflicts.some(a => a.reason.includes('ambiguous')));
  assert.equal(plan(f, { profile: 'personal' }).conflicts.length, 0);
});
// 1.3: a verified old profile can be safely replaced with the explicitly requested profile.
test('legacy root from another known profile is backed up', t => {
  const f = fixture(t); const old = renderProfile('work', f.repoRoot); put(f, 'opencode.jsonc', old);
  install(f, { profile: 'personal' });
  const backup = fs.readdirSync(f.configDir).find(p => p.startsWith('opencode.jsonc.bak.'));
  assert.equal(fs.readFileSync(path.join(f.configDir, backup), 'utf8'), old);
});
// 1.3/1.4: edited roots are preserved both before and after ownership registration.
test('foreign and modified rendered roots are conflicts', t => {
  const f = fixture(t); put(f, 'opencode.jsonc', '{"personal":true}');
  assert(plan(f).conflicts.some(a => a.id === 'opencode.jsonc'));
  fs.unlinkSync(path.join(f.configDir, 'opencode.jsonc')); install(f);
  put(f, 'opencode.jsonc', '{"personal":true}'); const before = snapshot(f.configDir);
  assert.throws(() => install(f)); assert.deepEqual(snapshot(f.configDir), before);
});
// 1.5: a retired file with a modified identity must remain visible across repeated runs.
test('owned obsolete links are removed; modified obsolete links remain recorded', t => {
  const f = fixture(t); install(f);
  const file = path.join(f.configDir, 'plugins/autonomy.js'); const origin = path.join(f.repoRoot, 'plugins/autonomy.js');
  const m = readManifest(f.configDir, f.repoRoot); m.entries.push({ id: 'plugins/autonomy.js', kind: 'symlink', source: origin });
  put(f, MANIFEST, JSON.stringify(m)); fs.symlinkSync(origin, file); install(f); assert.equal(fs.existsSync(file), false);
  put(f, MANIFEST, JSON.stringify(m)); fs.symlinkSync('/unowned', file);
  assert.equal(install(f).code, 1); assert.equal(plan(f).actions.find(a => a.id === 'plugins/autonomy.js').action, 'retained');
  assert(readManifest(f.configDir, f.repoRoot).entries.some(a => a.id === 'plugins/autonomy.js'));
});
// 1.5: merely seeing an unowned legacy name must never confer ownership.
test('unowned obsolete link is never adopted or removed on later runs', t => {
  const f = fixture(t); put(f, 'plugins/placeholder', '');
  const link = path.join(f.configDir, 'plugins/autonomy.js'); fs.symlinkSync('/not-ours', link);
  install(f); assert(!readManifest(f.configDir, f.repoRoot).entries.some(a => a.id === 'plugins/autonomy.js'));
  fs.unlinkSync(link); fs.symlinkSync(path.join(f.repoRoot, 'plugins/autonomy.js'), link);
  install(f); assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});
// 1.6: detect destination changes between plan and apply without partially installing.
test('changed destination between preflight and application blocks all writes', t => {
  const f = fixture(t); const p = plan(f); put(f, 'skills/user.md', 'mine'); const before = snapshot(f.configDir);
  assert.throws(() => applyPlan(p), /changed after preflight/); assert.deepEqual(snapshot(f.configDir), before);
});
// 1.6: journal is evidence of the exact partial install, not permission to retry it.
test('injected partial failure preserves a journal and blocks blind retry', t => {
  const f = fixture(t); const p = plan(f);
  assert.throws(() => applyPlan(p, { beforeAction(a, n) { if (n === 2) throw new Error('injected'); } }), /preserve .*journal/);
  const journal = JSON.parse(fs.readFileSync(path.join(f.configDir, JOURNAL)));
  assert.equal(journal.completed.length, 2); assert.equal(fs.existsSync(path.join(f.configDir, LOCK)), false);
  assert.throws(() => plan(f), /unfinished installation/);
});
// 1.6: concurrent invocations do not replace each other's lock or perform writes.
test('exclusive installation lock is preserved on contention', t => {
  const f = fixture(t); const p = plan(f); put(f, LOCK, 'other-owner'); const before = snapshot(f.configDir);
  assert.throws(() => applyPlan(p), /EEXIST/); assert.deepEqual(snapshot(f.configDir), before);
});
// 2.2/3.1: a check inspects all state without creating even a missing directory.
test('check uses installed profile and does not mutate absent or existing configuration', t => {
  const f = fixture(t); const before = snapshot(f.base); assert.equal(plan(f, { check: true }).code, 1); assert.deepEqual(snapshot(f.base), before);
  install(f, { profile: 'work' }); const installed = snapshot(f.configDir);
  assert.equal(plan(f, { check: true }).profile, 'work'); assert.equal(plan(f, { check: true }).code, 0);
  assert.equal(plan(f, { check: true, profile: 'personal' }).code, 1); assert.deepEqual(snapshot(f.configDir), installed);
});
// 2.3: switching profiles records a new digest while preserving the old root.
test('profile change updates owned regular root and keeps a unique backup', t => {
  const f = fixture(t); install(f); const old = fs.readFileSync(path.join(f.configDir, 'opencode.jsonc'));
  install(f, { profile: 'work' }); assert.equal(readManifest(f.configDir, f.repoRoot).profile, 'work');
  assert(fs.readdirSync(f.configDir).some(p => p.startsWith('opencode.jsonc.bak.') && fs.readFileSync(path.join(f.configDir, p)).equals(old)));
});
// 3.1: JSON/JSONC ambiguity must never select a root by guesswork.
test('competing root and duplicate plugin symlink are conflicts', t => {
  const f = fixture(t); install(f); put(f, 'opencode.json', '{}'); assert(plan(f).conflicts.some(a => a.reason.includes('competing')));
  fs.unlinkSync(path.join(f.configDir, 'opencode.json'));
  fs.symlinkSync(path.join(f.repoRoot, RESOURCE_SOURCES['plugins/sandbox-control.js']), path.join(f.configDir, 'plugins/duplicate.js'));
  assert(plan(f).conflicts.some(a => a.reason.includes('duplicate')));
});
// 3.2: doctor repairs only recorded absences, never adopting unowned resources.
test('repair-only plan recreates owned absences and rejects drift or missing ownership', t => {
  const f = fixture(t); install(f); fs.unlinkSync(path.join(f.configDir, 'agents'));
  applyPlan(plan(f, { repairOnly: true })); assert.equal(plan(f, { check: true }).code, 0);
  fs.unlinkSync(path.join(f.configDir, MANIFEST)); assert(plan(f, { repairOnly: true }).conflicts.length > 0);
});
// 1.4/2.3: renderer errors occur before any destination or lock is created.
test('invalid source profile and corrupt manifest are rejected without writes', t => {
  const f = fixture(t); const before = snapshot(f.base); assert.throws(() => plan(f, { profile: 'missing' }), /unknown/); assert.deepEqual(snapshot(f.base), before);
  put(f, MANIFEST, '{broken'); const existing = snapshot(f.configDir); assert.throws(() => plan(f), /not valid JSON/); assert.deepEqual(snapshot(f.configDir), existing);
});

// 4.1: a catalog mutation must fail with the missing public resource named.
test('inventory coverage rejects missing resources and missing source files', t => {
  const f = fixture(t); assert.equal(validateResourceInventory(RESOURCE_SOURCES, f.repoRoot), true);
  const catalog = { ...RESOURCE_SOURCES }; delete catalog['plugins/sandbox-control.js'];
  assert.throws(() => validateResourceInventory(catalog, f.repoRoot), /omits plugins\/sandbox-control.js/);
  fs.unlinkSync(path.join(f.repoRoot, RESOURCE_SOURCES['plugins/worktree-control.js']));
  assert.throws(() => plan(f), /source missing: plugins\/worktree-control.js/);
});
// 1.6: an injected mid-application root competitor cannot be committed as current.
test('new root competitor during application preserves journal and fails closed', t => {
  const f = fixture(t);
  assert.throws(() => applyPlan(plan(f), { beforeAction(a, n) { if (n === 1) put(f, 'opencode.json', '{}'); } }), /competing configuration changed/);
  assert.equal(fs.readFileSync(path.join(f.configDir, 'opencode.json'), 'utf8'), '{}');
  assert(fs.existsSync(path.join(f.configDir, JOURNAL)));
});

// Review regression: revalidation must preserve doctor's repair-only mode even
// with unchanged retired artifacts, so it repairs an owned absence safely.
test('repair-only revalidation retains obsolete ownership and repairs absences', t => {
  const f = fixture(t); install(f);
  const m = readManifest(f.configDir, f.repoRoot); const source = path.join(f.repoRoot, 'plugins/autonomy.js');
  m.entries.push({ id: 'plugins/autonomy.js', kind: 'symlink', source });
  put(f, MANIFEST, JSON.stringify(m)); fs.symlinkSync(source, path.join(f.configDir, 'plugins/autonomy.js'));
  fs.unlinkSync(path.join(f.configDir, 'agents'));
  const p = plan(f, { repairOnly: true }); assert.equal(p.conflicts.length, 0);
  assert.equal(applyPlan(p).code, 1);
  assert(fs.lstatSync(path.join(f.configDir, 'agents')).isSymbolicLink());
  assert(fs.lstatSync(path.join(f.configDir, 'plugins/autonomy.js')).isSymbolicLink());
});
