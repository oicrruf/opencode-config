# Spec Delta

## Purpose

Provide a local, per-project store for developer preferences and work
continuity, shared by the repository's worktrees and separated by verifiable
scope, so a decision survives the session that produced it without ever
becoming an instruction or an authorization on its own.

## ADDED Requirements

### Requirement: One canonical store per repository, shared by its worktrees

The system SHALL keep a single local database per repository at
`<repository-root>/.opencode/memory/memory.sqlite` and SHALL reach it from
every worktree of that repository without copying or merging databases. The
system SHALL NOT create an alternative database inside a worktree, and
SHALL NOT write outside the canonical location.

#### Scenario: A session starts from a linked worktree

- **WHEN** OpenCode starts a session from a worktree linked to the
  repository's main checkout
- **THEN** the memory tools SHALL read and write the canonical database in
  the main checkout, and no database SHALL be created in the worktree

#### Scenario: Two repositories are open

- **WHEN** sessions run in two different repositories
- **THEN** each repository SHALL use its own database and no record from one
  repository SHALL be visible in the other

#### Scenario: The repository root cannot be resolved

- **WHEN** the plugin cannot determine the main checkout of the repository
  with sufficient certainty
- **THEN** the memory tools SHALL report that memory is unavailable and
  SHALL NOT create a database at any other path

### Requirement: Records carry a verifiable scope

The system SHALL store the applicable scope of every record and SHALL
distinguish at least project, worktree, branch, work item, OpenSpec change,
and session. A record SHALL retain the scope it was created with when the
worktree or branch it refers to is later closed or integrated.

#### Scenario: A decision is taken inside a worktree

- **WHEN** an authorized agent records a decision while working from an
  identified worktree
- **THEN** the record SHALL be stored in the canonical database with that
  worktree as its scope, together with the branch and repository it belongs
  to

#### Scenario: A scoped record outlives its worktree

- **WHEN** a worktree is retired and its branch is integrated
- **THEN** the records created in that scope SHALL remain in the database
  with their original scope and SHALL NOT be promoted to project scope

#### Scenario: A search filters by scope

- **WHEN** an agent searches for preferences
- **THEN** only records whose scope applies to the current worktree, branch,
  work item, OpenSpec change, or session SHALL be returned

### Requirement: Preferences are stored with a category, status, source, and scope

The system SHALL store each developer preference with a category, a status, a
source, and an optional scope. An unambiguous statement from the developer
SHALL be stored as approved without a redundant confirmation. A statement
whose attribution, intent, recurrence, scope, or conflict with an existing
record is ambiguous SHALL NOT be stored or activated until it is clarified.

#### Scenario: An unambiguous preference is stored

- **WHEN** the developer states a recurring constraint in terms that identify
  the intent and the scope
- **THEN** the system SHALL store it as approved, with the category and the
  scope the statement identifies, and SHALL NOT ask for a second
  confirmation

#### Scenario: An ambiguous statement is not persisted

- **WHEN** a statement could plausibly be a one-off remark, could be
  attributed to another source, or conflicts with an existing record
- **THEN** the system SHALL NOT store it and SHALL report that clarification
  is required first

### Requirement: Corrections supersede a preference and forgetting removes its content

A correction SHALL create a new version that supersedes the previous one, and
forgetting SHALL remove the content while retaining only an opaque
identifier and the deletion date. Both operations SHALL address a record by
its exact identifier.

#### Scenario: A correction supersedes the previous version

- **WHEN** the developer corrects a stored preference
- **THEN** the system SHALL store the correction as a new approved version
  linked to the previous one, and SHALL mark the previous version as
  superseded

#### Scenario: A preference is forgotten

- **WHEN** the developer asks to forget a stored preference and identifies it
  unambiguously
- **THEN** the system SHALL delete its content, SHALL retain only an opaque
  identifier and the deletion date, and SHALL NOT retain a recoverable copy

### Requirement: Recovered context is auxiliary and never an authorization

The system SHALL treat every stored record as auxiliary context. A stored
record SHALL NOT authorize an action, SHALL NOT replace a current
instruction, policy, or request, and SHALL NOT be widened by inference. The
tools that expose the store SHALL state that property in their own
description, and the routing contract SHALL state it for the agents that
consult it.

#### Scenario: A stored preference could authorize a step

- **WHEN** an agent consults a stored preference that appears to permit an
  action the current request does not authorize
- **THEN** the agent SHALL treat the request and the current policies as the
  only sources of authorization and SHALL NOT act on the stored preference
  alone

#### Scenario: A stored decision contradicts the current request

