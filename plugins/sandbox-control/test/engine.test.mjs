import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLocalEngine, boundDocker } from '../engine.mjs';
function fixture(extra = {}) {
  const state = { id: 'daemon-1', os: 'linux', system: 'Docker Desktop', ...extra };
  const calls = [];
  const deps = { platform: 'darwin', env: {}, lstatSync: () => ({ isSocket: () => true }), execFileSync(cmd, args, options) {
    calls.push({ cmd, args, env: options?.env });
    if (args[0] === 'context' && args[1] === 'show') return 'desktop-linux';
    if (args[0] === 'context') return JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///local/docker.sock' } } }]);
    if (args[0] === 'info') return [state.id, state.os, state.system, '29.7.2', 'aarch64'].map(x => JSON.stringify(x)).join('|');
    return 'OK';
  }};
  return { state, calls, deps };
}
// Contract 1.1/1.2: only positive endpoint + Linux Desktop metadata admits macOS.
test('macOS Desktop and Linux work, with read-only probes only', () => {
  const f = fixture(); const found = inspectLocalEngine(f.deps); assert.equal(found.ok, true);
  assert(f.calls.every(c => ['context','info'].includes(c.args[0])));
  assert.equal(inspectLocalEngine({ ...f.deps, platform: 'linux' }).ok, true);
  f.state.system = 'Docker Engine';
  const linux = inspectLocalEngine({ ...f.deps, platform: 'linux' });
  assert.equal(linux.ok, true, 'Linux/WSL2 accepts its verified local Linux engine without a Desktop label');
  assert.equal(linux.binding.platform, 'linux');
  assert.equal(inspectLocalEngine({ ...f.deps, platform: 'win32' }).ok, false);
  f.state.system = 'Other engine'; assert.equal(inspectLocalEngine(f.deps).ok, false);
  assert.equal(inspectLocalEngine({ ...f.deps, platform: 'linux' }).ok, true);
  f.state.os = 'windows'; assert.equal(inspectLocalEngine(f.deps).ok, false);
});
// 1.1: host overrides cannot redirect any probe to a remote daemon.
test('remote, malformed, missing and non-socket endpoints fail before engine use', () => {
  const f = fixture();
  for (const endpoint of ['tcp://host:2375','ssh://user@host','http://host','unix://relative','unix:///a/../docker.sock']) {
    f.calls.length = 0; assert.equal(inspectLocalEngine({ ...f.deps, env: { DOCKER_HOST: endpoint } }).ok, false);
    assert.equal(f.calls.length, 0);
  }
  assert.equal(inspectLocalEngine({ ...f.deps, lstatSync: () => ({ isSocket: () => false }) }).ok, false);
  assert.equal(inspectLocalEngine({ ...f.deps, execFileSync: () => '{}' }).ok, false);
});
// 1.1: CLI context override has precedence over the host env as Docker specifies.
test('context precedence and explicit host are resolved without an ambient engine probe', () => {
  const f = fixture();
  let r = inspectLocalEngine({ ...f.deps, env: { DOCKER_CONTEXT: 'desktop-linux', DOCKER_HOST: 'tcp://remote' } });
  assert.equal(r.ok, true); assert.equal(f.calls.find(c => c.args[0] === 'context').args[2], 'desktop-linux');
  f.calls.length = 0;
  r = inspectLocalEngine({ ...f.deps, env: { DOCKER_HOST: 'unix:///explicit.sock' } });
  assert.equal(r.binding.endpoint, 'unix:///explicit.sock'); assert(f.calls.every(c => c.args[0] === 'info'));
});
// 1.1: raw diagnostics may contain connection credentials and must be sanitized.
test('invalid metadata and CLI errors do not disclose raw secrets', () => {
  const f = fixture(); f.state.id = ''; assert.equal(inspectLocalEngine(f.deps).ok, false);
  const secret = 'private-value-never-log';
  const r = inspectLocalEngine({ ...f.deps, execFileSync() { throw new Error(secret); } });
  assert.equal(r.ok, false); assert(!JSON.stringify(r).includes(secret));
});
// 2.2: a new coordinator reuses the binding, not the current ambient context.
test('bound operations pin endpoint, clear overrides and block changed identity', () => {
  const f = fixture(); const binding = inspectLocalEngine(f.deps).binding;
  const run = boundDocker(binding, { ...f.deps, env: { DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'tcp://remote', DOCKER_TLS_VERIFY: '1' } });
  run('docker', ['ps']); const call = f.calls.at(-1);
  assert.equal(call.env.DOCKER_HOST, binding.endpoint); assert.equal(call.env.DOCKER_CONTEXT, undefined); assert.equal(call.env.DOCKER_TLS_VERIFY, undefined);
  f.state.id = 'daemon-2'; const before = f.calls.filter(c => c.args[0] === 'rm').length;
  assert.throws(() => run('docker', ['rm', '-f', 'anything']), /identity changed/);
  assert.equal(f.calls.filter(c => c.args[0] === 'rm').length, before);
  assert.throws(() => boundDocker(null, f.deps), /no verified engine binding/);
});

test('build binding removes remote builder overrides and explicitly selects daemon default builder', async () => {
  const { buildBuildArguments } = await import('../docker-adapter.mjs');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'bound-build-'));
  try {
    writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n');
    const f = fixture();
    const binding = inspectLocalEngine(f.deps).binding;
    const run = boundDocker(binding, { ...f.deps, env: { BUILDX_BUILDER: 'remote-cloud', BUILDKIT_HOST: 'tcp://remote', DOCKER_BUILDKIT: '0' } });
    const build = buildBuildArguments({ captureDir: dir, imageTag: 'test:bound', executionId: 'bound' });
    assert.equal(build.ok, true);
    run('docker', build.args);
    const call = f.calls.at(-1);
    assert.equal(call.args[call.args.indexOf('--builder') + 1], 'default');
    for (const key of ['BUILDX_BUILDER', 'BUILDKIT_HOST', 'DOCKER_BUILDKIT']) assert.equal(call.env[key], undefined);
    assert.equal(call.env.DOCKER_HOST, binding.endpoint);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
