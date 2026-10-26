# Spec Delta

## Purpose

Run one local development application at a time per project under a
reservation that records its owner, so two sessions cannot start competing
processes and an application can only be stopped through the reservation
that owns it.

## ADDED Requirements

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

The system SHALL record the reservation's owner token, the identity of the
supervisor process, the time it was taken, its process group, and its
session. The token SHALL be the only way to stop the application. The
system SHALL store the name of the executable and SHALL NOT store secrets
that were passed as arguments.

#### Scenario: The reservation is recorded

- **WHEN** an application is started
- **THEN** the system SHALL record the owner token, the supervisor
  identity, the start time, the process group, and the session, and SHALL
  return the token to the requester

#### Scenario: The arguments carry a secret

- **WHEN** a start request passes a value that looks like a credential
- **THEN** the system SHALL refuse to store it and SHALL report the
  refusal

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
