# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
