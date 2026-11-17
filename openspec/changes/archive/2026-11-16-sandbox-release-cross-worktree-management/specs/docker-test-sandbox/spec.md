# Spec Delta

## MODIFIED Requirements

### Requirement: The sandbox command validates its complete invocation before dispatch

The system SHALL expose `/sandbox`, `/sandbox help`, `/sandbox release`, `/sandbox build <config.json>`, `/sandbox rebuild <config.json>` and `/sandbox transfer <config>`. A native V2 executor SHALL parse the complete invocation before any model prompt or tool call; it SHALL NOT rely on a Markdown prompt to enforce validation. Empty arguments and help SHALL return usage without tool calls or a model request. Release SHALL accept no operands. Build and rebuild SHALL accept exactly one checkout-relative configuration path. Transfer SHALL accept exactly one checkout-relative path: sandbox JSON for sandbox replacement or a Compose file for application handoff. Paths MAY be balanced single or double quoted for spaces and SHALL NOT use shell expansion. Invalid operations, missing or extra operands, flags and malformed quoting SHALL return usage without invoking tools or modifying resources. Valid release and transfer operations SHALL enforce the active session's named permission and tool entrypoints SHALL independently reject invalid fields before lifecycle effects.

#### Scenario: An invocation is invalid
- **WHEN** an invocation contains an unknown operation, extra operand, missing path, flag or unmatched quote
- **THEN** the system SHALL show usage without tool calls, engine operations, reservation changes or execution changes

#### Scenario: Help is requested
- **WHEN** the command has no arguments or has exactly `help`
- **THEN** the system SHALL display the supported syntax without invoking tools

#### Scenario: A configuration path contains spaces
- **WHEN** build, rebuild or transfer has exactly one properly quoted relative path
- **THEN** the system SHALL dispatch that operation with the literal path without interpreting shell expressions

#### Scenario: A release is requested
- **WHEN** an explicitly permitted session invokes `/sandbox release` with no operands
- **THEN** the system SHALL dispatch release against the single verified project reservation without asking a model to infer its identity

#### Scenario: An application transfer is requested
- **WHEN** an explicitly permitted session invokes `/sandbox transfer <compose.yml>` with one destination Compose file
- **THEN** the system SHALL preflight the target's persistent mounts and dispatch a handoff without asking a model to infer its identity

#### Scenario: A sandbox transfer is requested
- **WHEN** an explicitly permitted session invokes `/sandbox transfer <config.json>` with exactly one checkout-relative sandbox JSON path
- **THEN** the system SHALL dispatch sandbox replacement using that literal path

#### Scenario: Release has unexpected operands
- **WHEN** a release invocation contains any operand or flag
- **THEN** the system SHALL show usage without tool calls or resource changes

### Requirement: Rebuilding preserves evidence and verifies closure before replacement

Rebuild SHALL require an active sandbox of the verified work, checkout and owning session. The system SHALL validate replacement prerequisites before teardown, preserve the old execution report externally and verify absence of its own resources before starting the successor. The project quota SHALL remain held across the entire replacement. Every successor SHALL have a distinct identity, capture and report. Failure or uncertainty SHALL retain a recoverable reservation and block the successor; no automatic uncertain retry, product approval or Git/Linear modification SHALL occur. Existing isolation and dependency restrictions SHALL apply.

#### Scenario: Rebuild completes
- **WHEN** the owning session rebuilds a verifiable sandbox with valid prerequisites
- **THEN** the system SHALL preserve the old report, verify attributable cleanup and start the distinct successor while continuously holding the project quota

#### Scenario: Preservation or closure fails
- **WHEN** the report cannot be written, a resource remains, capture/secret cleanup fails or daemon identity becomes uncertain
- **THEN** the system SHALL retain evidence and the reservation, report the unresolved condition and SHALL NOT start a successor

#### Scenario: Another session asks for rebuild
- **WHEN** a session other than the recorded owner requests rebuild
- **THEN** the system SHALL refuse replacement and explain that explicit transfer is required

#### Scenario: A new prerequisite is unavailable
- **WHEN** the new configuration, runtime or dependency is missing or invalid
- **THEN** the system SHALL block before destroying the previous sandbox and SHALL NOT provision the prerequisite

### Requirement: Explicit sandbox transfer verifies ownership before changing sessions

