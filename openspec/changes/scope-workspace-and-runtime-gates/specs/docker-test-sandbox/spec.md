## ADDED Requirements

### Requirement: Only an explicit operator command loads a sandbox

OpenCode SHALL load or replace a project sandbox only when the user invokes the native sandbox build, rebuild or transfer command. The native permission and session verification SHALL still apply. The agent tools sandbox_start, sandbox_build, sandbox_rebuild and sandbox_transfer SHALL return operator guidance without invoking the lifecycle.

#### Scenario: An agent requests sandbox loading

- **WHEN** the agent invokes a start, build, rebuild or transfer tool, including with a valid session and permissive permissions
- **THEN** the tool SHALL direct the user to the relevant native command and SHALL NOT access the worktree inventory, reserve quota, capture files or start Docker

#### Scenario: The user explicitly invokes the native command

- **WHEN** the user invokes a valid build, rebuild or transfer command with the required permission
- **THEN** the system SHALL run the existing verified lifecycle for that operation

### Requirement: The configuration repository declares its sandbox in source control

The configuration repository SHALL provide a secret-free sandbox declaration at `.opencode/sandbox.json` and a Docker recipe for loading the sandbox and worktree plugins from the captured checkout in a pinned OpenCode runtime. Preparing the files SHALL NOT start an execution or publish a port by default.

#### Scenario: A user prepares a missing project declaration

- **WHEN** a repository needs a declaration and the user requests its preparation
- **THEN** the source files SHALL be prepared for version control with a concrete build recipe, separately from the user's eventual invocation of the sandbox

## MODIFIED Requirements

### Requirement: The sandbox command validates its complete invocation before dispatch

The system SHALL expose `/sandbox`, `/sandbox help`, `/sandbox release`, `/sandbox build [path]`, `/sandbox rebuild [path]` and `/sandbox transfer <config>`. A native V2 executor SHALL parse the complete invocation before any model prompt or tool call; it SHALL NOT rely on a Markdown prompt to enforce validation. Empty arguments and help SHALL return usage without tool calls or a model request. Release SHALL accept no operands. Build and rebuild SHALL accept zero or one checkout-relative configuration path. Transfer SHALL accept exactly one checkout-relative path: sandbox JSON for sandbox replacement or a Compose file for application handoff. Paths MAY be balanced single or double quoted for spaces and SHALL NOT use shell expansion. Invalid operations, missing or extra operands, flags and malformed quoting SHALL return usage without invoking tools or modifying resources. Valid release and transfer operations SHALL enforce the active session's named permission and tool entrypoints SHALL independently reject invalid fields before lifecycle effects.

#### Scenario: An invocation is invalid
- **WHEN** an invocation contains an unknown operation, extra operand, missing transfer path, flag or unmatched quote
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

#### Scenario: Build or rebuild uses the declared project configuration
- **WHEN** the user invokes `/sandbox build` or `/sandbox rebuild` without a path
- **THEN** the system SHALL discover the checkout configuration using the existing precedence, validate it before starting or replacing a sandbox, and report a missing declaration if neither conventional file exists

### Requirement: Command source and configuration belong to the effective session checkout

The system SHALL resolve the source checkout, project and work identity from the verified active session and managed worktree inventory. It SHALL use the explicitly selected configuration or, for build and rebuild without a path, the checkout declaration selected by existing precedence, resolve its build paths relative to that checkout root and verify configuration and source consistency. The selected configuration JSON SHALL remain outside the capture even when requested by include. External evidence SHALL record its byte fingerprint and only secret-free permitted parameters, excluding secret values, dependency URLs and arbitrary free-form configuration fields. Its fingerprint SHALL be checked after capture against the bytes used for validation. It SHALL retain project-wide quota and evidence while recording the tested checkout. Unverified, conflicting, escaping or ambiguous identity/configuration SHALL block without silently selecting another checkout. Existing default configuration consumers SHALL remain supported.

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
