# Proposal

## Why
Explicit release is coupled to build-time managed source identity and an optional OpenCode worktree API. Reconciliation only reports unrecorded entries, leaving a legitimate cleanup request stranded even when Git and Compose prove ownership.

## What Changes
- Resolve explicit release from the active Git project even from its canonical checkout or without the worktree API.
- Use verified Git worktree membership as a release-only fallback; retain recorded identities and derive stable path identities for unrecorded checkouts without changing inventory.
- Scope incomplete Compose metadata to related projects so unrelated stopped containers do not globally block release.
- Preserve exact Compose ownership, reports, process identity, volume protection and absence verification.
- Document operator CLI release for sessions outside OpenCode.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
- `docker-test-sandbox`: explicit release can use Git-verified checkout membership without granting build or retirement rights.

## Impact
Sandbox source/release resolution, a local release CLI, regression tests and operator guide. The single project reservation remains: removing it would not repair ownership attribution. No worktree creation/removal or volume deletion.
