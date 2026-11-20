## MODIFIED Requirements

### Requirement: Explicit release closes the project reservation without deleting persistent data

Release SHALL require an explicit request from a session granted the named release permission or an explicit local operator CLI invocation. It SHALL identify the single held reservation through the verified active project, preserve any required report before cleanup, and stop or remove only resources whose ownership is verified against the reservation, exact Compose labels, and managed worktree inventory or independently Git-verified project checkout membership. A stale legacy work ID MAY be reconciled only when exactly one verified runtime source is proven; the report SHALL retain both recorded and runtime owner IDs. It SHALL preserve database volumes, host upload directories and other persistent data. It SHALL release the quota only after the owned runtime resources are confirmed absent. Unknown, foreign, shared, or unverifiable resources SHALL block release without deletion.

#### Scenario: The user releases a verified sandbox
- **WHEN** a permitted session requests release and the sandbox execution and its resources are attributable
- **THEN** the system SHALL preserve the report, close the execution, remove only its disposable resources, retain persistent data and release the project quota after verified absence

#### Scenario: The reservation belongs to another managed worktree in the same project
- **WHEN** release is explicitly requested from a permitted session and the recorded owner worktree and all runtime resources are verified within the active project
- **THEN** the system SHALL close only that reservation's attributable runtime resources, preserve persistent data and record which worktree owned the released reservation

#### Scenario: A manual application has verifiable Compose ownership
- **WHEN** a permitted release request identifies an application reservation whose Compose resources map uniquely to a managed worktree and project, even if a legacy record's work ID is stale
- **THEN** the system SHALL stop/remove only those containers and ephemeral networks, preserve database volumes and host uploads, verify the containers are absent and then release the quota

#### Scenario: Release cannot prove exact ownership
- **WHEN** the reservation, worktree, Compose labels or resources are missing, shared or ambiguous
- **THEN** the system SHALL keep the reservation and all resources and report a blocked release without attempting name-based cleanup

#### Scenario: Release from a canonical or unrecorded checkout without OpenCode worktree API
- **WHEN** the operator explicitly requests release from a Git checkout and managed source resolution is unavailable
- **THEN** the system SHALL verify Git worktree membership and common repository identity, retain recorded work IDs where unique, derive stable checkout IDs otherwise, and perform the same ownership and cleanup checks without modifying the worktree inventory

#### Scenario: Invalid fallback evidence
- **WHEN** Git membership, inventory records, checkout identity or Compose ownership cannot be verified uniquely
- **THEN** release SHALL remain blocked without resource mutation; build, transfer and retirement SHALL retain their existing managed-identity requirements

#### Scenario: Unrelated containers have incomplete Compose labels
- **WHEN** a foreign Compose container lacks working-directory/config labels but has valid inspected identity and mounts, a different project label, and no known path or bind in the target project/checkout
- **THEN** discovery SHALL exclude it from release candidates without mutating it; a shared project label, related path, unsupported mounts or malformed inspection SHALL block cleanup
