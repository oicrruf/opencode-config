import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeSandboxOperation, recoverSandboxTransition } from "../transition.mjs";
import { readReservation, acquireReservation, verifyOwner } from "../reservation.mjs";
import { readTransition } from "../operation.mjs";
import { recordWorktree } from "../../worktree-control/inventory.mjs";
import { withEngineStub } from "./engine-fixture.mjs";
import { finishSandbox, writeExecutionRecord, readExecutionRecord } from "../lifecycle.mjs";

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-transition-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  mkdirSync(join(dir, ".opencode"));
  writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
  const configPath = ".opencode/sandbox.json";
  const config = { dockerfile: "Dockerfile", context: ".", stage: "test" };
  const write = (value = config) => writeFileSync(join(dir, configPath), JSON.stringify(value));
  write();
  recordWorktree(dir, { workId: "AT-200", directory: dir });
  const context = { directory: dir, sessionID: "session-one", projectID: "project", worktree: { async list() { return [{ directory: dir }]; } } };
  const calls = [];
  const deps = withEngineStub((command, args) => { calls.push(args); return ""; });
  const request = (operation, overrides = {}, dependencies = deps) => executeSandboxOperation(operation, { configPath }, { ...context, ...overrides }, dependencies);
  return { dir, context, config, write, configPath, deps, request, calls };
}

test("build binds work, source, session and generation; a second build stays blocked", async (t) => {
  const f = fixture(t);
  const started = await f.request("build");
  assert.equal(started.ok, true, started.reason);
  assert.equal(started.execution.sessionId, "session-one");
  assert.equal(started.execution.projectID, "project");
  assert.equal(started.execution.source.checkout, f.dir);
  const generation = readReservation(f.dir).reservation.generation;
  assert.equal(started.execution.generation, generation);
  f.calls.length = 0;
  assert.equal((await f.request("build")).blocked, true);
  assert.equal(f.calls.length, 0);
});

test("rebuild preserves report and continuous reservation, then starts a distinct successor", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  const oldId = first.execution.executionId;
  const observations = [];
  const deps = withEngineStub((command, args) => {
    observations.push({ args, reservation: readReservation(f.dir).reservation });
    return "";
  });
  const second = await f.request("rebuild", {}, deps);
  assert.equal(second.ok, true, second.reason);
  assert.notEqual(second.execution.executionId, oldId);
  assert.notEqual(second.token, first.token);
  assert.equal(existsSync(second.previousReportPath), true);
  assert.equal(JSON.parse(readFileSync(second.previousReportPath)).executionId, oldId);
  assert.equal(JSON.parse(readFileSync(second.previousReportPath)).approved, false);
  assert.equal(observations.every((entry) => entry.reservation?.scope === "sandbox"), true);
  assert.equal(existsSync(first.execution.capture.destination), false);
  assert.equal(readTransition(f.dir).transition.phase, "running");
  assert.equal(verifyOwner(f.dir, first.token).ok, false);
  assert.equal(finishSandbox(f.dir, oldId, { result: "passed", token: second.token }, deps).ok, false);
});

test("another session must explicitly transfer and never provides the old token", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  const denied = await f.request("rebuild", { sessionID: "session-two" });
  assert.equal(denied.blocked, true);
  assert.equal(readReservation(f.dir).reservation.executionId, first.execution.executionId);
  const transferred = await f.request("transfer", { sessionID: "session-two" });
  assert.equal(transferred.ok, true, transferred.reason);
  assert.equal(transferred.transferred, true);
  assert.equal(transferred.execution.sessionId, "session-two");
  assert.equal(readReservation(f.dir).reservation.sessionId, "session-two");
  assert.equal(verifyOwner(f.dir, first.token).ok, false);
  assert.equal(JSON.stringify(readTransition(f.dir)).includes(first.token), false);
});

test("free transfer builds normally and free rebuild refuses", async (t) => {
  const f = fixture(t);
  assert.equal((await f.request("rebuild")).blocked, true);
  assert.equal((await f.request("transfer")).ok, true);
});

test("manual application and another project identity cannot be transferred", async (t) => {
  const f = fixture(t);
  const reserved = acquireReservation(f.dir, { scope: "application", workId: "AT-200", sessionId: "manual" });
  assert.equal(reserved.ok, true);
  assert.equal((await f.request("transfer")).blocked, true);
  assert.equal(readReservation(f.dir).reservation.scope, "application");
});

test("project mismatch preserves the active sandbox", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  assert.equal((await f.request("transfer", { projectID: "another-project" })).blocked, true);
  assert.equal(readReservation(f.dir).reservation.executionId, first.execution.executionId);
});

