# Spec Delta

## ADDED Requirements

### Requirement: Worktree lifecycle is managed and conservative

The system SHALL route every worktree an agent creates through the managed
worktree control, and SHALL retire a worktree only on an explicit request
that carries the identity of the worktree, its branch, and its base, backed
by verified evidence. Neither the age of a worktree nor a capacity
condition SHALL retire one.

#### Scenario: An agent isolates a change

- **WHEN** an agent needs an isolated worktree for a refactor or a
  concurrent change
- **THEN** it SHALL request it from the managed control and SHALL NOT
  create one with a raw `git worktree add` inside the canonical checkout

#### Scenario: A worktree is retired

- **WHEN** a retirement is requested for a worktree whose checks all pass
- **THEN** the control SHALL preserve the evidence, remove the worktree,
  remove the local branch, and report the remote branch and the published
  commits as preserved

#### Scenario: A worktree is old

- **WHEN** a worktree has not been used for a long time
- **THEN** it SHALL appear in the candidate list ordered by age and SHALL
  NOT be retired, because age alone is not a retirement condition

#### Scenario: Space is tight

- **WHEN** the measured available space on the filesystem is low
- **THEN** the system SHALL report the measurement and SHALL NOT retire a
  worktree to free space
