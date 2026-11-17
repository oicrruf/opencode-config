// Focused tests for the lifecycle: the start, the status, the finish,
// the cleanup, the cancel, and the recovery. Run with
// `node plugins/sandbox-control/test/lifecycle.test.mjs`.
//
// The Docker calls are injected, so the tests never need an engine and
// never touch the host.
//
// Coverage:
//   1. The start returns a pending manual test and a distinct identity.
//   2. The status carries no secret and states the pending result.
//   3. The report is written before the cleanup and holds no secret.
//   4. The cleanup removes only the labeled resources and verifies their
//      absence.
//   5. A cleanup that cannot remove everything keeps the quota.
//   6. A cancellation keeps the quota until the resources are accounted
//      for.
//   7. A recovery finds an already completed closure and acts on no
//      other execution.

import { test } from "node:test";
import { EventEmitter } from "node:events";
import { withEngineStub } from "./engine-fixture.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const {
  startSandbox,
  sandboxStatus,
  finishSandbox,
  cleanupExecution,
  cancelSandbox,
  recoverSandbox,
  writeExecutionRecord,
  readExecutionRecord,
  normalizeWorkName,
  buildExecutionIdentity,
  buildReport,
} = await import("../lifecycle.mjs");
const { readReservation } = await import("../reservation.mjs");
const { readSupervisor } = await import("../execution.mjs");

for (const operation of ["finish", "cancel", "recover"]) {
  test(`${operation} keeps its record and quota when terminal persistence fails`, async () => {
    await withRepo(async (dir) => {
      prepareProject(dir);
      const deps = dockerStub();
      const started = await startSandbox({ cwd: dir, worktreePath: dir, workId: "terminal-write" }, deps);
      assert.equal(started.ok, true, started.reason);
      const original = fs.writeFileSync;
      let result;
      try {
        fs.writeFileSync = function(path, data, options) {
          if (String(path).includes("execution.json.") && typeof data === "string" && ["closed", "cancelled"].includes(JSON.parse(data).phase)) throw Error("injected terminal persistence failure");
          return original(path, data, options);
        };
        syncBuiltinESMExports();
        const id = started.execution.executionId;
        result = operation === "finish" ? finishSandbox(dir, id, { token: started.token, result: "passed" }, deps) :
          operation === "cancel" ? cancelSandbox(dir, id, { token: started.token }, deps) : recoverSandbox(dir, id, { ...deps, token: started.token });
      } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
      assert.equal(result.ok, false);
      assert.equal(result.quotaReleased, false);
      assert.equal(readExecutionRecord(dir, started.execution.executionId).ok, true);
      assert.equal(readReservation(dir).state, "held");
      const recovered = recoverSandbox(dir, started.execution.executionId, { ...deps, token: started.token });
      assert.equal(recovered.ok, true, recovered.reason);
      assert.equal(recovered.quotaReleased, true);
      assert.equal(readReservation(dir).state, "free");
    });
  });
}

function withRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-lifecycle-"));
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

function prepareProject(dir, { include = [] } = {}) {
  mkdirSync(join(dir, ".opencode"), { recursive: true });
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(dir, "app", "main.txt"), "content\n");
  writeFileSync(
    join(dir, ".opencode", "sandbox.json"),
    JSON.stringify({
      dockerfile: "Dockerfile",
      context: ".",
      stage: "test",
      ports: [{ container: 8080, host: "127.0.0.1", hostPort: 18080 }],
      include,
    }),
  );
  if (include.includes("custom-config.json")) writeFileSync(join(dir, "custom-config.json"), '{"featureFlag":true}\n');
}

