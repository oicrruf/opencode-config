# Local execution reservation Specification

## Purpose

Run one local development application at a time per project under a
reservation that records its owner, so two sessions cannot start competing
processes and an application can only be stopped through the reservation
that owns it.

## Requirements

### Requirement: One application at a time per project

The system SHALL allow a single reserved application per project. A start
request SHALL be rejected before it launches anything when another session
already holds the reservation, and the rejection SHALL name the work that
holds it. The system SHALL NOT launch a second application to satisfy a
rejected request.

#### Scenario: The reservation is free

- **WHEN** an agent requests the start of an application for a work that has
  a managed worktree
- **THEN** the system SHALL acquire the reservation, SHALL start the
  application, and SHALL return the token that owns it

#### Scenario: Another session holds the reservation

- **WHEN** a start request arrives while another session holds the
  reservation
- **THEN** the system SHALL reject the request before starting any
  process, and SHALL report the work that holds the reservation

#### Scenario: The work has no managed worktree

- **WHEN** a start request names a work that has no managed worktree
- **THEN** the system SHALL refuse the request and SHALL report that the
  work has no managed worktree

### Requirement: The reservation records its owner and its token

The system SHALL record the reservation's owner token, the identity of the supervisor process, the time it was taken, its process group, and its session. The token SHALL be the only way to stop the application through ordinary stop/finish/cancel/recover operations. An explicitly requested, permission-checked sandbox release or transfer SHALL be an exception only for exact resources verified against the reservation, Compose labels and managed project worktree inventory. For a legacy application reservation, the recorded work ID MAY differ from the Compose runtime source only when exact project labels and bind mounts resolve to exactly one existing managed worktree; the operation SHALL preserve both identities in its report. Such operations MAY close a reservation owned by a different worktree in the same project without obtaining or exposing the previous token, but SHALL NOT cross projects or act on ambiguous or unverified resources. Transfer SHALL rotate ownership authority without obtaining or exposing the previous token. The system SHALL store only a salted token verifier, SHALL store the name of the executable and SHALL NOT store secrets passed as arguments. New sandbox ownership SHALL include a verified session and generation bound to its exact execution.

#### Scenario: The reservation is recorded
- **WHEN** an application is started
- **THEN** the system SHALL record the token verifier, supervisor identity, start time, process group and session, and SHALL return the token to the requester without writing it to logs or reports

#### Scenario: The arguments carry a secret
- **WHEN** a start request passes a value that looks like a credential
- **THEN** the system SHALL refuse to store it and SHALL report the refusal

#### Scenario: Transfer changes ownership between managed worktrees
- **WHEN** an explicitly permitted transfer verifies source and target worktrees in the same project and proves the exact resource relationship
- **THEN** the system SHALL rotate authority under exclusive control and deliver the new capability only to the new owner without revealing the old capability

#### Scenario: Legacy reservation work ID differs from the Compose source
- **WHEN** a permitted release or transfer finds a stale recorded work ID but all Compose resources map to exactly one managed source worktree in the same project
- **THEN** the system SHALL retain the recorded owner ID and runtime source ID separately and SHALL perform no resource changes if the source match is absent or ambiguous

#### Scenario: Application transfer leaves a reserved handoff
- **WHEN** an explicitly permitted transfer closes a verified application from one managed worktree and targets another worktree in the same project
- **THEN** the system SHALL rotate authority to the target session and worktree, preserve the quota in `awaiting-start`, and return only the new owner capability

#### Scenario: Transfer changes the sandbox owner
- **WHEN** an explicitly requested sandbox transfer passes project/work, resource, session and operation verification
- **THEN** the system SHALL rotate authority under exclusive control and deliver the new capability only to the new owner without revealing the old capability

#### Scenario: Release is explicitly authorized
- **WHEN** an explicitly permitted release verifies the reservation and all attributable runtime resources
- **THEN** the system SHALL close those resources without requiring the prior token, preserve persistent data and record the released worktree identity

#### Scenario: Old authority targets a successor
- **WHEN** an old token, session or supervisor generation attempts to mutate the successor
- **THEN** the system SHALL refuse without changing resources or releasing the current reservation

### Requirement: Stopping is restricted to the reservation's own process group

The system SHALL stop an application only when the token matches the
reservation, and SHALL signal only the process group the reservation
started. When the application ends on its own, the supervisor SHALL close
the descendants that remain in that group and SHALL release the
reservation. Processes that were not started by the reservation SHALL NOT
be affected.

#### Scenario: The owner stops the application

- **WHEN** the owner calls the stop with its token
- **THEN** the system SHALL verify the identity, SHALL signal only the
  managed group, and SHALL release the reservation

#### Scenario: A wrong token is presented

- **WHEN** the stop is called with a token that does not match the
  reservation
- **THEN** the system SHALL refuse it and SHALL NOT signal the group

#### Scenario: The application ended on its own

- **WHEN** the application terminates by itself
- **THEN** the supervisor SHALL close the remaining descendants of its
  group and SHALL release the reservation

### Requirement: An ambiguous reservation blocks the next start

When the owner's identity does not match, the process group still has
processes, or the system's process state cannot be inspected, the system
SHALL NOT signal those processes and SHALL NOT release an ambiguous
reservation. It SHALL block the next start and SHALL report the condition.

