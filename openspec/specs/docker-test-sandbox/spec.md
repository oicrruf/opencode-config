# Docker test sandbox Specification

## Purpose

Build and test an independent capture of the work under test inside an
isolated local container, so a change that can only be verified at runtime
is verified against recorded evidence instead of against a claim, while the
host, the secrets, and the published history stay untouched.

## Requirements

### Requirement: The host and the build configuration are verified first

The system SHALL verify the host, the effective Docker endpoint, the engine,
and the project's declared build configuration before it prepares any resource.
It SHALL require a reachable local Unix-socket Linux Docker engine on Linux
or WSL2, without requiring a Docker Desktop product identity, or macOS with
verified local Docker Desktop running a Linux engine. For macOS,
a verified local Unix socket endpoint and Docker Desktop engine identification
SHALL both be required; process.platform alone SHALL NOT establish support.
Remote TCP/SSH/HTTP endpoints, incompatible engines and ambiguous identity SHALL
be refused. The project SHALL declare its Dockerfile, context, target stage
and applicable production parameters. The system SHALL NOT require Compose,
install an agent inside the sandbox, or generate/replace the project's Dockerfile.

#### Scenario: The host and the configuration are valid
- **WHEN** a supported host has a verified usable local Linux Docker engine
  and the project declares a valid Dockerfile, context and stage
- **THEN** the system SHALL build from the capture with that configuration
  and SHALL record the identity of the resulting image and engine

#### Scenario: The host is not supported
- **WHEN** the host/engine combination is unsupported, the engine cannot be
  reached, or its local identity cannot be verified
- **THEN** the system SHALL report the block before creating resources,
  SHALL NOT install anything and SHALL NOT present the test as approved

#### Scenario: The project declares no Dockerfile
- **WHEN** the project has no Dockerfile or the declared configuration is incomplete
- **THEN** the system SHALL report what is missing, SHALL NOT invent a
  configuration and SHALL NOT begin a build

#### Scenario: Linux or WSL2 uses a local Linux engine
- **WHEN** the client runs on Linux or WSL2 and the effective endpoint is a
  verified local Unix socket for a Linux container engine
- **THEN** preflight and start SHALL accept it without requiring Docker
  Desktop identification and SHALL preserve every existing isolation restriction

#### Scenario: macOS uses local Docker Desktop with Linux containers
- **WHEN** the client runs on macOS, the effective endpoint is a verified
  local Unix socket, and engine metadata identifies Docker Desktop with Linux containers
- **THEN** preflight and start SHALL accept the host combination, record
  those observations, and preserve every existing sandbox isolation restriction

#### Scenario: Context or environment selects a remote engine
- **WHEN** the effective Docker endpoint selected by context or environment
  uses a remote transport or cannot be determined unambiguously
- **THEN** preflight and start SHALL report a block before reservation,
  capture, build, container, network or volume creation

#### Scenario: Desktop identification is incomplete or incompatible
- **WHEN** macOS engine metadata is missing, malformed, identifies another
  engine, or does not identify Linux containers
- **THEN** the system SHALL refuse the start without inferring support from
  an installed CLI, a context name, or a successful version command alone

### Requirement: The capture is independent, identified, and consistent

The system SHALL capture the committed files, the modifications, and the new
files that belong to the work under test, and SHALL record a manifest with
the identity of the work, the repository, the branch, the head, and a
fingerprint per file. It SHALL NOT copy the worktree's Git pointer, SHALL
NOT follow a symbolic link out of the source, and SHALL reject a capture
whose source changed while it was being taken.

#### Scenario: The work has uncommitted changes

- **WHEN** the work under test has modifications and new files
- **THEN** the capture SHALL contain them, SHALL preserve the deletions and
  the relevant permissions, and the fingerprint SHALL identify the content
  that was tested

#### Scenario: A link points outside the source

- **WHEN** a symbolic link in the source would bring content from outside
  it into the capture
- **THEN** the capture SHALL be rejected without reading the destination,
  and no build SHALL start

