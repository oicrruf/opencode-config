// Verified local Docker transport. No probing operation creates Docker resources.
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';

const INFO = '{{json .ID}}|{{json .OSType}}|{{json .OperatingSystem}}|{{json .ServerVersion}}|{{json .Architecture}}';
const fail = reason => ({ ok: false, blocked: true, reason });
function transport(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///') || /[\r\n\0?#]/.test(endpoint)) return null;
  const socket = endpoint.slice(7);
  if (!isAbsolute(socket) || normalize(socket) !== socket) return null;
  return socket;
}
function environment(env, endpoint) {
  const result = { ...env, DOCKER_HOST: endpoint };
  for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_API_VERSION', 'BUILDX_BUILDER', 'BUILDKIT_HOST', 'DOCKER_BUILDKIT']) delete result[key];
  return result;
}
function metadata(run, env) {
  const raw = String(run('docker', ['info', '--format', INFO], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], env, timeout: 10000 })).trim();
  const parts = raw.split('|').map(part => JSON.parse(part));
  const [id, osType, operatingSystem, version, architecture] = parts;
  if (parts.length !== 5 || !parts.every(x => typeof x === 'string' && x.length > 0 && x.length < 256 && !/[\r\n\0]/.test(x)) || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error('invalid engine metadata');
  return { id, osType, operatingSystem, version, architecture };
}
function socketExists(socket, deps) {
  return (deps.lstatSync ?? lstatSync)(socket).isSocket();
}
export function inspectLocalEngine(deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (!['linux', 'darwin'].includes(platform)) return fail('supported hosts are Linux/WSL2 or macOS with local Docker Desktop');
  const run = deps.execFileSync ?? execFileSync;
  const env = deps.env ?? process.env;
  try {
    let endpoint;
    // Docker's DOCKER_CONTEXT overrides DOCKER_HOST; otherwise use explicit
    // DOCKER_HOST, then the active context reported by the CLI itself.
    if (!env.DOCKER_CONTEXT && env.DOCKER_HOST) endpoint = env.DOCKER_HOST;
    else {
      const context = env.DOCKER_CONTEXT || String(run('docker', ['context', 'show'], { encoding: 'utf8', env, timeout: 10000, stdio: ['ignore','pipe','pipe'] })).trim();
      if (!context || context.startsWith('-') || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(context)) return fail('Docker context identity is invalid');
      const contexts = JSON.parse(String(run('docker', ['context', 'inspect', context], { encoding: 'utf8', env, timeout: 10000, stdio: ['ignore','pipe','pipe'] })));
      if (!Array.isArray(contexts) || contexts.length !== 1) return fail('Docker context identity is ambiguous');
      endpoint = contexts[0]?.Endpoints?.docker?.Host;
    }
    const socket = transport(endpoint);
    if (!socket) return fail('Docker endpoint must be a verified local Unix socket; remote transports are refused');
    if (!socketExists(socket, deps)) return fail('Docker endpoint is not a local socket');
    const engine = metadata(run, environment(env, endpoint));
    if (engine.osType !== 'linux') return fail('the sandbox requires a Linux container engine');
    if (platform === 'darwin' && engine.operatingSystem !== 'Docker Desktop') return fail('macOS requires positively identified local Docker Desktop');
    return { ok: true, binding: { schemaVersion: 1, endpoint, platform, ...engine } };
  } catch {
    // Never echo raw CLI errors: a remote URL or env value may contain secrets.
    return fail('local Docker endpoint or engine metadata could not be verified');
  }
}
export function validBinding(binding) {
  return binding?.schemaVersion === 1 && !!transport(binding.endpoint) && ['linux','darwin'].includes(binding.platform) &&
    typeof binding.id === 'string' && /^[A-Za-z0-9:_-]{1,255}$/.test(binding.id) && binding.osType === 'linux' &&
    (binding.platform !== 'darwin' || binding.operatingSystem === 'Docker Desktop');
}
export function boundDocker(binding, deps = {}) {
  if (!validBinding(binding)) throw new Error('execution has no verified engine binding; preserve resources and reconcile explicitly');
  const run = deps.execFileSync ?? execFileSync;
  const env = environment(deps.env ?? process.env, binding.endpoint);
  function verify() {
    try {
      if (!socketExists(transport(binding.endpoint), deps)) throw new Error('not a socket');
      const current = metadata(run, env);
      if (current.id !== binding.id || current.osType !== binding.osType || current.operatingSystem !== binding.operatingSystem || current.architecture !== binding.architecture) throw new Error('changed');
    } catch { throw new Error('recorded local Docker engine is unavailable or its identity changed; resources and reservation are preserved'); }
  }
  verify();
  return (command, args, options = {}) => {
    if (command !== 'docker') throw new Error('bound executor only accepts Docker operations');
    verify();
    return run('docker', args, { ...options, env, timeout: options.timeout ?? 120000 });
  };
}
