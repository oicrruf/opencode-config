# Design

## Context

See proposal.md - Why. The current native command has no release action and its transfer path requires the same work identity. Sandbox executions have exact execution records and Docker labels; local application reservations have a process-group record but may outlive that process group when started through detached Compose. The current worktree identity must come from the V2 session and managed worktree inventory.

## Goals / Non-Goals

**Goals:**

- Make release and cross-worktree transfer explicit, permission-gated native operations.
- Close only resources that can be tied to the project reservation and a managed worktree.
- Preserve persistent database volumes and host upload paths while closing disposable runtime resources.
- Keep project quota held until closure or successor ownership is verified.
- Hand an application reservation to the destination worktree in a stopped, reserved state; require that owner to provide its own start command.

**Non-Goals:**

- Removing Git worktrees or changing Git refs.
- Releasing a reservation across project boundaries.
- Guessing ownership from container names, age, a dead coordinator, or a caller-supplied worktree path.
- Deleting Docker volumes, database contents, upload directories, or other persistent data as part of release.
- Replaying an old application's command automatically; launch arguments are not retained as a restart recipe.

## Decisions

1. **Use explicit native actions with named permissions.** Add `/sandbox release` and preserve `/sandbox transfer <config>` with a verified active worktree as the destination. The path is sandbox JSON when transferring an isolated sandbox and the destination Compose file when handing off an application. Both direct command and tool entrypoints assert `sandbox_release` or `sandbox_transfer`. Invalid syntax is rejected before dispatch.

2. **Resolve reservation and runtime ownership independently.** The active V2 session supplies the destination project/work identity; the reservation supplies its recorded owner. For Compose operations, Docker's exact project labels and bind mounts independently identify the runtime source worktree through the managed inventory. If the recorded owner differs from the runtime source, an explicitly permitted release/transfer may proceed only when the full Compose resource set maps to exactly one existing managed worktree in this project. Reports preserve both work IDs. Transfer requires that the destination differ from the verified runtime source. The destination configuration and source capture are resolved only from the active checkout.

3. **Add an attributable resource inventory for local Compose applications.** For supported Docker Compose reservations, record or derive a stable project identity from Docker's Compose labels, the verified runtime source worktree path, container IDs, networks, and mount metadata. Never infer the project from container names. Legacy records are eligible only when the running engine exposes a unique, complete match to the managed worktree and project; a stale reservation work ID is retained as historical ownership, and the actual resource work ID is recorded separately. Missing, conflicting or ambiguous evidence remains blocked.

4. **Separate disposable runtime resources from persistent data.** Release/transfer may stop and remove verified containers and ephemeral networks. It must retain named volumes and host bind paths, including database storage and uploads. Transfer may start a successor only when its configuration can reuse the same verified persistence mapping; otherwise it closes nothing and reports the mismatch.

5. **Preserve evidence and quota across the transition.** A versioned, secret-free transition journal records source/destination work IDs, generation, resource fingerprints, and completed phases. Reports are written before teardown. The exclusive project operation gate remains held through verified cleanup and successor ownership; failures keep the reservation and evidence.

6. **Do not bypass unresolved legacy token recovery.** Explicit permission authorizes the operation only after resource identity is independently verified; it does not authorize arbitrary Docker cleanup. Ordinary stop/recover tools continue to require the owner token. Ambiguous resources, missing labels, an unreachable engine, or a live conflicting operation block.

7. **Separate sandbox replacement from application handoff.** A path-based sandbox transfer replaces an isolated sandbox. For a verified Compose application, `/sandbox transfer <compose.yml>` renders the destination configuration and compares its persistent mounts before stopping the old runtime. It then preserves volumes/uploads, rotates ownership to the active worktree, and keeps the reservation held in `awaiting-start`. The destination starts its own foreground Compose command through `reservation_start` with the new token and the exact preflighted file; the runtime mount check repeats before launch.

## Risks / Trade-offs

- [Compose labels may be missing or inconsistent on older containers] → Block and require operator reconciliation; never fall back to name matching.
- [A legacy reservation may name a different worktree from the active Compose bind mount] → Resolve the runtime source only from exact engine labels and a unique managed inventory match; require an explicit permitted operation and report both identities.
- [A transfer could point the new worktree at a different database or upload directory] → Compare effective mounts and named-volume identities before teardown; require an exact persistence mapping or refuse transfer.
- [A crash can occur after containers stop but before ownership changes] → Persist a transition journal before the first mutation and recover only the exact recorded transition.
- [The destination application's chosen command could use different data] → Compare named volumes and upload bind sources with the handoff manifest; refuse to resume and keep the reservation when they differ.
- [Project-wide permission can be broader than a worktree-scoped permission] → Require an explicit per-session named action and report the exact source and destination work IDs before resource effects.

## Migration Plan

1. Add versioned metadata for new reservations and resource snapshots without changing existing records in place.
2. Permit legacy Compose release/transfer only after a fresh unique label and worktree reconciliation; leave all other legacy reservations untouched.
3. Activate the reviewed profile, start a fresh execution, verify the command registration, and run engine-free plus local-engine tests.
4. Rollback only after active transitions are closed or recovered with the new version; retain reports and persistent volumes.