#### Scenario: The source changes during the capture

- **WHEN** the worktree changes while the capture is being taken
- **THEN** the capture SHALL be rejected as inconsistent, and the system
  SHALL NOT build and SHALL NOT revert the change

#### Scenario: The branch or head changes during the capture

- **WHEN** the symbolic branch or the head changes while the capture is
  being taken, even if the resulting tree is identical
- **THEN** the capture SHALL be rejected for an inconsistent identity

#### Scenario: The build needs Git metadata

- **WHEN** the build requires Git metadata
- **THEN** the system SHALL prepare an independent repository holding the
  captured state, without copying the worktree's pointer and without
  enabling writes to the original repository

#### Scenario: The source changes after the capture

- **WHEN** the worktree changes after a valid capture
- **THEN** the result SHALL identify that capture only, SHALL NOT claim to
  cover the later state, and a correction SHALL require a new capture

### Requirement: Secrets and local agent state are excluded by default

The system SHALL exclude the secrets and the agent's local state from the
capture by default, including environment files, integration credentials,
model keys, sessions, the project memory, and the global configuration. The
system SHALL supply only the test secrets the developer declares
explicitly, outside the build context, and SHALL NOT include their values
in any argument, response, or evidence.

#### Scenario: The source contains local credentials

- **WHEN** the worktree contains an environment file, an integration
  credential, a model key, or the agent's local state
- **THEN** none of it SHALL appear in the capture, in the build context, or
  in the evidence

#### Scenario: A test secret is required

- **WHEN** the developer declares a credential or safe data that the test
  needs
- **THEN** it SHALL be supplied with the minimum scope, outside the build
  context, through a mechanism that does not write it into an image layer,
  and the evidence SHALL preserve it without its value

### Requirement: The build and the test are isolated from the host

The system SHALL build and run the capture without the host's Docker socket,
without elevated privileges, without the host's network, and without
mounting the original source into the container. It SHALL publish ports on
the loopback interface only, and SHALL declare the limits of CPU and memory
it applies.

#### Scenario: The request asks for a weaker isolation

- **WHEN** a request asks for elevated privileges, the Docker socket, the
  host network, a mount of the original source, or a publication that is
  not local
- **THEN** the preparation SHALL be refused and no execution SHALL start
  with the weakened protections

#### Scenario: The container publishes a port

- **WHEN** the test needs to publish a port
- **THEN** the system SHALL bind it to the loopback interface only and
  SHALL report the local address

### Requirement: External dependencies are used, never provisioned

The system SHALL use the external services the developer prepared and SHALL
NOT provision, modify, or remove them. When a declared dependency is
missing, the test SHALL be blocked and SHALL NOT be reported as approved,
and the cleanup SHALL remove only the resources the run created.

#### Scenario: A prepared dependency is available

- **WHEN** a database or a service the developer prepared is configured and
  reachable from the test environment
- **THEN** the system SHALL use it with the explicit data and credentials,
  and SHALL record the condition without claiming equivalence with
  production

#### Scenario: A dependency is missing

- **WHEN** a service the test needs is not available
- **THEN** the test SHALL be blocked, SHALL NOT be reported as approved, and
  the cleanup SHALL remove only the run's own resources

### Requirement: Each execution has a distinct identity tied to the work

The system SHALL give the sandbox, the session it drives, and the resources
it creates an identity that contains the work identifier and a normalized
work name, and SHALL distinguish two successive executions of the same work.
The system SHALL preserve the full identity in its record so a recovery
never depends on a truncated name.

#### Scenario: The same work is tested twice

- **WHEN** two captures of the same work are tested in succession
- **THEN** the two executions SHALL have distinct identities, and their
  reports and resources SHALL NOT be mixed

### Requirement: Starting the sandbox does not approve the test

The system SHALL allow a local access and a performance test with their
conditions recorded, and SHALL keep a manual test available until it is
explicitly concluded or cancelled. The system SHALL NOT apply a timeout by
default, and SHALL arm an independent local supervisor only when a maximum
duration is agreed for that execution. Starting the environment SHALL NOT
approve the test and SHALL NOT claim equivalence with production.

