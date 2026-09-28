## MODIFIED Requirements

### Requirement: Operation-specialized skills are user-invoked

The skills `archify`, `caveman-commit`, `git-workflow`, `herdr-integration`,
`mmx-cli`, `mmx-h3-video`, `router`, and `writing-great-skills` SHALL be
hidden from the model-visible skill list by declaring a `deny` pattern for
each under `permission.skill` in `opencode.jsonc`. The system SHALL NOT rely
on a `disable-model-invocation` frontmatter flag, because opencode does not
recognize that field and silently ignores it.

Because `permission.skill: deny` hides a skill from the agent AND rejects
the `skill` tool call for it, the system SHALL provide a user-invoked
command wrapper for each hidden skill so the content stays reachable. The
wrapper SHALL inject the canonical `SKILL.md` content from its installed
path at command-expansion time and SHALL NOT embed a copy of that content.

The system SHALL keep the `router` skill's index accurate: it SHALL name
every hidden skill and the wrapper that reaches it.

#### Scenario: archify does not consume description budget

- **WHEN** an architecture-diagram request arrives at the primary agent
- **THEN** the agent SHALL NOT see the `archify` description in its system
  prompt; it SHALL reach `archify` only when the user types the name or
  invokes it explicitly

#### Scenario: a hidden skill stays reachable through its wrapper

- **WHEN** the user types `/archify` (or any other hidden skill's wrapper)
- **THEN** the command SHALL inject the canonical
  `~/.config/opencode/skills/<name>/SKILL.md` content into the run, so the
  skill remains usable even though the `skill` tool is denied for it

#### Scenario: the description budget reflects the real prompt surface

- **WHEN** `scripts/validate-config.mjs` computes the union of model-invoked
  skill descriptions
- **THEN** it SHALL exclude exactly the skills that are `deny`-hidden in
  `opencode.jsonc`, and the resulting total SHALL stay under 3000 characters

### Requirement: Skill descriptions are pruned for redundancy

The system SHALL ensure that no two model-invoked skill descriptions
share an exact clause longer than 12 words, and SHALL refuse to load a
project config that violates this rule. The check is enforceable via a
small script checked into the repo.

The description budget SHALL be computed from the skills that the config
actually hides, not from any skill-declared flag. A flag that opencode
ignores SHALL NOT be treated as evidence that a skill is hidden.

#### Scenario: duplicate description clauses fail validation

- **WHEN** two skills both contain "Use when the user asks for a code
  review" in their description
- **THEN** the install validator SHALL emit a warning naming both skills
  and SHALL suggest removing the duplicated clause from the less-trafficked
  skill

#### Scenario: an inert flag does not shrink the budget

- **WHEN** a skill declares `disable-model-invocation: true` but
  `opencode.jsonc` does not deny it under `permission.skill`
- **THEN** the validator SHALL count that skill's description toward the
  3000-character budget

## ADDED Requirements

### Requirement: Command wrappers preserve the skill as single source of truth

Every command wrapper for a hidden skill SHALL read the canonical
`SKILL.md` from its installed path and SHALL NOT duplicate the skill body.
`scripts/validate-config.mjs` SHALL verify that every skill path referenced
by a wrapper command exists on disk, so a renamed or removed skill fails
validation instead of producing a wrapper that injects nothing.

#### Scenario: a renamed skill fails validation

- **WHEN** a wrapper references `skills/archify/SKILL.md` and that file no
  longer exists
- **THEN** `scripts/validate-config.mjs` SHALL exit non-zero naming the
  wrapper command and the missing path

#### Scenario: upstream skill updates propagate without editing the wrapper

- **WHEN** the `archify` skill body is updated in `skills/archify/SKILL.md`
- **THEN** `/archify` SHALL inject the updated body with no change to
  `commands/archify.md`, because the wrapper reads the file rather than
  embedding it

### Requirement: Skills can run on a different model tier than their caller

A skill SHALL be able to run on a tier different from the invoking agent's
model, by attaching a `model:` to a command wrapper that loads it. The
system SHALL assign the value tier to the mechanical, read-only skills and
SHALL keep the decision and execution tiers for skills whose default output
edits code or drives an irreversible change.

The model tier for a skill SHALL be declared only on the wrapper (or on the
agent that loads it) and SHALL NOT be declared inside `SKILL.md`, because
opencode does not recognize a `model` field in skill frontmatter.

#### Scenario: dedupe runs on the value tier

- **WHEN** the user invokes `/dedupe`
- **THEN** the command SHALL run on `ollama-cloud/gpt-oss:20b` and the
  `dedupe` skill SHALL return a read-only refactor proposal

#### Scenario: a wrapper does not dispatch a subtask

- **WHEN** a skill wrapper command declares a `model:` and is invoked
- **THEN** the command SHALL NOT set `subtask: true`, because OpenCode applies
  the command's `model:` to the command's own session but a `subtask` child
  inherits the invoking agent's model instead, silently discarding the
  declared tier

#### Scenario: a refactor skill stays on the decision tier

- **WHEN** the `refactoring`, `safe-refactor`, or `surgical-patch` skill is
  used
- **THEN** it SHALL run on the tier of an agent that makes irreversible
  edits, and SHALL NOT be moved to the value tier

#### Scenario: a model field in skill frontmatter is not honoured

- **WHEN** a `SKILL.md` declares `model: ollama-cloud/gpt-oss:20b`
- **THEN** the system SHALL NOT treat it as a model assignment; the effective
  model SHALL remain that of the invoking agent or command
