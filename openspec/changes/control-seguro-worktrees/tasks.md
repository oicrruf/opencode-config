# Tasks

## 1. Project resolution, inventory, and capacity

- [ ] 1.1 Implement the project-root resolution in
  `plugins/worktree-control/paths.mjs`: resolve the main checkout from the
  session location, resolve the worktree directory OpenCode manages for the
  project, and report that the control is unavailable outside a Git
  project; and verify with a focused test that a repository resolves, a
  non-repository reports unavailability, and nothing is created outside a
  repository.
- [ ] 1.2 Implement the inventory in
  `plugins/worktree-control/inventory.mjs`: record each worktree with its
  directory, its branch, and its creation time, and reconcile the records
  with the worktrees that actually exist, reporting missing and unrecorded
  entries; and verify with a focused test that a missing directory is
  reported as missing and an existing unregistered worktree is reported as
  unrecorded.
- [ ] 1.3 Implement the capacity measurement: measure the available bytes
  on the filesystem that holds the worktrees, report the measurement
  together with the number of worktrees, announce no maximum or remaining
  budget, report the measurement as unavailable when it cannot be taken,
  and block a creation only on exactly zero available bytes; and verify with
  a focused test for each of those four outcomes.
- [ ] 1.4 Implement the lock in `plugins/worktree-control/lock.mjs`: record
  the owner's identity, the time, and the scope, refuse a second mutating
  operation while the lock is held, release it when the operation finishes,
  and preserve a lock whose owner cannot be verified; and verify with a
  focused test that a concurrent operation is refused with the owner
  reported and that an unverifiable lock is not reclaimed.

## 2. Creation

- [ ] 2.1 Implement the creation path through OpenCode's worktree API:
  create the worktree outside the canonical checkout with its branch, name
  it after the work it isolates, and record it in the inventory; and verify
  with a focused test that the created worktree is outside the checkout,
  has the requested branch, and appears in the inventory.
- [ ] 2.2 Make the creation reuse an existing worktree recorded for the
  same work instead of creating a second one, and never reset it; and
  verify with a focused test that a repeated request returns the same
  directory and leaves the existing worktree untouched.
- [ ] 2.3 Make a failed creation report the failure, record nothing that
  does not exist, and leave no partial directory behind; and verify with a
  focused test that a failing API call leaves the inventory unchanged.

## 3. Retirement checks and evidence preservation

- [ ] 3.1 Implement the retirement request validation: require the
  worktree, its branch, the base, the expected head, and the evidence, and
  refuse a request that is missing any of them; and verify with a focused
  test that each incomplete request is refused with the missing element
  named.
- [ ] 3.2 Implement the blocking checks: local changes, unpublished
  commits, a process with access, unrecognized ignored files, and an unsafe
  path or symbolic link, each reported individually; and verify with a
  focused test that each condition blocks the retirement and is named in the
  report.
- [ ] 3.3 Make an unavailable check block the retirement rather than pass
  it, and report the check as unavailable; and verify with a focused test
  that a missing process-inspection facility blocks the retirement.
- [ ] 3.4 Implement the evidence preservation: copy the recognized
  verification and review reports to a location outside the worktree, under
  a directory named after the worktree and the date, and write a manifest
  that associates the copied files with the worktree, the branch, and the
  reviewed commit; and verify with a focused test that the manifest lists
  exactly the copied files.
- [ ] 3.5 Make the copy skip any file the evidence policy does not
  recognize and any file that looks like a credential, and make a failure to
  preserve the evidence keep the worktree; and verify with a focused test
  that an unrecognized file is left out and that a failing copy blocks the
  retirement.

## 4. Removal and branch handling

- [ ] 4.1 Implement the removal of the worktree through the worktree API
  only after every blocking check passed and the evidence was preserved,
  and report each check that was performed; and verify with a focused test
  that the removal happens only after the checks and the preservation.
- [ ] 4.2 Implement the local branch removal: verify the expected published
  state, refuse a symbolic reference, refuse a branch used by another
  worktree, never force the removal, and report a pending branch separately
  from a completed retirement; and verify with a focused test for each of
  those outcomes.
- [ ] 4.3 Make the control never push a deletion and never touch a
  published history, and refuse a request to delete the remote branch with
  the reason; and verify with a focused test that the refusal leaves the
  remote branch and the published commits intact.
- [ ] 4.4 Implement the candidate listing: list the worktrees that are safe
  to consider with the reason each is a candidate and the condition that
  would block it, order them by age, and perform no retirement while
  listing; and verify with a focused test that the listing retires nothing
  and returns the same set twice.

## 5. Agent instructions, permissions, and validation

- [ ] 5.1 Move `agent/refactor.md` from the raw `git worktree add` to the
  managed control, keeping the baseline capture and the cleanup step, and
  keeping the `.opencode/worktree/` ignore rule so the legacy path stays
  harmless; and verify the instruction no longer creates a worktree with a
  raw Git command.
- [ ] 5.2 Add the retirement sequence to `agent/build.md`: capture the
  identity of the worktree, preserve the evidence, request the retirement
  with that identity, and report the retirement, the branch removal, and
  the preserved remote separately; and verify the instruction names the
  three results.
- [ ] 5.3 Grant the managed worktree tools to the agents that isolate work
  in `config/opencode.template.jsonc` and SHALL NOT grant them to the audit
  specialists or to `explore`; and verify by reading the rendered
  configuration for the `personal` profile.
- [ ] 5.4 Add a check to `scripts/validate-config.mjs` that the managed
  tool grants match the intended agents and that `agent/refactor.md` no
  longer creates a worktree with a raw Git command; and verify by granting
  a tool to `qa` temporarily and confirming the validator exits non-zero
  naming the agent.
- [ ] 5.5 Add a group to `scripts/acceptance-harness.mjs` that checks the
  tool surface, the inventory reconciliation, the capacity reporting, and
  the refusal of a request that is missing its identity; and verify the
  group reports as passing.
- [ ] 5.6 Add a focused test file for the worktree control covering the
  inventory, the capacity, the lock, the blocking checks, the evidence
  preservation, and the branch handling; and verify it passes with the
  repository's test runner.

## 6. Documentation and integration verification

- [ ] 6.1 Document in `README.md` the managed worktrees, their location, the
  inventory, the capacity report, the retirement contract, the evidence
  preservation, and the rule that age and capacity never retire a worktree;
  and verify that a reader can answer from the README alone what blocks a
  retirement and where the preserved evidence lands.
- [ ] 6.2 Record the managed worktree flow in `AGENTS.md` next to the other
  cross-agent conventions, including that the legacy `.opencode/worktree/`
  path is retained only for compatibility; and verify the file names the
  control and the rule.
- [ ] 6.3 Run `node scripts/validate-config.mjs --profile personal`,
  `node scripts/test-model-profiles.mjs`, `node scripts/acceptance-harness.mjs`,
  and `openspec validate --specs --strict --type spec`; verify each result
  and record any pre-existing failure separately from a failure introduced by
  this change.
- [ ] 6.4 On this host, create a worktree through the control, read the
  inventory and the capacity report, request a retirement with an
  incomplete identity and confirm it is refused, and request a valid
  retirement of the clean worktree and confirm the evidence preservation,
  the removal, and the local branch removal are each reported separately;
  and record the actual observations in the change verification notes.

## Workflow follow-up

- A separate change introduces the local execution reservation and the
  Docker sandbox, which build on the inventory, the lock, and the capacity
  measurement specified here.
