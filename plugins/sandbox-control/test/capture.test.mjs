// Focused tests for the capture, the exclusion policy, the declared
// configuration, and the Docker argument set. Run with
// `node plugins/sandbox-control/test/capture.test.mjs`.
//
// These tests never call Docker: the argument set is asserted
// structurally, which is the point of constructing it in one place.
//
// Coverage:
//   1. A complete declaration is accepted and each missing element is
//      reported.
//   2. A declared path that leaves the project is refused.
//   3. The capture contains the uncommitted work and the manifest
//      matches it.
//   4. A symbolic link that leaves the source refuses the capture
//      without reading its destination.
//   5. Each excluded kind is absent from a capture.
//   6. The argument set carries none of the forbidden options and binds
//      the ports to the loopback interface.
//   7. A build context that leaves the capture is refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const { readSandboxConfig, resolveInside } = await import("../sandbox-config.mjs");
const { takeCapture, verifyCapture, prepareIndependentRepository, isExcluded } =
  await import("../sandbox-capture.mjs");
const {
  buildBuildArguments,
  buildRunArguments,
  buildNetworkArguments,
  assertNoForbiddenOptions,
  checkEngineHost,
  FORBIDDEN_OPTIONS,
} = await import("../docker-adapter.mjs");

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-capture-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-repo-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "config", "user.email", "t@local"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a complete declaration is accepted and each missing element is reported", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
    writeFileSync(
      join(dir, ".opencode", "sandbox.json"),
      JSON.stringify({ dockerfile: "Dockerfile", context: "app", stage: "test" }),
    );

    const complete = readSandboxConfig(dir);
    assert.equal(complete.ok, true);
    assert.equal(complete.config.stage, "test");

    writeFileSync(
      join(dir, ".opencode", "sandbox.json"),
      JSON.stringify({ dockerfile: "Dockerfile" }),
    );
    const incomplete = readSandboxConfig(dir);
    assert.equal(incomplete.ok, false);
    assert.deepEqual(incomplete.missing.sort(), ["context", "stage"]);

    rmSync(join(dir, ".opencode", "sandbox.json"));
    const absent = readSandboxConfig(dir);
    assert.equal(absent.ok, false);
    assert.match(absent.reason, /declares no sandbox configuration/);
  });
});

test("a declared path that leaves the project is refused", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
    writeFileSync(
      join(dir, ".opencode", "sandbox.json"),
      JSON.stringify({ dockerfile: "Dockerfile", context: "../elsewhere", stage: "test" }),
    );
    const outside = readSandboxConfig(dir);
    assert.equal(outside.ok, false);
    assert.match(outside.reason, /escapes the project|resolves outside the project/);

    const direct = resolveInside(dir, "/etc");
    assert.equal(direct.ok, false);
  });
});

test("the capture contains the uncommitted work and the manifest matches it", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "tracked.txt"), "committed\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], { stdio: "ignore" });

    writeFileSync(join(dir, "tracked.txt"), "modified\n");
    writeFileSync(join(dir, "new.txt"), "added\n");

    const result = takeCapture({
      worktreePath: dir,
      workId: "work-1",
      workName: "work one",
      executionId: "exec-1",
      cwd: dir,
    });
    assert.equal(result.ok, true);
    assert.equal(readFileSync(join(result.destination, "tracked.txt"), "utf8"), "modified\n");
    assert.equal(readFileSync(join(result.destination, "new.txt"), "utf8"), "added\n");
    assert.ok(result.manifest.branch, "the manifest records no branch");
    assert.ok(result.manifest.head, "the manifest records no head");

    const verified = verifyCapture(result.destination);
    assert.equal(verified.ok, true);
    assert.deepEqual(verified.mismatches, []);
  });
});

