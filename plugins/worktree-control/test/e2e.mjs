// The end-to-end exercise of the worktree control on a real repository.
//
// The worktree API is emulated over the real `git worktree` commands,
// so the control's own logic — the inventory, the checks, the evidence
// preservation, the removal, and the branch handling — runs against a
// real worktree with a real published branch.
//
// The exercise builds its own throwaway repository and its own bare
// remote inside a temporary directory. It never touches a repository
// the operator cares about, and it never pushes anywhere but into that
// local bare remote.
//
// Usage:
//   node plugins/worktree-control/test/e2e.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree } from "../creation.mjs";
import { describeInventory } from "../inventory.mjs";
import { reportCapacity } from "../capacity.mjs";
import { retireWorktree, listRetirementCandidates } from "../lifecycle.mjs";
import { readInventory } from "../inventory.mjs";

// The fixture: a throwaway repository and a throwaway bare remote.
const sandbox = mkdtempSync(join(tmpdir(), "worktree-e2e-"));
const root = join(sandbox, "repo");
const remotePath = join(sandbox, "remote.git");
// The directory the control manages. The fixture points it at the
// sandbox, so the exercise never writes outside its own area.
const managedRoot = join(sandbox, "managed-worktrees");
mkdirSync(root, { recursive: true });

const run = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

run(["init", "-q", "--initial-branch=main", "."], root);
run(["config", "user.email", "e2e@local"], root);
run(["config", "user.name", "e2e"], root);
writeFileSync(join(root, "file.txt"), "probe\n");
run(["add", "-A"], root);
run(["commit", "-q", "-m", "initial"], root);
run(["init", "-q", "--bare", remotePath], root);
run(["remote", "add", "origin", remotePath], root);
run(["push", "-q", "origin", "HEAD:main"], root);

const git = (args, cwd = root) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * The worktree API over the real Git commands.
 */
const api = {
  async list() {
    const out = git(["worktree", "list", "--porcelain"]);
    const entries = [];
    let current = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        current = { directory: line.slice("worktree ".length), branch: null };
        entries.push(current);
        continue;
      }
      if (line.startsWith("branch ") && current) {
        current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      }
    }
    return { data: entries };
  },
  async create({ name, branch }) {
    // The worktree lives under the directory the control manages, which
    // is where the runtime places it. The fixture points that
    // directory at the sandbox, so the exercise never writes outside
    // its own temporary area.
    const directory = join(managedRoot, `wt-${name}`);
    mkdirSync(managedRoot, { recursive: true });
    git(["worktree", "add", "-b", branch ?? `feature/${name}`, directory]);
    return { data: { directory, branch: branch ?? `feature/${name}` } };
  },
  async remove({ directory }) {
    // The removal is not forced: the control has already verified that
    // the worktree holds nothing that would be lost.
    git(["worktree", "remove", directory]);
    return { data: true };
  },
};

const report = (label, value) => {
  console.log(`\n--- ${label} ---`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 1));
};

// 1. The creation records the worktree in the inventory.
const created = await createWorktree(
  { workId: "e2e-work", branch: "feature/e2e", worktreeApi: api, cwd: root },
  { actualWorktrees: (await api.list()).data },
);
report("creation", {
  ok: created.ok,
  created: created.created,
  directory: created.worktree?.directory,
  branch: created.worktree?.branch,
});
const worktreeDir = created.worktree.directory;

// 2. The inventory reports it.
const inventory = describeInventory(root, (await api.list()).data);
report("inventory", {
  total: inventory.total,
  present: inventory.present,
  missing: inventory.missing,
  unrecorded: inventory.unrecorded,
  worktrees: inventory.worktrees,
});

// 3. The capacity report announces no limit.
const capacity = reportCapacity(root, inventory.total);
report("capacity", {
  available: capacity.available,
  availableBytes: capacity.availableBytes,
  worktrees: capacity.worktrees,
  maximum: capacity.maximum,
  remaining: capacity.remaining,
});

// 4. A retirement request with an incomplete identity is refused.
const incomplete = await retireWorktree(
  { request: { worktree: worktreeDir }, worktreeApi: api, cwd: root },
  {},
);
report("incomplete request", {
  ok: incomplete.ok,
  reason: incomplete.reason,
  missing: incomplete.missing?.map((entry) => entry.field),
});

// 5. The candidate listing retires nothing.
const candidates = await listRetirementCandidates(
  { worktreeApi: api, cwd: root, expectedRoot: managedRoot },
  {},
);
report("candidates", {
  total: candidates.total,
  retired: candidates.retired,
  first: candidates.candidates[0]
    ? {
        directory: candidates.candidates[0].directory,
        branch: candidates.candidates[0].branch,
        candidate: candidates.candidates[0].candidate,
        reason: candidates.candidates[0].reason,
      }
    : null,
});

// 6. The evidence of the worktree is written, and the branch is
//    published so the retirement is not blocked by the published
//    state. The push goes to the throwaway bare remote of the
//    fixture, never anywhere else.
writeFileSync(`${worktreeDir}/verification-report.md`, "# verification\n\nThe change was verified.\n");
git(["add", "-A"], worktreeDir);
git(["commit", "-q", "-m", "evidence"], worktreeDir);
git(["push", "-q", "origin", "feature/e2e"], worktreeDir);
git(["merge", "-q", "--no-ff", "feature/e2e", "-m", "integrate feature/e2e"], root);
git(["push", "-q", "origin", "main"], root);

// 7. A valid retirement: the evidence is preserved, the worktree is
//    removed, and the local branch is removed.
const head = git(["rev-parse", "feature/e2e"]);
const retirement = await retireWorktree(
  {
    request: {
      worktree: worktreeDir,
      branch: "feature/e2e",
      base: "main",
      head,
      evidence: "the change was verified and published",
      worktreeName: "e2e-work",
    },
    worktreeApi: api,
    cwd: root,
    expectedRoot: managedRoot,
  },
  { listProcesses: () => [] },
);
report("retirement", {
  ok: retirement.ok,
  removed: retirement.removed,
  evidencePreserved: retirement.evidencePreserved,
  evidence: retirement.evidence,
  evidenceFiles: retirement.evidenceFiles,
  branch: retirement.branch,
  remotePreserved: retirement.remotePreserved,
  blocked: Array.isArray(retirement.blocked) ? retirement.blocked.map((entry) => entry.check) : retirement.blocked,
  unavailable: Array.isArray(retirement.unavailable) ? retirement.unavailable.map((entry) => entry.check) : retirement.unavailable,
  reason: retirement.reason,
});

// 8. The remote branch and the published commits survive.
const tryGit = (args) => {
  try {
    return git(args, root);
  } catch {
    return null;
  }
};
const remoteBranch = tryGit(["rev-parse", "--verify", "origin/feature/e2e"]);
const localBranch = tryGit(["rev-parse", "--verify", "refs/heads/feature/e2e"]);
report("after the retirement", {
  remoteBranch: remoteBranch || "(absent)",
  localBranch: localBranch || "(absent)",
  worktrees: git(["worktree", "list"]),
});

const inventoryAfter = readInventory(root);
report("inventory after", inventoryAfter.entries);

// The fixture is removed with everything it holds.
rmSync(sandbox, { recursive: true, force: true });
console.log("\nthe fixture was removed");
