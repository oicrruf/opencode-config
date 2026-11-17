# Tasks

## 1. Native release command and permission surface

- [x] 1.1 Extend the strict `/sandbox` grammar with operand-free `release` and update parser tests to prove invalid operands cause zero dispatch.
- [x] 1.2 Add permission-gated `sandbox_release` dispatch to the native executor and tool surface; require interactive approval for `sandbox_release` and `sandbox_transfer`, and verify denial causes no source resolution or resource effects.
- [x] 1.3 Document release syntax, target selection, transfer between managed worktrees, and persistent-data guarantees; verify help output matches the documentation.

## 2. Reservation resource identity

- [x] 2.1 Add a versioned, secret-free resource manifest for Compose project, source worktree, containers, networks, named volumes, and bind mounts; verify records never contain secrets or arbitrary command arguments.
- [x] 2.2 Reconcile old reservations through managed worktree inventory and engine labels; verify missing, conflicting, or name-only identity blocks without changing resources.
- [x] 2.3 Add fixture tests for exact Compose project/worktree matching and foreign-resource rejection; document the legacy recovery boundary.

## 3. Explicit release and safe cleanup

- [x] 3.1 Implement release under the shared project operation gate with a report-first journal; verify retries cannot release a different reservation.
- [x] 3.2 Stop/remove only the verified reservation's containers; remove a Compose network only when exclusive ownership is positively verified, otherwise retain it. Retain named volumes and host upload paths; verify database and upload sentinels survive cleanup.
- [x] 3.3 Add lifecycle tests for active, already-stopped, ambiguous, and partial-cleanup states; verify quota remains held until owned runtime resources are absent.
- [x] 3.4 Update operator documentation with the permission boundary, release outcomes, preserved data, and recovery instructions; verify commands and syntax match the implementation.

## 4. Cross-worktree transfer

- [x] 4.1 Verify application source and destination work IDs resolve to distinct managed worktrees in the same project and serialize the handoff; test foreign-project, unknown-worktree, and competing-operation refusals.
- [x] 4.2 Validate that destination configuration reuses the exact persistent database and upload mapping before teardown; test mismatch blocks before any resource change.
- [x] 4.3 Hand off an application reservation as `awaiting-start`; verify the old token cannot affect the successor.
- [x] 4.4 Add target-start resume tests proving the rotated token and persistent mount match are required; document source/destination identity and handoff semantics.

## 5. Integration verification

- [x] 5.1 Extend the OpenCode V2 fixture to prove release and cross-worktree transfer reach the correct tools and denied/invalid invocations cause no model or resource activity.
- [x] 5.2 Run sandbox and worktree tests, both profile validators, model-profile tests, static acceptance, strict OpenSpec validation, and a local-engine fixture covering release/transfer with persistent data; record results and platform limits.
- [x] 5.3 Block worktree retirement while an active local container bind-mounts it; serialize retirement with sandbox mutations and verify transfer/release clears that blocker without deleting persistent data.

### Verification record

- Sandbox tests: 154/154 passed; worktree tests: 69/69 passed.
- `validate-config.mjs` passed for `personal` and `work`; model-profile checks passed; static acceptance passed 45/45; strict OpenSpec validation passed.
- Local Docker Desktop fixture passed active source-mount retirement blocking, transfer to `awaiting-start`, exact destination start, release, retirement unblocking, and database/upload sentinel checks before and after. Evidence: `.opencode/state/sandbox/reports/at200-compose-handoff-6459-569827.json`.
- Platform: macOS arm64 host with Docker Desktop Linux aarch64 engine. The fixture used cached `alpine:latest`, network mode `none`, and removed its uniquely named containers, test volume, and temporary paths. This does not establish Linux-host behavior.
- Live `website` audit: the active container bind-mounts `at156-design-refinement` and the reservation record names `at156-home-restore`. The destination's current Compose file lacks the active external `.env` and uploads binds, so transfer remains blocked before stopping the app. No live container, reservation, volume, or worktree was changed.
