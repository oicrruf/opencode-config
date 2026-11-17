# Spec Delta

## MODIFIED Requirements

### Requirement: The reservation records its owner and its token

The system SHALL record the reservation's owner token, the identity of the
supervisor process, the time it was taken, its process group, and its
session. The token SHALL be the only way to stop the application through
ordinary stop/finish/cancel/recover operations. An explicitly requested,
verified sandbox transfer or its explicit journaled recovery SHALL be the sole exception: it SHALL authorize
only a serialized sandbox replacement for the same project/work, SHALL
rotate ownership authority without obtaining or exposing the previous
token and SHALL NOT authorize takeover of a manual application. The system
SHALL store only a salted token verifier, SHALL store the name of the
executable and SHALL NOT store secrets passed as arguments. New sandbox
ownership SHALL include a verified session and generation bound to its
exact execution. Legacy records without sufficient identity SHALL NOT be
transferred by guessing missing fields.

#### Scenario: The reservation is recorded
- **WHEN** an application is started
- **THEN** the system SHALL record the token verifier, supervisor identity, start time, process group and session, and SHALL return the token to the requester without writing it to logs or reports

#### Scenario: The arguments carry a secret
- **WHEN** a start request passes a value that looks like a credential
- **THEN** the system SHALL refuse to store it and SHALL report the refusal

#### Scenario: Transfer changes the sandbox owner
- **WHEN** an explicitly requested sandbox transfer passes project/work, resource, session and operation verification
- **THEN** the system SHALL rotate authority under exclusive control and deliver the new capability only to the new owner without revealing the old capability

#### Scenario: Old authority targets a successor
- **WHEN** an old token, session or supervisor generation attempts to mutate the successor
- **THEN** the system SHALL refuse without changing resources or releasing the current reservation

## ADDED Requirements

### Requirement: Reservation replacement is exclusive and continuous across processes

The system SHALL serialize project-level start, replacement, transfer,
closure, recovery and supervisor mutations across processes. It SHALL keep
the project quota held from replacement intent through verified closure
and successor ownership, without exposing a free interval. Each mutation
SHALL verify the exact execution and ownership generation. Concurrent or
uncertain operations SHALL block without automatically retrying or taking
over locks by age alone. Manual applications SHALL share this exclusion
and quota without becoming transferable.

#### Scenario: Two sessions race to replace
- **WHEN** two independent processes request replacement or transfer concurrently
- **THEN** only one SHALL mutate the reservation or resources and the other SHALL report a conflict without launching an application

#### Scenario: Another start races with closure
- **WHEN** a sandbox or manual application start arrives after old resources close but before replacement ownership commits
- **THEN** it SHALL remain blocked by the continuously held project quota

#### Scenario: Supervisor races with transfer
- **WHEN** the old supervisor attempts cleanup while transfer commits a new generation
- **THEN** exclusion and identity verification SHALL prevent it from acting on the successor or releasing its reservation

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
