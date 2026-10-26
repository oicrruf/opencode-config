# Spec Delta

## Purpose

Persist the outcome of verification and review runs as reviewable evidence
that outlives the session, so that a later session can tell what was
reviewed, what it concluded, and whether a critical finding was ever
resolved.

## ADDED Requirements

### Requirement: Review evidence is persisted outside the session

The system SHALL let the `qa` and `adversarial` agents write their outcome
as a Markdown report under `.opencode/qa/` and `.opencode/adversarial/`,
respectively, in a directory named after the branch or the worktree the run
covered. The report SHALL be the evidence of record for that run and SHALL
remain readable after the session ends.

#### Scenario: A review run produces a report

- **WHEN** the `adversarial` agent completes a run that produced findings
- **THEN** it SHALL write a Markdown report under
  `.opencode/adversarial/<branch-or-worktree>/` and SHALL report the report
  path in its summary

#### Scenario: A verification run produces a report

- **WHEN** the `qa` agent completes a run that produced a failed or a
  blocked check
- **THEN** it SHALL write a Markdown report under
  `.opencode/qa/<branch-or-worktree>/` and SHALL report the report path in
  its summary

#### Scenario: Two runs in different scopes do not collide

- **WHEN** a run happens on one branch and another run happens on a
  different branch
- **THEN** each report SHALL be written under the directory of its own scope
  and neither run SHALL overwrite the other

#### Scenario: A later session finds the earlier evidence

- **WHEN** a session asks whether a change was already reviewed
- **THEN** the report written by the earlier run SHALL be available under
  the scope directory, with its scope, verdict, and commit still readable

### Requirement: A report is written only when the run produced something to report

The system SHALL write a report when the run produced findings, a failed
check, or a blocked check. A run whose checks all passed and which produced
no findings SHALL NOT create a report, and the result SHALL be reported in
the session summary only.

#### Scenario: A clean verification run

- **WHEN** every check the `qa` agent ran passed and it found no issue
- **THEN** no report SHALL be created under `.opencode/qa/` and the result
  SHALL be reported in the session summary

#### Scenario: A run with a blocked check

- **WHEN** a check could not be executed because of an impediment
- **THEN** a report SHALL be created that states the blocked check, the
  impediment, and that the result is blocked rather than passed

### Requirement: Every report declares its scope, verdict, and provenance

The system SHALL give every report a declared agent, the date and time of
the run, the reviewed scope, the mode, the commit that was reviewed, the
branch or worktree, and the final verdict. The report SHALL distinguish a
finding that the run introduced from pre-existing debt and from a risk it
could not verify.

#### Scenario: A report identifies what was reviewed

- **WHEN** a report is read
- **THEN** it SHALL state the agent, the timestamp, the reviewed scope, the
  mode, the reviewed commit, the branch or worktree, and the final verdict

#### Scenario: The report distinguishes the origin of a finding

- **WHEN** a report contains a finding that predates the reviewed change
- **THEN** it SHALL mark that finding as pre-existing rather than
  introduced, and SHALL state the evidence for that classification

#### Scenario: The review could not verify a material risk

- **WHEN** the review exhausted its budget before verifying a material risk
- **THEN** the report SHALL record an incomplete verdict that names the
  unverified risk and the evidence gathered

### Requirement: Findings are located, classified, and owned

The system SHALL record for every finding a severity, an origin, the file
and line where it was observed, the role that owns the fix, and a short
description. The report SHALL group the findings by severity and SHALL
state the overall verdict derived from them.

#### Scenario: A finding is recorded

- **WHEN** a reviewer reports a defect
- **THEN** the report SHALL record its severity, its origin, its location,
  the owning role, and a description, and SHALL group it under that
  severity

#### Scenario: The verdict follows the findings

- **WHEN** the report contains an introduced blocking finding
- **THEN** the verdict SHALL be a failure, and when it contains only
  non-blocking findings the verdict SHALL state that the change passes with
  those findings outstanding

### Requirement: Critical findings are identified by their consequence

The system SHALL classify a finding as critical when its consequence is
unauthorized access, exposure of sensitive data, or loss or corruption of
data. The classification SHALL depend on the consequence and not on the
reviewer's overall impression of the change.

#### Scenario: A missing authorization check

- **WHEN** a reviewer finds that a protected operation can be performed
  without an authorization check
- **THEN** the finding SHALL be classified as critical because its
  consequence is unauthorized access

#### Scenario: A secret written to a log

- **WHEN** a reviewer finds that a credential or personal data reaches an
  output that is not protected
- **THEN** the finding SHALL be classified as critical because its
  consequence is the exposure of sensitive data

#### Scenario: A destructive operation without a safeguard

