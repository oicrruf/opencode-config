# Spec Delta

## ADDED Requirements

### Requirement: The sandbox command validates its complete invocation before dispatch

The system SHALL expose `/sandbox`, `/sandbox help` and exactly `/sandbox build <config.json>`, `/sandbox rebuild <config.json>` and `/sandbox transfer <config.json>`. A native V2 executor SHALL parse the complete invocation before any model prompt or tool call; it SHALL NOT rely on a Markdown prompt to enforce validation. Empty arguments and help SHALL return usage without tool calls or a model request. Mutating operations SHALL accept exactly one checkout-relative configuration path, with balanced single or double quotes permitted for spaces and no shell expansion. Invalid operations, missing or extra operands, flags and malformed quoting SHALL return usage without invoking tools or modifying resources. Valid native operations and tool entrypoints SHALL enforce the active session's named sandbox permission, and tool entrypoints SHALL independently reject invalid fields before lifecycle effects.

#### Scenario: An invocation is invalid
- **WHEN** an invocation contains an unknown operation, extra operand, missing path, flag or unmatched quote
- **THEN** the system SHALL show usage without tool calls, engine operations, reservation changes or execution changes

#### Scenario: Help is requested
- **WHEN** the command has no arguments or has exactly `help`
- **THEN** the system SHALL display the supported syntax without invoking tools

#### Scenario: A configuration path contains spaces
- **WHEN** a supported operation has exactly one properly quoted relative path
- **THEN** the system SHALL dispatch that operation with the literal path without interpreting shell expressions

### Requirement: Command source and configuration belong to the effective session checkout

The system SHALL resolve the source checkout, project and work identity from the verified active session and managed worktree inventory. It SHALL use the explicitly selected configuration inside that checkout, resolve its build paths relative to that checkout root and verify configuration and source consistency. The selected configuration JSON SHALL remain outside the capture even when requested by include. External evidence SHALL record its byte fingerprint and only secret-free permitted parameters, excluding secret values, dependency URLs and arbitrary free-form configuration fields. Its fingerprint SHALL be checked after capture against the bytes used for validation. It SHALL retain project-wide quota and evidence while recording the tested checkout. Unverified, conflicting, escaping or ambiguous identity/configuration SHALL block without silently selecting another checkout. Existing default configuration consumers SHALL remain supported.

#### Scenario: Main checkout and worktree differ
- **WHEN** the session runs in a managed worktree with configuration different from the main checkout
- **THEN** validation and capture SHALL use the worktree configuration and source, while quota remains common to the project

#### Scenario: The session starts in a subdirectory
- **WHEN** the active session directory is below the verified checkout root
- **THEN** relative configuration and build paths SHALL resolve within that same checkout root

#### Scenario: Identity or paths cannot be verified
- **WHEN** the work is missing or ambiguous, the checkout belongs to another project, or a configuration/build path escapes directly or through a symlink
- **THEN** the command SHALL block before creating or closing resources and SHALL report the missing verification

#### Scenario: Configuration changes during capture
- **WHEN** the configuration fingerprint after capture differs from that used for validation
- **THEN** the system SHALL refuse the inconsistent execution without building a mixture of configurations

#### Scenario: The configuration is protected or contains test secrets
- **WHEN** the selected configuration is excluded by policy or supplies explicitly declared test secrets
- **THEN** its JSON SHALL remain outside the capture and build context, evidence SHALL contain only its fingerprint and permitted secret-free parameters, and test secret values SHALL use only the existing external secret mechanism

### Requirement: Rebuilding preserves evidence and verifies closure before replacement

Rebuild SHALL require an active sandbox of the verified work, checkout and owning session. The system SHALL validate replacement prerequisites before teardown, preserve the old execution report externally and verify absence of its own resources before starting the successor. The project quota SHALL remain held across the entire replacement. Every successor SHALL have a distinct identity, capture and report. Failure or uncertainty SHALL retain a recoverable reservation and block the successor; no automatic uncertain retry, product approval or Git/Linear modification SHALL occur. Existing isolation and dependency restrictions SHALL apply.

#### Scenario: Rebuild completes
- **WHEN** the owning session rebuilds a verifiable sandbox with valid prerequisites
- **THEN** the system SHALL preserve the old report, verify attributable cleanup and start the distinct successor while continuously holding the project quota

#### Scenario: Preservation or closure fails
- **WHEN** the report cannot be written, a resource remains, capture/secret cleanup fails or daemon identity becomes uncertain
- **THEN** the system SHALL retain evidence and the reservation, report the unresolved condition and SHALL NOT start a successor

#### Scenario: Another session asks for rebuild
- **WHEN** rebuild is requested by a session other than the recorded owner
- **THEN** the system SHALL refuse replacement and explain that explicit transfer is required

#### Scenario: A new prerequisite is unavailable
- **WHEN** the new configuration, runtime or dependency is missing or invalid
- **THEN** the system SHALL block before destroying the previous sandbox and SHALL NOT provision the prerequisite

### Requirement: Explicit sandbox transfer verifies ownership before changing sessions

Transfer SHALL require an explicit request in a verified permitted session for the same project and work, verify the exact reservation/execution/resource relationship and exclude active competing operations. It SHALL NOT ask the operator for another session's token or expose that token. With an active sandbox it SHALL perform the same report-first verified replacement as rebuild, using the requesting checkout as the new source. With a free quota it SHALL build from that checkout. Manual application reservations, another work, unknown state and unverified legacy ownership SHALL block. Transfer SHALL issue authority only to the new owner and invalidate prior authority for the successor.

#### Scenario: A second session explicitly transfers a sandbox
- **WHEN** a permitted session for the same project/work requests transfer and the existing sandbox and its idle operation state are verifiable
- **THEN** the system SHALL replace it safely and bind the successor to the requesting session without requesting or revealing the previous token

#### Scenario: The quota is free
- **WHEN** transfer finds a verified free project quota
- **THEN** the system SHALL perform a normal build bound to the requesting session and effective checkout

#### Scenario: The reservation is not transferable
- **WHEN** the quota belongs to a manual application, another work, an in-flight operation or unverifiable records
- **THEN** the system SHALL preserve that reservation and its resources and report a block without takeover
