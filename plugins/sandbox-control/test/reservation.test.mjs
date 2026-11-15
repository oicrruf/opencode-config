// Focused tests for the reservation, the quota, and the local execution
// rules. Run with `node plugins/sandbox-control/test/reservation.test.mjs`.
//
// These tests never launch a real application: the process helpers are
// injected, and every filesystem operation happens inside a temporary
// directory that is removed afterwards.
//
// Coverage:
//   1. A second start is refused and names the work that holds the quota.
//   2. A release requires the identity and the absence of the resources.
//   3. The owner token is not stored in clear text.
//   4. A credential-shaped argument is refused.
//   5. A wrong token refuses the stop and signals nothing.
//   6. The ambiguity rules each block the next start.
//   7. The recovery proceeds only on a confirmed owner and an empty group.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const { acquireReservation, readReservation, releaseReservation, verifyOwner, evaluateRecovery } =
  await import("../reservation.mjs");
const {
  startLocalExecution,
  stopLocalExecution,
  evaluateAmbiguity,
  recoverReservation,
  confirmManagedWorktree,
} = await import("../execution.mjs");

function withTempRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-reservation-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
    const result = run(dir);
    // An async body returns a promise: the directory must outlive it.
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

const fakeWorktreeApi = {
  list: async () => [
    { workId: "work-1", exists: true, directory: "/tmp/work-1" },
    { workId: "work-2", exists: true, directory: "/tmp/work-2" },
  ],
};

test("a second start is refused and names the holding work", () => {
  withTempRepo((dir) => {
    const first = acquireReservation(dir, { workId: "work-1", workName: "work one" });
    assert.equal(first.ok, true);

    const second = acquireReservation(dir, { workId: "work-2", workName: "work two" });
    assert.equal(second.ok, false);
    assert.equal(second.blocked, true);
    assert.equal(second.heldBy.workId, "work-1");
    assert.match(second.reason, /held by another session/);
  });
});

test("a release requires the identity and the absence of the resources", () => {
  withTempRepo((dir) => {
    const acquired = acquireReservation(dir, { workId: "work-1" });
    assert.equal(acquired.ok, true);

    const wrongIdentity = releaseReservation(dir, "not-the-token", { resourcesAbsent: true });
    assert.equal(wrongIdentity.ok, false);
    assert.equal(wrongIdentity.released, false);

    const resourcesPresent = releaseReservation(dir, acquired.token, { resourcesAbsent: false });
    assert.equal(resourcesPresent.ok, false);
    assert.equal(resourcesPresent.released, false);
    assert.match(resourcesPresent.reason, /resources it owns are still present/);

    // The reservation is still held after both refusals.
    assert.equal(readReservation(dir).state, "held");

    const released = releaseReservation(dir, acquired.token, { resourcesAbsent: true });
    assert.equal(released.ok, true);
    assert.equal(readReservation(dir).state, "free");
  });
});

test("the owner token is not stored in clear text", () => {
  withTempRepo((dir) => {
    const acquired = acquireReservation(dir, { workId: "work-1" });
    const record = readReservation(dir).reservation;
    const onDisk = JSON.stringify(record);
    assert.ok(!onDisk.includes(acquired.token), "the token is stored in clear text");
    assert.ok(record.ownerHash, "no verifier was stored");
    assert.ok(record.ownerSalt, "no salt was stored");
  });
});

test("a credential-shaped argument is refused", async () => {
  await withTempRepo(async (dir) => {
    const result = await startLocalExecution(
      dir,
      {
        workId: "work-1",
        executable: "/bin/echo",
        args: ["--api-key", "abcdef1234567890"],
        worktreeApi: fakeWorktreeApi,
      },
      { spawn: () => ({ pid: 4242 }) },
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /credential/);
    // Nothing was launched and nothing was reserved.
    assert.equal(readReservation(dir).state, "free");
  });
});

test("a launch that fails asynchronously gives the reservation back", async () => {
  await withTempRepo(async (dir) => {
    // A process that cannot be launched reports the failure through an
    // `error` event instead of throwing, so the reservation would stay
    // held without the release.
    const spawn = () => {
      const handlers = {};
      return {
        pid: undefined,
        once(event, handler) {
          handlers[event] = handler;
          if (event === "error") {
            setTimeout(() => handler(new Error("the executable was not found")), 5);
          }
          return this;
        },
      };
    };

    const result = await startLocalExecution(
      dir,
      {
        workId: "work-1",
        executable: "/bin/definitely-missing",
        args: [],
        worktreeApi: fakeWorktreeApi,
      },
      { spawn },
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /could not be started/);
    // The reservation was given back, so the next start is not blocked.
    assert.equal(readReservation(dir).state, "free");
  });
});

test("a work without a managed worktree is refused", async () => {
  await withTempRepo(async (dir) => {
    const result = await startLocalExecution(
      dir,
      { workId: "work-missing", executable: "/bin/echo", args: [], worktreeApi: fakeWorktreeApi },
      { spawn: () => ({ pid: 4242 }) },
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /no managed worktree/);
  });
});

