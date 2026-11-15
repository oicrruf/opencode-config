import test from "node:test";
import assert from "node:assert/strict";
import { adaptV2WorktreeApi, registerV2Tools, toolInputSchema } from "./plugin-v2-adapter.mjs";

test("V2 tool schema preserves required fields and prevents undeclared input", () => {
  assert.deepEqual(toolInputSchema({ id: { type: "string", description: "identifier", required: true }, values: { type: "array" } }), {
    type: "object",
    properties: { id: { type: "string", description: "identifier" }, values: { type: "array", items: { type: "string" } } },
    required: ["id"],
    additionalProperties: false,
  });
});

test("V2 tools resolve the active session directory and project instead of plugin location", async () => {
  const added = [];
  let disposed = 0;
  const worktreeCalls = [];
  const ctx = {
    location: { directory: "/global/opencode", project: { id: "global-project" } },
    session: { async get(input) {
      assert.deepEqual(input, { sessionID: "session-1" });
      return { directory: "/session/worktree", projectID: "session-project" };
    } },
    worktree: {
      async create(input) { worktreeCalls.push(["create", input]); return { directory: "/session/worktrees/task" }; },
      async list(input) { worktreeCalls.push(["list", input]); return []; },
      async remove(input) { worktreeCalls.push(["remove", input]); },
    },
    tool: { async transform(edit) { edit({ add: (tool) => added.push(tool) }); return { dispose: async () => disposed++ }; } },
  };
  const unregister = await registerV2Tools(ctx, "test.plugin", async () => ({ tool: {
    sample: { description: "sample tool", args: { value: { type: "string" } }, async execute(input, context) {
      const created = await context.worktree.create({ name: input.value, branch: "topic" });
      return { input, directory: context.directory, projectID: context.projectID, created };
    } },
  } }), { worktree: true });
  assert.equal(added.length, 1);
  assert.equal(added[0].name, "sample");
  assert.deepEqual(await added[0].execute({ value: "ok" }, { sessionID: "session-1" }), {
    content: JSON.stringify({ input: { value: "ok" }, directory: "/session/worktree", projectID: "session-project", created: { directory: "/session/worktrees/task" } }),
  });
  assert.deepEqual(worktreeCalls, [["create", { projectID: "session-project", name: "ok", branch: "topic" }]]);
  await unregister();
  assert.equal(disposed, 1);
});

test("V2 tools fail closed when the active session identity is missing", async () => {
  const added = [];
  let executed = false;
  const ctx = {
    location: { directory: "/global/opencode", project: { id: "global-project" } },
    session: { async get() { throw new Error("missing session"); } },
    tool: { async transform(edit) { edit({ add: (tool) => added.push(tool) }); return { dispose() {} }; } },
  };
  await registerV2Tools(ctx, "test.plugin", async () => ({ tool: {
    sample: { description: "sample tool", args: {}, async execute() { executed = true; return "unsafe"; } },
  } }));
  assert.deepEqual(await added[0].execute({}, { sessionID: "missing" }), {
    content: JSON.stringify({ ok: false, blocked: true, reason: "the active session context could not be read" }),
  });
  assert.equal(executed, false);
});

test("V2 worktree adapter binds project identity and never invents missing operations", async () => {
  const calls = [];
  const api = {
    async create(input) { calls.push(["create", input]); return { directory: "/worktree" }; },
    async list(input) { calls.push(["list", input]); return [{ directory: "/worktree" }]; },
    async remove(input) { calls.push(["remove", input]); return true; },
  };
  const adapted = adaptV2WorktreeApi(api, "project-id");
  assert.equal(adapted !== null, true);
  assert.deepEqual(await adapted.create({ name: "task", branch: "task-branch" }), { directory: "/worktree" });
  assert.deepEqual(await adapted.list({ directory: "/project" }), { data: [{ directory: "/worktree" }] });
  assert.deepEqual(await adapted.remove({ directory: "/worktree" }), { data: true });
  assert.deepEqual(calls, [
    ["create", { projectID: "project-id", name: "task", branch: "task-branch" }],
    ["list", { projectID: "project-id" }],
    ["remove", { projectID: "project-id", directory: "/worktree", force: false }],
  ]);
  assert.equal(adaptV2WorktreeApi({ create() {}, list() {} }, "project-id"), null);
});
