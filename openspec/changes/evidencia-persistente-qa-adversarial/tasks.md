# Tasks

## 1. Report format and repository layout

- [ ] 1.1 Define the report format under `docs/contracts/`: a frontmatter
  block declaring the agent, the timestamp, the reviewed scope, the mode, the
  reviewed commit, the branch or worktree, and the verdict, followed by the
  findings grouped by severity and the verification matrix; and verify that
  a report written against the format is readable and that every declared
  field is present.
- [ ] 1.2 Add the report directories `.opencode/qa/` and
  `.opencode/adversarial/` to the repository with a short index that states
  what a report proves, what it does not prove, and the naming convention
  `<timestamp>-<short-slug>.md`; and verify the index is reachable from the
  repository documentation.
- [ ] 1.3 Define the scope directory naming: the branch name with unsafe
  path characters replaced, the worktree taking precedence when the session
  runs inside one, and a documented fallback when neither can be resolved;
  and verify with a focused test that a branch name with a slash produces a
  single directory rather than a nested path.

## 2. Agent instructions and permissions

- [ ] 2.1 Extend `agent/qa.md` with the reporting obligation: write a report
  under `.opencode/qa/<scope>/` when the run produced findings, a failed
  check, or a blocked check, write nothing when everything passed and
  nothing was found, include the verification matrix with the state of each
  case, and report the report path in the summary; and verify the
  instruction states each of those obligations.
- [ ] 2.2 Extend `agent/adversarial.md` with the reporting obligation under
  `.opencode/adversarial/<scope>/`, the classification of each finding by
  severity, origin, owner, and location, the critical classification by
  consequence, and the requirement to name the unverified risk in an
  incomplete verdict; and verify the instruction states each of those
  obligations.
- [ ] 2.3 Extend `agent/build.md` with the rule that the PR-ready handoff
  cites the persisted report path, that an unresolved critical finding
  blocks the handoff, and that an accepted risk is reported as accepted
  rather than as resolved; and verify the instruction states both.
- [ ] 2.4 Grant each audit agent a write permission limited to its own
  report directory in `config/opencode.template.jsonc`, keep `bash: deny`
  and no write permission over the rest of the repository, and verify by
  reading the rendered configuration for the `personal` profile.
- [ ] 2.5 Require in the agent instructions that a regression test is
  reported only when it failed against the uncorrected behavior and passed
  against the corrected one, and that an environment failure is not reported
  as the defect; and verify the instruction states the condition.

## 3. The critical-finding gate

- [ ] 3.1 State the critical classification in the agent instructions and in
  the routing matrix: unauthorized access, exposure of sensitive data, and
  loss or corruption of data, with the existing severity ladder kept
  independent of it; and verify the three consequences appear in both
  places.
- [ ] 3.2 Implement the gate in the coordinator instructions: no PR-ready
  handoff while a critical finding is unresolved, with the two documented
  exits being a corrected and revalidated finding or a recorded acceptance
  by an authorized owner; and verify the instruction names both exits and
  forbids claiming an accepted risk was resolved.
- [ ] 3.3 Record the acceptance in the report next to the finding, naming
  the owner and the accepted risk; and verify the report format has a field
  for it and that a report without one is treated as no acceptance.

## 4. Validation gates

- [ ] 4.1 Add a check to `scripts/validate-config.mjs` that each audit agent
  holds a write permission only over its own report directory and holds no
  write permission over the rest of the repository; and verify by granting
  a broader write permission temporarily and confirming the validator exits
  non-zero naming the agent.
- [ ] 4.2 Add a check to `scripts/validate-config.mjs` that the agent
  instructions state the reporting obligation, the report location, the
  critical classification, and the blocking rule; and verify by removing
  one of those statements temporarily and confirming the validator fails.
- [ ] 4.3 Add a group to `scripts/acceptance-harness.mjs` that checks the
  rendered permission surface, the report locations, and the report format
  contract; and verify the group reports as passing.
- [ ] 4.4 Add a focused test for the report format: a sample report that
  satisfies the format, and cases that miss the scope, the verdict, the
  commit, the critical classification, or the verification matrix; and
  verify the test passes and rejects each incomplete case.

## 5. Documentation and integration verification

- [ ] 5.1 Document in `README.md` where the verification and review evidence
  lives, what a report contains, that a green report does not establish
  coverage or correctness, and that a critical finding blocks the handoff
  until it is corrected or explicitly accepted; and verify that a reader
  can answer from the README alone what a report proves and what blocks a
  delivery.
- [ ] 5.2 Record the evidence locations and the blocking rule in `AGENTS.md`
  next to the other cross-agent conventions; and verify the file names both
  report directories and the rule.
- [ ] 5.3 Run `node scripts/validate-config.mjs --profile personal`,
  `node scripts/test-model-profiles.mjs`, `node scripts/acceptance-harness.mjs`,
  and `openspec validate --specs --strict --type spec`; verify each result
  and record any pre-existing failure separately from a failure introduced by
  this change.
- [ ] 5.4 Dispatch the `qa` agent against a change with a deliberate
  non-critical finding and confirm a report is written under the scope
  directory with the declared fields, and dispatch a clean run and confirm no
  report is created; and record the actual observations in the change
  verification notes.