#### Scenario: The application is available

- **WHEN** the start checks pass
- **THEN** the system SHALL return the local access, and the manual test
  SHALL remain pending

#### Scenario: The test is concluded or cancelled

- **WHEN** the developer concludes the test with an explicit result, or
  cancels it
- **THEN** the system SHALL record that result or that cancellation, SHALL
  NOT convert it into an approval, and SHALL begin the report and the
  cleanup

#### Scenario: A maximum duration was agreed

- **WHEN** a maximum duration is agreed for that execution
- **THEN** an independent local supervisor SHALL be armed and recorded
  before the start, and its expiry SHALL close the run without approving it

### Requirement: The report is preserved outside the environment before the cleanup

The system SHALL preserve the report outside the environment and SHALL
include the result, the execution, the work, the capture, the image, the
commands and steps, the dependencies, the differences from production, the
performance conditions, and the relevant evidence, without secrets. It SHALL
distinguish a failure to start from an approved product, and it SHALL
preserve the evidence before it removes anything.

#### Scenario: The test concludes

- **WHEN** the execution ends or is cancelled
- **THEN** the system SHALL preserve a verifiable report without secrets
  before it removes any resource, and SHALL record the result and the
  reason for the termination separately

#### Scenario: The start or the preservation failed

- **WHEN** the start failed, or the evidence cannot be preserved
- **THEN** the system SHALL record the failure that is available without
  declaring an approval, and SHALL NOT release the quota nor destroy the
  resources needed to recover the evidence

### Requirement: The cleanup removes only the resources the run created

The system SHALL verify the identity and the absence of the resources it
owns before it releases the quota, after the evidence has been preserved.
It SHALL remove only the recorded exclusive resources, and SHALL NOT affect
shared images, external services, or resources the developer prepared. A
failure, an ambiguous identity, or an unreachable engine SHALL preserve the
block. The death of the coordinator SHALL NOT be enough to release the
quota.

#### Scenario: The cleanup is verified

- **WHEN** the execution is concluded or cancelled and the evidence is
  preserved
- **THEN** the system SHALL remove only the recorded exclusive resources,
  SHALL verify their absence, and SHALL NOT affect anything else

#### Scenario: The cleanup cannot be completed

- **WHEN** a resource cannot be removed, its identity is ambiguous, or the
  engine is unreachable
- **THEN** the system SHALL keep the block, SHALL report what remains, and
  SHALL NOT release the quota

### Requirement: Recovery resumes an interrupted execution without releasing the quota

The system SHALL recover an execution that was interrupted while it was
being prepared, run, or cleaned up, by consulting its record and the
engine's own state. It SHALL keep the quota while the resources are still
active or the identity is ambiguous, SHALL resume the verifiable closure,
and SHALL NOT start a second test for the same execution.

#### Scenario: The coordinator died during the run

- **WHEN** the coordinator is gone and the execution was still active
- **THEN** the recovery SHALL consult the record and the engine's state,
  SHALL keep the quota, and SHALL resume the closure without starting a
  second test

#### Scenario: The recovery finds the resources already gone

- **WHEN** the recovery finds that the execution's resources are absent
- **THEN** the recovery SHALL report that the closure was already completed
  and SHALL NOT act on any other execution

### Requirement: Git and the delivery stay outside the sandbox

The system SHALL limit the sandbox to building and testing the capture. It
SHALL NOT modify the host's branches, SHALL NOT publish code, SHALL NOT
open a pull request, SHALL NOT integrate, and SHALL NOT close a work item.
A correction SHALL be made in the worktree and SHALL require a new capture.

#### Scenario: The test modifies files

- **WHEN** the test generates or modifies files inside the container
- **THEN** the system SHALL NOT return those changes to the source
  automatically and SHALL NOT alter the host's Git references

