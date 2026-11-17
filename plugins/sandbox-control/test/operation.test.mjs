import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSandboxOperation, withSandboxRecovery, writeTransition, readTransition } from "../operation.mjs";
import { startSandbox, finishSandbox, cancelSandbox, recoverSandbox, writeExecutionRecord } from "../lifecycle.mjs";
import { acquireReservation, readReservation, verifyOwner } from "../reservation.mjs";
import { withEngineStub } from "./engine-fixture.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-operation-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  return { dir, lock: join(dir, ".opencode/state/sandbox/operation.json"), journal: join(dir, ".opencode/state/sandbox/transition.json") };
}

test("operation authority is private, reentrant and released after synchronous work", (t) => {
  const f = fixture(t);
  const result = withSandboxOperation(f.dir, "outer", () => {
    assert.equal(existsSync(f.lock), true);
    return withSandboxOperation(f.dir, "inner", () => ({ ok: true }));
  });
  assert.equal(result.ok, true);
  assert.equal(existsSync(f.lock), false);
});

test("concurrent async callers in one process cannot share another caller's authority", async (t) => {
  const f = fixture(t);
  let finish;
  const held = withSandboxOperation(f.dir, "held", () => new Promise((resolve) => { finish = resolve; }));
  let mutated = false;
  assert.equal(withSandboxOperation(f.dir, "competitor", () => { mutated = true; }).blocked, true);
  assert.equal(mutated, false);
  finish({ ok: true });
  assert.equal((await held).ok, true);
  assert.equal(existsSync(f.lock), false);
});

