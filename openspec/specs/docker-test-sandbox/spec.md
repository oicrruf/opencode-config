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