test("a wrong token refuses the stop and signals nothing", async () => {
  await withTempRepo(async (dir) => {
    const acquired = acquireReservation(dir, { workId: "work-1", processGroup: 4242 });
    let signalled = false;
    const result = await stopLocalExecution(dir, "wrong-token", {
      kill: () => {
        signalled = true;
      },
      listProcesses: () => [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.signalled, false);
    assert.equal(signalled, false);
    assert.equal(readReservation(dir).state, "held");
    void acquired;
  });
});

test("the ambiguity rules each block the next start", () => {
  withTempRepo((dir) => {
    acquireReservation(dir, { workId: "work-1", processGroup: 4242 });

    const identity = evaluateAmbiguity(dir, { identityMatches: false });
    assert.equal(identity.blocked, true);
    assert.match(identity.reason, /identity does not match/);

    const processes = evaluateAmbiguity(dir, { groupHasProcesses: true });
    assert.equal(processes.blocked, true);
    assert.match(processes.reason, /still has processes/);

    const unknown = evaluateAmbiguity(dir, { groupStateKnown: false });
    assert.equal(unknown.blocked, true);
    assert.match(unknown.reason, /unverifiable/);

    const clear = evaluateAmbiguity(dir, {});
    assert.equal(clear.blocked, false);
  });
});

test("the recovery proceeds only on a confirmed owner and an empty group", () => {
  withTempRepo((dir) => {
    const acquired = acquireReservation(dir, { workId: "work-1", processGroup: 4242 });

    const unconfirmed = evaluateRecovery(dir, { ownerEnded: null, groupHasProcesses: false });
    assert.equal(unconfirmed.recoverable, false);
    assert.match(unconfirmed.reason, /could not be confirmed/);

    const groupNotEmpty = evaluateRecovery(dir, { ownerEnded: true, groupHasProcesses: true });
    assert.equal(groupNotEmpty.recoverable, false);
    assert.match(groupNotEmpty.reason, /not confirmed to be empty/);

    const confirmed = evaluateRecovery(dir, { ownerEnded: true, groupHasProcesses: false });
    assert.equal(confirmed.recoverable, true);

    const wrongToken = recoverReservation(dir, {
      token: "wrong",
    }, { inspectOwner: () => ({ ok: true, ended: true }), listProcesses: () => [] });
    assert.equal(wrongToken.ok, false);
    assert.equal(readReservation(dir).state, "held");

    const released = recoverReservation(dir, {
      token: acquired.token,
    }, { inspectOwner: () => ({ ok: true, ended: true }), listProcesses: () => [] });
    assert.equal(released.ok, true);
    assert.equal(released.recoveredFrom, "work-1");
    assert.equal(readReservation(dir).state, "free");
  });
});

test("recovery inspects owner and process group and refuses generic sandbox release", () => {
  withTempRepo((dir) => {
    const acquired = acquireReservation(dir, { workId: "work-1", processGroup: 4242 });
    const liveOwner = recoverReservation(dir, { token: acquired.token }, { listProcesses: () => [] });
    assert.equal(liveOwner.released, false);
    assert.equal(readReservation(dir).state, "held");
    const activeOwner = recoverReservation(dir, { token: acquired.token }, {
      inspectOwner: () => ({ ok: true, ended: false }), listProcesses: () => [],
    });
    assert.equal(activeOwner.released, false);
    assert.equal(readReservation(dir).state, "held");
    const runningGroup = recoverReservation(dir, { token: acquired.token }, {
      inspectOwner: () => ({ ok: true, ended: true }), listProcesses: () => [{ pid: 7, pgid: 4242 }],
    });
    assert.equal(runningGroup.released, false);
    assert.equal(readReservation(dir).state, "held");
    releaseReservation(dir, acquired.token, { resourcesAbsent: true });

    const sandbox = acquireReservation(dir, { workId: "sandbox", scope: "sandbox", executionId: "exec-1" });
    assert.equal(sandbox.ok, true);
    const generic = recoverReservation(dir, { token: sandbox.token });
    assert.equal(generic.released, false);
    assert.match(generic.reason, /sandbox_recover/);
    assert.equal(readReservation(dir).state, "held");
  });
});

test("the worktree confirmation reports a missing work", async () => {
  const missing = await confirmManagedWorktree(fakeWorktreeApi, "work-absent");
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /no managed worktree/);

  const unavailable = await confirmManagedWorktree(null, "work-1");
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.reason, /not available/);

  const adapted = await confirmManagedWorktree({ list: async () => ({ data: [
    { workId: "work-1", exists: true, directory: "/tmp/work-1" },
  ] }) }, "work-1");
  assert.equal(adapted.ok, true);
  assert.equal(adapted.worktree.directory, "/tmp/work-1");
});

test("the verification of a presented token never leaks the token", () => {
  withTempRepo((dir) => {
    const acquired = acquireReservation(dir, { workId: "work-1" });
    const verified = verifyOwner(dir, acquired.token);
    assert.equal(verified.ok, true);
    assert.equal(verified.verified, true);
    assert.ok(!JSON.stringify(verified).includes(acquired.token), "the token was echoed back");
  });
});
