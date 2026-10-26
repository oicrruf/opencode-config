# Spec Delta

## Purpose

Manage the worktrees of a project through one control that creates them
outside the canonical checkout, reports their real state, and retires them
only on an explicit request backed by verified evidence, so no isolation
workspace is ever lost and no published work is ever discarded.

## ADDED Requirements

### Requirement: Worktrees are created through the managed control

The system SHALL create a worktree through OpenCode's worktree API, outside
the canonical checkout, and SHALL record it in the project's inventory. The
system SHALL name the worktree after the work it isolates and SHALL create
the branch it needs at the same time. The system SHALL NOT create a
worktree inside the canonical checkout and SHALL NOT create a worktree
without recording it.

#### Scenario: An agent isolates a change

- **WHEN** an agent requests a worktree for an isolated change
- **THEN** the system SHALL create it outside the canonical checkout, with
  its branch, and SHALL record it in the inventory

#### Scenario: The worktree already exists

- **WHEN** an agent requests a worktree that the inventory already records
  for the same work
- **THEN** the system SHALL return the existing one instead of creating a
  second, and SHALL NOT reset it

#### Scenario: The worktree cannot be created

- **WHEN** the worktree API reports a failure
- **THEN** the system SHALL report the failure, SHALL NOT record an entry
  that does not exist, and SHALL NOT leave a partial directory behind

### Requirement: The inventory reports the worktrees that actually exist

The system SHALL report the worktrees the project holds, with their
directory, their branch, and their state. The system SHALL reconcile the
recorded inventory with the worktrees that actually exist, and SHALL report
an entry that no longer exists as such rather than silently dropping it.

#### Scenario: The inventory is read

- **WHEN** an agent inspects the worktrees of the project
- **THEN** the system SHALL list every worktree with its directory and its
  branch, and SHALL report the total count

#### Scenario: A recorded worktree is gone

- **WHEN** the inventory records a worktree whose directory no longer
  exists
- **THEN** the system SHALL report it as missing and SHALL NOT present it
  as available

#### Scenario: A worktree exists outside the inventory

- **WHEN** a worktree exists for the project but is not recorded
- **THEN** the system SHALL report it as unrecorded, so the operator can
  decide what to do with it

### Requirement: Capacity is reported from a measurement and never invents a limit

The system SHALL report the space available on the filesystem that holds the
worktrees when that space can be measured. It SHALL NOT announce a maximum
number of worktrees, a remaining budget, or a threshold that it did not
measure. When the measurement is not possible, it SHALL say so and SHALL
NOT block the creation for that reason alone.

#### Scenario: The measurement succeeds

- **WHEN** the available space on the target filesystem can be measured
- **THEN** the system SHALL report that measurement and the number of
  worktrees present, and SHALL NOT report a maximum

#### Scenario: The measurement fails

- **WHEN** the available space cannot be measured
- **THEN** the system SHALL report that the space is unavailable and SHALL
  continue, and SHALL NOT block the operation for that reason

#### Scenario: The filesystem is full

- **WHEN** the measurement reports exactly zero bytes available
- **THEN** the system SHALL report the condition and SHALL NOT create a new
  worktree

### Requirement: Retirement requires an explicit request

The system SHALL retire a worktree only when a retirement is requested
explicitly, and SHALL require the request to identify the worktree, its
branch, and the base it integrates into. The system SHALL NOT retire a
worktree as a side effect of a creation, an inspection, or a capacity
check, and SHALL NOT retire one because it is old or because space is
tight.

#### Scenario: An inspection finds an old worktree

- **WHEN** an inspection reports a worktree that has not been used for a
  long time
- **THEN** the system SHALL list it as a candidate and SHALL NOT remove it

#### Scenario: A retirement is requested without a target

- **WHEN** a retirement is requested without identifying the worktree, the
  branch, and the base
- **THEN** the system SHALL refuse the request and SHALL report what the
  request must carry

### Requirement: Retirement is blocked by unsafe conditions

The system SHALL verify, before removing anything, that the worktree holds
no local changes, no unpublished commits, no process with access to it, no
unrecognized ignored files, and no unsafe path or symbolic link. When any
of these conditions is present, the system SHALL keep the worktree and
SHALL report the specific condition that blocked it.

#### Scenario: The worktree holds local changes

- **WHEN** the worktree has modified, staged, or untracked files
- **THEN** the system SHALL keep it and SHALL report the local changes as
  the blocking condition

#### Scenario: The worktree has unpublished commits

- **WHEN** the worktree's branch has commits that are not published
- **THEN** the system SHALL keep it and SHALL report the unpublished commits
  as the blocking condition

#### Scenario: A process is using the worktree

- **WHEN** a process has the worktree open
- **THEN** the system SHALL keep it and SHALL report the access as the
  blocking condition

