# Spec Delta

## ADDED Requirements

### Requirement: An unresolved critical finding blocks the PR-ready handoff

The system SHALL NOT announce a PR-ready handoff while a critical finding
from the reviewed change is unresolved. A finding is critical when its
consequence is unauthorized access, exposure of sensitive data, or loss or
corruption of data. Findings that are not critical SHALL be reported and
SHALL NOT block the handoff on their own.

#### Scenario: A critical finding is still open

- **WHEN** the reviewed change carries a critical finding that has not been
  corrected and no authorized owner has accepted the risk
- **THEN** the coordinating agent SHALL NOT announce a PR-ready handoff and
  SHALL report the blocking finding and its consequence

#### Scenario: Only non-critical findings remain

- **WHEN** the review left only findings that are not critical
- **THEN** the coordinating agent SHALL report them in the handoff, SHALL
  NOT treat them as a blocker, and SHALL continue to the PR-ready handoff

### Requirement: A critical finding clears through a correction or a recorded acceptance

The coordinator SHALL either correct a critical finding and revalidate the
correction, or obtain an explicit acceptance of the risk from an authorized
owner and record that acceptance next to the finding, naming the owner and
the accepted risk. The coordinator SHALL NOT claim that an accepted risk was
resolved.

#### Scenario: The critical finding was corrected and revalidated

- **WHEN** a critical finding was corrected and the correction was
  revalidated against the final diff
- **THEN** the coordinating agent SHALL continue to the PR-ready handoff and
  SHALL summarize the resolution and its revalidation in the handoff

#### Scenario: The risk is explicitly accepted

- **WHEN** an authorized owner accepts the risk of an unresolved critical
  finding
- **THEN** the coordinating agent SHALL record the acceptance, naming the
  owner and the accepted risk, next to the finding, and MAY then continue to
  the PR-ready handoff without claiming the finding was resolved