function supervisorSpawnStub() {
  const child = new EventEmitter();
  child.pid = 987654;
  child.payload = "";
  child.stdin = { end(value) { child.payload = value; } };
  child.unref = () => {};
  child.kill = () => {};
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

// A Docker stub that records the calls it received and reports the
// resources it still holds. A removal takes the resource out of the
// listing, so the absence verification is exercised for real.
function dockerStub(state = {}) {
  const calls = [];
  const present = { ...(state.present ?? {}) };
  // The list command of each kind: `ps` for containers, `ls` for the
  // rest, with the kind as the second argument.
  const listKind = (args) => {
    if (args[0] === "ps") return "container";
    if (args[0] === "ls") return args[1];
    return null;
  };
  const removeKind = (args) => {
    if (args[0] === "rm") return "container";
    if (args[0] === "rm" || args[1] === "rm") return args[0];
    return null;
  };
  const execFileSync = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (args[0] === "version") return "27.0.0\n";

    // The inspection of a container reports the volumes it mounts.
    if (args[0] === "inspect") {
      const target = args[args.length - 1];
      const volumes = (state.volumes ?? []).filter(
        (entry) => target === entry.container || target.startsWith(entry.container),
      );
      return volumes.map((entry) => entry.name).join(" ");
    }

    const listKindName = listKind(args);
    if (listKindName) {
      const filterIndex = args.indexOf("--filter");
      const filter = filterIndex >= 0 ? args[filterIndex + 1] : "";
      const executionId = filter.split("=")[1] ?? "unknown";
      const list = present[listKindName] ?? [];
      return list.map((id) => `${id}-${executionId}`).join("\n");
    }

    // A removal takes the resource out of the listing.
    const removeKindName = removeKind(args);
    if (removeKindName) {
      const target = args[args.length - 1];
      const list = present[removeKindName] ?? [];
      present[removeKindName] = list.filter((id) => !target.startsWith(id));
    }
    return "";
  };
  return { ...withEngineStub(execFileSync), calls, present };
}

test("a work name is normalized for use in a resource name", () => {
  assert.equal(normalizeWorkName("My Work Item!"), "my-work-item");
  assert.equal(normalizeWorkName(""), "work");
  assert.equal(normalizeWorkName("---"), "work");
});

test("two executions of the same work have distinct identities", () => {
  const first = buildExecutionIdentity("work-1", "my work");
  const second = buildExecutionIdentity("work-1", "my work");
  assert.notEqual(first.executionId, second.executionId);
  assert.equal(first.normalizedWorkName, "my-work");
});

test("the start returns a pending manual test and a distinct identity", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const result = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    assert.equal(result.ok, true);
    assert.equal(result.pendingManualTest, true);
    assert.equal(result.result, null);
    assert.equal(result.approved, undefined);
    assert.ok(result.token, "the start returned no owner token");
    assert.match(result.localAccess, /127\.0\.0\.1:18080/);

    // The quota is held by the sandbox.
    const reservation = readReservation(dir);
    assert.equal(reservation.state, "held");
    assert.equal(reservation.reservation.scope, "sandbox");

    // The container was created on the network of the execution and
    // never on the default bridge.
    const runCall = docker.calls.find((call) => call.includes("run --detach"));
    assert.ok(runCall, "the container was not started");
    assert.ok(!runCall.includes("--network host"));
    assert.ok(!runCall.includes("--privileged"));
  });
});

test("the declared capture include is honored during a sandbox start", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir, { include: ["custom-config.json"] });
    const result = await startSandbox(
      { workId: "work-include", workName: "include", worktreePath: dir, cwd: dir },
      { ...dockerStub(), platform: "linux", release: "6.1.0" },
    );
    assert.equal(result.ok, true);
    assert.equal(readFileSync(join(result.execution.capture.destination, "custom-config.json"), "utf8"), '{"featureFlag":true}\n');
  });
});

test("the status carries no secret and states the pending result", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    assert.equal(started.ok, true);

    const status = sandboxStatus(dir, started.execution.executionId);
    assert.equal(status.ok, true);
    assert.equal(status.pendingManualTest, true);
    assert.equal(status.approved, false);
    assert.match(status.note, /not an approved test/);
    assert.ok(!JSON.stringify(status).includes("sk-"), "the status leaked a secret shape");
  });
});

