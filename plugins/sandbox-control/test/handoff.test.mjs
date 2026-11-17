import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { withSandboxOperation } from "../operation.mjs";
import { acquireReservation, handoffApplicationReservation, readReservation } from "../reservation.mjs";
import { startLocalExecution, stopLocalExecution } from "../execution.mjs";
import { withEngineStub } from "./engine-fixture.mjs";

function config(volumeName = "shared_db") {
  return JSON.stringify({ name: "target-compose", services: { db: { volumes: [
    { type: "volume", source: volumeName, target: "/var/lib/db", read_only: false },
    { type: "bind", source: "/tmp/shared-uploads", target: "/app/uploads", read_only: false },
  ] } }, volumes: { [volumeName]: { name: volumeName } } });
}

async function fixture(t, volumeName = "shared_db") {
  const root = mkdtempSync(join(tmpdir(), "sandbox-awaiting-start-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
  const target = join(root, "target");
  mkdirSync(join(target, ".devcontainer"), { recursive: true });
  const composeFile = join(target, ".devcontainer/compose.yml");
  writeFileSync(composeFile, "services: {}\n");
  const canonicalTarget = realpathSync(target);
  const canonicalCompose = realpathSync(composeFile);
  const acquired = acquireReservation(root, { workId: "old", scope: "application", processGroup: 1000 });
  const handed = withSandboxOperation(root, "fixtureHandoff", () => handoffApplicationReservation(root, acquired.reservation, {
    resourcesAbsent: true, workId: "target", sessionId: "target-session", composeFile: canonicalCompose,
    composeProject: "target-compose", engineId: "fixture-daemon",
    persistentMounts: [
      { type: "volume", name: "shared_db", destination: "/var/lib/db", readOnly: false },
      { type: "bind", source: "/tmp/shared-uploads", destination: "/app/uploads", readOnly: false },
    ],
  }));
  assert.equal(handed.ok, true);
  return { root, target: canonicalTarget, composeFile: canonicalCompose, handed, volumeName };
}

function startInput(f, overrides = {}) {
  return {
    workId: "target", workName: "target", sessionId: "target-session",
    executable: "/usr/bin/docker",
    args: ["compose", "--project-directory", join(f.target, ".devcontainer"), "-f", f.composeFile, "up"],
    composeFile: f.composeFile, token: f.handed.token,
    worktreeApi: { async list() { return [{ workId: "target", directory: f.target, exists: true }]; } },
    ...overrides,
  };
}

function deps(f, { onSpawn = () => {}, volumeName = "shared_db" } = {}) {
  return {
    ...withEngineStub((_command, args) => {
      if (args[0] === "compose") return config(volumeName);
      throw new Error("unexpected Docker operation");
    }),
    spawn(_executable, _args) {
      onSpawn();
      const child = new EventEmitter();
      child.pid = 45678;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  };
}

test("awaiting-start resumes only the exact Compose command and persistent mapping", async (t) => {
  const f = await fixture(t);
  let launched = false;
  const result = await startLocalExecution(f.root, startInput(f), deps(f, { onSpawn: () => { launched = true; } }));
  assert.equal(result.ok, true, result.reason);
  assert.equal(launched, true);
  assert.equal(result.token, f.handed.token);
  assert.equal(readReservation(f.root).reservation.awaitingStart, false);
  assert.equal(readReservation(f.root).reservation.workId, "target");
});

test("awaiting-start refuses changed persistent mounts before launching anything", async (t) => {
  const f = await fixture(t);
  let launched = false;
  const result = await startLocalExecution(f.root, startInput(f), deps(f, { onSpawn: () => { launched = true; }, volumeName: "different_db" }));
  assert.equal(result.blocked, true);
  assert.equal(launched, false);
  assert.equal(readReservation(f.root).reservation.awaitingStart, true);
  assert.equal(readReservation(f.root).reservation.workId, "target");
});

test("awaiting-start refuses a command that changes the Compose configuration", async (t) => {
  const f = await fixture(t);
  let launched = false;
  const result = await startLocalExecution(f.root, startInput(f, { args: ["compose", "up", "-d"] }), deps(f, { onSpawn: () => { launched = true; } }));
  assert.equal(result.blocked, true);
  assert.equal(launched, false);
  assert.equal(readReservation(f.root).reservation.awaitingStart, true);
});

test("a resumed Compose application keeps the quota while labeled containers remain", async (t) => {
  const f = await fixture(t);
  const started = await startLocalExecution(f.root, startInput(f), deps(f));
  assert.equal(started.ok, true, started.reason);
  const result = await stopLocalExecution(f.root, f.handed.token, {
    ...withEngineStub((_command, args) => args[0] === "ps" ? "container-id" : ""),
    listProcesses: () => [], kill: () => {},
  });
  assert.equal(result.released, false);
  assert.match(result.reason, /Compose containers remain/);
  assert.equal(readReservation(f.root).state, "held");
});

test("a resumed Compose application releases its quota only after the project label is empty", async (t) => {
  const f = await fixture(t);
  const started = await startLocalExecution(f.root, startInput(f), deps(f));
  assert.equal(started.ok, true, started.reason);
  const result = await stopLocalExecution(f.root, f.handed.token, {
    ...withEngineStub((_command, args) => args[0] === "ps" ? "" : ""),
    listProcesses: () => [], kill: () => {},
  });
  assert.equal(result.released, true);
  assert.equal(readReservation(f.root).state, "free");
});
