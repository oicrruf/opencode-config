# Proposal

## Why

The `qa` and `adversarial` agents in this repository already have a precise
contract: what they may inspect, how they classify a finding, when a review
may be dispatched, and when a result closes. What they lack is persistence.
Their verdict, their findings, and their reproduction steps exist only in the
assistant message of the session that produced them, so the next session
cannot tell whether a review already happened, what it concluded, or whether
a critical finding was ever resolved. The repository's own coordination
rules already talk about "the most recent QA report" and "the most recent
adversarial report", but there is no such artifact for them to point at.

## What Changes

- Persist the outcome of every `qa` and `adversarial` run as a Markdown
  report under `.opencode/qa/` and `.opencode/adversarial/`, separated by
  branch or worktree, so the evidence outlives the session that produced
  it.
- Write a report only when the run produced findings, a failed check, or a
  blocked check; a clean run leaves no artifact behind.
- Give every report a declared scope, verdict, mode, commit, and branch, so
  a reader can tell what was reviewed and against which state.
- Classify each finding with its severity, its origin, its owner, and its
  location, and identify the critical ones — unauthorized access, exposure
  of sensitive data, and loss or corruption of data — by their consequence
  rather than by the reviewer's mood.
- Block the PR-ready handoff while a critical finding is unresolved, unless
  an authorized owner accepts the risk explicitly and the acceptance is
  documented.
- Require a verification matrix that links each source — a criterion, a
  scenario, a requirement — to the cases that cover it and to the state of
  each case.
- Require a regression test to fail before the fix and pass after it, so a
  green suite cannot be produced by a test that never exercised the defect.
- Keep the reports free of secrets and of transcripts, and keep findings as
  recommendations that do not create work on their own.

## Capabilities

### New Capabilities

- `verification-evidence`: persistent, reviewable evidence for verification
  and review runs, with a defined report format, a critical-finding gate,
  and a verification matrix.

### Modified Capabilities

- `agent-routing`: add the rule that an unresolved critical finding blocks
  the PR-ready handoff until it is corrected or explicitly accepted.

## Impact

- Agent instructions: `agent/qa.md` and `agent/adversarial.md` gain the
  reporting obligation, the report location, and the report format.
- Coordinator instructions: `agent/build.md` gains the rule that the
  handoff references the persisted report and that an unresolved critical
  finding blocks it.
- Repository layout: the report directories are added with a documented
  naming convention; a repository-local report may also be written by a
  project that uses this configuration.
- Validation: the validator and the acceptance harness gain assertions for
  the report format and for the gate wording in the agent instructions.
- Documentation: `README.md` describes where the evidence lives and what it
  does and does not prove.
- No change to the model-profile manifest, the routing classes, the step
  ceilings, or the permission surface.
