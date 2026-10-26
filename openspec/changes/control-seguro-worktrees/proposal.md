# Proposal

## Why

The repository's worktree practice is currently a convention expressed in
prose. The `refactor` agent creates its isolation worktree with a raw `git
worktree add` at `.opencode/worktree/<name>`, and the `refactoring` skill
reminds the agent to add that path to `.gitignore`. Nothing records which
worktrees exist, nothing checks whether one still holds uncommitted work, and
the removal path is a manual `git worktree remove` whose safety depends on
the operator remembering the checklist. A worktree left behind after a
session, or removed by an over-eager cleanup, is a lost change.

## What Changes

- Manage the worktrees of a project through a single control that creates
  them through OpenCode's worktree API, outside the canonical checkout, and
  records an inventory of what exists.
- Report the real state: the worktrees present, the space actually
  available on the target filesystem, and whether a measurement was
  possible. The control never announces a maximum it did not measure.
- Require an explicit request to retire a worktree, and block the retirement
  when the worktree holds local changes, unpublished commits, a process
  accessing it, unrecognized ignored files, or an unsafe path.
- Preserve the review and verification evidence outside the worktree before
  it is removed, with a manifest that ties it to the branch and the work,
  and without copying secrets.
- Remove the local branch of a retired worktree only when the published
  state has been verified, and never remove the remote branch or the
  published commits.
- Never retire a worktree because it is old or because space is tight:
  age and capacity may order a list, but only an explicit request with
  verified evidence retires one.
- Serialize concurrent operations on the same project with a lock that
  records its owner, and keep a lock whose owner cannot be verified instead
  of reclaiming it.

## Capabilities

### New Capabilities

- `worktree-control`: managed creation, inventory, capacity reporting, and
  conservative retirement of the worktrees of a project, with evidence
  preservation.

### Modified Capabilities

- `agent-routing`: bind the agents that isolate work to the managed control
  and state that retirement happens only on an explicit request with
  verified evidence.

## Impact

- New plugin source: `plugins/worktree-control/` with the inventory, the
  lock, the capacity measurement, the retirement checks, and the evidence
  preservation.
- Agent instructions: `agent/refactor.md` moves from a raw `git worktree
  add` to the managed control, and `agent/build.md` learns the retirement
  sequence.
- Configuration: the managed tools are granted to the agents that isolate
  work.
- Repository layout: the legacy `.opencode/worktree/` path stays ignored
  while the managed worktrees live outside the checkout.
- Validation: the validator and the acceptance harness gain assertions for
  the tool surface and for the retirement rules.
- Documentation: `README.md` describes the managed worktrees, their
  inventory, and the retirement contract.
- No change to the model-profile manifest, the routing classes, the step
  ceilings, or the permission surface of the audit specialists.
