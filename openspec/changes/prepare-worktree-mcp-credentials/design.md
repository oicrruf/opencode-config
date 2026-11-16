# Design

## Context

See proposal.md - Why. Worktree creation currently calls OpenCode's worktree API and records the directory, while retirement performs explicit safety checks and preserves evidence. The existing configuration declares agent-scoped MCP permissions and keeps OAuth credentials in OpenCode's credential store. Preparation must work from the created directory and must not change those policies.

## Goals / Non-Goals

**Goals:**
- Make readiness an explicit, inspectable stage of managed worktree creation and reuse.
- Safely materialize only specifically authorized local credential files when global credential storage is insufficient.
- Track owned outputs for resumption and selective cleanup during explicit retirement.

**Non-Goals:**
- Starting, enabling, authenticating, or probing MCP providers as a side effect of worktree creation.
- Copying credential stores, `.env` files, ignored directories, or general user configuration wholesale.
- Changing agent permissions, MCP server policy, or retirement authorization.

## Decisions

- **Inspect configuration from the actual worktree context.** Evaluate the effective configuration using the worktree directory rather than assuming the canonical checkout's view applies. Report config detection and provider connectivity as separate dimensions. This avoids false readiness claims; reading only global configuration was rejected because it does not prove effective worktree behavior.
- **Drive materialization from configuration and explicit policy.** Use OpenCode's ordered config documents to identify enabled MCP server definitions and inspect only their raw source declarations for `{file:path}` references. A relative project-local reference is eligible for materialization only when that exact relative path is also present in a machine-local `OPENCODE_WORKTREE_CREDENTIAL_FILES` JSON string-array allowlist. This makes the MCP config reference the need and the machine-local allowlist the authorization; neither alone is enough. Prefer references that already resolve from the worktree, and do not maintain an Azure-specific or other fixed server allowlist. Disabled servers are never candidates.
- **Use a per-worktree ownership manifest with atomic, restrictive writes.** Store only ownership metadata (safe relative paths, source identity where non-secret, permissions, and progress state), never values. Use a small Python 3 standard-library helper with `openat`-style `dir_fd` operations (`os.open`, `os.link`, `os.mkdir`) and `O_NOFOLLOW`/`O_DIRECTORY` to pin directory handles and avoid path re-resolution during file inspection/copy. Invoke it only for materialization or ownership verification; if Python or required platform capabilities are absent, fail closed and do not provision a dependency. Publish complete destination files exclusively at mode `0600`, never overwrite pre-existing files, and remove a just-created file by verified identity if ownership metadata cannot be persisted. Global credentials remain preferred over local copies.
- **Never ask the worktree API to delete an owned credential file.** OpenCode's worktree removal API has no atomic pre-delete predicate, so validation followed by API removal cannot guarantee that a credential remains unchanged during the RPC. Retirement SHALL fail closed whenever a materialized owned credential path is present, even if its current contents differ from the manifest. The operator must explicitly move or delete those files outside the retirement flow, then retry. Only when every owned path is safely confirmed absent may the control permit retirement and clear stale ownership metadata after successful API removal. No escrow snapshot is deleted as part of automatic retirement.
- **Treat incomplete state as not ready and resumable.** Persist progress after each successful materialization so retries can validate ownership and continue without broad rollback or deleting pre-existing data.

## Risks / Trade-offs

- [Effective configuration resolution can differ across OpenCode versions] → Keep configuration parsing isolated, test JSON and JSONC fixtures, and fail closed when the effective configuration cannot be determined.
- [Python or descriptor-relative filesystem primitives are unavailable] → Detect capability before mutation, report preparation/cleanup as blocked, and never fall back to pathname-based copying or deletion.
- [A credential source can change between validation and copy] → Open source and destination through pinned directory descriptors without following symlinks; verify regular-file identity and create destination files exclusively with restrictive modes.
- [Cleanup metadata can be tampered with] → Validate manifest paths as safe relative paths, reject symlinks and traversal, and verify every target remains beneath the worktree before deletion.
- [Worktree API cannot atomically protect files from concurrent mutation] → Refuse retirement while any control-owned credential path is present; require explicit operator relocation/removal and never delegate deletion of those files to the API.
- [Provider connectivity may not be verifiable without making network calls] → Report connectivity as unknown rather than probing or claiming success; runtime connectivity checks remain sandbox-only and require authorized secrets.

## Migration Plan

1. Add preparation as a managed creation/reuse stage while preserving existing behavior for worktrees with no required local credential files; do not require Python unless a local file operation is needed.
2. Introduce ownership metadata for newly materialized files; do not infer ownership of existing worktree files.
3. Block retirement while managed credential files remain in the worktree; allow retirement after their explicit removal and clear only stale ownership metadata after successful worktree removal.
4. Roll back by disabling the preparation integration and reverting the code. Preserve any ownership records and user files; never perform bulk deletion as rollback.
