import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, linkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSandboxConfig, configurationEvidence, verifyConfigurationSnapshot } from "../sandbox-config.mjs";
import { startSandbox, finishSandbox } from "../lifecycle.mjs";
import { readReservation } from "../reservation.mjs";
import { withEngineStub } from "./engine-fixture.mjs";

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-config-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  mkdirSync(join(dir, ".opencode"));
  mkdirSync(join(dir, "config dir"));
  writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
  const config = { dockerfile: "Dockerfile", context: ".", stage: "test" };
  const file = join(dir, "config dir", "sandbox.json");
  const write = (values = config) => writeFileSync(file, JSON.stringify(values));
  write();
  return { dir, config, file, write, relativePath: "config dir/sandbox.json" };
}

test("an explicit path with spaces uses checkout-relative build paths", (t) => {
  const f = fixture(t);
  const result = readSandboxConfig(f.dir, f.relativePath);
  assert.equal(result.ok, true);
  assert.equal(result.config.dockerfile, join(f.dir, "Dockerfile"));
  assert.equal(result.config.relativePath, f.relativePath);
  assert.match(result.config.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(verifyConfigurationSnapshot(f.dir, result.config).ok, true);
});

test("explicit config does not fall back to the main/default declaration", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, ".opencode/sandbox.json"), JSON.stringify({ ...f.config, stage: "default" }));
  assert.equal(readSandboxConfig(f.dir).config.stage, "default");
  assert.equal(readSandboxConfig(f.dir, f.relativePath).config.stage, "test");
  assert.equal(readSandboxConfig(f.dir, "missing.json").ok, false);
});

test("selected configurations cannot escape or follow symlinks", (t) => {
  const f = fixture(t);
  symlinkSync(f.file, join(f.dir, "link.json"));
  symlinkSync(join(f.dir, "config dir"), join(f.dir, "linked-dir"));
  symlinkSync(tmpdir(), join(f.dir, "outside"));
  for (const path of ["../outside.json", f.file, "C:\\config.json", "outside/a.json", "link.json", "linked-dir/sandbox.json", "", 3]) {
    assert.equal(readSandboxConfig(f.dir, path).ok, false, String(path));
  }
});

test("snapshot verification blocks changes, removal and symlink substitution", (t) => {
  const f = fixture(t);
  const original = readSandboxConfig(f.dir, f.relativePath).config;
  f.write({ ...f.config, stage: "different" });
  assert.equal(verifyConfigurationSnapshot(f.dir, original).inconsistent, true);
  rmSync(f.file);
  assert.equal(verifyConfigurationSnapshot(f.dir, original).ok, false);
  writeFileSync(join(f.dir, "substitute.json"), JSON.stringify(f.config));
  symlinkSync(join(f.dir, "substitute.json"), f.file);
  assert.equal(verifyConfigurationSnapshot(f.dir, original).ok, false);
});

test("configuration errors never echo malformed JSON contents", (t) => {
  const f = fixture(t);
  const sentinel = "synthetic-private-value-123";
  writeFileSync(f.file, `{"value":"${sentinel}"`);
  const result = readSandboxConfig(f.dir, f.relativePath);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test("external metadata uses an allowlist, not raw config or URLs", (t) => {
  const f = fixture(t);
  const sentinel = "synthetic-private-value-123";
  f.write({ ...f.config, dependencies: [`postgres://user:${sentinel}@localhost/db`], testSecrets: [{ name: "TEST_VALUE", value: sentinel }],
    arbitrary: sentinel, production: { allowExternalEgress: false, arbitrary: sentinel } });
  const result = readSandboxConfig(f.dir, f.relativePath);
  const evidence = configurationEvidence(result.config);
  assert.equal(JSON.stringify(evidence).includes(sentinel), false);
  assert.equal(evidence.captured, false);
  assert.equal(evidence.parameters.dependencyCount, 1);
  assert.equal(evidence.parameters.testSecretCount, 1);
  assert.equal("dependencies" in evidence.parameters, false);
});

test("lifecycle omits selected JSON and hardlink aliases even with include, and preserves external evidence", async (t) => {
  const f = fixture(t);
  const sentinel = "synthetic-private-value-123";
  f.write({ ...f.config, testSecrets: [{ name: "TEST_VALUE", value: sentinel }], include: [f.relativePath, "config-alias.json"] });
  linkSync(f.file, join(f.dir, "config-alias.json"));
  const deps = withEngineStub(() => "");
  const result = await startSandbox({ workId: "AT-200", workName: "config", worktreePath: f.dir, cwd: f.dir, configPath: f.relativePath }, deps);
  assert.equal(result.ok, true, result.reason);
  assert.equal(existsSync(join(result.execution.capture.destination, f.relativePath)), false);
  assert.equal(existsSync(join(result.execution.capture.destination, "config-alias.json")), false);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(result.execution.configuration.captured, false);
  const closed = finishSandbox(f.dir, result.execution.executionId, { result: "passed", token: result.token }, deps);
  assert.equal(closed.ok, true, closed.reason);
  assert.equal(closed.quotaReleased, true);
  const report = readFileSync(closed.reportPath, "utf8");
  assert.equal(report.includes(sentinel), false);
  assert.equal(JSON.parse(report).configuration.fingerprint, result.execution.configuration.fingerprint);
});

test("a protected filename stays excluded and still yields external config evidence", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, "opencode-sandbox.json"), JSON.stringify(f.config));
  const result = await startSandbox({ workId: "AT-200", worktreePath: f.dir, cwd: f.dir, configPath: "opencode-sandbox.json" }, withEngineStub(() => ""));
  assert.equal(result.ok, true, result.reason);
  assert.equal(existsSync(join(result.execution.capture.destination, "opencode-sandbox.json")), false);
  assert.equal(result.execution.configuration.path, "opencode-sandbox.json");
});

test("configuration changes during capture block before build and release safely", async (t) => {
  const f = fixture(t);
  const calls = [];
  const deps = { ...withEngineStub((command, args) => { calls.push(args); return ""; }),
    onBeforeCaptureCompare() { f.write({ ...f.config, stage: "changed" }); } };
  const result = await startSandbox({ workId: "AT-200", worktreePath: f.dir, cwd: f.dir, configPath: f.relativePath }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.phase, "configuration");
  assert.equal(calls.some((args) => args[0] === "build"), false);
  assert.equal(readReservation(f.dir).state, "free");
});
