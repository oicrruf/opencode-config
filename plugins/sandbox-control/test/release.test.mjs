import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { recordWorktree } from "../../worktree-control/inventory.mjs";
import { acquireReservation, readReservation, verifyOwner } from "../reservation.mjs";
import { releaseProjectReservation, transferApplicationReservation } from "../release.mjs";
import { withEngineStub } from "./engine-fixture.mjs";

const containerId = "a".repeat(64);

function inspection(id, source) {
  return [id, "running", "fixture-compose", `${source}/.devcontainer`, `${source}/.devcontainer/compose.yml`, "web", "/fixture-web-1",
    [{ Type: "bind", Source: source, Destination: "/app", RW: true }, { Type: "volume", Name: "fixture_db", Destination: "/db", RW: true }],
    { fixture_default: {} }].map((field) => JSON.stringify(field)).join("\t");
}

test("release stops only reconciled container IDs and preserves database volumes and bind paths", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  mkdirSync(join(root, ".devcontainer"));
  assert.equal(recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" }).ok, true);
  const held = acquireReservation(root, { workId: "active-work", scope: "application", processGroup: 12345 });
  assert.equal(held.ok, true);
  const containers = new Map([[containerId, inspection(containerId, root)]]);
  const calls = [];
  const runDocker = (_command, args) => {
    calls.push(args);
    if (args[0] === "ps") return [...containers.keys()].join("\n");
    if (args[0] === "inspect") return containers.get(args.at(-1));
    if (args[0] === "stop") return args.at(-1);
    if (args[0] === "rm") { containers.delete(args.at(-1)); return args.at(-1); }
    throw new Error("unexpected Docker operation");
  };
  const context = {
    directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [{ workId: "active-work", directory: root, branch: "active-work" }]; } },
  };
  const result = await releaseProjectReservation(context, { ...withEngineStub(runDocker), listProcesses: () => [] });
  assert.equal(result.ok, true, result.reason);
  assert.equal(readReservation(root).state, "free");
  assert.deepEqual(result.preservedNamedVolumes, ["fixture_db"]);
  assert.ok(result.preservedBindMounts.includes(root));
  assert.equal(calls.some((args) => args[0] === "volume" || args.includes("-v")), false);
});

test("release refuses a Compose worktree mismatch without any resource changes", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-mismatch-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  const owner = join(root, "owner");
  mkdirSync(owner);
  assert.equal(recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" }).ok, true);
  assert.equal(recordWorktree(root, { workId: "owner-work", directory: owner, branch: "owner-work" }).ok, true);
  const held = acquireReservation(root, { workId: "owner-work", scope: "application", processGroup: 12345 });
  assert.equal(held.ok, true);
  const calls = [];
  const context = {
    directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [
      { workId: "active-work", directory: root, branch: "active-work" },
      { workId: "owner-work", directory: owner, branch: "owner-work" },
    ]; } },
  };
  const result = await releaseProjectReservation(context, { ...withEngineStub((_command, args) => { calls.push(args); return args[0] === "ps" ? "" : ""; }), listProcesses: () => [] });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /no Compose project/);
  assert.equal(calls.every((args) => args[0] === "ps"), true, "only read-only container listings are allowed");
  assert.equal(readReservation(root).state, "held");
});

test("release refuses before cleanup when any listed Compose container cannot be inspected", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-uninspectable-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  mkdirSync(join(root, ".devcontainer"));
  recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" });
  acquireReservation(root, { workId: "active-work", scope: "application", processGroup: 12345 });
  const secondId = "b".repeat(64);
  const containers = new Map([[containerId, inspection(containerId, root)], [secondId, "malformed inspect output"]]);
  const calls = [];
  const runDocker = (_command, args) => {
    calls.push(args);
    if (args[0] === "ps") return [...containers.keys()].join("\n");
    if (args[0] === "inspect") return containers.get(args.at(-1));
    if (args[0] === "stop" || args[0] === "rm") throw new Error("no resource mutation is allowed");
    throw new Error("unexpected Docker operation");
  };
  const context = { directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [{ workId: "active-work", directory: root, branch: "active-work" }]; } } };
  const result = await releaseProjectReservation(context, { ...withEngineStub(runDocker), listProcesses: () => [] });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /ambiguous/);
  assert.equal(calls.some((args) => args[0] === "stop" || args[0] === "rm"), false);
  assert.equal(readReservation(root).state, "held");
});

