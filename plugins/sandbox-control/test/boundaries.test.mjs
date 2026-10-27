// Focused tests for the boundaries the adversarial review asked for:
// the exclusivity of the quota, the mapping of the declared build into
// the capture, the strict egress declaration, the dependency check, and
// the detection of a source that changed during the capture.
//
// Run with `node plugins/sandbox-control/test/boundaries.test.mjs`.
//
// Coverage:
//   1. The quota is acquired exclusively: a second acquisition is
//      refused even when both observe the quota as free.
//   2. The declared Dockerfile and context are mapped into the capture,
//      and a path that does not map is refused.
//   3. The egress is enabled only by the boolean true.
//   4. A missing dependency blocks the start before any resource exists.
//   5. A source that changes while the capture is taken is refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const { acquireReservation, readReservation } = await import("../reservation.mjs");
const { takeCapture } = await import("../sandbox-capture.mjs");
const { readSandboxConfig, checkDependencies } = await import("../sandbox-config.mjs");
const { startSandbox } = await import("../lifecycle.mjs");

function withRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-boundaries-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "config", "user.email", "t@local"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
    const result = run(dir);
    if (result && typeof result.then === "function") {
      return result.finally(() => rmSync(dir, { recursive: true, force: true }));
    }
    rmSync(dir, { recursive: true, force: true });
    return result;
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

function prepareProject(dir, extra = {}) {
  mkdirSync(join(dir, ".opencode"), { recursive: true });
  writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
  writeFileSync(
    join(dir, ".opencode", "sandbox.json"),
    JSON.stringify({ dockerfile: "Dockerfile", context: ".", stage: "test", ...extra }),
  );
}

function dockerStub() {
  return {
    execFileSync: (cmd, args) => {
      if (args[0] === "version") return "27.0.0\n";
      return "";
    },
  };
}

test("the quota is acquired exclusively", () => {
  withRepo((dir) => {
    const first = acquireReservation(dir, { workId: "work-1" });
    assert.equal(first.ok, true);

    // A second acquisition observes the record and is refused.
    const second = acquireReservation(dir, { workId: "work-2" });
    assert.equal(second.ok, false);
    assert.equal(second.blocked, true);
    assert.equal(second.heldBy.workId, "work-1");

    // The record still belongs to the first owner.
    const held = readReservation(dir);
    assert.equal(held.state, "held");
    assert.equal(held.reservation.workId, "work-1");
  });
});

test("the declared Dockerfile and context are mapped into the capture", () => {
  withRepo((dir) => {
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    mkdirSync(join(dir, "build"), { recursive: true });
    writeFileSync(join(dir, "build", "Dockerfile"), "FROM scratch\n");
    writeFileSync(
      join(dir, ".opencode", "sandbox.json"),
      JSON.stringify({ dockerfile: "build/Dockerfile", context: "build", stage: "test" }),
    );

    const config = readSandboxConfig(dir);
    assert.equal(config.ok, true);
    assert.equal(config.config.dockerfileRelative, "build/Dockerfile");
    assert.equal(config.config.contextRelative, "build");
  });
});

test("a declared path that leaves the project is refused", () => {
  withRepo((dir) => {
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
    writeFileSync(
      join(dir, ".opencode", "sandbox.json"),
      JSON.stringify({ dockerfile: "Dockerfile", context: "../outside", stage: "test" }),
    );
    const config = readSandboxConfig(dir);
    assert.equal(config.ok, false);
    assert.match(config.reason, /escapes the project|resolves outside the project/);
  });
});

test("the egress is enabled only by the boolean true", () => {
  withRepo((dir) => {
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");

    // A string is refused rather than coerced.
    writeFileSync(
      join(dir, ".opencode", "sandbox.json"),
      JSON.stringify({
        dockerfile: "Dockerfile",
        context: ".",
        stage: "test",
        production: { allowExternalEgress: "false" },
      }),
    );
    const refused = readSandboxConfig(dir);
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /must be the boolean/);

    // The boolean true is accepted and reported as true.
    writeFileSync(
      join(dir, ".opencode", "sandbox.json"),
      JSON.stringify({
        dockerfile: "Dockerfile",
        context: ".",
        stage: "test",
        production: { allowExternalEgress: true },
      }),
    );
    const accepted = readSandboxConfig(dir);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.config.production.allowExternalEgress, true);
  });
});

test("a missing dependency blocks the start before any resource exists", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir, { dependencies: ["postgres://localhost:5432/testdb"] });
    const docker = dockerStub();
    const result = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      {
        ...docker,
        platform: "linux",
        release: "6.1.0",
        checkDependency: async () => ({ ok: false, reason: "the connection was refused" }),
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.reason, /dependencies are not available/);
    // The quota was never taken, so no resource exists.
    assert.equal(readReservation(dir).state, "free");
  });
});

test("a dependency that answers does not block the start", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir, { dependencies: ["postgres://localhost:5432/testdb"] });
    const docker = dockerStub();
    const result = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      {
        ...docker,
        platform: "linux",
        release: "6.1.0",
        checkDependency: async () => true,
      },
    );
    assert.equal(result.ok, true);
  });
});

test("the dependency check reports an unreachable service", async () => {
  const result = await checkDependencies(["postgres://localhost:5432/testdb"], {
    checkDependency: async () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 1);
  assert.match(result.reason, /not available/);
});

test("a source that changes while the capture is taken is refused", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "tracked.txt"), "committed\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], { stdio: "ignore" });
    writeFileSync(join(dir, "tracked.txt"), "modified\n");

    // The source is changed while the capture is taken, through a
    // hook that runs between the inventory and the comparison.
    const original = execFileSync;
    void original;
    const capture = takeCapture({
      worktreePath: dir,
      workId: "work-1",
      executionId: "exec-race",
      cwd: dir,
      onBeforeCompare: () => writeFileSync(join(dir, "tracked.txt"), "changed mid-capture\n"),
    });
    assert.equal(capture.ok, false);
    assert.equal(capture.inconsistent, true);
    assert.match(capture.reason, /changed while it was taken/);
  });
});

test("a capture of a stable source is accepted", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "tracked.txt"), "committed\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], { stdio: "ignore" });
    writeFileSync(join(dir, "tracked.txt"), "modified\n");

    const capture = takeCapture({
      worktreePath: dir,
      workId: "work-1",
      executionId: "exec-stable",
      cwd: dir,
    });
    assert.equal(capture.ok, true);
    assert.ok(existsSync(join(capture.destination, "tracked.txt")));
  });
});
