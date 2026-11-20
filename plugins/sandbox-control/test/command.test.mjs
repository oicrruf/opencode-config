import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSandboxCommand, dispatchSandboxCommand, validateSandboxOperation, SANDBOX_USAGE, registerSandboxCommand } from "../command.mjs";

test("empty command and exact help produce usage without dispatch", async () => {
  let calls = 0;
  const handlers = { release() { calls++; }, build() { calls++; }, rebuild() { calls++; }, transfer() { calls++; } };
  for (const raw of ["", " ", "\t", "help", "  help  "]) {
    const result = await dispatchSandboxCommand(raw, handlers);
    assert.equal(result.help, true);
    assert.equal(result.usage, SANDBOX_USAGE);
  }
  assert.equal(calls, 0);
});

test("release dispatches without operands and transfer/build operations preserve their literal config path", async () => {
  const calls = [];
  const handlers = Object.fromEntries(["release", "build", "rebuild", "transfer"].map((operation) => [operation, (input) => { calls.push({ operation, input }); return { ok: true }; }]));
  assert.equal((await dispatchSandboxCommand("release", handlers)).ok, true);
  assert.equal((await dispatchSandboxCommand("transfer", handlers)).ok, false);
  for (const operation of ["build", "rebuild", "transfer"]) {
    assert.equal((await dispatchSandboxCommand(`${operation} config.json`, handlers)).ok, true);
  }
  assert.deepEqual(calls, [
    { operation: "release", input: {} },
    ...["build", "rebuild", "transfer"].map((operation) => ({ operation, input: { configPath: "config.json" } })),
  ]);
});

test("quotes group spaces without expansion or shell interpretation", () => {
  for (const path of ["config dir/sandbox.json", "literal$HOME/$(ignored);*.json", "./.opencode/sandbox.json"]) {
    for (const quote of ["'", '"']) {
      const result = parseSandboxCommand(`build ${quote}${path}${quote}`);
      assert.equal(result.ok, true);
      assert.equal(result.input.configPath, path);
    }
  }
  assert.equal(parseSandboxCommand('build "apostrophe\'s.json"').input.configPath, "apostrophe's.json");
});

test("invalid invocations cannot call any handler", async () => {
  let calls = 0;
  const handlers = { release() { calls++; }, build() { calls++; }, rebuild() { calls++; }, transfer() { calls++; } };
  for (const raw of [undefined, null, 4, {}, "status", "BUILD cfg.json", "help extra", "release extra", "release --force", "release cfg.json", "transfer", "build --flag", "build --config cfg.json",
    "build cfg.json extra", "rebuild a b", "transfer a b", "transfer --force", "transfer \"unfinished", "build 'unfinished", "build a\"b\"", 'build "a"b', "build ''", 'build " "',
    "build /absolute.json", "build ../outside.json", "build a/../../outside.json", "build C:/config.json", "build C:\\config.json",
    "build a\ntransfer b", "build a\r", "build a\0", 'build "a\tb"']) {
    assert.equal((await dispatchSandboxCommand(raw, handlers)).ok, false, String(raw));
  }
  assert.equal(calls, 0);
});

test("direct tool input rejects caller authority and extra fields", () => {
  for (const field of ["workId", "worktreePath", "sessionId", "token", "cwd", "projectID", "operation"]) {
    assert.equal(validateSandboxOperation("transfer", { configPath: "cfg.json", [field]: "forged" }).ok, false);
  }
  for (const value of [null, [], { configPath: undefined }, { configPath: false }, { configPath: "../x" }]) {
    assert.equal(validateSandboxOperation("build", value).ok, false);
  }
  assert.equal(validateSandboxOperation("start", { configPath: "cfg.json" }).ok, false);
  assert.equal(validateSandboxOperation("build", { configPath: "dir with spaces/cfg.json" }).ok, true);
  assert.equal(validateSandboxOperation("transfer", {}).ok, false);
});

test("unavailable valid handler reports a block and never substitutes another operation", async () => {
  let calls = 0;
  const result = await dispatchSandboxCommand("transfer cfg.json", { build() { calls++; } });
  assert.equal(result.blocked, true);
  assert.equal(calls, 0);
});

test("native V2 help/invalid input replies without model, permission or operation calls", async () => {
  let command;
  const replies = [];
  let mutations = 0;
  const ctx = {
    command: { async transform(edit) { edit({ add(value) { command = value; } }); return { dispose() {} }; } },
    session: { async synthetic(input) { replies.push(input); } },
    permission: { async assert() { mutations++; throw Error("must never be called"); } },
  };
  await registerSandboxCommand(ctx, async () => { mutations++; throw Error("must never execute"); });
  assert.equal(command.name, "sandbox");
  for (const raw of ["", "help", "help extra", "bad", "transfer", 'build "unterminated', "transfer a b"]) {
    await command.execute({ sessionID: "session", prompt: { text: raw } });
  }
  assert.equal(replies.length, 7);
  assert.equal(mutations, 0);
  assert.equal(replies.every((reply) => reply.sessionID === "session" && reply.text.includes(SANDBOX_USAGE)), true);
  assert.equal(replies.every((reply) => reply.resume === false && reply.delivery === "queue"), true);
});

test("native V2 valid dispatch asserts the operation permission before side effects", async () => {
  let command;
  const events = [];
  const ctx = {
    command: { async transform(edit) { edit({ add(value) { command = value; } }); return { dispose() {} }; } },
    permission: { async assert(input) { events.push(input.action); } },
    session: { async synthetic(input) { events.push(input.text); } },
  };
  await registerSandboxCommand(ctx, async (operation, input, sessionID) => { events.push([operation, input, sessionID]); return { ok: true }; });
  await command.execute({ sessionID: "session", prompt: { text: 'transfer "config dir/cfg.json"' } });
  assert.deepEqual(events, ["sandbox_transfer", ["transfer", { configPath: "config dir/cfg.json" }, "session"], '{"ok":true}']);
  ctx.permission.assert = async () => { throw Error("denied"); };
  await assert.rejects(command.execute({ sessionID: "session", prompt: { text: "build cfg.json" } }), /denied/);
  assert.equal(events.length, 3);
  ctx.permission.assert = async (input) => { events.push(input.action); };
  for (const operation of ["build", "rebuild"]) {
    await command.execute({ sessionID: "session", prompt: { text: operation } });
    assert.deepEqual(events.slice(-3), [`sandbox_${operation}`, [operation, {}, "session"], '{"ok":true}']);
  }
});
