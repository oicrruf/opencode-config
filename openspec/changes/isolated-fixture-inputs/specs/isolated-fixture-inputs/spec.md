# Spec Delta

## Purpose
Limit a declared fixture build to its exact screened inputs without changing the isolation or admission requirements of existing sandbox runs.

## ADDED Requirements

### Requirement: Bounded selection
The control MUST build only from an independent screened capture of explicitly selected inputs when fixture mode is requested.

#### Scenario: Unrelated file in checkout
- **WHEN** an unselected unrelated file contains a credential-shaped literal
- **THEN** its bytes are neither copied nor exposed to the fixture; the report identifies the selected scope rather than certifying the whole checkout.

#### Scenario: Unsafe selected input
- **WHEN** any selected input is missing, protected, aliased, changed, unverifiable, over a limit or fails screening
- **THEN** refuse the entire build before resource creation, without silently omitting an input or logging its content.

#### Scenario: Existing project
- **WHEN** no fixture selector is configured
- **THEN** existing full eligible checkout capture and screening behavior is unchanged.

### Requirement: Isolated and attributable verification
The control MUST retain configuration and input fingerprints, engine/source identity, managed quota, isolation and verified cleanup.

#### Scenario: Fixture cannot run
- **WHEN** required pinned runtime dependencies are unavailable locally or the test cannot run without network or persistent host data
- **THEN** report blocked, do not provision the dependencies, and do not claim acceptance.

#### Scenario: Successful fixture
- **WHEN** a disposable integration test passes
- **THEN** report only the verified fixture behavior, preserve evidence and verify resource closure without touching any shared application.
