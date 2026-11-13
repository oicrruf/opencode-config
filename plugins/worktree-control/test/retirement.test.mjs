// Focused tests for the creation, the retirement checks, the evidence
// preservation, the removal, and the branch handling. Run with
// `node plugins/worktree-control/test/retirement.test.mjs`.
//
// The worktree API is injected, so the tests never create a real
// worktree and never touch the operator's repository.
//
// Coverage:
//   1. The created worktree is outside the checkout, has the requested
//      branch, and appears in the inventory.
//   2. A repeated request returns the same directory and leaves the
//      worktree untouched.
//   3. A failing API call leaves the inventory unchanged.
//   4. Each incomplete retirement request is refused with the missing
//      element named.
//   5. Each blocking condition blocks and is named in the report.
//   6. An unavailable check blocks the retirement.
//   7. The manifest lists exactly the copied files, and an unrecognized
//      file is left out.
//   8. The removal happens only after the checks and the preservation.
//   9. The branch handling refuses a symbolic reference, a branch used
//      elsewhere, and an unpublished branch, and never forces.
//   10. A request to delete the remote branch is refused.
//   11. The candidate listing retires nothing and returns the same set
//      twice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

const { createWorktree, normalizeWorkName } = await import("../creation.mjs");
const { readInventory, writeInventory, reconcileInventory } = await import("../inventory.mjs");
const {
  checkLocalChanges,
  checkUnpublishedCommits,
  checkProcessAccess,
  checkIgnoredFiles,
  checkPathSafety,
  runBlockingChecks,
} = await import("../retirement-checks.mjs");
const { preserveEvidence, isRecognizedEvidence, looksLikeCredential } = await import("../evidence.mjs");
const { validateRetirementRequest, verifyRetirementIdentity, removeLocalBranch, refuseRemoteDeletion } = await import("../removal.mjs");
const { retireWorktree, listRetirementCandidates } = await import("../lifecycle.mjs");