test("release reconciles a stale application owner only to one managed Compose source and preserves data", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-stale-owner-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  const recordedOwner = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-recorded-owner-")));
  const resourceOwner = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-resource-owner-")));
  t.after(() => { rmSync(recordedOwner, { recursive: true, force: true }); rmSync(resourceOwner, { recursive: true, force: true }); });
  for (const directory of [recordedOwner, resourceOwner]) mkdirSync(join(directory, ".devcontainer"), { recursive: true });
  recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" });
  recordWorktree(root, { workId: "recorded-owner", directory: recordedOwner, branch: "recorded-owner" });
  recordWorktree(root, { workId: "resource-owner", directory: resourceOwner, branch: "resource-owner" });
  acquireReservation(root, { workId: "recorded-owner", scope: "application", processGroup: 12345 });
  const containers = new Map([[containerId, inspection(containerId, resourceOwner)]]);
  const runDocker = (_command, args) => {
    if (args[0] === "ps") return [...containers.keys()].join("\n");
    if (args[0] === "inspect") return containers.get(args.at(-1));
    if (args[0] === "stop") return args.at(-1);
    if (args[0] === "rm") { containers.delete(args.at(-1)); return args.at(-1); }
    throw new Error("unexpected Docker operation");
  };
  const context = { directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [
      { workId: "active-work", directory: root, branch: "active-work" },
      { workId: "recorded-owner", directory: recordedOwner, branch: "recorded-owner" },
      { workId: "resource-owner", directory: resourceOwner, branch: "resource-owner" },
    ]; } } };
  const result = await releaseProjectReservation(context, { ...withEngineStub(runDocker), listProcesses: () => [] });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.workId, "recorded-owner");
  assert.equal(result.resourceWorkId, "resource-owner");
  assert.equal(readReservation(root).state, "free");
  const report = JSON.parse(readFileSync(result.reportPath, "utf8"));
  assert.equal(report.workId, "recorded-owner");
  assert.equal(report.resourceWorkId, "resource-owner");
  assert.deepEqual(result.preservedNamedVolumes, ["fixture_db"]);
});

test("release keeps a stale reservation when active Compose mounts match multiple managed worktrees", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-ambiguous-owner-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  const resourcePaths = [
    realpathSync(mkdtempSync(join(tmpdir(), "sandbox-resource-a-"))),
    realpathSync(mkdtempSync(join(tmpdir(), "sandbox-resource-b-"))),
  ];
  const recordedPath = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-stale-recorded-owner-")));
  t.after(() => { resourcePaths.forEach((path) => rmSync(path, { recursive: true, force: true })); rmSync(recordedPath, { recursive: true, force: true }); });
  recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" });
  recordWorktree(root, { workId: "recorded-owner", directory: recordedPath, branch: "recorded-owner" });
  for (const [index, directory] of resourcePaths.entries()) {
    mkdirSync(join(directory, ".devcontainer"), { recursive: true });
    recordWorktree(root, { workId: `resource-${index}`, directory, branch: `resource-${index}` });
  }
  acquireReservation(root, { workId: "recorded-owner", scope: "application", processGroup: 12345 });
  const ids = ["e".repeat(64), "f".repeat(64)];
  const containers = new Map(ids.map((id, index) => [id, inspection(id, resourcePaths[index])]));
  const calls = [];
  const runDocker = (_command, args) => {
    calls.push(args);
    if (args[0] === "ps") return [...containers.keys()].join("\n");
    if (args[0] === "inspect") return containers.get(args.at(-1));
    throw new Error("resource mutations are not allowed when ownership is ambiguous");
  };
  const context = { directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [
      { workId: "active-work", directory: root, branch: "active-work" },
      { workId: "recorded-owner", directory: recordedPath, branch: "recorded-owner" },
      ...resourcePaths.map((directory, index) => ({ workId: `resource-${index}`, directory, branch: `resource-${index}` })),
    ]; } } };
  const result = await releaseProjectReservation(context, { ...withEngineStub(runDocker), listProcesses: () => [] });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /multiple Compose projects/);
  assert.equal(calls.some((args) => args[0] === "stop" || args[0] === "rm"), false);
  assert.equal(readReservation(root).state, "held");
});

