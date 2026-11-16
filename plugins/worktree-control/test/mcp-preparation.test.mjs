import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createWorktree } from "../creation.mjs";
import { inspectMcpConfiguration, summarizeMcpConfig } from "../mcp-preparation.mjs";

const documents = (servers) => [{ type: "document", info: { mcp: { servers } } }];

test("effective MCP servers use precedence and never expose substituted config values", () => {
  const result = summarizeMcpConfig([
    ...documents({ alpha: { type: "remote", url: "https://example.invalid", headers: { Authorization: "secret" } } }),
    ...documents({ alpha: { type: "remote", enabled: false, headers: { Authorization: "different-secret" } }, beta: { type: "local" } }),
  ]);
  assert.deepEqual(result, {
    ok: true,
    configPresent: true,
    configured: true,
    servers: [{ name: "alpha", enabled: false }, { name: "beta", enabled: true }],
    connectionStatus: "unknown",
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("configuration inspection is read-only, scoped to the worktree, and leaves connectivity unknown", async () => {
  const calls = [];
  const result = await inspectMcpConfiguration("/managed/worktree", {
    async get(input) {
      calls.push(input);
      return { data: documents({ context7: { type: "remote", enabled: true } }) };
    },
  });
  assert.deepEqual(calls, [{ location: { directory: "/managed/worktree" } }]);
  assert.equal(result.ok, true);
  assert.equal(result.connectionStatus, "unknown");
  assert.deepEqual(result.servers, [{ name: "context7", enabled: true }]);
});

test("unavailable config reader fails closed with a redacted reason", async () => {
  const result = await inspectMcpConfiguration("/managed/worktree", {
    async get() { throw new Error("request included secret-token"); },
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("new worktree remains recorded but is not reported ready if config inspection fails", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "worktree-mcp-"));
  const root = join(fixture, "repo");
  const directory = join(fixture, "managed", "wt");
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  try {
    const api = {
      async list() { return { data: [] }; },
      async create() { mkdirSync(directory, { recursive: true }); return { data: { directory, branch: "feature/test" } }; },
    };
    const result = await createWorktree(
      { workId: "test", worktreeApi: api, cwd: root, mcpConfigApi: { async get() { throw new Error("secret"); } } },
      { actualWorktrees: [] },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.created, true);
    assert.equal(result.readiness.ok, false);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("a repeated worktree request re-inspects MCP configuration from its actual directory", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "worktree-mcp-reuse-"));
  const root = join(fixture, "repo");
  const directory = join(fixture, "managed", "wt");
  mkdirSync(root, { recursive: true });
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  try {
    const api = {
      async create() { throw new Error("existing worktree must not be recreated"); },
      async list() { return { data: [{ directory, branch: "feature/test" }] }; },
    };
    const { writeInventory } = await import("../inventory.mjs");
    writeInventory(root, [{ workId: "test", directory, branch: "feature/test", createdAt: new Date().toISOString() }]);
    const calls = [];
    const result = await createWorktree(
      { workId: "test", worktreeApi: api, cwd: root, mcpConfigApi: { async get(input) { calls.push(input); return { data: [] }; } } },
      { actualWorktrees: [{ directory, branch: "feature/test" }] },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.reused, true);
    assert.deepEqual(calls, [{ location: { directory } }]);
    assert.equal(result.readiness.connectionStatus, "unknown");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
