# Spec Delta

## Purpose

Provide a per-project cache of library documentation that records which
version the answer refers to, how fresh it is, and which agent verified it,
so repeated lookups are answered locally and stale answers are never
presented as current.

## ADDED Requirements

### Requirement: Repeated lookups are answered from the project cache

The system SHALL cache the documentation lookups made through Context7 in the
project's local store. A repeated lookup with the same tool, the same
arguments, and the same resolved package version SHALL be answered from the
cache without a network request. The cache SHALL be scoped to the project
that produced it and SHALL NOT be shared between repositories.

#### Scenario: The same library is queried twice

- **WHEN** an agent queries the same library and topic twice in the same
  project, and the cached entry is still fresh
- **THEN** the second lookup SHALL be answered from the local store and
  SHALL NOT produce a network request to the documentation service

#### Scenario: Another project asks for the same library

- **WHEN** a different repository asks for documentation that another project
  already cached
- **THEN** the lookup SHALL NOT be answered from the other project's cache
  and SHALL reach the documentation service

#### Scenario: The lookup arguments differ

- **WHEN** an agent queries the same library with different arguments
- **THEN** the cache SHALL NOT serve the entry recorded for the other
  arguments, and the lookup SHALL reach the documentation service

### Requirement: The cache key includes the library, the version, and the topic

The system SHALL identify a cached entry by the project, the tool, the
arguments, the library, the package name, the package version, and the
topic. The system SHALL NOT serve an entry whose identity does not match the
request exactly.

#### Scenario: The library changed

- **WHEN** the request names a different library than the cached entry
- **THEN** the cached entry SHALL NOT be served, and the request SHALL be
  resolved against the documentation service

#### Scenario: The topic changed

- **WHEN** the request asks about a different topic than the cached entry
  covers
- **THEN** the cached entry SHALL NOT be served, and the request SHALL be
  resolved against the documentation service

### Requirement: Package versions are resolved from the project and never guessed

The system SHALL resolve the version of a package from the project's own
lockfile when the lockfile is supported and contains that package as a direct
dependency. When the version cannot be determined, the system SHALL record
the version status as indeterminate, SHALL NOT invent a version, and SHALL
NOT reuse the entry to support a version-specific claim.

#### Scenario: The lockfile pins the package

- **WHEN** the project has a supported lockfile that pins the queried
  package as a direct dependency
- **THEN** the system SHALL record that exact version with the cached
  documentation and SHALL use it as part of the cache identity

#### Scenario: The lockfile does not pin the package

- **WHEN** the project has no supported lockfile, or the lockfile does not
  contain the queried package as a direct dependency
- **THEN** the system SHALL record the version status as indeterminate with
  the reason, and SHALL NOT attribute any version to the documentation

#### Scenario: The lockfile cannot be read

- **WHEN** the lockfile exists but cannot be parsed or is of an unsupported
  format
- **THEN** the system SHALL record the version status as indeterminate with
  the reason and SHALL continue with the documentation lookup

### Requirement: Every cached entry carries an explicit freshness status

The system SHALL give every cached entry a status of current, stale,
invalidated, or unverified, and a retrieval time, a verification time, and
an expiry time. The system SHALL serve only entries whose status is current.
A stale entry SHALL be re-queried, and an invalidated entry SHALL never be
served and SHALL be discarded when it is next encountered.

#### Scenario: The entry is still within its freshness window

- **WHEN** an entry is requested before its expiry time and its status is
  current
- **THEN** the system SHALL serve it and SHALL report its recorded version
  and status

#### Scenario: The entry passed its freshness window

- **WHEN** an entry is requested after its expiry time
- **THEN** the system SHALL re-query the documentation service, SHALL update
  the entry, and SHALL NOT serve the expired content as current

#### Scenario: An entry was invalidated

- **WHEN** an entry's status is invalidated
- **THEN** the system SHALL NOT serve it, SHALL re-query the documentation
  service, and SHALL replace the invalidated entry

#### Scenario: The entry was never verified

- **WHEN** an entry's status is unverified
- **THEN** the system SHALL NOT present it as verified documentation, and
  SHALL report that its verification is pending

### Requirement: Verified documentation can be saved and retrieved

The system SHALL let an agent record the documentation it verified, with its
identity, the library, the package name and version, the version status, the
topic, the source URL, the source kind, the agent that recorded it, the
content, and the retrieval, verification, and expiry times. It SHALL let an
agent search the recorded documentation by library, package, version, topic,
and status.

#### Scenario: An agent records a verified answer

- **WHEN** an agent saves a documentation answer it verified against the
  documented source
- **THEN** the record SHALL be stored with the library, the package version
  and its version status, the topic, the source URL, the recording agent,
  the content, and the three timestamps

#### Scenario: An agent looks for documentation

- **WHEN** an agent searches for documentation by library or topic
- **THEN** the result SHALL list the matching records with their version,
  status, source, and recording agent, ordered so that current records are
  preferred over stale ones

#### Scenario: A record refers to a version that was never resolved

- **WHEN** a saved record has an indeterminate version status
- **THEN** the search result SHALL show that the version is indeterminate
  and SHALL NOT present the record as specific to a version

### Requirement: Documentation is shared across the planning and implementation phases

The system SHALL store the documentation records in the project's store so a
record saved during planning is retrievable during implementation within the
same project. The system SHALL record which agent saved each record, and
SHALL NOT present a record as current without the freshness status that
applies to it.

#### Scenario: Planning records a fact and implementation reads it

- **WHEN** the planning phase saves a verified documentation record and the
  implementation phase asks for the same topic
- **THEN** the implementation phase SHALL receive that record, with the
  recording agent and the freshness status visible

#### Scenario: The record is stale when it is read

- **WHEN** a record saved during planning is read during implementation
  after its freshness window elapsed
- **THEN** the system SHALL report it as stale and SHALL NOT present it as
  current documentation

### Requirement: The cache stays local and free of credentials

The system SHALL keep the cached documentation and the saved records inside
the project's local store, and SHALL NOT transmit them to another repository
or to an external service. The system SHALL NOT store the documentation
service's API key, an access token, or any other credential, and SHALL NOT
store content that contains one.

#### Scenario: A lookup would store the service credential

- **WHEN** a cached response or a saved record would contain an API key, a
  token, or a password
- **THEN** the system SHALL refuse to store that content and SHALL report
  the refusal

#### Scenario: The store is inspected

- **WHEN** the project's store is examined
- **THEN** it SHALL contain only the documentation records, their metadata,
  and the cache entries, and no credential from the documentation service

### Requirement: Cache failures never block a lookup

The system SHALL treat a cache read error, a cache write error, and a
version-resolution error as non-blocking. A cache failure SHALL fall back to
the documentation service, and a failure of the documentation service SHALL
be reported as a failure of the lookup rather than of the session.

#### Scenario: The store is unavailable

- **WHEN** the cache cannot be read or written and a lookup is requested
- **THEN** the system SHALL query the documentation service directly, SHALL
  report that the cache was unavailable, and SHALL NOT fail the session

#### Scenario: The documentation service is unreachable

- **WHEN** the lookup cannot be completed and no fresh cache entry exists
- **THEN** the system SHALL report the lookup as failed, SHALL NOT serve
  stale content as if it were current, and SHALL NOT fail the session