test("release keeps the reservation if a Compose restart creates new resources", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-respawn-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  mkdirSync(join(root, ".devcontainer"));
  recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" });
  acquireReservation(root, { workId: "active-work", scope: "application", processGroup: 12345 });
  const replacementId = "b".repeat(64);
  const containers = new Map([[containerId, inspection(containerId, root)]]);
  const runDocker = (_command, args) => {
    if (args[0] === "ps") return [...containers.keys()].join("\n");
    if (args[0] === "inspect") return containers.get(args.at(-1));
    if (args[0] === "stop") return args.at(-1);
    if (args[0] === "rm") {
      containers.delete(args.at(-1));
      containers.set(replacementId, [replacementId, "running", "fixture-compose", `${root}/.devcontainer`, `${root}/.devcontainer/compose.yml`, "database", "/fixture-database-1",
        [{ Type: "volume", Name: "fixture_db", Destination: "/db", RW: true }], { fixture_default: {} }].map((field) => JSON.stringify(field)).join("\t"));
      return args.at(-1);
    }
    throw new Error("unexpected Docker operation");
  };
  const context = { directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [{ workId: "active-work", directory: root, branch: "active-work" }]; } } };
  const result = await releaseProjectReservation(context, { ...withEngineStub(runDocker), listProcesses: () => [] });
  assert.equal(result.blocked, true);
  assert.equal(readReservation(root).state, "held");
});

test("release verifies Compose ownership before stopping a recorded process group", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-process-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  mkdirSync(join(root, ".devcontainer"));
  recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" });
  acquireReservation(root, { workId: "active-work", scope: "application", processGroup: 12345 });
  const dockerCalls = [];
  let processChecks = 0;
  const context = { directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [{ workId: "active-work", directory: root, branch: "active-work" }]; } } };
  const result = await releaseProjectReservation(context, { ...withEngineStub((_command, args) => { dockerCalls.push(args); return ""; }),
    listProcesses: () => { processChecks++; return [{ pid: 12345, pgid: 12345 }]; } });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /Compose project/);
  assert.equal(dockerCalls.some((args) => args[0] === "stop" || args[0] === "rm"), false);
  assert.equal(processChecks, 0, "the reservation process is not stopped until Compose ownership is verified");
  assert.equal(readReservation(root).state, "held");
});

test("release retries a partial container removal from the immutable report", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-partial-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  mkdirSync(join(root, ".devcontainer"));
  recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" });
  acquireReservation(root, { workId: "active-work", scope: "application", processGroup: 12345 });
  const secondId = "b".repeat(64);
  const containers = new Map([
    [containerId, inspection(containerId, root)],
    [secondId, inspection(secondId, root).replace('"web"', '"database"').replace('"/fixture-web-1"', '"/fixture-database-1"')],
  ]);
  let failOnce = true;
  const runDocker = (_command, args) => {
    if (args[0] === "ps") return [...containers.keys()].join("\n");
    if (args[0] === "inspect") return containers.get(args.at(-1));
    if (args[0] === "stop") return args.at(-1);
    if (args[0] === "rm") {
      if (args.at(-1) === secondId && failOnce) { failOnce = false; throw new Error("transient removal failure"); }
      containers.delete(args.at(-1));
      return args.at(-1);
    }
    throw new Error("unexpected Docker operation");
  };
  const context = { directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [{ workId: "active-work", directory: root, branch: "active-work" }]; } } };
  const dependencies = { ...withEngineStub(runDocker), listProcesses: () => [] };
  const first = await releaseProjectReservation(context, dependencies);
  assert.equal(first.blocked, true);
  assert.equal(readReservation(root).state, "held");
  const second = await releaseProjectReservation(context, dependencies);
  assert.equal(second.ok, true, second.reason);
  assert.equal(readReservation(root).state, "free");
});