test("the report is written before the cleanup and holds no secret", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    assert.equal(started.ok, true);

    const finished = finishSandbox(
      dir,
      started.execution.executionId,
      {
        result: "passed",
        steps: ["built the image", "ran the test"],
        differencesFromProduction: ["the database is the prepared one"],
        token: started.token,
      },
      docker,
    );
    assert.equal(finished.ok, true);
    assert.equal(finished.result, "passed");
    assert.ok(existsSync(finished.reportPath), "the report was not written");

    const report = JSON.parse(readFileSync(finished.reportPath, "utf8"));
    assert.equal(report.result, "passed");
    assert.equal(report.approved, false);
    assert.equal(report.steps.length, 2);
    assert.ok(!JSON.stringify(report).includes("sk-"), "the report leaked a secret shape");
  });
});

test("a step that carries a credential is refused and the resources are kept", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    const refused = finishSandbox(
      dir,
      started.execution.executionId,
      {
        result: "passed",
        steps: ["exported API_KEY=sk-abcdefghijklmnop123456"],
        token: started.token,
      },
      docker,
    );
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /credential-shaped/);
  });
});

test("closing an execution requires the token that owns the reservation", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );

    // Without a token the close is refused, so an actor that knows only
    // the execution identity cannot destroy the environment.
    const withoutToken = finishSandbox(
      dir,
      started.execution.executionId,
      { result: "passed", steps: [] },
      docker,
    );
    assert.equal(withoutToken.ok, false);
    assert.match(withoutToken.reason, /requires the token/);

    // A wrong token is refused as well.
    const wrongToken = finishSandbox(
      dir,
      started.execution.executionId,
      { result: "passed", steps: [], token: "not-the-token" },
      docker,
    );
    assert.equal(wrongToken.ok, false);
    assert.match(wrongToken.reason, /does not own the reservation/);

    // The execution is still running and the quota is still held.
    assert.equal(readReservation(dir).state, "held");
  });
});

test("a successful close releases the quota", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    const finished = finishSandbox(
      dir,
      started.execution.executionId,
      { result: "passed", steps: [], token: started.token },
      docker,
    );
    assert.equal(finished.ok, true);
    assert.equal(finished.quotaReleased, true);
    assert.equal(readReservation(dir).state, "free");
  });
});

test("the cleanup removes only the labeled resources and verifies their absence", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub({ present: { container: ["c1"], network: ["n1"] } });
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    const cleanup = cleanupExecution(dir, started.execution.executionId, docker);
    assert.equal(cleanup.ok, true);
    assert.equal(existsSync(started.execution.capture.destination), false, "the recorded capture remained after cleanup");
    assert.ok(cleanup.removed.length > 0);
    for (const removal of cleanup.removed) {
      assert.ok(docker.calls.some((call) => call.includes(`label=${"com.opencode.sandbox.execution"}=`)));
      void removal;
    }
  });
});

