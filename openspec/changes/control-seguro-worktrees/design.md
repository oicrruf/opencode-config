# Design

## Context

See `proposal.md` for motivation. OpenCode exposes a worktree API to
plugins, and the reference implementation of this capability uses it to
create worktrees outside the canonical checkout, under the worktree
directory OpenCode itself manages, partitioned by the first characters of
the project identifier. That layout matters: a worktree inside the
repository pollutes the working tree, appears in `git status` of the
canonical checkout, and can be committed by accident. This repository
currently mitigates that by ignoring `.opencode/worktree/`, which the
`refactor` agent uses with a raw `git worktree add`.

The permission surface constrains what the control can do. The
configuration template denies `bash` to the audit specialists and to
`explore`, and grants `external_directory` to the agents that work across
directories. A worktree control is therefore a plugin rather than a set of
shell instructions: the checks it performs — local changes, unpublished
commits, processes with access, unsafe paths — need direct filesystem and
process access, and they need to run under a lock.

The repository's conventions constrain the rest. Worktrees are isolated
work, not a place to store evidence: the evidence that survives a worktree
belongs outside it. And the plugin is installed globally, so it runs in
every project on the host, which means the inventory has to be per project
and the control has to stay inert when there is no project.

## Goals / Non-Goals

**Goals:**

- Give every worktree one creation path, one inventory, and one retirement
  path, so no worktree is created outside the control and no worktree is
  removed without the checks.
- Make the retirement decision safe by default: explicit request, verified
  identity, verified published state, preserved evidence, and a conservative
  outcome when anything is uncertain.
- Report the real state of the project — what exists, what is blocked, how
  much space is actually available — without inventing limits.
- Serialize the state-changing operations so two sessions cannot corrupt
  the inventory or race a retirement.

**Non-Goals:**

- Provide a branch, commit, or pull-request workflow. Those belong to the
  repository's Git conventions and to the delivery lifecycle, not to the
  worktree control.
- Integrate with a work-item tracker. The reference implementation requires
  evidence from a tracker before retiring; this repository has no tracker
  contract, so the evidence is supplied by the requester and verified
  locally.
- Implement the local execution reservation or the Docker sandbox. They are
  specified in a separate change that builds on this one.
- Automate cleanup on a schedule, on idle time, or on low disk space.
- Manage the worktrees of a project that is not a Git repository.

## Decisions

### 1. Worktrees are created through OpenCode's worktree API, outside the checkout

The control calls the worktree API exposed to plugins and lets OpenCode
place the worktree in the worktree directory it manages, partitioned per
project. The control does not create a directory by hand and does not
maintain its own layout.

**Alternative considered:** Keep the current `.opencode/worktree/<name>`
convention with a raw `git worktree add`. Rejected because it keeps the
working tree dirty, relies on a `.gitignore` rule to hide a real
directory, and gives the control no inventory to reason about.

### 2. The inventory is a reconciliation, not a list of intentions

The inventory file records what the control believes exists, but every read
reconciles it against the worktrees that actually exist. An entry whose
directory is gone is reported as missing, and a worktree that exists
without an entry is reported as unrecorded.

The reconciliation is what makes the inventory trustworthy after a crash, a
manual `git worktree remove`, or a move of the checkout.

**Alternative considered:** Trust the inventory file. Rejected because a
stale inventory is exactly what a conservative retirement must not rely on.

### 3. Capacity is a measurement, never a policy

The control measures the available bytes on the filesystem that holds the
worktrees and reports the measurement together with the number of
worktrees. It announces no maximum, no remaining budget, and no threshold.
Only a measurement of exactly zero available bytes blocks a creation.

**Alternative considered:** A configured maximum number of worktrees per
project, as the reference implementation had before it removed the limit.
Rejected because a fixed count is wrong on a host with a large disk and
wrong on a host with a small one, and because the real constraint is space,
not count.

### 4. Retirement is refused unless the request carries a complete identity

A retirement request names the worktree, its branch, the base it
integrates into, the expected head, and the evidence that the work was
integrated. The control verifies that identity against the repository
before touching anything, and refuses a request that is missing any of it.

**Alternative considered:** Let the control infer the identity from the
current session. Rejected because the session's worktree is not
necessarily the worktree being retired, and inferring it is how a control
retires the wrong directory.

### 5. The blocking conditions are checked individually and reported individually

Local changes, unpublished commits, a process with access, unrecognized
ignored files, and an unsafe path are each checked and each reported. The
report names the specific conditions that blocked, so the operator knows
what to resolve rather than being told "retirement failed".