test("another managed work and legacy ownership remain blocked without migration", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  recordWorktree(f.dir, { workId: "AT-201", directory: f.dir });
  assert.equal((await f.request("transfer")).blocked, true);
  recordWorktree(f.dir, { workId: "AT-200", directory: f.dir });
  const legacy = { ...first.execution };
  delete legacy.generation;
  writeExecutionRecord(f.dir, legacy);
  const recordFile = join(f.dir, ".opencode/state/sandbox/executions", first.execution.executionId, "execution.json");
  const before = readFileSync(recordFile, "utf8");
  assert.equal((await f.request("transfer")).blocked, true);
  assert.equal(readFileSync(recordFile, "utf8"), before);
});

test("missing replacement dependency blocks before closing the previous run", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  f.write({ ...f.config, dependencies: ["http://missing-fixture"] });
  const replacement = await f.request("rebuild", {}, { ...f.deps, checkDependency: async () => false });
  assert.equal(replacement.ok, false);
  assert.equal(existsSync(first.execution.capture.destination), true);
  assert.equal(readTransition(f.dir).transition, null);
});

test("report failure keeps the old reservation and starts no successor", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  mkdirSync(join(f.dir, ".opencode/state/sandbox/reports", `${first.execution.executionId}.json`), { recursive: true });
  f.calls.length = 0;
  const replacement = await f.request("rebuild");
  assert.equal(replacement.blocked, true);
  assert.equal(readReservation(f.dir).reservation.executionId, first.execution.executionId);
  assert.equal(f.calls.some((args) => args[0] === "build"), false);
  assert.equal(existsSync(first.execution.capture.destination), true);
});

test("incomplete cleanup keeps the old reservation; explicit recovery only closes", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  const dirty = withEngineStub((command, args) => (args[0] === "ps" ? "owned-container" : ""));
  const failed = await f.request("transfer", { sessionID: "session-two" }, dirty);
  assert.equal(failed.blocked, true);
  assert.equal(readReservation(f.dir).reservation.executionId, first.execution.executionId);
  f.calls.length = 0;
  const recovered = await recoverSandboxTransition({ ...f.context, sessionID: "session-two" }, f.deps);
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal(recovered.quotaReleased, true);
  assert.equal(readReservation(f.dir).state, "free");
  assert.equal(f.calls.some((args) => args[0] === "build"), false);
  assert.equal(readTransition(f.dir).transition.phase, "recovered");
});

test("changed config after old closure retains successor reservation for explicit recovery", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  let changed = false;
  const deps = withEngineStub((command, args) => {
    if (args[0] === "ps" && !changed) { changed = true; f.write({ ...f.config, stage: "changed" }); }
    return "";
  });
  const failed = await f.request("transfer", { sessionID: "session-two" }, deps);
  assert.equal(failed.ok, false);
  assert.equal(failed.transitionPending, true);
  assert.notEqual(readReservation(f.dir).reservation.executionId, first.execution.executionId);
  const recovered = await recoverSandboxTransition({ ...f.context, sessionID: "session-two" }, f.deps);
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal(readReservation(f.dir).state, "free");
});

test("invalid direct input cannot access context, tools or filesystem state", async () => {
  const context = new Proxy({}, { get() { throw Error("invalid input must not resolve context"); } });
  for (const input of [{ configPath: "../outside.json" }, { configPath: "valid.json", token: "forged" }]) {
    assert.equal((await executeSandboxOperation("transfer", input, context)).ok, false);
  }
});

