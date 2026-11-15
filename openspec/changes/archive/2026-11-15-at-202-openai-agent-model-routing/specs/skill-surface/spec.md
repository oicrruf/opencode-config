# Spec Delta

## MODIFIED Requirements

### Requirement: Skills can run on a different model tier than their caller

A skill SHALL be able to run on a tier different from the invoking agent's
model by attaching a `model:` to its command wrapper. Every wrapper model
override SHALL use an OpenAI model ID. Mechanical, read-only skills SHALL use
the lightweight tier; skills whose default output edits code or drives an
irreversible change SHALL use the execution or decision tier according to
their risk.

The model tier for a skill SHALL be declared only on the wrapper (or on the
agent that loads it) and SHALL NOT be declared inside `SKILL.md`, because
OpenCode does not recognize a `model` field in skill frontmatter.

#### Scenario: dedupe runs on the value tier

- **WHEN** the user invokes `/dedupe`
- **THEN** the command SHALL run on `openai/gpt-5.6-luna` and the `dedupe` skill
  SHALL return a read-only refactor proposal

#### Scenario: a wrapper does not dispatch a subtask

- **WHEN** a skill wrapper command declares a `model:` and is invoked
- **THEN** the command SHALL NOT set `subtask: true`, because OpenCode applies
  the command model to its own session but a `subtask` child inherits the
  invoking agent model instead

#### Scenario: a refactor skill stays on the decision tier

- **WHEN** the `refactoring`, `safe-refactor`, or `surgical-patch` skill is
  used
- **THEN** it SHALL run on an OpenAI execution or decision model and SHALL
  NOT be moved to the lightweight tier

#### Scenario: a model field in skill frontmatter is not honoured

- **WHEN** a `SKILL.md` declares `model: openai/gpt-5.6-luna`
- **THEN** the system SHALL NOT treat it as a model assignment; the effective
  model SHALL remain that of the invoking agent or command
