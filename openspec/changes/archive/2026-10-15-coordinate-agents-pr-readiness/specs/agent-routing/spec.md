# Spec Delta

## MODIFIED Requirements

### Requirement: Targeted adversarial reviews have a bounded closure

In `targeted` mode, `adversarial` SHALL inspect only the final diff,
directly affected call paths, and axes relevant to the changed behavior.
It SHALL NOT run a broad repository scan, a full verification suite,
dependency-wide CVE scan, or browser automation unless the changed diff
supplies concrete evidence that the check is required. It SHALL label
findings as introduced by the change, pre-existing debt, or unverifiable,
and SHALL not block completion on pre-existing debt, `MINOR`, or `NIT`
findings. The coordinator SHALL permit one focused re-review limited to
resolved `BLOCKER` or `MAJOR` findings. After that re-review, the reviewer
SHALL return a final structured verdict or an incomplete verdict that
identifies any unverified risk and evidence gathered. The coordinator
SHALL continue agent coordination through the PR-ready handoff rather than
requiring a separate human approval before that handoff. It SHALL clearly
include unresolved material risks and unverified items in the handoff so
the human can assess them during PR review, and SHALL NOT represent them as
verified or resolved.

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
  unverified risk and evidence gathered, and the coordinator SHALL continue
  to the PR-ready handoff with that risk explicitly surfaced for human PR
  review rather than requiring a separate pre-PR operator decision

#### Scenario: Coordinated work reaches PR-ready handoff

- **WHEN** the required implementation and task-relevant verification are
  complete and the required adversarial review has returned its final
  verdict
- **THEN** the coordinating agent SHALL announce that the PR is ready for
  human review, summarize verification and findings, and identify any
  unresolved risks without claiming the PR was approved or merged