**Alternative considered:** A single "not clean" verdict. Rejected because
the remedies are different in each case, and a single verdict hides the
one that matters.

### 6. Evidence is preserved before anything is removed, and the manifest binds it

The recognized verification and review reports are copied to a location
outside the worktree, under a directory named after the worktree and the
date, with a manifest that records the worktree, the branch, the reviewed
commit, and the copied files. A file the evidence policy does not
recognize is not copied, and a file that looks like a credential is not
copied.

The order matters: the evidence is preserved first, and a failure to
preserve it keeps the worktree. A removal that destroys the only copy of a
review is a silent loss of the record that the change was reviewed.

**Alternative considered:** Keep the evidence in the worktree and let the
reviewer read it before the removal. Rejected because the removal is
usually the last step and the evidence has to outlive it.

### 7. The local branch is removed with a verified expected state

After the worktree is removed, the local branch is removed only when the
control can verify the expected published state, only when the branch is
not a symbolic reference, and only when no other worktree uses it. A
branch that cannot be removed is reported as pending, separately from the
retirement itself, so a partial result is never reported as a failure and
never as a success.

**Alternative considered:** Leave the branch and let the operator delete it.
Rejected because leftover branches make the next inventory ambiguous, and
because the branch is the one artifact whose removal is safe to automate
once the published state is verified.

### 8. The remote branch and the published commits are out of scope for removal

The control never pushes a deletion and never touches a published history.
A request to delete the remote branch is refused with the reason. The
published commits stay reachable, which is also what makes the local
branch removal safe: the work is still on the remote.

**Alternative considered:** Offer a "clean up everything" action. Rejected
because the remote branch and the published commits are the operator's
safety net, and an automated deletion of them is unrecoverable.

### 9. The lock records an owner, and an unverifiable owner is never reclaimed

Operations that mutate the worktree state run under a lock that records the
owner's identity, the time, and the scope. A lock whose owner cannot be
verified is preserved: age, an isolated process identifier, and the absence
of a response are not evidence that the owner is gone. The reference
implementation reached the same conclusion after an incident, and the
conservative rule is what keeps a concurrent session from being cut off
mid-operation.

**Alternative considered:** Reclaim a lock older than a threshold.
Rejected because the failure mode of a wrong reclaim is corrupting a live
operation, while the failure mode of keeping a lock is a blockage the
operator can see and resolve.

### 10. Age orders the candidate list and nothing else

The candidate list is ordered by age so the operator can see the oldest
first, and the list is informational. Listing never retires.

### 11. The control stays inert outside a Git project

The control resolves the project root from the session location. Outside a
Git repository it reports that the control is unavailable and creates
nothing. Because the plugin is installed globally, that inertness is what
keeps it harmless in the many directories on a host that are not projects.

## Risks / Trade-offs

- [A worktree is created outside the control by hand] → The inventory
  reports it as unrecorded, so the operator sees it, and the retirement
  path still applies to it because the checks run against the directory,
  not against the inventory.
- [The inventory file is lost] → The reconciliation rebuilds what it can
  from the worktrees that exist; a missing inventory is not an error.
- [A process check is unavailable on the host] → The control reports the
  check as unavailable and keeps the worktree, because an unverifiable
  check is not a passing check.
- [A branch is deleted locally while its commits exist only there] → The
  removal requires a verified published state, and the remote branch and
  commits are never removed.
- [The lock blocks the operator indefinitely] → The lock's owner and time
  are reported so the operator can resolve it, and the resolution is an
  explicit authorized action rather than an automatic reclaim.
- [The control is installed globally and adds noise elsewhere] → It stays
  inert outside a Git project and exposes no tool that mutates anything
  without an explicit request.
- [Evidence copying pulls in a large artifact] → Only the recognized
  evidence types are copied, and the manifest records exactly what was
  copied.

## Migration Plan

1. Implement the plugin: root resolution, the inventory and its
   reconciliation, the lock, the capacity measurement, the creation path,
   the retirement checks, the evidence preservation, and the branch removal.
2. Move the `refactor` agent from the raw `git worktree add` to the managed
   control, and keep the `.opencode/worktree/` ignore rule so the legacy
   path stays harmless.
3. Grant the managed tools to the agents that isolate work.
4. Extend the validator and the acceptance harness.
5. Roll back by restoring the `refactor` agent's instructions and removing
   the tool grants. Worktrees created through the control remain valid Git
   worktrees and can be inspected or removed with the standard commands.
