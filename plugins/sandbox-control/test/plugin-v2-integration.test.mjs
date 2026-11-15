import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { recordWorktree } from "../../worktree-control/inventory.mjs";
import plugin from "../index.js";

test("V2 reservation_start reconciles the public worktree listing with managed inventory", async () => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-v2-reservation-"));
  const managed = join(root, "managed-worktree");
  mkdirSync(managed);
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  try {
    const recorded = recordWorktree(root, { workId: "work-1", directory: managed, branch: "work-1" });
    assert.equal(recorded.ok, true);

    const tools = [];
    const context = {
      session: { async get() { return { directory: root, projectID: "project-1" }; } },
      worktree: {
        async create() { throw new Error("not used"); },
        async remove() { throw new Error("not used"); },
        async list(input) {
          assert.deepEqual(input, { projectID: "project-1" });
          return [{ name: "work-1", directory: managed, branch: "work-1" }];
        },
      },
      tool: { async transform(edit) { edit({ add: (definition) => tools.push(definition) }); return { dispose() {} }; } },
    };
    await plugin.setup(context);
    const start = tools.find(({ name }) => name === "reservation_start");
    assert.ok(start);
    const result = JSON.parse((await start.execute({ workId: "work-1", executable: "/definitely/missing/opencode-fixture" }, { sessionID: "session-1" })).content);
    assert.equal(result.ok, false);
    assert.match(result.reason, /application could not be started/);
    assert.doesNotMatch(result.reason, /managed worktree control is not available|has no managed worktree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
