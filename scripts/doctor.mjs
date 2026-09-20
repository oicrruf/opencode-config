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

import { existsSync, readFileSync, lstatSync, symlinkSync, renameSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(here);
const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');

const args = new Set(process.argv.slice(2));
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

function detectOpenspec() {
  const r = spawnSync('command', ['-v', 'openspec'], { encoding: 'utf8' });
  return r.status === 0;
}

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
  const r = spawnSync('command', ['-v', dep.bin], { encoding: 'utf8' });
  if (r.status === 0) {
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

// ---- 3. Symlinks under ~/.config/opencode ----------------------------------

const linkEntries = [
  'opencode.jsonc',
  'agents',
  'commands',
  'skills',
  'tui.jsonc',
  'herdr-tui-session.js',
  'quota-tui.tsx',
  'plugins/herdr-agent-state.js',
];

if (!existsSync(configDir)) {
  fail('symlinks', `${configDir} does not exist — run install.sh first`);
} else {
  for (const entry of linkEntries) {
    const target = join(configDir, entry);
    const source = join(repoDir, entry);
    const exists = existsSync(target);
    // `lstatSync` (not `statSync`) so we inspect the link itself, not the
    // target it points at. `statSync` follows the link and reports the
    // target's properties, which would make a valid symlink look like a
    // regular file or directory.
    const isLink = exists ? lstatSync(target).isSymbolicLink() : false;

    if (!exists) {
      if (applySafe && !dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        if (existsSync(source)) {
          try {
            symlinkSync(source, target);
            ok('symlinks', `linked ${entry} → ${relative(configDir, source)}`);
          } catch (err) {
            fail('symlinks', `could not link ${entry}: ${err.message}`);
          }
          continue;
        }
        fail('symlinks', `${entry} missing in clone; cannot recreate link`);
        continue;
      }
      if (applySafe && dryRun) {
        warn('symlinks', `--dry-run would create symlink ${entry} → ${relative(configDir, source)}`);
        continue;
      }
      fail('symlinks', `${entry} missing under ${configDir} — repair with \`/doctor --apply-safe\``);
      continue;
    }

    if (isLink) {
      ok('symlinks', `${entry} symlink OK`);
      continue;
    }

    // Exists but is not a symlink — the repair path is to back it up and
    // replace it with the canonical symlink, matching install.sh's `link`
    // helper. --apply-safe does it; --check-only surfaces it as fail.
    if (applySafe && !dryRun) {
      const backup = `${target}.bak.${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
      try {
        renameSync(target, backup);
        if (existsSync(source)) {
          symlinkSync(source, target);
          ok('symlinks', `replaced non-symlink ${entry} with symlink → ${relative(configDir, source)} (backup at ${basename(backup)})`);
        } else {
          fail('symlinks', `${entry} missing in clone; backed up to ${basename(backup)} but no source to link`);
        }
      } catch (err) {
        fail('symlinks', `could not repair ${entry}: ${err.message}`);
      }
      continue;
    }
    if (applySafe && dryRun) {
      warn('symlinks', `--dry-run would replace non-symlink ${entry} with symlink → ${relative(configDir, source)} (timestamped backup)`);
      continue;
    }
    fail('symlinks', `${entry} exists but is not a symlink; repair with \`/doctor --apply-safe\``);
  }
}

// ---- 4. Configuration validator -------------------------------------------

function runValidator() {
  const r = spawnSync('node', [join(repoDir, 'scripts/validate-config.mjs')], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const validator = runValidator();
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

const cfgPath = join(repoDir, 'opencode.jsonc');
if (existsSync(cfgPath)) {
  let cfg;
  try {
    cfg = readJsonc(cfgPath);
  } catch (err) {
    fail('mcp', `opencode.jsonc not parseable: ${err.message}`);
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
  fail('mcp', `${cfgPath} missing — clone incomplete`);
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