test("cleanup refuses a capture path redirected through a symlink", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox({ workId: "safe-path", workName: "safe-path", cwd: dir, worktreePath: dir }, docker);
    const outside = mkdtempSync(join(tmpdir(), "sandbox-preserved-outside-"));
    const sentinel = join(outside, "keep.txt");
    writeFileSync(sentinel, "must survive cleanup\n");
    rmSync(started.execution.capture.destination, { recursive: true, force: true });
    symlinkSync(outside, started.execution.capture.destination, "dir");
    try {
      const closed = finishSandbox(dir, started.execution.executionId, { result: "passed", token: started.token }, docker);
      assert.equal(closed.cleanup.ok, false);
      assert.equal(closed.quotaReleased, false);
      assert.equal(readFileSync(sentinel, "utf8"), "must survive cleanup\n");
      assert.equal(readReservation(dir).state, "held");
      assert.equal(readExecutionRecord(dir, started.execution.executionId).ok, true, "failed capture cleanup must retain its recovery record");
    } finally {
      rmSync(started.execution.capture.destination, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a cleanup that cannot remove everything keeps the quota", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    // The listing always reports a container, so the absence check
    // never succeeds.
    const docker = withEngineStub((cmd, args) => {
        if (args[0] === "ps") return "leftover-container\n";
        if (args[0] === "ls") return "leftover-container\n";
        if (args[0] === "version") return "27.0.0\n";
        // The build and the start succeed; only the removal fails.
        if (args[0] === "build" || args[0] === "run" || args[0] === "network") return "";
        throw new Error("the resource could not be removed");
    });
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    assert.equal(started.ok, true);

    const cancelled = cancelSandbox(dir, started.execution.executionId, { token: started.token }, docker);
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.quotaReleased, false);
    assert.equal(readReservation(dir).state, "held");
  });
});

test("a recovery finds an already completed closure and acts on no other execution", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    const finished = finishSandbox(
      dir,
      started.execution.executionId,
      { result: "passed", steps: [], token: started.token },
      docker,
    );
    assert.equal(finished.ok, true);

    const recovered = recoverSandbox(dir, started.execution.executionId, { ...docker, token: started.token });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.alreadyClosed, true);

    // An unknown identity closes nothing.
    const unknown = recoverSandbox(dir, "exec-does-not-exist", { ...docker, token: started.token });
    assert.equal(unknown.ok, true);
    assert.equal(unknown.alreadyClosed, true);
  });
});

test("a recovery requires the token that owns the reservation", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    assert.equal(started.ok, true);

    // Without a token the recovery refuses: it destroys resources, so
    // it is a destructive transition like closing and cancelling.
    const withoutToken = recoverSandbox(dir, started.execution.executionId, docker);
    assert.equal(withoutToken.ok, false);
    assert.match(withoutToken.reason, /requires the token/);
    assert.equal(withoutToken.quotaReleased, false);

    // A wrong token is refused as well.
    const wrongToken = recoverSandbox(dir, started.execution.executionId, {
      ...docker,
      token: "not-the-token",
    });
    assert.equal(wrongToken.ok, false);
    assert.match(wrongToken.reason, /does not own the reservation/);

    // The execution is untouched and the quota is still held.
    assert.equal(readReservation(dir).state, "held");
  });
});

test("the result must be one of the declared states", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    const invalid = finishSandbox(dir, started.execution.executionId, { result: "looks good" }, docker);
    assert.equal(invalid.ok, false);
    assert.match(invalid.reason, /must be one of/);
  });
});

test("a volume created implicitly is discovered and removed", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub({
      present: { container: ["c1"] },
      volumes: [{ container: "c1", name: "implicit-volume" }],
    });
    const started = await startSandbox(
      { workId: "work-1", workName: "my work", worktreePath: dir, cwd: dir },
      { ...docker, platform: "linux", release: "6.1.0" },
    );
    assert.equal(started.ok, true);

    const cleanup = cleanupExecution(dir, started.execution.executionId, docker);
    assert.equal(cleanup.ok, true);
    const implicit = cleanup.removed.find((entry) => entry.origin === "implicit");
    assert.ok(implicit, "the implicit volume was not discovered");
    assert.equal(implicit.id, "implicit-volume");
    assert.ok(
      docker.calls.some((call) => call.includes("volume rm -f implicit-volume")),
      "the implicit volume was not removed",
    );
  });
});

test("the execution record round-trips", async () => {
  await withRepo(async (dir) => {
    const record = {
      executionId: "exec-1",
      workId: "work-1",
      workName: "work one",
      phase: "running",
      result: null,
    };
    const written = writeExecutionRecord(dir, record);
    assert.equal(written.ok, true);
    const read = readExecutionRecord(dir, "exec-1");
    assert.equal(read.ok, true);
    assert.equal(read.record.phase, "running");
  });
});