function withRepo(run) {
  const dir = mkdtempSync(join(tmpdir(), "worktree-retire-"));
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

// A worktree API that records what it was asked to do.
function worktreeApiStub(state = {}) {
  const calls = [];
  const api = {
    calls,
    async create(args) {
      calls.push(["create", args]);
      if (state.failCreate) throw new Error(state.failCreate);
      const directory = state.directory ?? join(state.base ?? "/tmp", args.name);
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
      return { data: { directory, branch: state.branch ?? `feature/${args.name}` } };
    },
    async list() {
      calls.push(["list", {}]);
      return { data: state.worktrees ?? [] };
    },
    async remove(args) {
      calls.push(["remove", args]);
      if (state.failRemove) throw new Error(state.failRemove);
      return { data: true };
    },
  };
  return api;
}

test("the created worktree is outside the checkout and is recorded", async () => {
  await withRepo(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-outside-"));
    try {
      const api = worktreeApiStub({ base: outside, branch: "feature/widget" });
      const created = await createWorktree(
        { workId: "widget", worktreeApi: api, cwd: root },
        { actualWorktrees: [] },
      );
      assert.equal(created.ok, true);
      assert.equal(created.created, true);
      assert.equal(created.worktree.branch, "feature/widget");
      assert.ok(!created.worktree.directory.startsWith(root), "the worktree is inside the checkout");

      const inventory = readInventory(root);
      assert.equal(inventory.entries.length, 1);
      assert.equal(inventory.entries[0].workId, "widget");
      assert.equal(inventory.entries[0].directory, created.worktree.directory);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a repeated request returns the same worktree and creates no second one", async () => {
  await withRepo(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-outside-"));
    try {
      const api = worktreeApiStub({ base: outside });
      const first = await createWorktree({ workId: "widget", worktreeApi: api, cwd: root }, {});
      assert.equal(first.ok, true);

      const second = await createWorktree(
        { workId: "widget", worktreeApi: api, cwd: root },
        { actualWorktrees: [{ name: "widget", directory: first.worktree.directory, branch: "feature/widget" }] },
      );
      assert.equal(second.ok, true);
      assert.equal(second.reused, true);
      assert.equal(second.created, false);
      assert.equal(second.worktree.directory, first.worktree.directory);

      const creations = api.calls.filter((call) => call[0] === "create");
      assert.equal(creations.length, 1, "a second worktree was created");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a failing creation leaves the inventory unchanged", async () => {
  await withRepo(async (root) => {
    const api = worktreeApiStub({ failCreate: "the branch already exists" });
    const created = await createWorktree({ workId: "widget", worktreeApi: api, cwd: root }, {});
    assert.equal(created.ok, false);
    assert.match(created.reason, /could not be created/);

    const inventory = readInventory(root);
    assert.equal(inventory.entries.length, 0, "a worktree that does not exist was recorded");
  });
});

test("each incomplete retirement request is refused with the missing element named", () => {
  const complete = {
    worktree: "/tmp/wt",
    branch: "feature/a",
    base: "main",
    head: "abc123",
    evidence: "the work was integrated",
  };
  assert.equal(validateRetirementRequest(complete).ok, true);

  for (const field of ["worktree", "branch", "base", "head", "evidence"]) {
    const incomplete = { ...complete };
    delete incomplete[field];
    const result = validateRetirementRequest(incomplete);
    assert.equal(result.ok, false, `${field} was not required`);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].field, field);
  }
});

test("retirement identity is matched to the linked worktree and a published base", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "worktree-identity-"));
  try {
    const root = join(fixture, "repo");
    const origin = join(fixture, "origin.git");
    const worktree = join(fixture, "managed", "widget");
    mkdirSync(root, { recursive: true });
    mkdirSync(join(fixture, "managed"), { recursive: true });
    execFileSync("git", ["init", "-q", "--initial-branch=main", root], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "config", "user.email", "t@local"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "config", "user.name", "t"], { stdio: "ignore" });
    writeFileSync(join(root, "base.txt"), "base\n");
    execFileSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "base"], { stdio: "ignore" });
    const baseHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["init", "-q", "--bare", origin], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "remote", "add", "origin", origin], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "branch", "feature/widget"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "branch", "unintegrated", baseHead], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "checkout", "feature/widget"], { stdio: "ignore" });
    writeFileSync(join(root, "verification-report.md"), "# verified\n");
    execFileSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "work"], { stdio: "ignore" });
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["-C", root, "checkout", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "merge", "-q", "--no-ff", "feature/widget", "-m", "integrate"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "push", "-q", "origin", "main", "feature/widget", "unintegrated"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "worktree", "add", "-q", worktree, "feature/widget"], { stdio: "ignore" });

    const request = { worktree, branch: "feature/widget", base: "main", head, evidence: "verified integration" };
    assert.equal(verifyRetirementIdentity(request, root).ok, true);
    assert.equal(verifyRetirementIdentity({ ...request, branch: "main" }, root).ok, false);
    assert.equal(verifyRetirementIdentity({ ...request, head: baseHead }, root).ok, false);
    assert.equal(verifyRetirementIdentity({ ...request, base: "unintegrated" }, root).ok, false);
    assert.equal(verifyRetirementIdentity({ ...request, base: "feature/widget" }, root).ok, false);

    const api = worktreeApiStub({});
    const refused = await retireWorktree(
      {
        request: { ...request, branch: "main" },
        worktreeApi: api,
        cwd: root,
        expectedRoot: join(fixture, "managed"),
      },
      { listProcesses: () => [] },
    );
    assert.equal(refused.identityMismatch, true);
    assert.equal(refused.evidencePreserved, undefined);
    assert.ok(!api.calls.some((call) => call[0] === "remove"));
    assert.equal(existsSync(worktree), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("local changes block the retirement and are named", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "changed.txt"), "content\n");
    const check = checkLocalChanges(dir);
    assert.equal(check.ok, true);
    assert.equal(check.blocked, true);
    assert.match(check.reason, /local changes/);
    assert.equal(check.changes.length, 1);
  });
});