- **WHEN** a stored decision conflicts with the developer's current
  instruction
- **THEN** the current instruction SHALL prevail and the conflict SHALL NOT
  be resolved silently in favor of the stored record

### Requirement: Work continuity can be saved and resumed

The system SHALL allow an agent to save a continuity record with a brief
summary, the verified sources it relies on, the checks that were run, the
blockers that remain, the proposed next steps, and the references it
confirms. It SHALL allow a later session to retrieve those records, filtered
by work item when one is known.

#### Scenario: A session ends with verified state

- **WHEN** an agent ends a session having verified a specific state and
  recorded the references it confirmed
- **THEN** it SHALL be able to save a continuity record containing that
  summary, its sources, its checks, its blockers, and its next steps
  distinguished as proposed, agreed, or pending

#### Scenario: A later session resumes the work

- **WHEN** a new session asks for the continuity of a known work item
- **THEN** the tool SHALL return the matching records so the session can
  re-establish the state, and the session SHALL re-verify the state against
  the authoritative sources before relying on it

### Requirement: The store is versioned, migrates atomically, and never half-applies

The system SHALL record the schema version of the store and SHALL apply each
migration atomically, preserving existing data. A migration that fails SHALL
leave the database unchanged. A database created by an incompatible future
schema version SHALL be left untouched and SHALL NOT be written to.

#### Scenario: A new database is created

- **WHEN** the store is initialized on a repository that has none
- **THEN** the system SHALL create the initial schema, SHALL record its
  version, and SHALL only accept writes once that version is recorded

#### Scenario: A migration succeeds

- **WHEN** the store is opened at an older version with a supported
  migration path
- **THEN** the migration SHALL complete atomically and the recorded version
  SHALL change only after every step of the migration has completed

#### Scenario: A migration fails

- **WHEN** a migration cannot complete
- **THEN** the system SHALL preserve the database without partial changes,
  SHALL NOT write new data, and SHALL continue operating without memory

### Requirement: The store stays local, unversioned, and free of sensitive content

The system SHALL keep the database and its auxiliary files out of version
control through a versioned ignore rule, and SHALL NOT synchronize or
transmit their contents to other developers or services. The system SHALL
store brief summaries and never full transcripts, credentials, tokens, or
other secrets. The system SHALL NOT store content attributed to the
developer that the developer did not state.

#### Scenario: A fresh clone ignores the store

- **WHEN** a contributor clones this repository on a host where the memory
  store already exists
- **THEN** the versioned ignore rule SHALL exclude the store and its
  auxiliary files, and they SHALL NOT appear as versionable changes

#### Scenario: A credential is offered for storage

- **WHEN** an agent attempts to record a value that is a credential, a token,
  or a key
- **THEN** the system SHALL refuse to store it and SHALL report the refusal

#### Scenario: A quoted source is stored

- **WHEN** an agent stores a record that quotes a specification, a work item,
  or a tool output
- **THEN** the record SHALL be a summary with its own attribution, and SHALL
  NOT be stored as a statement made by the developer

### Requirement: The store protects its own paths and permissions

The system SHALL limit access to the store to the local identity that runs
OpenCode, SHALL apply restrictive permissions where the platform allows it,
and SHALL refuse to write through a symbolic link or to a path that would
escape the canonical location. The system SHALL NOT replace or delete data
it does not recognize as its own.

#### Scenario: The store is created

- **WHEN** the plugin initializes the store on a host that allows
  restricting permissions
- **THEN** it SHALL apply restrictive permissions to the directory and the
  database, and SHALL verify that no component of the path is an unsafe
  symbolic link

#### Scenario: The path holds an incompatible file

- **WHEN** the canonical path contains a file the plugin does not recognize
  as its own store, or an unsafe link
- **THEN** the plugin SHALL NOT replace or delete it, SHALL leave the memory
  inactive, and SHALL report a clear diagnostic

### Requirement: Memory failures never block the session

The system SHALL allow OpenCode to keep operating when the store is
unavailable, locked, incompatible, or reports an integrity error. A memory
failure SHALL NOT abort the agent's task, and SHALL NOT cause the store to
be discarded or silently recreated.

#### Scenario: The database is locked or damaged

- **WHEN** the store cannot be read or written because of a lock, corruption,
  or an engine error
- **THEN** the memory tool SHALL abandon that operation, SHALL preserve the
  file for diagnosis or recovery, and SHALL let the session continue

#### Scenario: The cause disappears later

- **WHEN** a transient failure no longer applies and the store is intact and
  compatible again
- **THEN** a later session SHALL be able to use the store again without the
  earlier data having been discarded or recreated