### Requirement: Each execution remains bound to its verified local engine

The system SHALL retain the verified local endpoint and daemon identity for
an execution and SHALL use that binding for its build, run, inspection,
reporting, cancellation, cleanup, recovery and supervisor actions. It SHALL
NOT silently follow subsequent changes to the ambient Docker context.
Unreachable, changed or unverifiable identity SHALL block destructive actions
and quota release while preserving evidence and resources for reconciliation.

#### Scenario: Default context changes after start
- **WHEN** the operator changes the ambient Docker context while an execution exists
- **THEN** the execution SHALL continue using its recorded local binding
  after verifying the same daemon identity, without acting on the new context

#### Scenario: Daemon identity changes or becomes unavailable
- **WHEN** the recorded endpoint no longer identifies the same verifiable daemon
- **THEN** cleanup, recovery and the supervisor SHALL preserve the reservation
  and report the uncertainty without removing resources on another engine

#### Scenario: Legacy execution has no engine binding
- **WHEN** recovery encounters an older execution without sufficient binding evidence
- **THEN** it SHALL preserve resources and require explicit reconciliation,
  without fabricating a binding from the currently selected context

### Requirement: Platform compatibility does not weaken runtime proof or isolation

The system SHALL retain independent capture, one application per project,
external evidence before cleanup, no Docker socket inside the container, no
added privileges, no host network or original-source mount, internal network
by default, declared limits and loopback-only publications on Docker Desktop.
It SHALL distinguish unit/transport fixtures from actual runtime observations.
Missing dependencies SHALL block a runtime test rather than be provisioned, except for the explicitly declared pinned OpenCode image authorized for the AT-188 fixture. No other image or package may be provisioned implicitly.

#### Scenario: Docker Desktop execution is verified
- **WHEN** a declared test runs through sandbox-control on the verified local Desktop engine
- **THEN** its evidence SHALL identify client and engine, tested capture,
  actual observed results and isolation conditions before attributable cleanup

#### Scenario: The pinned OpenCode fixture image is provisioned explicitly
- **WHEN** the operator-approved AT-188 fixture requests its declared
  OpenCode 2.2.7 OCI digest and the architecture matches linux/amd64 or linux/arm64
- **THEN** setup MAY fetch that exact image by digest before sandbox start,
  SHALL verify the local image identity/platform and SHALL use no floating tag

#### Scenario: Another runtime dependency is unavailable
- **WHEN** any dependency other than the explicitly approved pinned OpenCode
  fixture image, or any required service, is unavailable
- **THEN** the test SHALL remain blocked, SHALL NOT download or install it
  automatically and SHALL NOT substitute an import-only or host test

#### Scenario: AT-188 requires plugin loading evidence
- **WHEN** the AT-188 acceptance fixture is executed
- **THEN** evidence SHALL come from a real OpenCode session in the sandbox,
  show sandbox-control and worktree-control tools loaded once, preserve the
  installed configuration identity and keep the operator's global configuration untouched

### Requirement: The sandbox and worktree controls load through the pinned OpenCode V2 plugin API

The sandbox-control and worktree-control plugins SHALL expose a V2 default
plugin entrypoint with a stable ID and register their existing tool surface
through the public V2 tool transform API. Worktree operations SHALL use the
public V2 worktree API with the active project identity. V1 compatibility
entrypoints MAY remain, but SHALL NOT be used as evidence of V2 loading. Tool
names, input fields, safety checks, and failure behavior SHALL remain
compatible with the existing control contracts.

#### Scenario: OpenCode V2 loads each control once
- **WHEN** a V2 session loads the two local plugins
- **THEN** each plugin SHALL register its tools once through the V2 context,
  and the public tool listing SHALL contain each expected effective tool ID once

#### Scenario: V2 worktree API is unavailable
- **WHEN** a worktree-control tool requires an API operation that the V2
  context does not provide
- **THEN** the operation SHALL return an unavailable/blocked result and SHALL
  NOT fall back to raw worktree creation or removal

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