test("another OS process cannot mutate while the operation is held", async (t) => {
  const f = fixture(t);
  const moduleUrl = new URL("../operation.mjs", import.meta.url).href;
  const code = `import {withSandboxOperation} from ${JSON.stringify(moduleUrl)}; withSandboxOperation(process.argv[1], "child", async()=>{process.stdout.write("held\\n"); for await (const chunk of process.stdin) {break;} return {ok:true};});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, f.dir], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exit = once(child, "exit");
  const [output] = await once(child.stdout, "data");
  assert.match(String(output), /held/);
  const denied = withSandboxOperation(f.dir, "parent", () => { throw Error("must never run"); });
  assert.equal(denied.blocked, true);
  child.stdin.end("finish");
  assert.equal((await exit)[0], 0);
  assert.equal(withSandboxOperation(f.dir, "after", () => ({ ok: true })).ok, true);
});

test("unknown or ancient lock records are preserved, never stolen by age", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, ".opencode/state/sandbox"), { recursive: true });
  for (const content of ["{", JSON.stringify({ schemaVersion: 1, operationId: "unknown", pid: 999999999, startedAt: "1970-01-01" })]) {
    writeFileSync(f.lock, content);
    assert.equal(withSandboxOperation(f.dir, "attempt", () => ({ ok: true })).blocked, true);
    assert.equal(readFileSync(f.lock, "utf8"), content);
  }
});

test("exceptions release only the owned operation lock", async (t) => {
  const f = fixture(t);
  assert.throws(() => withSandboxOperation(f.dir, "throw", () => { throw Error("fixture"); }), /fixture/);
  assert.equal(existsSync(f.lock), false);
  await assert.rejects(withSandboxOperation(f.dir, "reject", async () => { throw Error("fixture"); }), /fixture/);
  assert.equal(existsSync(f.lock), false);
});

test("transition journal is versioned, atomic, secret-free and requires exclusive ownership", (t) => {
  const f = fixture(t);
  const record = { phase: "intent", workId: "AT-200", sessionId: "session", worktreePath: f.dir,
    previousExecutionId: "old", previousGeneration: "generation-1", successorExecutionId: "new", successorGeneration: "generation-2" };
  assert.equal(writeTransition(f.dir, record).blocked, true);
  withSandboxOperation(f.dir, "transition", () => {
    assert.equal(writeTransition(f.dir, { ...record, token: "not-persisted" }).ok, true);
    const previous = readFileSync(f.journal, "utf8");
    assert.equal(previous.includes("not-persisted"), false);
    assert.equal(writeTransition(f.dir, { ...record, phase: "bad" }).blocked, true);
    assert.equal(readFileSync(f.journal, "utf8"), previous);
    assert.equal(writeTransition(f.dir, { ...record, phase: "closed" }).ok, true);
    return { ok: true };
  });
  assert.equal(readTransition(f.dir).transition.phase, "closed");
  assert.equal(readTransition(f.dir).transition.schemaVersion, 1);
  assert.equal(existsSync(f.lock), false);
});

test("unsafe state links and corrupt journals block without changing outside files", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, ".opencode/state/sandbox"), { recursive: true });
  writeFileSync(f.journal, "{");
  assert.equal(readTransition(f.dir).blocked, true);
  rmSync(join(f.dir, ".opencode/state/sandbox"), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "sandbox-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(f.dir, ".opencode/state/sandbox"));
  assert.equal(withSandboxOperation(f.dir, "unsafe", () => ({ ok: true })).blocked, true);
  assert.equal(existsSync(join(outside, "operation.json")), false);
});

test("legacy mutators and manual starts cannot enter a pending sandbox operation", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, ".opencode"));
  writeFileSync(join(f.dir, "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(f.dir, ".opencode/sandbox.json"), JSON.stringify({ dockerfile: "Dockerfile", context: ".", stage: "test", dependencies: ["http://fixture"] }));
  let permit;
  const deps = { ...withEngineStub(() => ""), checkDependency: () => new Promise((resolve) => { permit = resolve; }) };
  const first = startSandbox({ cwd: f.dir, worktreePath: f.dir, workId: "AT-200", sessionId: "session" }, deps);
  assert.equal(typeof permit, "function");
  for (const attempt of [
    () => acquireReservation(f.dir, { workId: "manual", scope: "application" }),
    () => finishSandbox(f.dir, "other", { result: "passed", token: "wrong" }, deps),
    () => cancelSandbox(f.dir, "other", { token: "wrong" }, deps),
    () => recoverSandbox(f.dir, "other", { token: "wrong", ...deps }),
  ]) assert.equal(attempt().blocked, true);
  permit(true);
  const started = await first;
  assert.equal(started.ok, true, started.reason);
  assert.equal(started.execution.generation, readReservation(f.dir).reservation.generation);
  assert.equal(readReservation(f.dir).reservation.schemaVersion, 2);
  const closed = finishSandbox(f.dir, started.execution.executionId, { result: "passed", token: started.token }, deps);
  assert.equal(closed.quotaReleased, true);
});

test("a current token cannot close another execution or an obsolete generation", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, ".opencode"));
  writeFileSync(join(f.dir, "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(f.dir, ".opencode/sandbox.json"), JSON.stringify({ dockerfile: "Dockerfile", context: ".", stage: "test" }));
  const calls = [];
  const deps = withEngineStub((command, args) => { calls.push(args); return ""; });
  const started = await startSandbox({ cwd: f.dir, worktreePath: f.dir, workId: "AT-200", sessionId: "session" }, deps);
  assert.equal(started.ok, true, started.reason);
  assert.equal(verifyOwner(f.dir, started.token, { generation: "obsolete" }).ok, false);
  const other = { ...started.execution, executionId: "old-execution", generation: "obsolete" };
  writeExecutionRecord(f.dir, other);
  calls.length = 0;
  for (const attempt of [
    () => finishSandbox(f.dir, other.executionId, { result: "passed", token: started.token }, deps),
    () => cancelSandbox(f.dir, other.executionId, { token: started.token }, deps),
    () => recoverSandbox(f.dir, other.executionId, { ...deps, token: started.token }),
  ]) assert.equal(attempt().ok, false);
  assert.equal(calls.length, 0);
  assert.equal(readReservation(f.dir).reservation.executionId, started.execution.executionId);
});

test("explicit recovery can replace a dead operation owner but never a live one", async (t) => {
  const f = fixture(t);
  withSandboxOperation(f.dir, "alive", () => {
    assert.equal(withSandboxRecovery(f.dir, () => ({ ok: true })).blocked, true);
    return { ok: true };
  });
  const moduleUrl = new URL("../operation.mjs", import.meta.url).href;
  const code = `import {withSandboxOperation} from ${JSON.stringify(moduleUrl)}; withSandboxOperation(process.argv[1], "interrupted", ()=>process.exit(0));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, f.dir]);
  assert.equal((await once(child, "exit"))[0], 0);
  assert.equal(existsSync(f.lock), true);
  assert.equal(withSandboxOperation(f.dir, "ordinary", () => ({ ok: true })).blocked, true);
  assert.equal(withSandboxRecovery(f.dir, () => ({ ok: true })).ok, true);
  assert.equal(existsSync(f.lock), false);
});
