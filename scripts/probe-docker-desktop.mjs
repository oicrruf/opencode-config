// Execute the pinned OpenCode V2 plugin-loading fixture through sandbox-control.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectLocalEngine, boundDocker } from '../plugins/sandbox-control/engine.mjs';
import { startSandbox, finishSandbox } from '../plugins/sandbox-control/lifecycle.mjs';

const imageName = 'ghcr.io/anomalyco/opencode:2.2.7@sha256:7b1e3139a64121d12e572530974a18b9452967fb4d67516d8cfd9c0e763dd57d';
const expectedTools = [
  'sandbox_start', 'sandbox_status', 'sandbox_finish', 'sandbox_cancel', 'sandbox_recover',
  'reservation_start', 'reservation_stop', 'reservation_recover', 'sandbox_preflight', 'sandbox_supervisor',
  'worktree_create', 'worktree_list', 'worktree_capacity', 'worktree_candidates', 'worktree_retire',
  'worktree_lock', 'worktree_reconcile',
];

function fingerprintTree(root) {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const rel = relative(root, path).replaceAll('\\', '/');
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else {
        hash.update(rel).update('\0').update(readFileSync(path)).update('\0');
      }
    }
  };
  visit(root);
  return hash.digest('hex');
}

const engine = inspectLocalEngine();
assert.equal(engine.ok, true, engine.reason);
const docker = boundDocker(engine.binding);
const image = JSON.parse(docker('docker', ['image', 'inspect', imageName], { encoding: 'utf8' }))[0];
assert.equal(image.Id, 'sha256:7b1e3139a64121d12e572530974a18b9452967fb4d67516d8cfd9c0e763dd57d');
assert.equal(image.Os, 'linux');
assert.equal(image.Architecture, ({ aarch64: 'arm64', x86_64: 'amd64' })[engine.binding.architecture] ?? engine.binding.architecture);

const cwd = mkdtempSync(join(tmpdir(), 'opencode-v2-plugin-probe-'));
cpSync(fileURLToPath(new URL('./fixtures/docker-desktop/', import.meta.url)), cwd, { recursive: true });
const plugins = join(cwd, '.opencode', 'plugins');
mkdirSync(plugins, { recursive: true });
const runtimeFilesOnly = (source) => !source.split(/[\\/]/).includes('test');
cpSync(fileURLToPath(new URL('../plugins/sandbox-control/', import.meta.url)), join(plugins, 'sandbox-control'), { recursive: true, filter: runtimeFilesOnly });
cpSync(fileURLToPath(new URL('../plugins/worktree-control/', import.meta.url)), join(plugins, 'worktree-control'), { recursive: true, filter: runtimeFilesOnly });
cpSync(fileURLToPath(new URL('../plugins/plugin-v2-adapter.mjs', import.meta.url)), join(plugins, 'plugin-v2-adapter.mjs'));
for (const name of ['sandbox-control', 'worktree-control']) {
  symlinkSync(`${name}/index.js`, join(plugins, `${name}.js`));
}
const configPath = join(cwd, 'opencode-sandbox.json');
const sandboxConfig = JSON.parse(readFileSync(configPath, 'utf8'));
sandboxConfig.testSecrets = [{ name: 'OPENCODE_PASSWORD', value: randomBytes(24).toString('base64url') }];
writeFileSync(configPath, JSON.stringify(sandboxConfig, null, 2));
execFileSync('git', ['init', '-q', cwd]);
const fixtureFingerprint = fingerprintTree(cwd);