// Desktop 2.2: identity changes must block removals and preserve the owner's quota.
test("changed engine identity blocks cleanup without releasing reservation", async () => {
  await withRepo(async dir => {
    prepareProject(dir); const docker = dockerStub();
    const started = await startSandbox({workId:"binding", workName:"binding", worktreePath:dir, cwd:dir}, {...docker, platform:"darwin"});
    assert.equal(started.ok, true);
    const changed = {...docker, execFileSync(cmd,args,options) {
      if (args[0] === "info") return ["different-daemon","linux","Docker Desktop","29.7.2","aarch64"].map(JSON.stringify).join("|");
      return docker.execFileSync(cmd,args,options);
    }};
    const before = docker.calls.filter(c => /docker (?:rm|network rm|image rm|volume rm)/.test(c)).length;
    const closed = finishSandbox(dir, started.execution.executionId, {result:"passed",steps:[],token:started.token}, changed);
    assert.equal(closed.quotaReleased, false); assert.equal(closed.cleanup.ok, false);
    assert.equal(readReservation(dir).state,"held");
    assert.equal(docker.calls.filter(c => /docker (?:rm|network rm|image rm|volume rm)/.test(c)).length,before);
  });
});
// Desktop 2.3: old records cannot inherit a potentially unrelated ambient daemon.
test("legacy record without binding blocks recovery before Docker operations", async () => {
  await withRepo(async dir => {
    const record = {executionId:"legacy",workId:"legacy",workName:"legacy",phase:"running",result:null,tokenRequired:false};
    writeExecutionRecord(dir,record); const docker = dockerStub();
    const recovered = recoverSandbox(dir,"legacy",docker);
    assert.equal(recovered.ok,false); assert.match(recovered.reason,/no verified engine binding/);
    assert.equal(docker.calls.length,0);
  });
});

test('a fresh coordinator closes the recorded Desktop engine despite remote context changes', async () => {
  await withRepo(async dir => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox({ workId: 'desktop', workName: 'desktop', cwd: dir, worktreePath: dir }, { ...docker, platform: 'darwin' });
    assert.equal(started.ok, true);
    const finished = finishSandbox(dir, started.execution.executionId,
      { result: 'passed', token: started.token },
      { ...docker, env: { DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'ssh://remote' } });
    assert.equal(finished.cleanup.ok, true);
    assert.equal(finished.quotaReleased, true);
  });
});

test('an unreachable bound daemon preserves quota for cancel, recovery and expired supervisor closure', async () => {
  const { closeExpiredExecution } = await import('../lifecycle.mjs');
  await withRepo(async dir => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox({ workId: 'deadline', workName: 'deadline', cwd: dir, worktreePath: dir, maxDurationSeconds: 60 }, { ...docker, supervisorSpawn: supervisorSpawnStub });
    assert.equal(started.ok, true);
    writeExecutionRecord(dir, { ...started.execution, deadlineAt: new Date(0).toISOString() });
    const unavailable = { ...docker, token: started.token, lstatSync() { throw new Error('unavailable'); } };
    for (const close of [
      () => cancelSandbox(dir, started.execution.executionId, { token: started.token }, unavailable),
      () => recoverSandbox(dir, started.execution.executionId, unavailable),
      () => closeExpiredExecution(dir, started.execution.executionId, unavailable),
    ]) {
      const before = docker.calls.length;
      const closed = close();
      assert.equal(closed.quotaReleased, false);
      assert.equal(docker.calls.length, before);
      assert.equal(readReservation(dir).state, 'held');
    }
  });
});

