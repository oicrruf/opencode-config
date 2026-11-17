# Proposal

## Why

The native `/sandbox` command can build, rebuild, or transfer a sandbox only for the same work identity, but it has no release action. This leaves a user unable to explicitly stop an owned sandbox or hand a verified project sandbox from one managed worktree to another; the current application reservation also shows that a Compose process can exit while its containers and project quota remain active.

## What Changes

- Add an explicit `/sandbox release` operation that records closure and removes only verified resources owned by the selected sandbox or supported local Compose application.
- Extend explicit transfer to a different managed worktree in the same project, using the active verified worktree as the successor owner.
- Require explicit named permission for release and transfer, serialize both operations, preserve reports before cleanup, and keep the project reservation held until successor ownership or verified resource absence.
- Preserve persistent database volumes and host uploads during stop, release, and transfer. Remove only attributable ephemeral containers, networks, captures, and secrets; never delete a Git worktree or persistent data through this operation.
- Block when project, worktree, Compose resource labels, execution records, or persistent-data boundaries cannot be verified. For a legacy Compose reservation whose recorded work ID is stale, permit an explicit release/transfer only when the active Compose resource set maps to exactly one existing managed worktree in the same project; report both identities. Do not take over another project or ambiguous legacy resources.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `docker-test-sandbox`: add a native release operation and permit explicit transfer between verified managed worktrees in the same project.
- `local-execution-reservation`: permit explicit, permission-gated closure or transfer of a verifiable project Compose reservation across its managed worktrees while preserving persistent volumes and uploads.

## Impact

Affected areas include the native command parser and executor, sandbox lifecycle and reservation transitions, Docker resource discovery/cleanup, managed-worktree identity verification, permission profiles, documentation, and lifecycle/runtime tests. Existing reservations without enough identity to distinguish owned Compose resources from shared resources will remain blocked for manual reconciliation. A permission-gated operation may reconcile stale recorded ownership only when exact labels and bind mounts prove one managed resource worktree; reports retain both the reservation owner and actual resource owner.
