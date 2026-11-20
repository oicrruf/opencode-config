# Design

## Context
See proposal.md. The existing strict source resolver requires a managed inventory entry and public worktree API. Reconcile is observational. AT-157 currently has exact Compose working-directory/config labels and code bind, plus persistent uploads from a separate checkout.

## Goals / Non-Goals
**Goals:** Release attributable resources from a permitted session or explicit operator invocation without registration ceremony.
**Non-Goals:** Multiple application slots, weaker startup/transfer/retirement rules, manual lock deletion, data deletion.

## Decisions
Keep strict managed resolution when available for compatibility. If it fails, independently list Git worktrees using NUL-delimited porcelain, validate each existing checkout's toplevel and common project root, and reconcile read-only inventory. Corrupt or duplicate inventory identities block. Unrecorded checkouts receive deterministic path-hash IDs only in release evidence, never registration. Require active checkout membership. Recompute fallback membership inside the operation lock. CLI uses explicit local operator identity rather than pretending to be a V2 session.
Preserve the complete existing cleanup pipeline. Foreign data binds are retained and do not alone establish project membership. Keep the project quota because the failure is ownership resolution, not capacity.

## Risks / Trade-offs
- Git metadata can disappear: fail closed, preserve the reservation.
- Legacy managed fixtures/API retain their existing authority; fallback independently verifies Git and never trusts caller-provided paths as inventory.
- Partial cleanup remains resumable through the existing report. Stable fallback IDs must survive retries.

## Migration Plan
No state migration. Validate and review, activate installed resources, execute authorized release and verify absent containers plus preserved data. Rollback code without deleting inventory/reservations/reports.

## Runtime discovery correction
Live read-only inspection found exited foreign containers carrying a Compose project label but no working-directory/config labels. The old global parser blocked every project. Parse these as incomplete ownership: block when the project label matches a selected project, any known path/bind touches the current project/checkout, or mounts are unsupported. Otherwise exclude them from ownership candidates and never mutate them. Fully malformed inspections still block. This is required to release the observed AT-157 application.