#### Scenario: The path is unsafe

- **WHEN** the worktree path is a symbolic link or resolves outside the
  expected location
- **THEN** the system SHALL keep it and SHALL report the unsafe path as the
  blocking condition

#### Scenario: The worktree is clean

- **WHEN** every blocking condition is absent
- **THEN** the system SHALL proceed with the retirement and SHALL report
  each check it performed

### Requirement: Evidence is preserved before the worktree is removed

The system SHALL copy the recognized verification and review evidence of the
worktree to a location outside it, and SHALL write a manifest that ties the
preserved files to the worktree, the branch, and the reviewed commit. The
system SHALL copy only the recognized evidence, SHALL NOT copy an
unrecognized file, and SHALL NOT copy a secret. When the evidence cannot be
preserved, the system SHALL keep the worktree.

#### Scenario: The worktree holds review evidence

- **WHEN** a worktree holds a verification or review report that the
  evidence policy recognizes
- **THEN** the system SHALL copy it outside the worktree, SHALL write a
  manifest associating it with the worktree, the branch, and the reviewed
  commit, and SHALL then proceed with the retirement

#### Scenario: The evidence cannot be preserved

- **WHEN** the evidence cannot be copied or the manifest cannot be written
- **THEN** the system SHALL keep the worktree and SHALL report the failure

#### Scenario: The worktree holds a credential

- **WHEN** the worktree holds a file that looks like a credential and that
  the evidence policy does not recognize as evidence
- **THEN** the system SHALL NOT copy it and SHALL report that it was left
  out

### Requirement: The local branch is removed only after the published state is verified

After a successful retirement, the system SHALL remove the local branch of
the retired worktree, and SHALL do so only after verifying the published
state that the branch is expected to match. The system SHALL NOT force the
removal, SHALL NOT remove a branch that is used by another worktree, and
SHALL report a pending branch separately from a completed retirement.

#### Scenario: The branch is published and integrated

- **WHEN** the worktree was retired and its branch is published and its
  published state matches the expected commit
- **THEN** the system SHALL remove the local branch and SHALL report the
  removal

#### Scenario: The branch could not be removed

- **WHEN** the local branch cannot be removed
- **THEN** the system SHALL report the retirement as complete with the
  branch pending, and SHALL NOT report the whole operation as failed

#### Scenario: The branch is used elsewhere

- **WHEN** the branch is checked out in another worktree
- **THEN** the system SHALL keep the branch and SHALL report it as pending

### Requirement: The remote branch and the published commits are never removed

The system SHALL keep the remote branch and the published commits of every
retired worktree. The system SHALL NOT push a deletion, SHALL NOT rewrite
a published history, and SHALL NOT remove a commit that is reachable from
the remote.

#### Scenario: The worktree was retired

- **WHEN** a retirement completes
- **THEN** the remote branch SHALL still exist and the published commits
  SHALL still be reachable

#### Scenario: The operator asks to delete the remote branch

- **WHEN** a request asks the control to delete the remote branch
- **THEN** the system SHALL refuse and SHALL report that the remote branch
  and the published commits are preserved

### Requirement: Candidates are listed, never acted upon

The system SHALL be able to list the worktrees that are safe to consider for
retirement, with the state that makes each one a candidate and the state
that would block it. The system SHALL NOT perform a retirement while
listing, and the age of a worktree SHALL only order the list.

#### Scenario: The candidates are listed

- **WHEN** an agent asks for the retirement candidates
- **THEN** the system SHALL list them with the reason each is a candidate
  and any condition that would block its retirement, ordered by age

#### Scenario: The list is inspected twice

- **WHEN** the candidates are listed twice without an intervening request
- **THEN** the second listing SHALL report the same set and SHALL NOT have
  retired anything

### Requirement: Concurrent operations are serialized by a lock with a recorded owner

The system SHALL serialize the operations that mutate a project's worktree
state, using a lock that records its owner, the time it was taken, and the
scope it covers. When the lock is already held, the system SHALL refuse the
new operation and SHALL report the owner of the existing lock. A lock whose
owner cannot be verified SHALL be preserved, and the system SHALL NOT
reclaim it on the basis of its age.

#### Scenario: A second operation arrives

- **WHEN** an operation that mutates the worktree state is requested while
  the lock is held
- **THEN** the system SHALL refuse it and SHALL report the recorded owner of
  the existing lock

#### Scenario: The lock is released

- **WHEN** the operation that held the lock finishes
- **THEN** the lock SHALL be released and the next operation SHALL be able
  to proceed

#### Scenario: The owner cannot be verified

- **WHEN** a lock exists whose owner identity cannot be verified
- **THEN** the system SHALL keep the lock, SHALL NOT reclaim it because it
  is old, and SHALL report that the lock's owner is unverifiable
