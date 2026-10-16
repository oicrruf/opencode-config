# Spec Delta

## ADDED Requirements

### Requirement: Adversarial review dispatch is risk-proportionate

The system SHALL dispatch `adversarial` at most once against the final diff
of a completed bounded change unless a prior review returned blocking
findings that were fixed. The system SHALL NOT automatically dispatch
`adversarial` for isolated mechanical, documentation, formatting, or
low-risk configuration changes that have no security, data, public-interface,
compatibility, or executable-logic impact. The system SHALL require an
adversarial review before completion when the change affects authorization,
authentication, secrets, untrusted-input handling, schema or data migration,
destructive data handling, public API or compatibility behavior, or an active
incident.

#### Scenario: Low-risk mechanical change completes without adversarial review

- **WHEN** a completed change is isolated, mechanical, and has no defined
  high-risk impact
- **THEN** the coordinator SHALL rely on task-relevant verification and
  SHALL NOT automatically dispatch `adversarial`

#### Scenario: Bounded logic change receives one final targeted review

- **WHEN** a completed bounded change modifies executable logic without a
  full-review trigger
- **THEN** the coordinator SHALL dispatch `adversarial` once in `targeted`
  mode against the final diff and its directly affected dependencies

#### Scenario: High-risk change requires adversarial review

- **WHEN** a completed change affects authorization, untrusted-input
  handling, a schema migration, destructive data handling, public
  compatibility behavior, secrets, or an active incident
- **THEN** the coordinator SHALL dispatch `adversarial` before declaring
  the change complete

### Requirement: Targeted adversarial reviews have a bounded closure

In `targeted` mode, `adversarial` SHALL inspect only the final diff,
directly affected call paths, and axes relevant to the changed behavior.
It SHALL NOT run a broad repository scan, a full verification suite,
dependency-wide CVE scan, or browser automation unless the changed diff
supplies concrete evidence that the check is required. It SHALL label
findings as introduced by the change, pre-existing debt, or unverifiable,
and SHALL not block completion on pre-existing debt, `MINOR`, or `NIT`
findings. The coordinator SHALL permit one focused re-review limited to
resolved `BLOCKER` or `MAJOR` findings; after that re-review, the reviewer
SHALL return a final structured verdict or an incomplete verdict that
names the unverified risk and the required operator decision.

#### Scenario: Targeted review excludes irrelevant audit axes

- **WHEN** a targeted review concerns a non-UI change with no dependency or
  security evidence
- **THEN** the reviewer SHALL inspect the diff and relevant call paths
  without running browser automation, a dependency-wide scan, or unrelated
  full-suite checks

#### Scenario: Pre-existing debt does not reopen the change

- **WHEN** a targeted review identifies a defect that predates the final
  diff
- **THEN** the reviewer SHALL report it as pre-existing debt and the
  coordinator SHALL NOT treat it as a release blocker for the reviewed
  change

#### Scenario: Blocking fixes receive one focused re-review

- **WHEN** the reviewer reports introduced `BLOCKER` or `MAJOR` findings
  and the implementing agent supplies fixes
- **THEN** the coordinator SHALL request at most one focused re-review of
  those fixes before closing the review

#### Scenario: Targeted review cannot complete within its budget

- **WHEN** the reviewer cannot verify a material risk before its applicable
  step budget is exhausted
- **THEN** it SHALL return an incomplete verdict that identifies the
  unverified risk, evidence gathered, and the operator decision needed
  instead of continuing to expand its scope
