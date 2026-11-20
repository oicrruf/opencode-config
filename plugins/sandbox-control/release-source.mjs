// Release-only fallback: Git membership is independent of OpenCode's API and
// never registers a checkout or grants build/transfer/retirement authority.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { canonicalPath, resolveRepositoryRoot } from "./paths.mjs";
import { readInventory } from "../worktree-control/inventory.mjs";
import { resolveSandboxSource } from "./source.mjs";

const blocked = (reason) => ({ ok: false, blocked: true, reason });
const valid = (s) => typeof s === "string" && s.length > 0 && !/[\x00-\x1f\x7f]/.test(s);
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 });

export function resolveGitReleaseSource(context) {
  if (!valid(context?.directory) || !valid(context?.sessionID) || !valid(context?.projectID)) {
    return blocked("release needs an active session or explicit local operator context");
  }
  try {
    const checkout = canonicalPath(git(context.directory, ["rev-parse", "--show-toplevel"]).trim());
    const project = resolveRepositoryRoot(checkout);
    if (!project.ok) return blocked(project.reason);
    const projectRoot = canonicalPath(project.root);
    const recorded = readInventory(projectRoot, { strict: true });
    if (!recorded.ok) return blocked(recorded.reason);
    const paths = new Set();
    const ids = new Set();
    for (const entry of recorded.entries) {
      if (!valid(entry?.directory) || !isAbsolute(entry.directory) || !valid(entry.workId) || entry.workId.length > 128) return blocked("invalid release inventory identity");
      const path = canonicalPath(entry.directory);
      if (paths.has(path) || ids.has(entry.workId)) return blocked("duplicate release inventory identity");
      paths.add(path); ids.add(entry.workId);
    }
    const raw = git(checkout, ["worktree", "list", "--porcelain", "-z"]);
    const present = [];
    for (const record of raw.split("\0\0").filter(Boolean)) {
      const fields = record.split("\0");
      if (!fields[0].startsWith("worktree ")) return blocked("invalid Git worktree listing");
      const path = fields[0].slice(9);
      if (!valid(path) || !isAbsolute(path)) return blocked("invalid Git checkout path");
      const directory = canonicalPath(path);
      const member = resolveRepositoryRoot(directory);
      if (!member.ok || canonicalPath(member.root) !== projectRoot ||
          canonicalPath(git(directory, ["rev-parse", "--show-toplevel"]).trim()) !== directory) {
        return blocked("Git checkout membership cannot be verified for release");
      }
      if (present.some((entry) => entry.directory === directory)) return blocked("duplicate Git checkout membership");
      const existing = recorded.entries.find((entry) => canonicalPath(entry.directory) === directory);
      const workId = existing?.workId ?? `git-checkout-${createHash("sha256").update(directory).digest("hex").slice(0, 24)}`;
      if (present.some((entry) => entry.workId === workId) || (!existing && ids.has(workId))) return blocked("conflicting release checkout identity");
      present.push({ directory, workId, exists: true, recorded: !!existing });
    }
    const active = present.find((entry) => entry.directory === checkout);
    if (!active) return blocked("active checkout is absent from verified Git membership");
    return { ok: true, projectRoot, worktreePath: checkout, workId: active.workId, workName: active.workId,
      sessionId: context.sessionID, projectID: context.projectID, releaseGitFallback: true,
      inventory: { ok: true, present } };
  } catch {
    return blocked("Git checkout membership or inventory cannot be verified for release");
  }
}

export async function resolveReleaseSource(context) {
  const managed = await resolveSandboxSource(context);
  return managed.ok ? managed : resolveGitReleaseSource(context);
}
