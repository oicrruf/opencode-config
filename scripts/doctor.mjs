#!/usr/bin/env node
// scripts/doctor.mjs — diagnose and (optionally) repair the OpenCode
// environment on the current host.
//
// Modes:
//   --check-only    (default) print a report and exit. Never installs,
//                   never relinks, never mutates state outside stdout.
//   --apply-safe    install missing lazygit/lazydocker, recreate missing
//                   symlinks under $XDG_CONFIG_HOME/opencode, and rerun
//                   scripts/validate-config.mjs. Idempotent.
//   --dry-run       pair with --apply-safe to print the actions without
//                   executing them. Never mutates state.
//
// Report levels: ok, warn, fail, requires-approval.
// Exit code: 0 when no `fail` is found, 1 otherwise. `requires-approval`
// rows do NOT contribute to the exit code: the script surfaces them
// but does not block the operator.
//
// The script is intentionally provider-agnostic. It MUST NOT call
// mmx, codex, ollama, or any model CLI.

import { existsSync, readFileSync, accessSync, constants } from 'node:fs';
import { createPlan, applyPlan } from './resource-manifest.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(here);
const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');

const args = new Set(process.argv.slice(2));
if ([...args].some(a => !['--check-only', '--apply-safe', '--dry-run'].includes(a)) ||
    (args.has('--check-only') && args.has('--apply-safe'))) {
  console.error('doctor: invalid or conflicting arguments'); process.exit(2);
}
const checkOnly = args.has('--check-only') || !args.has('--apply-safe');
const applySafe = args.has('--apply-safe');
const dryRun = args.has('--dry-run');

if (!checkOnly && !applySafe) {
  console.error('doctor: pass either --check-only or --apply-safe');
  process.exit(2);
}
if (dryRun && !applySafe) {
  console.error('doctor: --dry-run is only valid with --apply-safe');
  process.exit(2);
}

const findings = []; // { level, area, message }
function ok(area, message) { findings.push({ level: 'ok', area, message }); }
function warn(area, message) { findings.push({ level: 'warn', area, message }); }
function fail(area, message) { findings.push({ level: 'fail', area, message }); }
function approve(area, message) { findings.push({ level: 'requires-approval', area, message }); }

// ---- 1. OpenSpec CLI -------------------------------------------------------

function executablePresent(bin) {
  const suffixes = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      try { accessSync(join(dir, bin + suffix), constants.X_OK); return true; } catch {}
    }
  }
  return false;
}
function detectOpenspec() { return executablePresent('openspec'); }

if (detectOpenspec()) {
  ok('dependencies', 'openspec CLI found on PATH');
} else {
  fail('dependencies', 'openspec CLI missing — install with `npm install -g @fission-ai/openspec`');
}

// ---- 2. Tooling dependencies ----------------------------------------------

const toolDeps = [
  { bin: 'lazygit', install: { darwin: 'brew install lazygit', linux: 'sudo apt-get install -y lazygit || sudo dnf install -y lazygit || sudo pacman -S --noconfirm lazygit' } },
  { bin: 'lazydocker', install: { darwin: 'brew install lazydocker', linux: 'curl -fsSL https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash' } },
  { bin: 'codegraph', install: { darwin: 'npm install -g @colbymchenry/codegraph', linux: 'npm install -g @colbymchenry/codegraph' } },
  { bin: 'serena', install: { darwin: 'uv tool install -p 3.13 serena-agent', linux: 'uv tool install -p 3.13 serena-agent' } },
];

const os = platform(); // 'darwin', 'linux', 'win32', ...
for (const dep of toolDeps) {
  if (executablePresent(dep.bin)) {
    ok('dependencies', `${dep.bin} found on PATH`);
    continue;
  }
  if (applySafe && !dryRun && (dep.bin === 'lazygit' || dep.bin === 'lazydocker')) {
    const cmd = os === 'darwin' ? dep.install.darwin : (os === 'linux' ? dep.install.linux : null);
    if (cmd) {
      const install = spawnSync('bash', ['-lc', cmd], { stdio: 'inherit' });
      if (install.status === 0) {
        ok('dependencies', `${dep.bin} installed via package manager`);
      } else {
        fail('dependencies', `${dep.bin} install failed — run \`${cmd}\` manually`);
      }
      continue;
    }
    fail('dependencies', `${dep.bin} install not supported on ${os}; install manually`);
    continue;
  }
  if (applySafe && dryRun && (dep.bin === 'lazygit' || dep.bin === 'lazydocker')) {
    const cmd = os === 'darwin' ? dep.install.darwin : (os === 'linux' ? dep.install.linux : null);
    if (cmd) {
      warn('dependencies', `--dry-run would install ${dep.bin} with: ${cmd}`);
      continue;
    }
    fail('dependencies', `${dep.bin} install not supported on ${os}; install manually`);
    continue;
  }
  fail('dependencies', `${dep.bin} missing — repair with \`/doctor\` (--apply-safe) or install manually`);
}

