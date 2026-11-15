# Design

## Context

Existing capture rules exclude secrets by default, while explicit project includes could override the deny list. Existing links were dereferenced during capture, and failed links were silently dropped.

## Goals / Non-Goals

**Goals:** Close the ten review findings while preserving the adopted contracts and support for macOS Docker Desktop and Linux/WSL2.

**Non-Goals:** Change global OpenCode configuration, install dependencies, broaden Docker engine trust, or approve/merge the PR.

## Decisions

- **Deny list wins:** Evaluate mandatory exclusions before project includes; reject an internal link whose target is protected. This avoids requiring project-controlled approval for credentials.
- **Preserve link type:** Recreate validated internal symlinks with relative destinations. Refuse unsafe links rather than copy target bytes or silently omit the link.
- **Verify before release:** Derive process identity from the host and inspect the process group. Sandbox reservations use their execution identity and Docker-aware recovery rather than generic quota release.
- **Detached deadline helper:** Start a separate process only for bounded executions. Pass its token over stdin rather than argv or disk; the helper follows evidence-first closure and retains the reservation on failure. Polling/retry is scoped to that execution.
- **Screen serialized evidence:** Screen the final report as well as individual steps and differences. Return safe field/index diagnostics without echoing rejected values.
- **Inventory-backed V2 worktrees:** Reconcile the active session's V2 listing with the project inventory; never accept an unrecorded worktree.
- **Content-addressed capture identity:** Hash sorted path and file-fingerprint pairs with SHA-256 so content changes alter the report identity.

## Risks / Trade-offs

- [False positive in credential scanning] → Refuse the report without echoing content; the operator can correct the supplied description.
- [Deadline helper cannot reach Docker] → Keep the quota and retry the same execution; never declare cleanup complete while resources remain.
- [Process identity unavailable on a platform] → Block generic recovery; execution-specific sandbox recovery remains the supported path.

## Migration Plan

No data migration. New sandbox reservations record an execution ID and owner start identity. Existing records without verifiable identity fail closed and require supported execution recovery or operator intervention.

## Open Questions

None.