test("release recovers an already-removed Compose project from its persisted report", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-release-recover-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  mkdirSync(join(root, ".devcontainer"));
  recordWorktree(root, { workId: "active-work", directory: root, branch: "active-work" });
  acquireReservation(root, { workId: "active-work", scope: "application", processGroup: 12345 });
  let present = true;
  let groupChecks = 0;
  const runDocker = (_command, args) => {
    if (args[0] === "ps") return present ? containerId : "";
    if (args[0] === "inspect") return inspection(containerId, root);
    if (args[0] === "stop") return containerId;
    if (args[0] === "rm") { present = false; return containerId; }
    throw new Error("unexpected Docker operation");
  };
  const context = { directory: root, sessionID: "session-new", projectID: "project-1",
    worktree: { async list() { return [{ workId: "active-work", directory: root, branch: "active-work" }]; } } };
  const dependencies = { ...withEngineStub(runDocker), listProcesses: () => {
    groupChecks++;
    return groupChecks === 2 ? [{ pid: 12345, pgid: 12345 }] : [];
  } };
  const first = await releaseProjectReservation(context, dependencies);
  assert.equal(first.blocked, true);
  assert.equal(readReservation(root).state, "held");
  const second = await releaseProjectReservation(context, dependencies);
  assert.equal(second.ok, true, second.reason);
  assert.equal(second.recovered, true);
  assert.equal(readReservation(root).state, "free");
});