const started = await startSandbox({ cwd, worktreePath: cwd, workId: 'AT-188-v2-runtime', workName: 'at188-v2-runtime' });
if (!started.ok) {
  console.log(JSON.stringify({ cwd, started }, null, 2));
  process.exitCode = 1;
} else {
  let observations;
  let runtimeDiagnostics = {};
  try {
    const container = JSON.parse(docker('docker', ['inspect', started.execution.container], { encoding: 'utf8' }))[0];
    const network = JSON.parse(docker('docker', ['network', 'inspect', started.execution.network], { encoding: 'utf8' }))[0];
    runtimeDiagnostics = {
      localAccess: started.localAccess,
      runHelpFlags: [],
      declaredPortBindings: container.HostConfig?.PortBindings,
      networkPorts: container.NetworkSettings?.Ports,
      exposedPorts: container.Config?.ExposedPorts,
      entrypoint: container.Config?.Entrypoint,
      state: container.State?.Status,
    };
    if (container.State?.Status !== 'running') {
      throw new Error('OpenCode V2 container exited before readiness');
    }
    const second = await startSandbox({ cwd, worktreePath: cwd, workId: 'AT-188-v2-second', workName: 'at188-v2-second' });
    const version = docker('docker', ['exec', started.execution.container, 'opencode', '--version'], { encoding: 'utf8' }).trim();
    assert.match(version, /^opencode v?2\.2\.7$/i);
    const runHelp = docker('docker', ['exec', started.execution.container, 'opencode', 'run', '--help'], { encoding: 'utf8' });
    const helpFlags = runHelp.split('\n').filter((line) => /--(dir|directory|server|attach|model)\b/.test(line));
    runtimeDiagnostics.runHelpFlags = helpFlags;
    let pluginList = '';
    try {
      pluginList = docker('docker', ['exec', started.execution.container, 'opencode', 'plugin', 'list', '--server', 'http://127.0.0.1:8080'], { encoding: 'utf8' }).slice(0, 4000);
    } catch (error) { pluginList = String(error.stdout ?? error.stderr ?? error.message).slice(0, 2000); }
    runtimeDiagnostics.pluginList = pluginList;
    for (const args of [['debug', 'config'], ['debug', 'paths']]) {
      let output = '';
      try { output = docker('docker', ['exec', started.execution.container, 'opencode', ...args], { encoding: 'utf8' }).slice(0, 4000); }
      catch (error) { output = String(error.stdout ?? error.stderr ?? error.message).slice(0, 2000); }
      runtimeDiagnostics[`diagnostic_${args[1]}`] = output;
    }
    const hostLogPath = join(cwd, 'evidence', 'opencode.log');
    mkdirSync(join(cwd, 'evidence'), { recursive: true });
    try {
      docker('docker', ['cp', `${started.execution.container}:/tmp/at188-home/.local/share/opencode/log/opencode.log`, hostLogPath], { encoding: 'utf8' });
      const logLines = readFileSync(hostLogPath, 'utf8').split('\n');
      runtimeDiagnostics.pluginLoadErrors = logLines.filter((line) => /plugin|error|failed|sandbox-control|worktree-control/i.test(line)).slice(-60);
    } catch (error) {
      runtimeDiagnostics.pluginLoadErrors = [`OpenCode log unavailable: ${error.message}`];
    }
    let sessionCommandAccepted = false;
    try {
      docker('docker', ['exec', started.execution.container, 'opencode', '--server', 'http://127.0.0.1:8080',
        'run', '--model', 'no-provider/no-model', 'Report the loaded tool names.'], { encoding: 'utf8' });
      sessionCommandAccepted = true;
    } catch { /* no model or provider credentials are configured in this isolated HOME */ }
    let runtimeProbe;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const logs = docker('docker', ['logs', started.execution.container], { encoding: 'utf8' });
      const line = logs.split('\n').findLast((entry) => entry.includes('AT188_TOOL_IDS_LATE '))
        ?? logs.split('\n').findLast((entry) => entry.includes('AT188_TOOL_IDS '));
      runtimeDiagnostics.pluginLogLines = logs.split('\n').filter((entry) => /plugin|AT188_TOOL_IDS|error/i.test(entry)).slice(-30);
      if (line) {
        const marker = line.includes('AT188_TOOL_IDS_LATE ') ? 'AT188_TOOL_IDS_LATE ' : 'AT188_TOOL_IDS ';
        const start = line.indexOf(marker) + marker.length;
        try { runtimeProbe = JSON.parse(line.slice(start)); } catch {}
      }
      if (runtimeProbe && expectedTools.every((name) => runtimeProbe.counts[name] === 1)) break;
      await setTimeout(250);
    }
    assert.ok(runtimeProbe, 'V2 runtime did not invoke the plugin verifier during session initialization');
    const toolIds = runtimeProbe.ids;
    const counts = runtimeProbe.counts;
    runtimeDiagnostics.runtimeProbe = runtimeProbe;
    for (const name of expectedTools) assert.equal(counts[name], 1, `${name} was not registered exactly once`);
    assert.equal(second.ok, false, 'the control allowed a second project execution');

    const host = container.HostConfig;
    assert.equal(host.Privileged, false);
    assert.deepEqual(host.CapDrop, ['ALL']);
    assert.ok(host.SecurityOpt.includes('no-new-privileges'));
    assert.equal(container.Mounts.length, 0);
    assert.equal(network.Internal, true);
    assert.equal(host.NetworkMode, started.execution.network);
    assert.equal(host.PidsLimit, 64);
    assert.equal(host.Memory, 512 * 1024 * 1024);
    assert.equal(host.NanoCpus, 1e9);
    assert.equal(Object.values(host.PortBindings ?? {}).flat().length, 0, 'the fixture unexpectedly requested host ports');
    assert.equal(Object.values(container.NetworkSettings.Ports ?? {}).flat().length, 0, 'the internal network unexpectedly published a port');
    observations = {
      engine: engine.binding,
      image: { id: image.Id, os: image.Os, architecture: image.Architecture, ref: imageName },
      opencodeVersion: version,
      installedConfig: { path: '/fixture/opencode.json', sha256: createHash('sha256').update(readFileSync(join(cwd, 'opencode.json'))).digest('hex'), plugins: JSON.parse(readFileSync(join(cwd, 'opencode.json'), 'utf8')).plugins },
      runHelpFlags: helpFlags,
      toolListingApi: 'V2 plugin context ctx.tool.list()',
      toolIds,
      counts,
      runtimeProbe,
      sessionCommandAccepted,
      fixtureFingerprint,
      capture: started.execution.capture,
      captureFingerprint: fingerprintTree(started.execution.capture.destination),
      isolation: { noMounts: true, noPrivileges: true, capDropAll: true, noNewPrivileges: true,
        internalNetwork: true, noPublishedPorts: true, cpu: 1, memory: host.Memory, pids: host.PidsLimit,
        secondStartRefused: true, independentCapture: started.execution.capture.destination !== cwd },
      result: 'passed',
      differencesFromProduction: ['macOS client controls the local Docker Desktop Linux VM', 'fixture installs plugins into an isolated container HOME'],
    };
  } catch (error) {
    observations = { fixtureFingerprint, capture: started.execution.capture, ...runtimeDiagnostics,
      result: 'failed', failure: error.message };
    process.exitCode = 1;
  } finally {
    mkdirSync(join(cwd, 'evidence'), { recursive: true });
    writeFileSync(join(cwd, 'evidence', 'observations.json'), JSON.stringify(observations ?? { result: 'failed' }, null, 2));
    const closed = finishSandbox(cwd, started.execution.executionId, {
      result: observations?.result ?? 'failed', token: started.token,
      steps: ['Verify local engine binding and exact pinned OpenCode image',
        'Start a V2 session inside the sandbox and observe public ctx.tool.list() results from the fixture plugin',
        'Inspect isolation, save external observations, then close attributable resources'],
      differencesFromProduction: observations?.differencesFromProduction ?? ['macOS client controls the local Docker Desktop Linux VM'],
    });
    assert.equal(closed.cleanup?.ok, true);
    assert.equal(closed.quotaReleased, true);
    const durableEvidence = {
      result: observations?.result ?? 'failed',
      executionId: started.execution.executionId,
      opencodeVersion: observations?.opencodeVersion ?? null,
      image: observations?.image ?? null,
      engine: observations?.engine ?? engine.binding,
      installedConfig: observations?.installedConfig ?? null,
      fixtureFingerprint,
      capture: observations?.capture?.manifest ? {
        fingerprint: observations?.captureFingerprint,
        fileCount: started.execution.capture.manifest.files.length,
        destinationIndependent: started.execution.capture.destination !== cwd,
      } : { fingerprint: started.execution.capture.fingerprint, fileCount: started.execution.capture.manifest.files.length },
      observedToolIds: observations?.toolIds ?? observations?.runtimeProbe?.ids ?? [],
      toolRegistrationCounts: observations?.counts ?? observations?.runtimeProbe?.counts ?? {},
      isolation: observations?.isolation ?? null,
      failure: observations?.failure ?? null,
      closure: { cleanupOk: closed.cleanup?.ok === true, removed: closed.cleanup?.removed ?? [], remaining: closed.cleanup?.remaining ?? [], quotaReleased: closed.quotaReleased === true },
      differencesFromProduction: observations?.differencesFromProduction ?? ['macOS client controls the local Docker Desktop Linux VM'],
    };
    const evidencePath = fileURLToPath(new URL('../openspec/changes/soportar-docker-desktop-local/runtime-evidence.json', import.meta.url));
    writeFileSync(evidencePath, JSON.stringify(durableEvidence, null, 2) + '\n');
    console.log(JSON.stringify({ result: durableEvidence.result, executionId: durableEvidence.executionId,
      opencodeVersion: durableEvidence.opencodeVersion, toolRegistrationCounts: durableEvidence.toolRegistrationCounts,
      isolation: durableEvidence.isolation, evidencePath, closure: durableEvidence.closure }, null, 2));
  }
}