for (const phase of ["intent", "closed", "prepared", "successor", "running"]) {
  test(`an OS-process interruption at ${phase} retains evidence/quota and recovers without building`, async (t) => {
    const f = fixture(t);
    const first = await f.request("build");
    assert.equal(first.ok, true, first.reason);
    const transitionUrl = new URL("../transition.mjs", import.meta.url).href;
    const engineUrl = new URL("./engine-fixture.mjs", import.meta.url).href;
    const code = `import {executeSandboxOperation} from ${JSON.stringify(transitionUrl)};
      import {withEngineStub} from ${JSON.stringify(engineUrl)};
      const directory=process.argv[1];
      const context={directory,projectID:"project",sessionID:"session-two",worktree:{async list(){return [{directory}];}}};
      const deps={...withEngineStub(()=>""),onTransitionPhase(phase){if(phase===process.argv[2])process.exit(0);}};
      const result=await executeSandboxOperation("transfer",{configPath:".opencode/sandbox.json"},context,deps);
      process.exit(result.ok?4:5);`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, f.dir, phase], { stdio: ["ignore", "pipe", "pipe"] });
    assert.equal((await once(child, "exit"))[0], 0);
    assert.equal(readReservation(f.dir).state, "held");
    assert.equal(readTransition(f.dir).transition.phase, phase === "prepared" ? "closed" : phase);
    assert.equal(existsSync(join(f.dir, ".opencode/state/sandbox/operation.json")), true);
    f.calls.length = 0;
    const recovered = await recoverSandboxTransition({ ...f.context, sessionID: "session-two" }, f.deps);
    assert.equal(recovered.ok, true, recovered.reason);
    assert.equal(recovered.quotaReleased, true);
    assert.equal(readReservation(f.dir).state, "free");
    assert.equal(f.calls.some((args) => args[0] === "build"), false);
    assert.equal(JSON.stringify(readTransition(f.dir)).includes(first.token), false);
    assert.equal(existsSync(join(f.dir, ".opencode/state/sandbox/reports", `${first.execution.executionId}.json`)), true);
  });
}

test("two processes requesting transfer serialize the entire replacement", { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  f.write({ ...f.config, dependencies: ["http://fixture"] });
  const transitionUrl = new URL("../transition.mjs", import.meta.url).href;
  const engineUrl = new URL("./engine-fixture.mjs", import.meta.url).href;
  const code = `import {executeSandboxOperation} from ${JSON.stringify(transitionUrl)};
    import {withEngineStub} from ${JSON.stringify(engineUrl)};
    const directory=process.argv[1]; let waited=false;
    const context={directory,projectID:"project",sessionID:"child-session",worktree:{async list(){return [{directory}];}}};
    const deps={...withEngineStub(()=>""),async checkDependency(){if(waited)return true;waited=true;process.stdout.write("held\\n");for await(const chunk of process.stdin){break;}return true;}};
    const result=await executeSandboxOperation("transfer",{configPath:".opencode/sandbox.json"},context,deps);
    process.exit(result.ok?0:5);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, f.dir], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exit = once(child, "exit");
  assert.match(String((await once(child.stdout, "data"))[0]), /held/);
  const competitor = await f.request("transfer", { sessionID: "competitor" });
  assert.equal(competitor.blocked, true);
  assert.equal(readReservation(f.dir).reservation.executionId, first.execution.executionId);
  child.stdin.end("continue");
  assert.equal((await exit)[0], 0);
  assert.equal(readReservation(f.dir).reservation.sessionId, "child-session");
});

test("terminal-record write failure retains recovery identity until retry succeeds", async (t) => {
  const f = fixture(t);
  const first = await f.request("build");
  const original = fs.writeFileSync;
  let failed;
  try {
    fs.writeFileSync = function(path, data, options) {
      if (String(path).includes("execution.json.") && typeof data === "string" && JSON.parse(data).phase === "closed") throw Error("injected terminal write failure");
      return original(path, data, options);
    };
    syncBuiltinESMExports();
    failed = await f.request("transfer", { sessionID: "session-two" });
  } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
  assert.equal(failed.ok, false);
  assert.equal(readExecutionRecord(f.dir, first.execution.executionId).ok, true);
  assert.equal(readReservation(f.dir).state, "held");
  const recovered = await recoverSandboxTransition({ ...f.context, sessionID: "session-two" }, f.deps);
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal(readReservation(f.dir).state, "free");
});

test("recovery retries a closed provisional successor after journal persistence fails", async (t) => {
  const f = fixture(t);
  await f.request("build");
  await assert.rejects(f.request("transfer", { sessionID: "session-two" }, { ...f.deps, onTransitionPhase(phase) { if (phase === "prepared") throw Error("interrupt after provisional write"); } }), /interrupt/);
  const successorId = readTransition(f.dir).transition.successorExecutionId;
  const original = fs.writeFileSync;
  try {
    fs.writeFileSync = function(path, data, options) {
      if (String(path).includes("transition.json.") && typeof data === "string" && JSON.parse(data).phase === "recovered") throw Error("injected journal failure");
      return original(path, data, options);
    };
    syncBuiltinESMExports();
    const failed = await recoverSandboxTransition({ ...f.context, sessionID: "session-two" }, f.deps);
    assert.equal(failed.ok, false);
    assert.equal(readExecutionRecord(f.dir, successorId).record.phase, "closed");
  } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
  const recovered = await recoverSandboxTransition({ ...f.context, sessionID: "session-two" }, f.deps);
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal(readReservation(f.dir).state, "free");
});