- **WHEN** a reviewer finds that stored data can be destroyed or corrupted
  without a safeguard
- **THEN** the finding SHALL be classified as critical because its
  consequence is loss or corruption of data

### Requirement: An unresolved critical finding blocks the handoff

The system SHALL NOT announce a PR-ready handoff while a critical finding
from the reviewed change is unresolved. The coordinator SHALL resolve it and
revalidate it, or SHALL obtain an explicit acceptance of the risk from an
authorized owner and record that acceptance with the finding. Findings that
are not critical SHALL be reported and SHALL NOT block the handoff on their
own.

#### Scenario: A critical finding is fixed

- **WHEN** a critical finding was corrected and the correction was
  revalidated
- **THEN** the report SHALL record the resolution and the coordinator SHALL
  be able to continue to the PR-ready handoff

#### Scenario: A critical finding is still open

- **WHEN** a critical finding remains unresolved when the change would be
  declared complete
- **THEN** the coordinator SHALL NOT announce a PR-ready handoff and SHALL
  report the blocking finding

#### Scenario: The risk is explicitly accepted

- **WHEN** an authorized owner accepts the risk of an unresolved critical
  finding
- **THEN** the coordinator SHALL record the acceptance, with the owner and
  the accepted risk, next to the finding, and MAY then continue to the
  PR-ready handoff

#### Scenario: A non-critical finding is outstanding

- **WHEN** only non-critical findings remain open
- **THEN** the coordinator SHALL report them, SHALL NOT treat them as a
  blocker, and SHALL continue to the PR-ready handoff

### Requirement: The verification matrix links each source to its cases and their state

The system SHALL require the `qa` agent to relate each source of truth — an
acceptance criterion, a scenario, or a requirement — to the cases that cover
it, and SHALL record for every case its preconditions, its inputs, its
expected result, its type, its reproduction steps, its state, and its
evidence. A case that is not executed SHALL be recorded as such, and a
missing source SHALL be stated explicitly instead of being replaced by
invented cases.

#### Scenario: Every source has a case

- **WHEN** the reviewed change has acceptance criteria
- **THEN** the report SHALL list, for each criterion, the cases that cover
  it and the state of each case

#### Scenario: A case was not executed

- **WHEN** a case was defined but not run
- **THEN** the report SHALL record it as not executed with the reason, and
  SHALL NOT report it as passed

#### Scenario: The change has no stated source

- **WHEN** the reviewed change has no acceptance criteria, no scenario, and
  no requirement to relate cases to
- **THEN** the report SHALL say so and SHALL offer characterization cases
  for the current behavior, stating that preserving the current behavior
  does not establish that it is correct

### Requirement: A regression test fails before the fix and passes after it

The system SHALL require that a regression test for a defect reproduces the
failure before the correction and passes after it. A test that passes both
before and after the correction SHALL NOT be presented as a regression
test, and a failure caused by the environment SHALL NOT be presented as the
defect being reproduced.

#### Scenario: The test reproduces the defect

- **WHEN** a defect is corrected and a regression test is added
- **THEN** the report SHALL record that the test failed against the
  uncorrected behavior and passed against the corrected behavior

#### Scenario: The test never failed

- **WHEN** a proposed regression test passes against the uncorrected
  behavior as well
- **THEN** the report SHALL state that the test does not reproduce the
  defect and SHALL NOT count it as coverage of the defect

### Requirement: Reports contain no secrets and no transcripts

The system SHALL keep credentials, tokens, keys, personal data, and full
transcripts out of the report. A reproduction step SHALL reference the
command or the steps and the safe data they use, and SHALL NOT paste a
sensitive value.

#### Scenario: A reproduction needs a credential

- **WHEN** a reproduction step would require a credential to run
- **THEN** the report SHALL describe how the credential is obtained from
  the local environment and SHALL NOT include its value

#### Scenario: A transcript would be the evidence

- **WHEN** the evidence for a finding is a long tool output
- **THEN** the report SHALL include the relevant excerpt and the command
  that produced it, and SHALL NOT paste the whole transcript

### Requirement: A finding is a recommendation and does not create work

The system SHALL treat every finding as a recommendation. A finding SHALL
NOT create an implementation task, a work item, or a task in a change's task
list on its own. Work SHALL be created only after the developer approves the
recommendation, and the coordinator SHALL then check whether an equivalent
task already exists before creating one.

#### Scenario: A review produces findings

- **WHEN** a review reports three findings
- **THEN** no task SHALL be created for them and the findings SHALL be
  reported as recommendations

#### Scenario: The developer approves a finding

- **WHEN** the developer approves a finding as work
- **THEN** the coordinator SHALL look for an equivalent existing task and
  SHALL reuse it or create a linked one, recording the scenario, the
  expected result, and the report path