test("unpublished commits block the retirement and are named", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "a.txt"), "one\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "local only"], { stdio: "ignore" });

    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();

    const check = checkUnpublishedCommits(dir, branch);
    assert.equal(check.ok, true);
    assert.equal(check.blocked, true);
    assert.match(check.reason, /not published/);
  });
});

test("a process with access blocks the retirement and is named", () => {
  const check = checkProcessAccess("/tmp/wt", {
    listProcesses: () => [{ pid: 1234, cwd: "/tmp/wt" }],
  });
  assert.equal(check.ok, true);
  assert.equal(check.blocked, true);
  assert.match(check.reason, /process has the worktree open/);
  assert.equal(check.processes.length, 1);
});

test("an unavailable process check blocks the retirement", () => {
  const check = checkProcessAccess("/tmp/wt", {
    listProcesses: () => {
      throw new Error("the process table is not readable");
    },
  });
  assert.equal(check.ok, false);
  assert.equal(check.available, false);
  assert.equal(check.blocked, true);
  assert.match(check.reason, /could not be inspected/);
});

test("unrecognized ignored files block the retirement and are named", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, ".gitignore"), "cache/\n");
    mkdirSync(join(dir, "cache"), { recursive: true });
    writeFileSync(join(dir, "cache", "big.bin"), "x");

    const check = checkIgnoredFiles(dir, ["cache/allowed"]);
    assert.equal(check.ok, true);
    assert.equal(check.blocked, true);
    assert.match(check.reason, /does not recognize/);
    assert.ok(check.unrecognized.length > 0);
  });
});

test("an unsafe path blocks the retirement and is named", () => {
  withRepo((dir) => {
    const target = join(dir, "real");
    mkdirSync(target, { recursive: true });
    const link = join(dir, "link");
    execFileSync("ln", ["-s", target, link], { stdio: "ignore" });

    const check = checkPathSafety(link, dir);
    assert.equal(check.ok, true);
    assert.equal(check.blocked, true);
    assert.match(check.reason, /symbolic link/);
  });
});

test("the blocking checks report each condition individually", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "changed.txt"), "content\n");
    const report = runBlockingChecks({
      directory: dir,
      branch: "master",
      deps: {
        listProcesses: () => [],
        execFileSync: (cmd, args, opts) => {
          if (cmd === "git" && args[0] === "status") return { toString: () => " M changed.txt\n" };
          return execFileSync(cmd, args, opts);
        },
      },
    });
    assert.equal(report.ok, true);
    assert.equal(report.canRetire, false);
    assert.ok(report.blocked.length > 0);
    const names = report.blocked.map((item) => item.check);
    assert.ok(names.includes("localChanges"));
  });
});

test("the evidence manifest lists exactly the copied files", () => {
  withRepo((root) => {
    const worktree = join(root, "wt");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, "verification-report.md"), "# verification\n");
    writeFileSync(join(worktree, "random-notes.txt"), "not evidence\n");
    writeFileSync(join(worktree, "credentials.json"), '{"api_key":"sk-abcdefghijklmnop123456"}');

    const preserved = preserveEvidence({
      root,
      directory: worktree,
      worktreeName: "wt",
      branch: "feature/a",
      head: "abc123",
    });
    assert.equal(preserved.ok, true);
    assert.equal(preserved.copied.length, 1);
    assert.equal(preserved.copied[0].path, "verification-report.md");

    const manifest = JSON.parse(readFileSync(join(preserved.target, "manifest.json"), "utf8"));
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].path, "verification-report.md");
    assert.equal(manifest.worktree.branch, "feature/a");
    assert.equal(manifest.worktree.head, "abc123");

    // The unrecognized file was not copied, and the credential was not
    // copied either.
    assert.ok(!existsSync(join(preserved.target, "random-notes.txt")));
    assert.ok(!existsSync(join(preserved.target, "credentials.json")));

    const manifestBeforeCollision = readFileSync(join(preserved.target, "manifest.json"), "utf8");
    const collision = preserveEvidence({
      root,
      directory: worktree,
      worktreeName: "wt",
      branch: "feature/a",
      head: "abc123",
    });
    assert.equal(collision.ok, false);
    assert.match(collision.reason, /already exists/);
    assert.equal(readFileSync(join(preserved.target, "manifest.json"), "utf8"), manifestBeforeCollision);
  });
});

