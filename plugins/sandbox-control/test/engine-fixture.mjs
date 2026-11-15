// Explicit engine evidence for unit fixtures: these stubs never attest a real daemon.
export const fixtureBinding = {
  schemaVersion: 1, endpoint: 'unix:///fixture/docker.sock', platform: 'linux',
  id: 'fixture-daemon', osType: 'linux', operatingSystem: 'Docker Desktop',
  version: '29.7.2', architecture: 'aarch64',
};
export function withEngineStub(run) {
  return {
    env: {}, lstatSync: () => ({ isSocket: () => true }),
    execFileSync(command, args, options) {
      if (args[0] === 'context' && args[1] === 'show') return 'fixture';
      if (args[0] === 'context') return JSON.stringify([{ Endpoints: { docker: { Host: fixtureBinding.endpoint } } }]);
      if (args[0] === 'info') return [fixtureBinding.id, fixtureBinding.osType, fixtureBinding.operatingSystem, fixtureBinding.version, fixtureBinding.architecture].map(x => JSON.stringify(x)).join('|');
      return run(command, args, options);
    },
  };
}