// ---- 3. Shared installed-state inspection and safe resource repair ----------
const validationReport = runValidator();
let installedPlan = null;
try {
  installedPlan = createPlan({ repoRoot: repoDir, configDir, check: true, repairOnly: applySafe });
  if (applySafe && !dryRun && validationReport.status === 0 && installedPlan.previous && !installedPlan.conflicts.length) {
    // Repair only absent owned resources. Drift/adoption/update conflicts never
    // become a backup-and-takeover operation through doctor.
    applyPlan(installedPlan);
    installedPlan = createPlan({ repoRoot: repoDir, configDir, check: true });
  }
  if (!installedPlan.previous) fail('resources', 'ownership manifest missing — run install.sh to inspect and migrate');
  for (const action of installedPlan.actions) {
    if (action.action === 'keep') ok('resources', `${action.id}: identity verified (${action.kind})`);
    else if (dryRun && action.action === 'create' && installedPlan.previous) warn('resources', `--dry-run would recreate owned absence: ${action.id}`);
    else fail('resources', `${action.id}: ${action.action} — ${action.reason}`);
  }
  warn('plugins', 'distribution inspected; runtime loading is not verified by doctor');
} catch (error) {
  fail('resources', error.message);
}

// ---- 4. Configuration validator -------------------------------------------

function runValidator() {
  const r = spawnSync(process.execPath, [join(repoDir, 'scripts/validate-config.mjs')], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const validator = validationReport;
if (validator.status === 0) {
  ok('config', 'validate-config.mjs passed');
} else {
  fail('config', `validate-config.mjs failed: ${validator.stderr.trim() || validator.stdout.trim()}`);
}

// ---- 5. OpenSpec change state ---------------------------------------------

function openspecStatus() {
  if (!detectOpenspec()) return null;
  const r = spawnSync('openspec', ['list', '--json'], { encoding: 'utf8', cwd: repoDir });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

const openspecList = openspecStatus();
if (openspecList && Array.isArray(openspecList.changes)) {
  for (const c of openspecList.changes) {
    if (c.status === 'in-progress' && c.completedTasks < c.totalTasks) {
      approve('openspec', `change "${c.name}" has ${c.totalTasks - c.completedTasks} pending tasks — run \`/opsx-apply ${c.name}\``);
    }
  }
  ok('openspec', `${openspecList.changes.length} OpenSpec change(s) detected`);
} else if (!detectOpenspec()) {
  // already reported as fail above
} else {
  warn('openspec', 'openspec list returned no parseable JSON');
}

// ---- 6. MCP configuration -------------------------------------------------

function readJsonc(file) {
  const raw = readFileSync(file, 'utf8');
  const stripped = raw
    .replace(/^\s*\/\/[^\n]*\n/gm, '')
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '');
  return JSON.parse(stripped);
}

const cfgPath = join(configDir, 'opencode.jsonc');
if (installedPlan?.actions.find(a => a.id === 'opencode.jsonc')?.before.kind === 'file') {
  let cfg;
  try {
    cfg = readJsonc(cfgPath);
  } catch (err) {
    fail('mcp', 'installed opencode.jsonc is not parseable');
  }
  if (cfg && cfg.mcp) {
    const agentPerms = JSON.stringify(Object.values(cfg.agent || {}).map((a) => a && a.permission));
    for (const [name, value] of Object.entries(cfg.mcp)) {
      if (!value || value.enabled === false) {
        approve('mcp', `MCP "${name}" is disabled — set enabled: true in opencode.jsonc to activate`);
        continue;
      }
      const token = `${name}_*`;
      if (!agentPerms.includes(token) && !agentPerms.includes(name)) {
        warn('mcp', `MCP "${name}" enabled but no agent references "${token}" or "${name}" in permission`);
      } else {
        ok('mcp', `MCP "${name}" referenced by at least one agent`);
      }
    }
  }
} else {
  fail('mcp', `${cfgPath} unavailable as a regular rendered root`);
}

// ---- 7. Render report -----------------------------------------------------

const order = ['fail', 'requires-approval', 'warn', 'ok'];
const tally = { ok: 0, warn: 0, fail: 0, 'requires-approval': 0 };
for (const f of findings) tally[f.level]++;

console.log('doctor report');
console.log('=============');
console.log(`os: ${os}`);
console.log(`mode: ${applySafe ? (dryRun ? 'apply-safe (dry-run)' : 'apply-safe') : 'check-only'}`);
console.log(`tally: ${tally.ok} ok / ${tally.warn} warn / ${tally.fail} fail / ${tally['requires-approval']} requires-approval`);
console.log('');
for (const level of order) {
  const rows = findings.filter((f) => f.level === level);
  if (rows.length === 0) continue;
  console.log(`[${level}]`);
  for (const r of rows) console.log(`  - ${r.area}: ${r.message}`);
  console.log('');
}

process.exit(tally.fail === 0 ? 0 : 1);