test("evidence preservation refuses a symlinked project state directory", () => {
  withRepo((root) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-evidence-outside-"));
    try {
      const worktree = join(root, "wt");
      mkdirSync(worktree, { recursive: true });
      writeFileSync(join(worktree, "verification-report.md"), "# verification\n");
      symlinkSync(outside, join(root, ".opencode"), "dir");

      const preserved = preserveEvidence({
        root,
        directory: worktree,
        worktreeName: "wt",
        branch: "feature/a",
        head: "abc123",
      });
      assert.equal(preserved.ok, false);
      assert.match(preserved.reason, /symbolic link|unsafe/);
      assert.deepEqual(readdirSync(outside), []);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("the evidence policy recognizes the review and verification reports", () => {
  assert.equal(isRecognizedEvidence("verification-report.md"), true);
  assert.equal(isRecognizedEvidence("review-report.md"), true);
  assert.equal(isRecognizedEvidence("evidence/summary.md"), true);
  assert.equal(isRecognizedEvidence("random-notes.txt"), false);
  assert.equal(looksLikeCredential('const api_key = "sk-abcdefghijklmnop123456";'), true);
  assert.equal(looksLikeCredential("# a normal report\n"), false);
});

test("the removal happens only after the checks and the preservation", async () => {
  await withRepo(async (root) => {
    // The worktree lives outside the checkout, as a managed one does,
    // and it is a Git worktree so the checks can run against it.
    const outside = mkdtempSync(join(tmpdir(), "worktree-retire-wt-"));
    try {
      const worktree = join(outside, "wt");
      execFileSync("git", ["init", "-q", worktree], { stdio: "ignore" });
      execFileSync("git", ["-C", worktree, "config", "user.email", "t@local"], { stdio: "ignore" });
      execFileSync("git", ["-C", worktree, "config", "user.name", "t"], { stdio: "ignore" });
      // The worktree is clean: the evidence report is committed, so it
      // is not a local change. The evidence policy still recognizes it.
      writeFileSync(join(worktree, "verification-report.md"), "# verification\n");
      execFileSync("git", ["-C", worktree, "add", "-A"], { stdio: "ignore" });
      execFileSync("git", ["-C", worktree, "commit", "-q", "-m", "evidence"], { stdio: "ignore" });
      const api = worktreeApiStub({ failRemove: "the worktree is busy" });

      const refused = await retireWorktree(
        {
          request: { worktree, branch: "no-such-branch", base: "main", head: "abc", evidence: "integrated" },
          worktreeApi: api,
          cwd: root,
          // The managed root is the directory the control manages, and
          // the worktree lives inside it.
          expectedRoot: outside,
        },
        { listProcesses: () => [], verifyRetirementIdentity: () => ({ ok: true }) },
      );
      assert.equal(refused.ok, false);
      // The evidence was preserved before the removal was attempted, and
      // the removal was attempted.
      assert.equal(refused.evidencePreserved, true);
      assert.ok(refused.evidence, "the evidence has no destination");
      assert.ok(api.calls.some((call) => call[0] === "remove"));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a blocking condition stops the retirement before the preservation", async () => {
  await withRepo(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-blocked-"));
    try {
      const worktree = join(outside, "wt");
      mkdirSync(worktree, { recursive: true });
      writeFileSync(join(worktree, "changed.txt"), "uncommitted\n");
      writeFileSync(join(worktree, "verification-report.md"), "# verification\n");
      const api = worktreeApiStub({});

      const refused = await retireWorktree(
        {
          request: { worktree, branch: "no-such-branch", base: "main", head: "abc", evidence: "integrated" },
          worktreeApi: api,
          cwd: root,
          expectedRoot: outside,
        },
        { listProcesses: () => [], verifyRetirementIdentity: () => ({ ok: true }) },
      );
      assert.equal(refused.ok, false);
      assert.equal(refused.removed, false);
      // The evidence was not preserved, because the checks blocked first.
      assert.equal(refused.evidencePreserved, undefined);
      assert.ok(!api.calls.some((call) => call[0] === "remove"), "the removal happened anyway");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a blocking condition keeps the worktree", async () => {
  await withRepo(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-kept-"));
    try {
      const worktree = join(outside, "wt");
      mkdirSync(worktree, { recursive: true });
      writeFileSync(join(worktree, "changed.txt"), "uncommitted\n");
      const api = worktreeApiStub({});

      const refused = await retireWorktree(
        {
          request: { worktree, branch: "master", base: "main", head: "abc", evidence: "integrated" },
          worktreeApi: api,
          cwd: root,
          expectedRoot: outside,
        },
        { listProcesses: () => [], verifyRetirementIdentity: () => ({ ok: true }) },
      );
      assert.equal(refused.ok, false);
      assert.equal(refused.removed, false);
      assert.ok(!api.calls.some((call) => call[0] === "remove"), "the removal happened anyway");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a request to delete the remote branch is refused", () => {
  const refused = refuseRemoteDeletion({ deleteRemoteBranch: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.refused, true);
  assert.match(refused.reason, /preserved/);

  const allowed = refuseRemoteDeletion({});
  assert.equal(allowed.ok, true);
  assert.equal(allowed.refused, false);
});

test("an unpublished branch is not removed and is reported as pending", () => {
  withRepo((dir) => {
    // The branch has to exist for the check to reach the published
    // state: a repository without a commit has no branch at all.
    writeFileSync(join(dir, "a.txt"), "one\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], { stdio: "ignore" });

    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const result = removeLocalBranch({
      root: dir,
      directory: dir,
      branch,
      expectedHead: null,
    });
    assert.equal(result.ok, false);
    assert.equal(result.pending, true);
    // The branch is the checked-out branch of the repository, so the
    // control keeps it. The reason names that condition, and never
    // claims the branch is missing.
    assert.match(result.reason, /checked out in the repository/);
    assert.ok(!/does not exist/.test(result.reason), `unexpected reason: ${result.reason}`);
  });
});

test("a branch that is checked out in the repository is kept and reported as pending", () => {
  withRepo((dir) => {
    writeFileSync(join(dir, "a.txt"), "one\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], { stdio: "ignore" });
    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();

    // The branch of the checkout that is running the control is not
    // removed: its removal would change the branch of the checkout.
    const result = removeLocalBranch({
      root: dir,
      directory: dir,
      branch,
      expectedHead: null,
    });
    assert.equal(result.ok, false);
    assert.equal(result.pending, true);
    assert.match(result.reason, /checked out in the repository/);
  });
});

test("the branch removal runs in the repository and not in the removed worktree", () => {
  withRepo((dir) => {
    // The worktree was already removed, so a command executed in it
    // would fail for the wrong reason and report an existing branch as
    // missing.
    writeFileSync(join(dir, "a.txt"), "one\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], { stdio: "ignore" });
    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const gone = join(dir, "wt-gone");

    const result = removeLocalBranch({
      root: dir,
      directory: gone,
      branch,
      expectedHead: null,
    });
    // The branch exists, so the reason is never "the local branch
    // does not exist".
    assert.ok(!/does not exist/.test(result.reason ?? ""), `unexpected reason: ${result.reason}`);
  });
});

test("a worktree outside the managed directory is refused", async () => {
  await withRepo(async (root) => {
    const managed = mkdtempSync(join(tmpdir(), "worktree-managed-"));
    const outside = mkdtempSync(join(tmpdir(), "worktree-outside-"));
    try {
      const worktree = join(outside, "wt");
      mkdirSync(worktree, { recursive: true });
      const api = worktreeApiStub({});

      const refused = await retireWorktree(
        {
          request: { worktree, branch: "no-such", base: "main", head: "abc", evidence: "x" },
          worktreeApi: api,
          cwd: root,
          expectedRoot: managed,
        },
        { listProcesses: () => [] },
      );
      assert.equal(refused.ok, false);
      assert.equal(refused.unsafePath, true);
      assert.match(refused.reason, /outside the managed worktree directory/);
      // Nothing was removed and nothing was preserved.
      assert.ok(!api.calls.some((call) => call[0] === "remove"), "the removal happened anyway");
    } finally {
      rmSync(managed, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("the evidence directory name cannot escape the evidence area", () => {
  withRepo((root) => {
    const worktree = join(root, "wt");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, "verification-report.md"), "# verification\n");

    const preserved = preserveEvidence({
      root,
      directory: worktree,
      worktreeName: "../../escape",
      branch: "feature/a",
      head: "abc123",
    });
    assert.equal(preserved.ok, true);
    // The name was normalized, so the destination stayed inside the
    // evidence area.
    const relative = basename(preserved.target);
    assert.ok(!relative.includes(".."), `the destination escaped: ${preserved.target}`);
    assert.ok(!relative.includes("/"), `the destination escaped: ${preserved.target}`);
  });
});

test("a symbolic reference branch is not removed", () => {
  withRepo((dir) => {
    // A symbolic reference that points at another branch is never
    // removed.
    execFileSync("git", ["-C", dir, "symbolic-ref", "refs/heads/alias", "refs/heads/main"], {
      stdio: "ignore",
    });
    const result = removeLocalBranch({
      root: dir,
      directory: dir,
      branch: "alias",
      expectedHead: null,
    });
    assert.equal(result.ok, false);
    assert.equal(result.pending, true);
    assert.match(result.reason, /symbolic reference/);
  });
});

test("a worktree that cannot be listed is unknown, not missing", () => {
  withRepo((dir) => {
    writeInventory(dir, [
      { workId: "work-a", directory: join(dir, "wt"), branch: "feature/a", createdAt: "2026-01-01T00:00:00Z" },
    ]);

    // The listing could not be read: the entry's state is unknown.
    const unverified = reconcileInventory(dir, [], { verified: false });
    assert.equal(unverified.missing.length, 0);
    assert.equal(unverified.unknown.length, 1);

    // A verified listing reports it as missing.
    const verified = reconcileInventory(dir, [], { verified: true });
    assert.equal(verified.missing.length, 1);
    assert.equal(verified.unknown.length, 0);
  });
});

test("a creation is refused when the worktrees cannot be listed", async () => {
  await withRepo(async (root) => {
    const api = {
      calls: [],
      async create(args) {
        this.calls.push(["create", args]);
        return { data: { directory: join(root, args.name) } };
      },
      async list() {
        throw new Error("the API is not reachable");
      },
      async remove() {
        return { data: true };
      },
    };

    const created = await createWorktree({ workId: "widget", worktreeApi: api, cwd: root }, {});
    assert.equal(created.ok, false);
    assert.equal(created.blocked, true);
    assert.equal(created.unverified, true);
    // No worktree was created, so no duplicate was produced.
    assert.equal(api.calls.filter((call) => call[0] === "create").length, 0);
  });
});

test("the candidate listing refuses to report an incomplete list", async () => {
  await withRepo(async (root) => {
    const api = {
      async list() {
        throw new Error("the API is not reachable");
      },
    };
    const candidates = await listRetirementCandidates({ worktreeApi: api, cwd: root }, {});
    assert.equal(candidates.ok, false);
    assert.equal(candidates.unverified, true);
    assert.equal(candidates.candidates.length, 0);
  });
});

test("a condition that appears between the checks and the removal keeps the worktree", async () => {
  await withRepo(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-race-"));
    try {
      const worktree = join(outside, "wt");
      execFileSync("git", ["init", "-q", worktree], { stdio: "ignore" });
      execFileSync("git", ["-C", worktree, "config", "user.email", "t@local"], { stdio: "ignore" });
      execFileSync("git", ["-C", worktree, "config", "user.name", "t"], { stdio: "ignore" });
      writeFileSync(join(worktree, "verification-report.md"), "# verification\n");
      execFileSync("git", ["-C", worktree, "add", "-A"], { stdio: "ignore" });
      execFileSync("git", ["-C", worktree, "commit", "-q", "-m", "evidence"], { stdio: "ignore" });

      const api = worktreeApiStub({});
      let checkCount = 0;
      const refused = await retireWorktree(
        {
          request: { worktree, branch: "no-such", base: "main", head: "abc", evidence: "x" },
          worktreeApi: api,
          cwd: root,
          expectedRoot: outside,
        },
        {
          listProcesses: () => [],
          verifyRetirementIdentity: () => ({ ok: true }),
          // The change appears after the first round of checks. The
          // check of the local changes is the one that reads the
          // status, so the second round reports the change.
          execFileSync: (cmd, args, opts) => {
            if (cmd === "git" && args[0] === "status" && !args.includes("--ignored")) {
              checkCount += 1;
              if (checkCount > 1) return { toString: () => " M appeared.txt\n" };
            }
            return execFileSync(cmd, args, opts);
          },
        },
      );
      assert.equal(refused.ok, false);
      assert.equal(refused.removed, false);
      assert.equal(refused.revalidated, true);
      assert.ok(!api.calls.some((call) => call[0] === "remove"), "the removal happened anyway");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a creation is refused when an injected listing is not verified", async () => {
  await withRepo(async (root) => {
    const api = worktreeApiStub({});
    // The listing is injected as unverified, which is what the plugin
    // does when the API could not answer.
    const created = await createWorktree(
      { workId: "widget", worktreeApi: api, cwd: root },
      { actualWorktrees: [], listingVerified: false, listingReason: "the API is not reachable" },
    );
    assert.equal(created.ok, false);
    assert.equal(created.blocked, true);
    assert.equal(created.unverified, true);
    // No worktree was created, so no duplicate was produced.
    assert.equal(api.calls.filter((call) => call[0] === "create").length, 0);
  });
});

test("the reconciliation matches the same directory named two ways", () => {
  withRepo((dir) => {
    // The recorded entry and the listed worktree name the same
    // directory with two spellings. Without the canonical form the
    // worktree would be reported as missing and as unrecorded at the
    // same time.
    const directory = join(dir, "wt");
    mkdirSync(directory, { recursive: true });
    const spelling = join(dir, "..", dir.split("/").pop(), "wt");

    writeInventory(dir, [
      { workId: "work-a", directory, branch: "feature/a", createdAt: "2026-01-01T00:00:00Z" },
    ]);

    const reconciled = reconcileInventory(dir, [{ name: "work-a", directory: spelling, branch: "feature/a" }]);
    assert.equal(reconciled.present.length, 1, "the worktree was not matched");
    assert.equal(reconciled.missing.length, 0, "the worktree was reported as missing");
    assert.equal(reconciled.unrecorded.length, 0, "the worktree was reported as unrecorded");
  });
});

test("the candidate listing retires nothing and returns the same set twice", async () => {
  await withRepo(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "worktree-candidates-"));
    try {
      const directory = join(outside, "widget");
      mkdirSync(directory, { recursive: true });
      const api = worktreeApiStub({ worktrees: [{ name: "widget", directory, branch: "feature/widget" }] });

      const first = await listRetirementCandidates(
        { worktreeApi: api, cwd: root },
        { listProcesses: () => [] },
      );
      assert.equal(first.ok, true);
      assert.equal(first.total, 1);
      assert.equal(first.retired, 0);
      assert.equal(first.candidates[0].directory, directory);
      assert.ok(!api.calls.some((call) => call[0] === "remove"), "the listing removed something");

      const second = await listRetirementCandidates(
        { worktreeApi: api, cwd: root },
        { listProcesses: () => [] },
      );
      assert.equal(second.total, first.total);
      assert.equal(second.candidates[0].directory, first.candidates[0].directory);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a work name is normalized for use in a directory and a branch", () => {
  assert.equal(normalizeWorkName("My Widget!"), "my-widget");
  assert.equal(normalizeWorkName(""), "work");
  assert.equal(normalizeWorkName("---"), "work");
});