Transfer SHALL require an explicit request in a verified permitted session for the same project. A sandbox transfer SHALL retain the same managed work identity. An application transfer MAY change the work identity only when the destination and the runtime source resolve to distinct, existing managed worktrees in that project and the exact resource relationship is verified. The runtime source SHALL be derived from exact Compose labels and bind mounts, independently of the reservation's recorded owner. If a legacy reservation's recorded work ID differs from the uniquely verified runtime source, an explicit permitted operation MAY reconcile them, SHALL preserve both identities in its report, and SHALL NOT infer ownership from names or age. Transfer SHALL exclude active competing operations and SHALL NOT ask for or expose the previous session's token. For a sandbox, transfer SHALL perform report-first verified replacement while keeping the quota held continuously and bind the new execution to the active checkout. For a Compose application, transfer SHALL close only the old runtime, preserve its persistent database volumes and host upload paths, rotate authority to the active worktree, and keep the quota reserved in an `awaiting-start` state; it SHALL NOT replay the prior command. The target session SHALL resume only through `reservation_start` with the newly issued token and a command whose runtime mounts match the preserved persistence manifest. Another project, unknown state and resources that cannot be attributed SHALL remain blocked.

#### Scenario: A sandbox transfer changes only its owning session
- **WHEN** an explicitly permitted session with the same managed work identity requests transfer and the old sandbox resources are verifiable
- **THEN** the system SHALL preserve the old report and persistent data, close only attributable prior resources, and create a distinct successor bound to the requesting session without requesting or revealing the old token

#### Scenario: A Compose application transfers to another worktree
- **WHEN** an explicitly permitted session provides a destination Compose file to transfer a verified application from another managed worktree in the same project
- **THEN** the system SHALL stop/remove only attributable runtime resources, preserve volumes and upload paths, rotate ownership to the active worktree and keep the quota held awaiting a target-owned start

#### Scenario: A legacy reservation names a stale worktree
- **WHEN** the reservation's recorded work ID differs from the active Compose bind mount but the project labels and all managed-worktree candidates resolve to exactly one runtime source
- **THEN** an explicitly permitted release or transfer SHALL record both identities and may close only that verified Compose resource set; zero or multiple runtime-source matches SHALL remain blocked without resource changes

#### Scenario: The target resumes a transferred application
- **WHEN** the verified target session starts the handed-off application with the new token and its runtime mounts match the persistent manifest
- **THEN** the system SHALL start the target command and retain the same project reservation under the target worktree

#### Scenario: The target command changes persistent data mapping
- **WHEN** the target start uses a different database volume or upload bind source
- **THEN** the system SHALL refuse the start, preserve persistent data and keep the handoff reservation held

#### Scenario: A second session explicitly transfers a sandbox
- **WHEN** a permitted session for the same project/work requests transfer and the existing sandbox and its idle operation state are verifiable
- **THEN** the system SHALL replace it safely and bind the successor to the requesting session without requesting or revealing the previous token

#### Scenario: The quota is free
- **WHEN** transfer finds a verified free project quota
- **THEN** the system SHALL perform a normal build bound to the requesting session and effective checkout

#### Scenario: A transfer crosses a project boundary
- **WHEN** the current reservation and requesting checkout resolve to different projects
- **THEN** the system SHALL preserve the reservation and resources and refuse transfer

#### Scenario: A resource or persistent-data boundary is ambiguous
- **WHEN** the system cannot prove resource ownership or distinguish persistent data from disposable sandbox resources
- **THEN** the system SHALL preserve all resources and the quota and report the verification needed

#### Scenario: The reservation is not transferable
- **WHEN** the quota belongs to another project, an in-flight operation or unverifiable records
- **THEN** the system SHALL preserve that reservation and its resources and report a block without takeover

## ADDED Requirements

### Requirement: Explicit release closes the project reservation without deleting persistent data

Release SHALL require an explicit request from a session granted the named release permission. It SHALL identify the single held reservation through the verified active project, preserve any required report before cleanup, and stop or remove only resources whose ownership is verified against the reservation, exact Compose labels, and managed worktree inventory. A stale legacy work ID MAY be reconciled only when exactly one managed runtime source is proven; the report SHALL retain both recorded and runtime owner IDs. It SHALL preserve database volumes, host upload directories and other persistent data. It SHALL release the quota only after the owned runtime resources are confirmed absent. Unknown, foreign, shared, or unverifiable resources SHALL block release without deletion.

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