#### Scenario: The process identifier was reused

- **WHEN** the recorded owner's identity does not match the process that
  holds the reservation
- **THEN** the system SHALL NOT signal it, SHALL NOT release the
  reservation, and SHALL block the next start

#### Scenario: The process state cannot be inspected

- **WHEN** the system cannot determine the state of the process group
- **THEN** the system SHALL keep the reservation and SHALL report that the
  state is unverifiable

### Requirement: A reservation whose owner ended is recovered conservatively

The recovery of an abandoned reservation SHALL proceed only when the
recorded owner is confirmed to have ended and its group no longer has
processes. The system SHALL NOT release a reservation on the basis of age
alone, and the recovery of a reservation SHALL be recorded so a retry does
not release a different one.

#### Scenario: The owner is confirmed gone

- **WHEN** the system confirms that the exact owner ended and that its
  group has no remaining process
- **THEN** the system SHALL release the reservation and SHALL record the
  recovery

#### Scenario: The owner cannot be confirmed

- **WHEN** the system cannot confirm that the owner ended
- **THEN** the system SHALL keep the reservation and SHALL report that the
  owner is unverifiable

### Requirement: Reservation replacement is exclusive and continuous across processes

The system SHALL serialize project-level start, replacement, transfer, release, closure, recovery and supervisor mutations across processes. It SHALL keep the project quota held from replacement or release intent through verified closure and successor ownership or verified resource absence, without exposing a free interval. Each mutation SHALL verify the exact execution and ownership generation. Concurrent or uncertain operations SHALL block without automatically retrying or taking over locks by age alone. Manual applications SHALL share this exclusion and quota; they MAY be explicitly released or transferred only when their runtime resources and persistent-data boundaries are uniquely verified.

#### Scenario: Two sessions race to replace or release
- **WHEN** two independent processes request replacement, transfer or release concurrently
- **THEN** only one SHALL mutate the reservation or resources and the other SHALL report a conflict without launching an application

#### Scenario: Two sessions race to replace
- **WHEN** two independent processes request replacement or transfer concurrently
- **THEN** only one SHALL mutate the reservation or resources and the other SHALL report a conflict without launching an application

#### Scenario: Another start races with release
- **WHEN** a sandbox or manual application start arrives after old resources close but before release is committed
- **THEN** it SHALL remain blocked by the continuously held project quota

#### Scenario: Another start races with closure
- **WHEN** a sandbox or manual application start arrives after old resources close but before replacement ownership commits
- **THEN** it SHALL remain blocked by the continuously held project quota

#### Scenario: Supervisor races with transfer or release
- **WHEN** the old supervisor attempts cleanup while transfer or release commits
- **THEN** exclusion and identity verification SHALL prevent it from acting on the successor or releasing the current reservation

#### Scenario: Supervisor races with transfer
- **WHEN** the old supervisor attempts cleanup while transfer commits a new generation
- **THEN** exclusion and identity verification SHALL prevent it from acting on the successor or releasing its reservation

#### Scenario: Persistent data is attached to the application
- **WHEN** release or transfer finds database volumes or host upload paths attached to verified application resources
- **THEN** the system SHALL preserve those volumes and paths and SHALL NOT remove them as disposable runtime resources

#### Scenario: A target resumes a transferred application
- **WHEN** the target session supplies the handoff token, managed work ID, and its own application command with matching persistent mounts
- **THEN** the system SHALL start only that command and SHALL complete the handoff without changing the database volume or upload source

#### Scenario: A target command has mismatched persistence
- **WHEN** the target command mounts a different persistent volume or upload source
- **THEN** the system SHALL not start or release the held quota and SHALL preserve the handoff record and old persistent data

#### Scenario: Application ownership cannot be verified
- **WHEN** application resource labels do not uniquely match the recorded worktree and project
- **THEN** release and transfer SHALL be refused while the reservation and all resources remain intact

### Requirement: Interrupted replacement retains recoverable identity and evidence

The system SHALL retain sufficient versioned, secret-free transition state
to identify the previous and successor executions, owner, generation and
last verified phase. Failure to persist or reconcile this state SHALL
preserve the quota and evidence. Recovery SHALL verify operation ownership,
engine and resources before continuing attributable closure; it SHALL NOT
automatically start another test, infer a free quota from a missing partial
record or require disclosure of another session's token.

#### Scenario: The coordinator dies between closure and successor start
- **WHEN** replacement is interrupted after old resource absence was verified but before successor start completes
- **THEN** the reservation and transition evidence SHALL remain recoverable and no competitor SHALL treat the quota as free

#### Scenario: New authority was committed but not delivered
- **WHEN** transfer is interrupted after authority rotation and before the requesting session receives its capability
- **THEN** recovery SHALL use verified transition identity without exposing or asking for the previous owner's token

#### Scenario: Running was persisted before token delivery
- **WHEN** explicit recovery identifies the exact running successor and either the requesting session is its verified owner or the prior operation owner is verifiably gone
- **THEN** recovery SHALL close that successor without requiring an undelivered token or starting another test, while a different live session without such proof SHALL remain blocked

#### Scenario: Records are inconsistent
- **WHEN** the reservation, transition record and execution cannot be reconciled to one verified generation
- **THEN** the system SHALL report the ambiguity and preserve the block without deleting records or launching resources
