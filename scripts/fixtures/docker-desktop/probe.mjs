// Dependency probe only: this does not claim OpenCode plugin loading.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
mkdirSync(process.env.HOME, { recursive: true });
const version = spawnSync('opencode', ['--version'], { encoding: 'utf8', timeout: 10000 });
console.log(JSON.stringify({ kind: 'runtime-prerequisite', platform: process.platform, architecture: process.arch,
  runtimeAvailable: version.status === 0, version: version.status === 0 ? version.stdout.trim() : null,
  blocked: version.status !== 0 ? 'OpenCode Linux executable is unavailable in the declared cached image' : null }));
setInterval(() => {}, 1000);
