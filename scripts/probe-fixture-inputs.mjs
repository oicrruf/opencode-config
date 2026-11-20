// Managed runtime smoke test; no WordPress, shared database or remote access.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectLocalEngine, boundDocker } from "../plugins/sandbox-control/engine.mjs";
import { startSandbox, finishSandbox } from "../plugins/sandbox-control/lifecycle.mjs";

const image = "alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b";
const engine = inspectLocalEngine();
if (!engine.ok) throw new Error("verified local engine unavailable");
const docker = boundDocker(engine.binding);
let base;
try {
  base = JSON.parse(docker("docker", ["image", "inspect", image], { encoding: "utf8" }))[0];
} catch {
  console.log(JSON.stringify({ result: "blocked", reason: "pinned Alpine image is not cached; no pull attempted" }));
  process.exit(2);
}
assert.equal(base.Os, "linux");
assert.equal(base.Architecture, { aarch64: "arm64", x86_64: "amd64" }[engine.binding.architecture]
  ?? engine.binding.architecture);
const cwd = mkdtempSync(join(tmpdir(), "isolated-fixture-inputs-"));
execFileSync("git", ["init", "-q", cwd]);
mkdirSync(join(cwd, "fixture"));
writeFileSync(join(cwd, "fixture", "Dockerfile"),
  `FROM ${image} AS probe\nCOPY fixture/marker.txt /marker.txt\n` +
  `RUN test "$(cat /marker.txt)" = fixture-only\nCMD ["sleep", "3600"]\n`);
writeFileSync(join(cwd, "fixture", "marker.txt"), "fixture-only\n");
// Deliberately credential-shaped synthetic data, never selected or copied.
writeFileSync(join(cwd, "negative-fixture.txt"), 'password="fixture-only-not-a-real-secret"\n');
const config = {
  dockerfile: "fixture/Dockerfile", context: ".", stage: "probe",
  fixtureInputs: ["fixture/Dockerfile", "fixture/marker.txt"],
  production: { allowExternalEgress: false }, ports: [],
  limits: { cpus: "1", memory: "128m", pids: 32 },
};
writeFileSync(join(cwd, "opencode-sandbox.json"), JSON.stringify({
  ...config, fixtureInputs: [...config.fixtureInputs, "negative-fixture.txt"],
}));
const rejected = await startSandbox({
  cwd, worktreePath: cwd, workId: "fixture-inputs-negative", workName: "fixture-inputs-negative",
});
if (rejected.ok) {
  const closed = finishSandbox(cwd, rejected.execution.executionId, {
    token: rejected.token, result: "failed",
    steps: ["Negative selected-credential test unexpectedly started; close through managed control"],
    differencesFromProduction: ["Synthetic negative fixture only"],
  });
  console.log(JSON.stringify({ result: "failed", cwd, reportPath: closed.reportPath,
    quotaReleased: closed.quotaReleased }));
}
assert.equal(rejected.ok, false, "a selected secret-shaped input was admitted");
assert.equal(rejected.phase, "capture");
assert.equal(rejected.quotaReleased, true);
assert.equal(rejected.resourcesKept, false);
writeFileSync(join(cwd, "opencode-sandbox.json"), JSON.stringify(config));
const started = await startSandbox({
  cwd, worktreePath: cwd, workId: "fixture-inputs-smoke", workName: "fixture-inputs-smoke",
});
if (!started.ok) {
  console.log(JSON.stringify({ result: "blocked", cwd, reason: started.reason,
    phase: started.phase, resourcesKept: started.resourcesKept, quotaReleased: started.quotaReleased }));
  process.exit(2);
}
let result = "failed";
let observations;
try {
  const container = JSON.parse(docker("docker", ["inspect", started.execution.container], { encoding: "utf8" }))[0];
  const network = JSON.parse(docker("docker", ["network", "inspect", started.execution.network], { encoding: "utf8" }))[0];
  assert.equal(container.State.Running, true);
  assert.equal(container.Mounts.length, 0);
  assert.equal(container.HostConfig.Privileged, false);
  assert.deepEqual(container.HostConfig.CapDrop, ["ALL"]);
  assert.ok(container.HostConfig.SecurityOpt.includes("no-new-privileges"));
  assert.equal(network.Internal, true);
  assert.equal(Object.values(container.HostConfig.PortBindings ?? {}).flat().length, 0);
  assert.equal(Object.values(container.NetworkSettings.Ports ?? {}).flat().length, 0);
  assert.equal(docker("docker", ["exec", started.execution.container, "cat", "/marker.txt"],
    { encoding: "utf8" }).trim(), "fixture-only");
  const files = started.execution.capture.manifest.files.map(file => file.rel ?? file.path).sort();
  assert.deepEqual(files, ["fixture/Dockerfile", "fixture/marker.txt"]);
  observations = { selectedCredentialRefused: true, noHostMounts: true, noPorts: true, internalNetwork: true,
    noPrivileges: true, selectedFiles: files, pinnedImage: image };
  result = "passed";
} finally {
  const closed = finishSandbox(cwd, started.execution.executionId, {
    token: started.token, result,
    steps: ["Build exact selected capture with cached pinned image and no build network",
      "Inspect no host mounts/ports, internal runtime network and least privilege",
      "Verify selected marker and exact manifest; preserve evidence then close managed resources"],
    differencesFromProduction: ["Synthetic Alpine fixture only; no PHP, WordPress or Polylang acceptance"],
  });
  const evidence = { result, observations, reportPath: closed.reportPath,
    cleanupOk: closed.cleanup?.ok === true, quotaReleased: closed.quotaReleased === true };
  writeFileSync(join(cwd, "observations.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...evidence, cwd }, null, 2));
  assert.equal(closed.cleanup?.ok, true, "managed cleanup incomplete; retain fixture and report");
  assert.equal(closed.quotaReleased, true);
}
