// The worktree control plugin.
//
// The plugin exposes the tools an agent uses to isolate work and to
// retire it. It is installed as a managed global resource, so it runs
// in every project on the host; it stays inert outside a Git project.
//
// Every tool description states the property that matters: retirement
// happens only on an explicit request with a complete identity, and
// neither age nor low disk space ever retires a worktree.

import { createWorktree, listWorktrees } from "./creation.mjs";
import { describeInventory, reconcileInventory } from "./inventory.mjs";
import { reportCapacity } from "./capacity.mjs";
import { describeLock } from "./lock.mjs";
import { retireWorktree, listRetirementCandidates } from "./lifecycle.mjs";
import { resolveProjectRoot, resolveProjectId, resolveWorktreeRoot } from "./paths.mjs";

/**
 * The worktree API of the session, when it is available.
 *
 * The API is exposed to plugins by the runtime. The control uses it
 * instead of a raw Git command, so the worktrees land where OpenCode
 * manages them.
 */
function worktreeApiOf(context) {
  const api = context?.worktree ?? context?.client?.worktree ?? null;
  if (api && typeof api.create === "function") return api;
  return null;
}

function projectContext(context) {
  const cwd = context?.directory ?? process.cwd();
  const project = resolveProjectRoot(cwd);
  if (!project.ok) return { ok: false, reason: project.reason, cwd };
  const projectId = resolveProjectId(project.root);
  return {
    ok: true,
    cwd,
    root: project.root,
    projectId,
    worktreeRoot: resolveWorktreeRoot(projectId),
  };
}

export const WorktreeControlPlugin = async () => {
  return {
    tool: {
      worktree_create: {
        description:
          "Create a managed worktree for an isolated change. The worktree is created outside the " +
          "canonical checkout, with its branch, and is recorded in the project's inventory. " +
          "A repeated request for the same work returns the existing worktree instead of creating a second one.",
        args: {
          workId: { type: "string", description: "the identifier of the work to isolate" },
          branch: { type: "string", description: "the branch to create with the worktree" },
        },
        async execute(args, context) {
          const project = projectContext(context);
          if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };

          const api = worktreeApiOf(context);
          if (!api) {
            return { ok: false, reason: "the worktree API is not available in this session" };
          }
          const listing = await listWorktrees(api, project.cwd);
          return createWorktree(
            { workId: args?.workId, branch: args?.branch ?? null, worktreeApi: api, cwd: project.cwd },
            {
              actualWorktrees: listing.worktrees,
              listingVerified: listing.verified,
              listingReason: listing.reason,
            },
          );
        },
      },

      worktree_list: {
        description:
          "List the worktrees of the project with their directory, their branch, and their state. " +
          "A recorded worktree whose directory is gone is reported as missing, and a worktree that " +
          "exists without a record is reported as unrecorded.",
        args: {},
        async execute(args, context) {
          const project = projectContext(context);
          if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };

          const api = worktreeApiOf(context);
          const listing = api
            ? await listWorktrees(api, project.cwd)
            : { worktrees: [], verified: false, reason: "the worktree API is not available" };
          const report = describeInventory(project.root, listing.worktrees, {
            verified: listing.verified,
          });
          if (!report.ok) return report;

          // The capacity counts the worktrees that are present, not the
          // historical records whose directory is gone.
          const capacity = reportCapacity(project.worktreeRoot, report.present + report.unrecorded);
          return { ...report, capacity };
        },
      },

      worktree_capacity: {
        description:
          "Report the space available on the filesystem that holds the worktrees, together with the " +
          "number of worktrees present. The report announces no maximum and no remaining budget: " +
          "it states only what was measured.",
        args: {},
        async execute(args, context) {
          const project = projectContext(context);
          if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };

          const api = worktreeApiOf(context);
          const listing = api
            ? await listWorktrees(api, project.cwd)
            : { worktrees: [], verified: false, reason: "the worktree API is not available" };
          const report = describeInventory(project.root, listing.worktrees, {
            verified: listing.verified,
          });
          // The capacity counts the worktrees that are present, not the
          // historical records whose directory is gone.
          const count = report.ok ? report.present + report.unrecorded : 0;
          return reportCapacity(project.worktreeRoot, count);
        },
      },

      worktree_candidates: {
        description:
          "List the worktrees that are safe to consider for a retirement, with the state that makes " +
          "each one a candidate and the condition that would block it, ordered by age. " +
          "Listing never retires anything: a retirement requires an explicit request.",
        args: {},
        async execute(args, context) {
          const project = projectContext(context);
          if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };

          const api = worktreeApiOf(context);
          if (!api) {
            return { ok: false, reason: "the worktree API is not available in this session" };
          }
          return listRetirementCandidates({ worktreeApi: api, cwd: project.cwd });
        },
      },

      worktree_retire: {
        description:
          "Retire a worktree. The request must name the worktree, its branch, the base it " +
          "integrates into, the expected head, and the evidence that the work was integrated. " +
          "The retirement is refused when the worktree holds local changes, unpublished commits, " +
          "a process with access, unrecognized ignored files, or an unsafe path. " +
          "The remote branch and the published commits are never removed.",
        args: {
          worktree: { type: "string", description: "the directory of the worktree to retire" },
          branch: { type: "string", description: "the branch of the worktree" },
          base: { type: "string", description: "the base the work integrates into" },
          head: { type: "string", description: "the expected head of the worktree" },
          evidence: { type: "string", description: "the evidence that the work was integrated" },
          worktreeName: { type: "string", description: "the name of the worktree, used for the evidence directory" },
        },
        async execute(args, context) {
          const project = projectContext(context);
          if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };

          const api = worktreeApiOf(context);
          if (!api) {
            return { ok: false, reason: "the worktree API is not available in this session" };
          }
          return retireWorktree({ request: args ?? {}, worktreeApi: api, cwd: project.cwd });
        },
      },

      worktree_lock: {
        description:
          "Report the state of the lock that serializes the mutating operations of the project. " +
          "A lock whose owner cannot be verified is preserved and reported as unverifiable.",
        args: {},
        async execute(args, context) {
          const project = projectContext(context);
          if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };
          return describeLock(project.root);
        },
      },

      worktree_reconcile: {
        description:
          "Reconcile the recorded inventory with the worktrees that actually exist, and report the " +
          "entries that are missing and the worktrees that exist without a record.",
        args: {},
        async execute(args, context) {
          const project = projectContext(context);
          if (!project.ok) return { ok: false, reason: project.reason, unavailable: true };

          const api = worktreeApiOf(context);
          const listing = api
            ? await listWorktrees(api, project.cwd)
            : { worktrees: [], verified: false, reason: "the worktree API is not available" };
          const reconciled = reconcileInventory(project.root, listing.worktrees, {
            verified: listing.verified,
          });
          if (!reconciled.ok) return reconciled;
          return {
            ok: true,
            verified: reconciled.verified,
            present: reconciled.present.length,
            missing: reconciled.missing.length,
            unrecorded: reconciled.unrecorded.length,
            unknown: reconciled.unknown.length,
            missingEntries: reconciled.missing,
            unrecordedEntries: reconciled.unrecorded,
            unknownEntries: reconciled.unknown,
          };
        },
      },
    },
  };
};
