import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitReleaseSource } from "../release-source.mjs";
import { releaseProjectReservation } from "../release.mjs";
import { acquireReservation, readReservation } from "../reservation.mjs";
import { recordWorktree } from "../../worktree-control/inventory.mjs";
import { withEngineStub } from "./engine-fixture.mjs";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "git-release-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  return { root, context: { directory: root, sessionID: "operator", projectID: "project" } };
}

for (const mode of ["unrecorded", "unavailable-api", "empty-api"]) {
  test(`explicit release works with ${mode} and retains data without registration`, async (t) => {
    const { root, context } = fixture(t);
    if (mode !== "unrecorded") recordWorktree(root, { directory: root, workId: "AT-157" });
    if (mode === "unavailable-api") context.worktree = { list: async () => { throw Error("offline"); } };
    if (mode === "empty-api") context.worktree = { list: async () => [] };
    const path = join(root, ".opencode/state/worktrees/inventory.json");
    const before = existsSync(path) ? readFileSync(path, "utf8") : null;
    const source = resolveGitReleaseSource(context);
    assert.equal(source.ok, true, source.reason);
    assert.equal(resolveGitReleaseSource(context).workId, source.workId);
    acquireReservation(root, { workId: "AT-157", scope: "application", processGroup: 12345 });
    const id = "a".repeat(64);
    let present = true;
    const calls = [];
    const docker = (_cmd, args) => {
      calls.push(args);
      if (args[0] === "ps") return present ? id : "";
      if (args[0] === "inspect") return [id, "running", "website", root, `${root}/compose.yml`, "web", "/website-web",
        [{ Type: "bind", Source: root, Destination: "/app", RW: true }, { Type: "volume", Name: "database", Destination: "/db", RW: true }], {}].map(JSON.stringify).join("\t");
      if (args[0] === "stop") return id;
      if (args[0] === "rm") { present = false; return id; }
      throw Error("unexpected operation");
    };
    const result = await releaseProjectReservation(context, { ...withEngineStub(docker), listProcesses: () => [] });
    assert.equal(result.ok, true, result.reason);
    assert.equal(readReservation(root).state, "free");
    assert.deepEqual(result.preservedNamedVolumes, ["database"]);
    assert.equal(calls.some((a) => a[0] === "volume" || a.includes("-v")), false);
    assert.equal(existsSync(path) ? readFileSync(path, "utf8") : null, before);
    assert.equal(JSON.parse(readFileSync(result.reportPath)).resourceWorkId, source.workId);
  });
}

test("fallback rejects corrupt and duplicated inventory before Docker", async (t) => {
  const { root, context } = fixture(t);
  recordWorktree(root, { directory: root, workId: "AT-157" });
  const path = join(root, ".opencode/state/worktrees/inventory.json");
  for (const contents of ["{", "{}", "null", '{"entries":"damaged"}', JSON.stringify({ entries: [null] }), JSON.stringify({ entries: [
    { directory: root, workId: "a" }, { directory: root, workId: "b" },
  ] })]) {
    writeFileSync(path, contents);
    let calls = 0;
    const result = await releaseProjectReservation(context, { ...withEngineStub(() => { calls++; }), listProcesses: () => [] });
    assert.equal(result.blocked, true);
    assert.equal(calls, 0);
  }
});

test("fallback needs session context and cannot resolve a non-Git directory", (t) => {
  const { root, context } = fixture(t);
  assert.equal(resolveGitReleaseSource({ ...context, sessionID: "" }).blocked, true);
  rmSync(join(root, ".git"), { recursive: true });
  assert.equal(resolveGitReleaseSource(context).blocked, true);
});