async function applicationTransferFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-handoff-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-qm", "base"], { stdio: "ignore" });
  const oldPath = join(tmpdir(), `sandbox-handoff-old-${process.pid}-${Date.now()}`);
  const targetPath = join(tmpdir(), `sandbox-handoff-target-${process.pid}-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-qb", "old-work", oldPath], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "worktree", "add", "-qb", "target-work", targetPath], { stdio: "ignore" });
  t.after(() => {
    try { execFileSync("git", ["-C", root, "worktree", "remove", "--force", oldPath], { stdio: "ignore" }); } catch {}
    try { execFileSync("git", ["-C", root, "worktree", "remove", "--force", targetPath], { stdio: "ignore" }); } catch {}
  });
  for (const path of [oldPath, targetPath]) {
    mkdirSync(join(path, ".devcontainer"));
    writeFileSync(join(path, ".devcontainer/compose.yml"), "services: {}\n");
  }
  recordWorktree(root, { workId: "old-work", directory: oldPath, branch: "old-work" });
  recordWorktree(root, { workId: "target-work", directory: targetPath, branch: "target-work" });
  const held = acquireReservation(root, { workId: "old-work", scope: "application", processGroup: 12345 });
  return { root, oldPath: realpathSync(oldPath), targetPath: realpathSync(targetPath), held };
}

test("Compose transfer stops the source and rotates ownership to an awaiting-start target", async (t) => {
  const fixture = await applicationTransferFixture(t);
  const id = "c".repeat(64);
  const uploadPath = "/tmp/sandbox-handoff-uploads";
  const resourcePath = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-runtime-source-")));
  t.after(() => rmSync(resourcePath, { recursive: true, force: true }));
  mkdirSync(join(resourcePath, ".devcontainer"), { recursive: true });
  recordWorktree(fixture.root, { workId: "runtime-source", directory: resourcePath, branch: "runtime-source" });
  const inspected = [id, "running", "fixture-compose", `${resourcePath}/.devcontainer`, `${resourcePath}/.devcontainer/compose.yml`, "web", "/fixture-web-1",
    [{ Type: "bind", Source: resourcePath, Destination: "/app", RW: true },
      { Type: "bind", Source: uploadPath, Destination: "/app/uploads", RW: true },
      { Type: "volume", Name: "fixture_db", Destination: "/db", RW: true }], { fixture_default: {} }].map((field) => JSON.stringify(field)).join("\t");
  let present = true;
  const calls = [];
  const runDocker = (_command, args) => {
    calls.push(args);
    if (args[0] === "ps") return present ? id : "";
    if (args[0] === "inspect") return inspected;
    if (args[0] === "compose") return JSON.stringify({
      name: "target-compose", services: { web: { volumes: [
        { type: "bind", source: fixture.targetPath, target: "/app", read_only: false },
        { type: "bind", source: uploadPath, target: "/app/uploads", read_only: false },
        { type: "volume", source: "fixture_db", target: "/db", read_only: false },
      ] } }, volumes: { fixture_db: { name: "fixture_db" } },
    });
    if (args[0] === "stop") return id;
    if (args[0] === "rm") { present = false; return id; }
    throw new Error("unexpected Docker operation");
  };
  const context = { worktree: { async list() { return [
    { workId: "old-work", directory: fixture.oldPath, branch: "old-work" },
    { workId: "target-work", directory: fixture.targetPath, branch: "target-work" },
    { workId: "runtime-source", directory: resourcePath, branch: "runtime-source" },
  ]; } } };
  const source = { ok: true, projectRoot: fixture.root, worktreePath: fixture.targetPath, workId: "target-work", workName: "target-work", sessionId: "target-session", projectID: "project-1" };
  const result = await transferApplicationReservation(context, ".devcontainer/compose.yml", { ...withEngineStub(runDocker), listProcesses: () => [] }, source);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.awaitingStart, true);
  assert.equal(result.workId, "target-work");
  assert.deepEqual(result.preservedNamedVolumes, ["fixture_db"]);
  assert.ok(result.preservedBindMounts.includes(uploadPath));
  const successor = readReservation(fixture.targetPath).reservation;
  assert.equal(successor.awaitingStart, true);
  assert.equal(successor.workId, "target-work");
  assert.equal(verifyOwner(fixture.targetPath, fixture.held.token).ok, false);
  assert.equal(verifyOwner(fixture.targetPath, result.token).ok, true);
  assert.ok(calls.some((args) => args[0] === "compose"));
});

test("Compose transfer refuses a changed upload mapping before stopping the source", async (t) => {
  const fixture = await applicationTransferFixture(t);
  const id = "d".repeat(64);
  const inspected = [id, "running", "fixture-compose", `${fixture.oldPath}/.devcontainer`, `${fixture.oldPath}/.devcontainer/compose.yml`, "web", "/fixture-web-1",
    [{ Type: "bind", Source: fixture.oldPath, Destination: "/app", RW: true },
      { Type: "bind", Source: "/tmp/source-uploads", Destination: "/app/uploads", RW: true },
      { Type: "volume", Name: "fixture_db", Destination: "/db", RW: true }], { fixture_default: {} }].map((field) => JSON.stringify(field)).join("\t");
  const calls = [];
  const runDocker = (_command, args) => {
    calls.push(args);
    if (args[0] === "ps") return id;
    if (args[0] === "inspect") return inspected;
    if (args[0] === "compose") return JSON.stringify({ name: "target-compose", services: { web: { volumes: [
      { type: "bind", source: fixture.targetPath, target: "/app", read_only: false },
      { type: "bind", source: "/tmp/different-uploads", target: "/app/uploads", read_only: false },
      { type: "volume", source: "fixture_db", target: "/db", read_only: false },
    ] } }, volumes: { fixture_db: { name: "fixture_db" } } });
    throw new Error("resource mutations must not occur on a mapping mismatch");
  };
  const context = { worktree: { async list() { return [
    { workId: "old-work", directory: fixture.oldPath, branch: "old-work" },
    { workId: "target-work", directory: fixture.targetPath, branch: "target-work" },
  ]; } } };
  const source = { ok: true, projectRoot: fixture.root, worktreePath: fixture.targetPath, workId: "target-work", workName: "target-work", sessionId: "target-session", projectID: "project-1" };
  const result = await transferApplicationReservation(context, ".devcontainer/compose.yml", { ...withEngineStub(runDocker), listProcesses: () => [] }, source);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /exact persistent/);
  assert.equal(calls.some((args) => args[0] === "stop" || args[0] === "rm"), false);
  assert.equal(readReservation(fixture.oldPath).reservation.workId, "old-work");
});

test("Compose transfer refuses an unlisted destination worktree before Docker operations", async (t) => {
  const fixture = await applicationTransferFixture(t);
  let dockerCalls = 0;
  const context = { worktree: { async list() {
    return [{ workId: "old-work", directory: fixture.oldPath, branch: "old-work" }];
  } } };
  const source = { ok: true, projectRoot: fixture.root, worktreePath: fixture.targetPath, workId: "target-work", workName: "target-work", sessionId: "target-session", projectID: "project-1" };
  const result = await transferApplicationReservation(context, ".devcontainer/compose.yml", {
    ...withEngineStub(() => { dockerCalls++; return ""; }), listProcesses: () => [],
  }, source);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /destination/);
  assert.equal(dockerCalls, 0);
  assert.equal(readReservation(fixture.oldPath).reservation.workId, "old-work");
});
