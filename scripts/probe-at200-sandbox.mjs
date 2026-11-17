// AT-200 runtime evidence. Uses only an already-cached pinned image and the
// sandbox control. Does not install dependencies or touch global OpenCode state.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";
import { inspectLocalEngine, boundDocker } from "../plugins/sandbox-control/engine.mjs";
import { executeSandboxOperation } from "../plugins/sandbox-control/transition.mjs";
import { finishSandbox } from "../plugins/sandbox-control/lifecycle.mjs";
import { recordWorktree } from "../plugins/worktree-control/inventory.mjs";

const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== "--command-only")) throw new Error("usage: node scripts/probe-at200-sandbox.mjs [--command-only]");
const commandOnly = flags.includes("--command-only");
const activeEvidence = new URL("../openspec/changes/sandbox-command-safe-rebuild/", import.meta.url);
const archivedEvidence = new URL("../openspec/changes/archive/2026-11-16-sandbox-command-safe-rebuild/", import.meta.url);
const evidenceRoot = existsSync(fileURLToPath(activeEvidence)) ? activeEvidence : archivedEvidence;
if (!existsSync(fileURLToPath(evidenceRoot))) throw new Error("the AT-200 evidence directory is unavailable");
const evidencePath = fileURLToPath(new URL(`${commandOnly ? "runtime-command-evidence" : "runtime-evidence"}.json`, evidenceRoot));
const imageName = "ghcr.io/anomalyco/opencode:2.2.7@sha256:7b1e3139a64121d12e572530974a18b9452967fb4d67516d8cfd9c0e763dd57d";
const evidence = { scope: "AT-200", observations: [], limitations: ["The host controller context uses a fixture project-scoped listing; real V2 loading is observed separately inside the sandbox."] };
const save = () => writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
const engine = inspectLocalEngine();
if (!engine.ok) {
  evidence.result = "blocked"; evidence.blocker = engine.reason; save();
  console.log(JSON.stringify({ result: evidence.result, blocker: evidence.blocker, evidencePath }));
  process.exit(2);
}
const docker = boundDocker(engine.binding);
try {
  const image = JSON.parse(docker("docker", ["image", "inspect", imageName], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
  assert.equal(image.Id, "sha256:7b1e3139a64121d12e572530974a18b9452967fb4d67516d8cfd9c0e763dd57d");
  assert.equal(image.Os, "linux");
  assert.equal(image.Architecture, ({ aarch64: "arm64", x86_64: "amd64" })[engine.binding.architecture] ?? engine.binding.architecture);
} catch {
  evidence.result = "blocked"; evidence.blocker = "the pinned architecture-compatible runtime image is not already available"; save();
  console.log(JSON.stringify({ result: evidence.result, blocker: evidence.blocker, evidencePath }));
  process.exit(2);
}

const cwd = mkdtempSync(join(tmpdir(), "at200-runtime-"));
const fixture = fileURLToPath(new URL("./fixtures/docker-desktop/", import.meta.url));
cpSync(fixture, cwd, { recursive: true });
const plugins = join(cwd, ".opencode/plugins");
mkdirSync(plugins, { recursive: true });
for (const name of ["sandbox-control", "worktree-control"]) {
  cpSync(fileURLToPath(new URL(`../plugins/${name}/`, import.meta.url)), join(plugins, name), { recursive: true, filter: (path) => !path.split(/[\\/]/).includes("test") });
  symlinkSync(`${name}/index.js`, join(plugins, `${name}.js`));
}
cpSync(fileURLToPath(new URL("../plugins/plugin-v2-adapter.mjs", import.meta.url)), join(plugins, "plugin-v2-adapter.mjs"));
const configuration = JSON.parse(readFileSync(join(cwd, "opencode-sandbox.json")));
configuration.testSecrets = [{ name: "OPENCODE_PASSWORD", value: randomBytes(24).toString("base64url") }];
writeFileSync(join(cwd, "opencode-sandbox.json"), JSON.stringify(configuration));
// The command is registered by the copied plugin, with no same-name Markdown
// template. The selected control JSON remains excluded from the build capture.
execFileSync("git", ["init", "-q", cwd], { stdio: "ignore" });
recordWorktree(cwd, { workId: "AT-200-runtime", directory: cwd });
const context = { directory: cwd, projectID: "fixture-project", sessionID: "fixture-owner", worktree: { async list() { return [{ directory: cwd }]; } } };
let active;
evidence.engine = engine.binding;
evidence.result = "failed";
try {
  for (const operation of commandOnly ? ["build"] : ["build", "rebuild", "transfer"]) {
    const previous = active;
    const started = await executeSandboxOperation(operation, { configPath: "opencode-sandbox.json" }, { ...context, sessionID: operation === "transfer" ? "fixture-new-owner" : "fixture-owner" });
    if (started.token) active = started;
    assert.equal(started.ok, true, started.reason);
    assert.equal(started.execution.configuration.captured, false);
    const container = JSON.parse(docker("docker", ["inspect", started.execution.container], { encoding: "utf8" }))[0];
    const network = JSON.parse(docker("docker", ["network", "inspect", started.execution.network], { encoding: "utf8" }))[0];
    assert.equal(container.HostConfig.Privileged, false);
    assert.deepEqual(container.HostConfig.CapDrop, ["ALL"]);
    assert.ok(container.HostConfig.SecurityOpt.includes("no-new-privileges"));
    assert.equal(container.Mounts.length, 0);
    assert.equal(network.Internal, true);
    assert.equal(container.HostConfig.NetworkMode, started.execution.network);
    assert.equal((container.HostConfig.CapAdd ?? []).length, 0);
    assert.equal((container.HostConfig.Devices ?? []).length, 0);
    assert.notEqual(container.HostConfig.PidMode, "host");
    assert.notEqual(container.HostConfig.IpcMode, "host");
    assert.ok(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0 && container.HostConfig.PidsLimit > 0);
    assert.equal(Object.values(container.HostConfig.PortBindings ?? {}).flat().length, 0);
    const second = await executeSandboxOperation("build", { configPath: "opencode-sandbox.json" }, context);
    assert.equal(second.ok, false);
    evidence.observations.push({ operation, executionId: started.execution.executionId,
      previousExecutionId: started.previousExecutionId ?? null, previousReportPath: started.previousReportPath ?? null,
      configuration: started.execution.configuration, secondStartRefused: true,
      isolation: { noMounts: true, noPrivileges: true, internalNetwork: true, noHostNetwork: true, noAddedCapabilities: true,
        noDevices: true, noHostPidOrIpc: true, noPublishedPorts: true, capDropAll: true, noNewPrivileges: true,
        memory: container.HostConfig.Memory, nanoCpus: container.HostConfig.NanoCpus, pids: container.HostConfig.PidsLimit },
      previousReportPreserved: !previous || Boolean(started.previousReportPath),
      previousReport: started.previousReportPath ? JSON.parse(readFileSync(started.previousReportPath, "utf8")) : null,
    });
    console.log(JSON.stringify({ operation, executionId: started.execution.executionId, isolated: true }));
  }

  // Create a session through the public API, without submitting a model prompt.
  try {
    const output = docker("docker", ["exec", active.execution.container, "opencode", "--server", "http://127.0.0.1:8080", "api", "session.create", "--data", '{"title":"AT-200 bootstrap","location":{"directory":"/fixture"}}'], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
    const created = JSON.parse(output);
    evidence.bootstrap = { ok: true, directory: (created.data ?? created).location?.directory ?? null };
    docker("docker", ["exec", active.execution.container, "opencode", "--server", "http://127.0.0.1:8080", "api", "command.list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
  } catch (error) {
    evidence.bootstrap = { ok: false, code: error.status ?? null,
      stdout: String(error.stdout ?? "").replaceAll(configuration.testSecrets[0].value, "[redacted]").slice(0, 3000),
      stderr: String(error.stderr ?? "").replaceAll(configuration.testSecrets[0].value, "[redacted]").slice(0, 3000) };
  }
  let probe;
  for (let attempt = 0; attempt < 40; attempt++) {
    const logs = docker("docker", ["logs", active.execution.container], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const line = logs.split("\n").findLast((entry) => entry.includes("AT188_TOOL_IDS_LATE ")) ?? logs.split("\n").findLast((entry) => entry.includes("AT188_TOOL_IDS "));
    if (line) { const marker = line.includes("AT188_TOOL_IDS_LATE ") ? "AT188_TOOL_IDS_LATE " : "AT188_TOOL_IDS "; try { probe = JSON.parse(line.slice(line.indexOf(marker) + marker.length)); } catch { /* incomplete marker */ } }
    if (probe && Object.values(probe.counts).every((count) => count === 1)) break;
    await setTimeout(250);
  }
  assert.ok(probe, "no runtime V2 tool marker was observed");
  for (const name of ["sandbox_build", "sandbox_rebuild", "sandbox_transfer", "sandbox_recover_transition"]) assert.equal(probe.counts[name], 1);
  evidence.v2ToolRegistrationCounts = probe.counts;
  let commandProof;
  for (let attempt = 0; attempt < 40; attempt++) {
    const logs = docker("docker", ["logs", active.execution.container], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const line = logs.split("\n").findLast((entry) => entry.includes("AT200_COMMAND_PROOF "));
    const failure = logs.split("\n").findLast((entry) => entry.includes("AT200_COMMAND_PROOF_ERROR "));
    if (failure) {
      const marker = "AT200_COMMAND_PROOF_ERROR ";
      try { evidence.commandError = JSON.parse(failure.slice(failure.indexOf(marker) + marker.length)); } catch { /* no raw log contents */ }
      throw new Error("the native V2 command probe could not execute");
    }
    if (line) { try { commandProof = JSON.parse(line.slice(line.indexOf("AT200_COMMAND_PROOF ") + "AT200_COMMAND_PROOF ".length)); } catch { /* incomplete log line */ } }
    if (commandProof) break;
    await setTimeout(250);
  }
  assert.ok(commandProof, "the native command proof was not observed");
  evidence.commandProof = commandProof;
  assert.equal(commandProof.count, 8);
  assert.equal(commandProof.toolCalls, 0);
  assert.equal(commandProof.modelCalls, 0);
  assert.equal(commandProof.usageSeen, true);
  assert.equal(commandProof.invalidSeen, true);
  assert.equal(commandProof.syntheticSeen, true);
  evidence.result = "passed";
} catch (error) {
  evidence.result = "failed";
  // Preserve concise assertion messages only, not CLI stderr or model output.
  evidence.failure = error.code === "ERR_ASSERTION" ? error.message : "the runtime operation failed; inspect retained execution state";
  process.exitCode = 1;
} finally {
  save(); // External observations exist before any teardown.
  if (active?.token && active?.execution?.executionId) {
    const closed = finishSandbox(cwd, active.execution.executionId, { token: active.token,
      result: evidence.result, steps: ["AT-200 real build, rebuild, transfer, V2 registration and native command proof"],
      differencesFromProduction: ["fixture session/listing on controller; OpenCode V2 and application run inside isolated Docker Desktop Linux runtime"] });
    evidence.closure = { ok: closed.cleanup?.ok === true, quotaReleased: closed.quotaReleased === true, reportPath: closed.reportPath ?? null };
    if (evidence.closure.ok && evidence.closure.quotaReleased) {
      evidence.sandboxReport = JSON.parse(readFileSync(closed.reportPath, "utf8"));
      save();
      rmSync(cwd, { recursive: true, force: true });
    } else { evidence.retainedState = cwd; save(); process.exitCode = 1; }
  } else { evidence.retainedState = cwd; save(); }
  console.log(JSON.stringify({ result: evidence.result, blocker: evidence.blocker ?? null, failure: evidence.failure ?? null, closure: evidence.closure ?? null, evidencePath, retainedState: evidence.retainedState ?? null }));
  if (evidence.result === "blocked" && !process.exitCode) process.exitCode = 2;
}
