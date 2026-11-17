import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { recordWorktree } from "../../worktree-control/inventory.mjs";
import plugin, { SandboxControlPlugin } from "../index.js";
import { registerV2Tools } from "../../plugin-v2-adapter.mjs";
import { withEngineStub } from "./engine-fixture.mjs";
import { readReservation } from "../reservation.mjs";

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
      command: { async transform(edit) { edit({ add() {} }); return { dispose() {} }; } },
      permission: { async assert() {} },
      session: { async get() { return { directory: root, projectID: "project-1" }; }, async synthetic() {} },
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

test("V2 new tools register once and use only verified session/project context", async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-v2-command-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", directory], { stdio: "ignore" });
  mkdirSync(join(directory, ".opencode"));
  writeFileSync(join(directory, "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(directory, ".opencode/sandbox.json"), JSON.stringify({ dockerfile: "Dockerfile", context: ".", stage: "test" }));
  recordWorktree(directory, { workId: "AT-200", directory });
  const tools = [];
  let sessionReads = 0;
  let worktreeReads = 0;
  let denyRelease = false;
  let denyTransfer = false;
  const context = {
    permission: { async assert(input) {
      assert.equal(input.sessionID, "real-session");
      assert.ok(["sandbox_build", "sandbox_release", "sandbox_transfer"].includes(input.action));
      if (denyRelease && input.action === "sandbox_release") throw new Error("permission denied");
      if (denyTransfer && input.action === "sandbox_transfer") throw new Error("permission denied");
    } },
    session: { async get({ sessionID }) { sessionReads++; assert.equal(sessionID, "real-session"); return { directory, projectID: "real-project" }; } },
    worktree: { async create() {}, async remove() {}, async list(input) { worktreeReads++; assert.deepEqual(input, { projectID: "real-project" }); return [{ directory }]; } },
    tool: { async transform(edit) { edit({ add: (definition) => tools.push(definition) }); return { dispose() {} }; } },
  };
  await registerV2Tools(context, "fixture", () => SandboxControlPlugin(withEngineStub(() => "")), { worktree: true });
  for (const name of ["sandbox_build", "sandbox_rebuild", "sandbox_transfer", "sandbox_release", "sandbox_recover_transition"]) {
    assert.equal(tools.filter((definition) => definition.name === name).length, 1);
  }
  const build = tools.find((definition) => definition.name === "sandbox_build");
  const release = tools.find((definition) => definition.name === "sandbox_release");
  const transfer = tools.find((definition) => definition.name === "sandbox_transfer");
  assert.deepEqual(build.input.required, ["configPath"]);
  assert.equal(build.input.additionalProperties, false);
  assert.deepEqual(release.input.properties, {});
  assert.deepEqual(release.input.required, []);
  assert.deepEqual(transfer.input.required, ["configPath"]);
  const missingSession = JSON.parse((await build.execute({ configPath: ".opencode/sandbox.json" }, {})).content);
  assert.equal(missingSession.blocked, true);
  assert.equal(sessionReads, 0);
  const forged = JSON.parse((await build.execute({ configPath: ".opencode/sandbox.json", sessionId: "forged" }, { sessionID: "real-session" })).content);
  assert.equal(forged.ok, false);
  assert.equal(readReservation(directory).state, "free");
  denyRelease = true;
  await assert.rejects(release.execute({}, { sessionID: "real-session" }), /permission denied/);
  assert.equal(readReservation(directory).state, "free");
  denyTransfer = true;
  const worktreeReadsBeforeTransferDenial = worktreeReads;
  await assert.rejects(transfer.execute({ configPath: ".devcontainer/compose.yml" }, { sessionID: "real-session" }), /permission denied/);
  assert.equal(worktreeReads, worktreeReadsBeforeTransferDenial, "denied transfer must not resolve the source worktree");
  assert.equal(readReservation(directory).state, "free");
  denyRelease = false;
  const result = JSON.parse((await build.execute({ configPath: ".opencode/sandbox.json" }, { sessionID: "real-session" })).content);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.execution.sessionId, "real-session");
  assert.equal(result.execution.projectID, "real-project");
  assert.equal(readReservation(directory).reservation.sessionId, "real-session");
});