test("a deadline starts an independent helper without persisting its owner token", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox(
      { workId: "deadline", workName: "deadline", cwd: dir, worktreePath: dir, maxDurationSeconds: 60 },
      { ...docker, supervisorSpawn: supervisorSpawnStub },
    );
    assert.equal(started.ok, true);
    const state = readSupervisor(dir);
    assert.equal(state.ok, true);
    assert.equal(state.supervisor.executionId, started.execution.executionId);
    assert.ok(state.supervisor.supervisorPid);
    assert.equal(state.supervisor.token, undefined);
    assert.ok(!JSON.stringify(state).includes(started.token));
    const finished = finishSandbox(dir, started.execution.executionId, { result: "passed", token: started.token }, docker);
    assert.equal(finished.quotaReleased, true);
    assert.equal(readSupervisor(dir).supervisor, null);
  });
});

test("failed starts return the token and identity while cleanup keeps the reservation", async () => {
  await withRepo(async (dir) => {
    prepareProject(dir);
    const docker = dockerStub();
    const execFileSync = (cmd, args, options) => {
      if (args[0] === "build") throw new Error("fixture build failure");
      if (args[0] === "ps") throw new Error("fixture engine outage");
      return docker.execFileSync(cmd, args, options);
    };
    const started = await startSandbox(
      { workId: "failed", workName: "failed", cwd: dir, worktreePath: dir },
      { ...docker, execFileSync },
    );
    assert.equal(started.ok, false);
    assert.equal(started.resourcesKept, true);
    assert.ok(started.executionId);
    assert.ok(started.token);
    assert.equal(readReservation(dir).state, "held");
  });
});

test("report screening covers caller supplied production differences and fingerprints file content", () => {
  const record = { executionId: "exec", workId: "work", startedAt: new Date(0).toISOString(), capture: { manifest: { files: [{ path: "a.txt", fingerprint: "a" }] } } };
  const refused = buildReport(record, { result: "passed", steps: [], differencesFromProduction: ['password="fixture-only-password-123"'] });
  assert.equal(refused.ok, false);
  assert.doesNotMatch(JSON.stringify(refused), /fixture-only-password-123/);
  const first = buildReport(record, { result: "passed", steps: [], differencesFromProduction: [] });
  const second = buildReport({ ...record, capture: { manifest: { files: [{ path: "a.txt", fingerprint: "b" }] } } }, { result: "passed", steps: [], differencesFromProduction: [] });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.report.capture.fingerprint.length, 64);
  assert.notEqual(first.report.capture.fingerprint, second.report.capture.fingerprint);
  const linkA = buildReport({ ...record, capture: { manifest: { files: [{ path: "inside", kind: "symlink", target: "a" }] } } }, { result: "passed", steps: [], differencesFromProduction: [] });
  const linkB = buildReport({ ...record, capture: { manifest: { files: [{ path: "inside", kind: "symlink", target: "b" }] } } }, { result: "passed", steps: [], differencesFromProduction: [] });
  assert.notEqual(linkA.report.capture.fingerprint, linkB.report.capture.fingerprint);
});

test('recover and cancel retain original runtime evidence after cleanup was blocked', async () => {
  for (const action of ['recover', 'cancel']) await withRepo(async dir => {
    prepareProject(dir);
    const docker = dockerStub();
    const started = await startSandbox({ workId: 'evidence', workName: 'evidence', cwd: dir, worktreePath: dir }, docker);
    const unavailable = { ...docker, lstatSync() { throw new Error('unavailable'); } };
    const finished = finishSandbox(dir, started.execution.executionId, { result: 'passed', token: started.token,
      steps: ['actual runtime observation'], differencesFromProduction: ['prepared database'] }, unavailable);
    assert.equal(finished.cleanup.ok, false);
    const original = readFileSync(finished.reportPath, 'utf8');
    const close = action === 'recover'
      ? () => recoverSandbox(dir, started.execution.executionId, { ...unavailable, token: started.token })
      : () => cancelSandbox(dir, started.execution.executionId, { token: started.token }, unavailable);
    assert.equal(close().quotaReleased, false);
    assert.equal(readFileSync(finished.reportPath, 'utf8'), original);
  });
});
