# Spec Delta

## Purpose

Build and test an independent capture of the work under test inside an
isolated local container, so a change that can only be verified at runtime
is verified against recorded evidence instead of against a claim, while the
host, the secrets, and the published history stay untouched.

## ADDED Requirements

### Requirement: The host and the build configuration are verified first

The system SHALL verify the host and the project's declared build
configuration before it prepares any resource. It SHALL require a local
Docker engine on Linux or WSL2, and SHALL require the project to declare its
Dockerfile, its build context, its target stage, and the production
parameters that apply. It SHALL NOT require Compose, SHALL NOT install an
agent inside the sandbox, and SHALL NOT generate or replace the project's
Dockerfile.

#### Scenario: The host and the configuration are valid

- **WHEN** the host has a usable local Docker engine and the project
  declares a valid Dockerfile, context, and stage
- **THEN** the system SHALL build from the capture with that configuration
  and SHALL record the identity of the resulting image

#### Scenario: The host is not supported

- **WHEN** the host is not Linux or WSL2, or the local Docker engine cannot
  be reached
- **THEN** the system SHALL report the block, SHALL NOT install anything,
  and SHALL NOT present the test as approved

#### Scenario: The project declares no Dockerfile

- **WHEN** the project has no Dockerfile or the declared configuration is
  incomplete
- **THEN** the system SHALL report what is missing, SHALL NOT invent a
  configuration, and SHALL NOT begin a build

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