test("a symbolic link that leaves the source refuses the capture", () => {
  withRepo((dir) => {
    const outside = mkdtempSync(join(tmpdir(), "sandbox-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "host content\n");
      symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));

      const result = takeCapture({
        worktreePath: dir,
        workId: "work-1",
        executionId: "exec-2",
        cwd: dir,
      });
      assert.equal(result.ok, false);
      assert.match(result.reason, /points outside the source/);
      assert.equal(result.refused, "link.txt");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("each excluded kind is absent from a capture", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, ".env"), "SECRET=1\n");
    writeFileSync(join(dir, "credentials.json"), '{"token":"x"}\n');
    writeFileSync(join(dir, "app.js"), "console.log(1)\n");
    mkdirSync(join(dir, ".opencode", "memory"), { recursive: true });
    writeFileSync(join(dir, ".opencode", "memory", "memory.sqlite"), "db\n");

    const result = takeCapture({
      worktreePath: dir,
      workId: "work-1",
      executionId: "exec-3",
      cwd: dir,
    });
    assert.equal(result.ok, true);
    assert.ok(!existsSync(join(result.destination, ".env")));
    assert.ok(!existsSync(join(result.destination, "credentials.json")));
    assert.ok(!existsSync(join(result.destination, ".opencode", "memory", "memory.sqlite")));
    assert.ok(existsSync(join(result.destination, "app.js")));

    // The deny list is the default: a path is excluded unless the
    // declared configuration includes it.
    assert.equal(isExcluded(".env").excluded, true);
    assert.equal(isExcluded(".env", [".env"]).excluded, false);
  });
});

test("a capture with a credential-shaped file is refused", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "config.js"), 'const apiKey = "sk-abcdefghijklmnop123456";\n');
    const result = takeCapture({
      worktreePath: dir,
      workId: "work-1",
      executionId: "exec-4",
      cwd: dir,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /credential-shaped/);
  });
});

test("the argument set carries none of the forbidden options", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
    const build = buildBuildArguments({
      captureDir: dir,
      imageTag: "sandbox:exec-1",
      executionId: "exec-1",
      workId: "work-1",
    });
    assert.equal(build.ok, true);
    assert.equal(assertNoForbiddenOptions(build.args).ok, true);
    for (const option of FORBIDDEN_OPTIONS) {
      assert.ok(!build.args.includes(option), `the build carries ${option}`);
    }
    // The build context is the capture itself.
    assert.equal(build.args[build.args.length - 1], dir);
  });
});

test("a build context that leaves the capture is refused", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
    const result = buildBuildArguments({
      captureDir: dir,
      dockerfileRelative: "../Dockerfile",
      imageTag: "sandbox:exec-1",
      executionId: "exec-1",
      workId: "work-1",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /escapes the capture/);
  });
});

test("the run binds the ports to the loopback interface only", () => {
  const run = buildRunArguments({
    imageTag: "sandbox:exec-1",
    executionId: "exec-1",
    workId: "work-1",
    containerName: "sandbox-exec-1",
    networkName: "sandbox-net-exec-1",
    ports: [{ container: 8080, host: "127.0.0.1", hostPort: 18080 }],
  });
  assert.equal(run.ok, true);
  assert.equal(assertNoForbiddenOptions(run.args).ok, true);
  assert.ok(run.args.includes("--publish"));
  assert.ok(run.args.includes("8080:127.0.0.1:18080"));

  const external = buildRunArguments({
    imageTag: "sandbox:exec-1",
    executionId: "exec-1",
    containerName: "sandbox-exec-1",
    networkName: "sandbox-net-exec-1",
    ports: [{ container: 8080, host: "0.0.0.0" }],
  });
  assert.equal(external.ok, false);
  assert.match(external.reason, /loopback interface only/);
});

test("the run never joins the default bridge network", () => {
  const withoutNetwork = buildRunArguments({
    imageTag: "sandbox:exec-1",
    executionId: "exec-1",
    containerName: "sandbox-exec-1",
  });
  assert.equal(withoutNetwork.ok, false);
  assert.match(withoutNetwork.reason, /network created for its execution/);

  const network = buildNetworkArguments({ executionId: "exec-1", name: "sandbox-net-exec-1" });
  assert.equal(network.ok, true);
  assert.equal(network.internal, true);
  assert.ok(network.args.includes("--internal"));
});

test("an unsupported platform is blocked", () => {
  const blocked = checkEngineHost("darwin", "24.0.0");
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Linux or WSL2/);

  const supported = checkEngineHost("linux", "6.1.0");
  assert.equal(supported.ok, true);
});

test("the independent repository does not touch the original", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "file.txt"), "content\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], { stdio: "ignore" });
    const headBefore = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const capture = takeCapture({
      worktreePath: dir,
      workId: "work-1",
      executionId: "exec-5",
      cwd: dir,
    });
    assert.equal(capture.ok, true);

    const prepared = prepareIndependentRepository(capture.destination);
    assert.equal(prepared.ok, true);
    assert.ok(existsSync(join(capture.destination, ".git")));

    const headAfter = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(headAfter, headBefore);
  });
});
