import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSandboxSource } from "../source.mjs";
import { recordWorktree } from "../../worktree-control/inventory.mjs";

// These are filesystem/API fixtures, not evidence of an OpenCode runtime
// session or a real linked worktree. No worktree is created by raw Git.
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-source-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = (name) => {
    const path = join(root, name);
    mkdirSync(path);
    execFileSync("git", ["init", "-q", path], { stdio: "ignore" });
    return path;
  };
  const checkout = repo("effective-checkout");
  const api = { async list() { return { data: [{ directory: checkout, branch: "irrelevant" }] }; } };
  const context = { directory: checkout, sessionID: "verified-session", projectID: "verified-project", worktree: api };
  return { checkout, context, repo };
}

test("source uses the exact verified inventory entry and records session identity", async (t) => {
  const { checkout, context } = fixture(t);
  assert.equal(recordWorktree(checkout, { workId: "AT-200", directory: checkout }).ok, true);
  const result = await resolveSandboxSource(context);
  assert.deepEqual(result, {
    ok: true, projectRoot: checkout, worktreePath: checkout,
    workId: "AT-200", workName: "AT-200", sessionId: context.sessionID, projectID: context.projectID,
  });
});

test("a session subdirectory resolves to its effective toplevel", async (t) => {
  const { checkout, context } = fixture(t);
  mkdirSync(join(checkout, "app"));
  recordWorktree(checkout, { workId: "AT-200", directory: checkout });
  const result = await resolveSandboxSource({ ...context, directory: join(checkout, "app") });
  assert.equal(result.ok, true);
  assert.equal(result.worktreePath, checkout);
});

test("a branch or a workId in caller context is not a managed identity", async (t) => {
  const { context } = fixture(t);
  const result = await resolveSandboxSource({ ...context, workId: "AT-200" });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /no unique verified/);
});

test("an inventory entry alone cannot replace a verified public listing", async (t) => {
  const { checkout, context } = fixture(t);
  recordWorktree(checkout, { workId: "AT-200", directory: checkout });
  for (const worktree of [null, { async list() { throw Error("unavailable"); } }, { async list() { return []; } }]) {
    assert.equal((await resolveSandboxSource({ ...context, worktree })).blocked, true);
  }
});

test("a foreign project's listing cannot redirect the source", async (t) => {
  const { checkout, context, repo } = fixture(t);
  const foreign = repo("foreign-checkout");
  recordWorktree(checkout, { workId: "AT-200", directory: checkout });
  const result = await resolveSandboxSource({ ...context, worktree: { async list() { return [{ directory: foreign }]; } } });
  assert.equal(result.blocked, true);
});

test("a corrupt inventory blocks instead of inventing work identity", async (t) => {
  const { checkout, context } = fixture(t);
  recordWorktree(checkout, { workId: "AT-200", directory: checkout });
  writeFileSync(join(checkout, ".opencode/state/worktrees/inventory.json"), "{");
  const result = await resolveSandboxSource(context);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /inventory could not be read/);
});

test("multiple inventory identities for the same checkout are ambiguous", async (t) => {
  const { checkout, context } = fixture(t);
  recordWorktree(checkout, { workId: "AT-200", directory: checkout });
  writeFileSync(join(checkout, ".opencode/state/worktrees/inventory.json"), JSON.stringify({ entries: [
    { workId: "AT-200", directory: checkout }, { workId: "AT-201", directory: checkout },
  ] }));
  assert.equal((await resolveSandboxSource(context)).blocked, true);
});

test("syntactically valid inventory with malformed records blocks without throwing", async (t) => {
  const { checkout, context } = fixture(t);
  recordWorktree(checkout, { workId: "AT-200", directory: checkout });
  for (const entry of [null, {}, { workId: "AT-200", directory: 7 }]) {
    writeFileSync(join(checkout, ".opencode/state/worktrees/inventory.json"), JSON.stringify({ entries: [entry] }));
    assert.equal((await resolveSandboxSource(context)).blocked, true);
  }
});

test("an identity duplicated across listed checkouts is ambiguous", async (t) => {
  const { checkout, context, repo } = fixture(t);
  const other = repo("other");
  recordWorktree(checkout, { workId: "AT-200", directory: checkout });
  recordWorktree(checkout, { workId: "AT-200", directory: other });
  context.worktree = { async list() { return [{ directory: checkout }, { directory: other }]; } };
  const result = await resolveSandboxSource(context);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /ambiguous across checkouts/);
});

test("missing session context blocks before any worktree API call", async () => {
  let calls = 0;
  const worktree = { async list() { calls++; return []; } };
  for (const context of [{}, { sessionID: "s" }, { directory: "/", sessionID: "s" }]) {
    assert.equal((await resolveSandboxSource({ ...context, worktree })).blocked, true);
  }
  assert.equal(calls, 0);
});
