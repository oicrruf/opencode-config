#!/usr/bin/env node
// AT-188: the single inventory and ownership boundary for install/check/doctor.
// No I/O with side effects occurs while planning. Only applyPlan writes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderProfile } from './render-config.mjs';

export const MANIFEST = '.opencode-resource-manifest.json';
export const JOURNAL = '.opencode-install-journal.json';
export const LOCK = '.opencode-install.lock';
export const RESOURCE_SOURCES = Object.freeze({
  agents: 'agent', commands: 'commands', skills: 'skills',
  'tui.jsonc': 'tui.jsonc', 'herdr-tui-session.js': 'herdr-tui-session.js',
  'quota-tui.tsx': 'quota-tui.tsx',
  'plugins/herdr-agent-state.js': 'plugins/herdr-agent-state.js',
  'plugins/worktree-control.js': 'plugins/worktree-control/index.js',
  'plugins/sandbox-control.js': 'plugins/sandbox-control/index.js',
});
// Required public resources are an independent acceptance invariant, not a
// second mapping used by consumers. Removing a catalog entry must fail closed.
export function validateResourceInventory(inventory = RESOURCE_SOURCES, repoRoot = DEFAULT_ROOT) {
  for (const id of ['agents', 'commands', 'skills', 'tui.jsonc', 'herdr-tui-session.js', 'quota-tui.tsx', 'plugins/herdr-agent-state.js', 'plugins/worktree-control.js', 'plugins/sandbox-control.js']) {
    if (typeof inventory[id] !== 'string') error(`resource inventory omits ${id}`);
  }
  for (const [id, source] of Object.entries(inventory)) {
    if (typeof source !== 'string' || !fs.existsSync(path.join(repoRoot, source))) error(`resource inventory source missing: ${id}`);
  }
  return true;
}
export const RETIRED_SOURCES = Object.freeze({ 'plugins/autonomy.js': 'plugins/autonomy.js' });
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_FILE = 'opencode.jsonc';
const digestPattern = /^[a-f0-9]{64}$/;
const json = value => JSON.stringify(value, null, 2) + '\n';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function error(message) { throw new Error(`resource-manifest: ${message}`); }
function stat(file) { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sourceOf(root, id) { return path.resolve(root, RESOURCE_SOURCES[id] ?? RETIRED_SOURCES[id]); }

// Reject symlink parents, including a symlink at the configuration root itself.
// Callers using /tmp on macOS should pass its canonical /private/tmp spelling.
export function assertSafeParents(file) {
  let parent = path.dirname(path.resolve(file));
  for (;;) {
    const s = stat(parent);
    if (s && (!s.isDirectory() || s.isSymbolicLink())) error(`unsafe parent: ${parent}`);
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}
export function inspect(file) {
  assertSafeParents(file);
  const s = stat(file);
  if (!s) return { kind: 'absent' };
  const identity = { dev: s.dev, ino: s.ino, mtime: s.mtimeMs };
  if (s.isSymbolicLink()) return { kind: 'symlink', source: path.resolve(path.dirname(file), fs.readlinkSync(file)), ...identity };
  if (s.isFile()) return { kind: 'file', digest: digest(fs.readFileSync(file)), ...identity };
  return { kind: 'other', ...identity };
}
function matches(actual, expected) {
  return actual.kind === expected?.kind && (actual.kind === 'file'
    ? actual.digest === expected.digest : actual.kind === 'symlink' && actual.source === expected.source);
}
function recordMatches(actual, record) { return matches(actual, record); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function target(configDir, id) { return path.join(configDir, id); }
function allowedId(id) { return id === ROOT_FILE || Object.hasOwn(RESOURCE_SOURCES, id) || Object.hasOwn(RETIRED_SOURCES, id); }

export function validateManifest(value, repoRoot) {
  if (!object(value) || value.version !== 1 || value.repoRoot !== repoRoot || typeof value.profile !== 'string' || !value.profile || !Array.isArray(value.entries)) error('invalid manifest version, owner, profile or entries');
  const ids = new Set();
  for (const entry of value.entries) {
    if (!object(entry) || !allowedId(entry.id) || ids.has(entry.id)) error(`invalid or duplicate manifest identifier: ${entry?.id}`);
    ids.add(entry.id);
    if (entry.id === ROOT_FILE) {
      if (entry.kind !== 'file' || !digestPattern.test(entry.digest ?? '')) error(`invalid root digest: ${entry.id}`);
    } else if (entry.kind !== 'symlink' || entry.source !== sourceOf(repoRoot, entry.id)) error(`invalid manifest source: ${entry.id}`);
  }
  if (!ids.has(ROOT_FILE)) error('manifest omits rendered root');
  return value;
}
export function readManifest(configDir, repoRoot) {
  const file = target(configDir, MANIFEST);
  const actual = inspect(file);
  if (actual.kind === 'absent') return null;
  if (actual.kind !== 'file') error('manifest must be a regular file');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { error('manifest is not valid JSON'); }
  return validateManifest(value, repoRoot);
}

export function createPlan(options = {}) {
  const repoRoot = fs.realpathSync(options.repoRoot ?? DEFAULT_ROOT);
  const configDir = path.resolve(options.configDir ?? path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode'));
  assertSafeParents(target(configDir, MANIFEST));
  if (stat(target(configDir, JOURNAL))) error(`unfinished installation: preserve ${JOURNAL} and reconcile its recorded operations before retrying`);
  const previous = readManifest(configDir, repoRoot);
  const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/model-profiles.json'), 'utf8'));
  const profile = options.profile ?? ((options.check || options.repairOnly) && previous ? previous.profile : catalog.defaultProfile);
  if (!Object.hasOwn(catalog.profiles ?? {}, profile) || (previous && !Object.hasOwn(catalog.profiles, previous.profile))) error('unknown selected or recorded profile');
  validateResourceInventory(RESOURCE_SOURCES, repoRoot);
  const rendered = renderProfile(profile, repoRoot);
  const desired = [{ id: ROOT_FILE, kind: 'file', digest: digest(rendered) }, ...Object.keys(RESOURCE_SOURCES).map(id => ({ id, kind: 'symlink', source: sourceOf(repoRoot, id) }))];
  // Validate all source paths before destinations can change; symlinked trees are
  // intentionally protected at their boundary, not by a per-file content index.
  for (const entry of desired.slice(1)) if (!fs.existsSync(entry.source)) error(`missing source: ${entry.id}`);
  const records = new Map((previous?.entries ?? []).map(entry => [entry.id, entry]));
  const actions = [];
  function add(entry, action, reason, before) { actions.push({ ...entry, action, reason, before, target: target(configDir, entry.id) }); }
  for (const entry of desired) {
    const before = inspect(target(configDir, entry.id));
    const record = records.get(entry.id);
    if (before.kind === 'absent') {
      add(entry, options.repairOnly && !record ? 'conflict' : 'create', record ? 'owned resource missing' : 'resource missing', before);
    } else if (record) {
      if (!recordMatches(before, record)) add(entry, 'conflict', 'recorded resource was modified or replaced', before);
      else if (matches(before, entry)) add(entry, 'keep', 'identity verified', before);
      else add(entry, options.repairOnly ? 'conflict' : 'update', 'owned resource needs update', before);
    } else if (!previous && !options.repairOnly && matches(before, entry)) {
      // A byte-identical root must still have an unambiguous profile identity.
      if (entry.id === ROOT_FILE && !options.profile) {
        const matching = Object.keys(catalog.profiles).filter(p => digest(renderProfile(p, repoRoot)) === before.digest);
        if (matching.length !== 1) { add(entry, 'conflict', 'ambiguous legacy profile; select --profile explicitly', before); continue; }
      }
      add(entry, 'adopt', 'exact legacy identity', before);
    } else if (!previous && !options.repairOnly && entry.id === ROOT_FILE) {
      // Legacy root symlink is accepted only from this checkout, with verified
      // rendered content. We never follow an arbitrary link to inspect secrets.
      const legacySource = path.join(repoRoot, ROOT_FILE);
      const legacy = before.kind === 'symlink' && before.source === legacySource;
      const bytes = before.kind === 'file' ? fs.readFileSync(target(configDir, entry.id))
        : legacy && fs.existsSync(legacySource) ? fs.readFileSync(legacySource) : null;
      const matching = bytes ? Object.keys(catalog.profiles).filter(p => digest(renderProfile(p, repoRoot)) === digest(bytes)) : [];
      if (matching.length && (options.profile || matching.length === 1)) add(entry, 'update', 'verified legacy render; preserve backup', before);
      else add(entry, 'conflict', 'unowned or ambiguous root configuration', before);
    } else add(entry, 'conflict', 'unowned resource', before);
  }
  for (const [id] of Object.entries(RETIRED_SOURCES)) {
    const before = inspect(target(configDir, id));
    const record = records.get(id);
    if (before.kind === 'absent') continue;
    if (record && recordMatches(before, record)) add(record, options.repairOnly ? 'retained' : 'remove', 'unchanged retired resource', before);
    else add(record ?? { id, kind: 'symlink', source: sourceOf(repoRoot, id) }, 'retained', 'retired resource has no matching ownership evidence', before);
  }
  // Competing roots or explicit config destinations cannot silently redirect us.
  const extras = [];
  for (const id of ['opencode.json']) {
    const before = inspect(target(configDir, id));
    extras.push({ id, before });
    if (before.kind !== 'absent') add({ id }, 'conflict', 'competing root configuration', before);
  }
  if (process.env.OPENCODE_CONFIG && path.resolve(process.env.OPENCODE_CONFIG) !== target(configDir, ROOT_FILE)) error('OPENCODE_CONFIG selects another root; effective configuration is ambiguous');
  const pluginDir = path.join(configDir, 'plugins');
  if (stat(pluginDir)) {
    assertSafeParents(path.join(pluginDir, '_'));
    const knownSources = new Set(desired.filter(e => e.id.startsWith('plugins/')).map(e => e.source));
    for (const name of fs.readdirSync(pluginDir).sort()) {
      const id = `plugins/${name}`;
      if (allowedId(id) || !/\.(?:[cm]?js|tsx?)$/.test(name)) continue;
      const before = inspect(target(configDir, id));
      if (before.kind === 'symlink' && knownSources.has(before.source)) add({ id }, 'conflict', 'duplicate plugin entrypoint', before);
    }
  }
  const parsed = JSON.parse(rendered);
  for (const instruction of parsed.instructions ?? []) {
    if (typeof instruction !== 'string') error('invalid instruction path');
    // Remote/glob instructions are runtime-resolved: do not label them verified.
    if (!/^(?:https?:|.*[*?])/.test(instruction) && !fs.existsSync(path.resolve(repoRoot, instruction))) error(`missing configured instruction: ${instruction}`);
  }
  const manifest = { version: 1, repoRoot, profile, entries: [...desired, ...actions.filter(a => a.action === 'retained' && records.has(a.id)).map(({ id, kind, source }) => ({ id, kind, source }))] };
  const conflicts = actions.filter(a => a.action === 'conflict');
  const changed = !previous || !same(previous, manifest) || actions.some(a => !['keep', 'retained'].includes(a.action));
  return { repoRoot, configDir, profile, rendered, manifest, previous, actions, conflicts, extras,
    manifestBefore: inspect(target(configDir, MANIFEST)), repairOnly: !!options.repairOnly, changed,
    code: conflicts.length || changed || actions.some(a => a.action === 'retained') ? 1 : 0 };
}

function atomicWrite(file, bytes, before) {
  assertSafeParents(file);
  if (before && !same(inspect(file), before)) error(`identity changed before write: ${file}`);
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    if (before && !same(inspect(file), before)) error(`identity changed before rename: ${file}`);
    fs.renameSync(temporary, file);
  } finally { if (stat(temporary)) fs.unlinkSync(temporary); }
}
export function applyPlan(plan, { beforeAction = () => {} } = {}) {
  if (plan.conflicts.length) error('conflicts prevent installation; no destinations were changed');
  if (!plan.changed) return { changed: false, code: plan.code };
  assertSafeParents(target(plan.configDir, MANIFEST));
  fs.mkdirSync(plan.configDir, { recursive: true });
  const lockFile = target(plan.configDir, LOCK);
  const token = randomUUID();
  fs.writeFileSync(lockFile, token, { flag: 'wx', mode: 0o600 });
  let journalStarted = false;
  const completed = [];
  const journalFile = target(plan.configDir, JOURNAL);
  try {
    // Recompute under the lock before writing a journal or any managed path.
    const fresh = createPlan({ repoRoot: plan.repoRoot, configDir: plan.configDir, profile: plan.profile, repairOnly: plan.repairOnly });
    if (!same(fresh.actions, plan.actions) || !same(fresh.manifestBefore, plan.manifestBefore) || !same(fresh.manifest, plan.manifest)) error('installation changed after preflight; retry inspection');
    const journal = { version: 1, repoRoot: plan.repoRoot, profile: plan.profile,
      previousManifest: plan.previous, expectedManifest: plan.manifest,
      backup: plan.actions.some(a => a.id === ROOT_FILE && a.action === 'update') ? `${target(plan.configDir, ROOT_FILE)}.bak.${randomUUID()}` : null,
      operations: plan.actions.map(({ id, action, before, kind, source, digest }) => ({ id, action, before, kind, source, digest })), completed };
    fs.writeFileSync(journalFile, json(journal), { flag: 'wx', mode: 0o600 });
    journalStarted = true;
    let journalState = inspect(journalFile);
    for (const action of plan.actions) {
      if (['keep', 'adopt', 'retained'].includes(action.action)) continue;
      beforeAction(action, completed.length);
      if (inspect(lockFile).kind !== 'file' || fs.readFileSync(lockFile, 'utf8') !== token) error('installation lock ownership changed');
      assertSafeParents(action.target);
      if (!same(inspect(action.target), action.before)) error(`identity changed before action: ${action.id}`);
      fs.mkdirSync(path.dirname(action.target), { recursive: true });
      if (action.action === 'remove') fs.unlinkSync(action.target);
      else if (action.kind === 'file') {
        if (action.action === 'update') {
          const backup = journal.backup;
          fs.writeFileSync(backup, fs.readFileSync(action.target), { flag: 'wx', mode: 0o600 });
        }
        atomicWrite(action.target, plan.rendered, action.before);
      } else {
        // Only absent links are created today; recorded link source changes are
        // conflicts because the inventory validates the canonical origin.
        fs.symlinkSync(action.source, action.target, fs.statSync(action.source).isDirectory() ? 'dir' : 'file');
      }
      completed.push({ id: action.id, after: inspect(action.target) });
      atomicWrite(journalFile, json(journal), journalState);
      journalState = inspect(journalFile);
    }
    for (const action of plan.actions) {
      const expected = action.action === 'remove' ? { kind: 'absent' } : completed.find(c => c.id === action.id)?.after ?? action.before;
      if (!same(inspect(action.target), expected)) error(`identity changed before manifest commit: ${action.id}`);
    }
    for (const extra of plan.extras) {
      if (!same(inspect(target(plan.configDir, extra.id)), extra.before)) error(`competing configuration changed: ${extra.id}`);
    }
    const knownPluginSources = new Set(Object.keys(RESOURCE_SOURCES).filter(id => id.startsWith('plugins/')).map(id => sourceOf(plan.repoRoot, id)));
    for (const name of fs.readdirSync(path.join(plan.configDir, 'plugins'))) {
      const id = `plugins/${name}`;
      if (allowedId(id) || !/\.(?:[cm]?js|tsx?)$/.test(name)) continue;
      const actual = inspect(target(plan.configDir, id));
      if (actual.kind === 'symlink' && knownPluginSources.has(actual.source)) error(`duplicate plugin appeared: ${id}`);
    }
    if (inspect(lockFile).kind !== 'file' || fs.readFileSync(lockFile, 'utf8') !== token) error('installation lock ownership changed');
    atomicWrite(target(plan.configDir, MANIFEST), json(plan.manifest), plan.manifestBefore);
    fs.unlinkSync(journalFile);
    journalStarted = false;
    return { changed: true, code: plan.actions.some(a => a.action === 'retained') ? 1 : 0 };
  } catch (e) {
    error(`${e.message}; completed: ${completed.map(a => a.id).join(', ') || 'none'}${journalStarted ? `; preserve ${journalFile} for reconciliation` : ''}`);
  } finally {
    const lock = stat(lockFile);
    if (lock?.isFile() && !lock.isSymbolicLink() && fs.readFileSync(lockFile, 'utf8') === token) fs.unlinkSync(lockFile);
  }
}
export function describePlan(plan) {
  return [`profile=${plan.profile}`, ...plan.actions.map(a => `${a.action}: ${a.id} — ${a.reason}`),
    !plan.previous ? 'manifest: adoption required (check does not adopt)' : '',
    'plugins: distribution inspection only; runtime loading not verified'].filter(Boolean).join('\n');
}

function main() {
  let profile; let configDir; let check = false; let preflight = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') check = true;
    else if (a === '--preflight') preflight = true;
    else if (a === '--config-dir' && args[i + 1] && !args[i + 1].startsWith('-')) configDir = args[++i];
    else if (a === '--profile' && args[i + 1] && !args[i + 1].startsWith('-')) profile = args[++i];
    else if (a.startsWith('--profile=') && a.slice(10)) profile = a.slice(10);
    else error(`unknown or incomplete argument: ${a}`);
  }
  const plan = createPlan({ profile, check, configDir });
  console.log(describePlan(plan));
  if (check) { process.exitCode = plan.code; return; }
  if (plan.conflicts.length) { process.exitCode = 1; return; }
  if (preflight) { process.exitCode = 0; return; }
  const result = applyPlan(plan);
  console.log(result.changed ? 'installation applied' : 'configuration already current');
  process.exitCode = result.code;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
