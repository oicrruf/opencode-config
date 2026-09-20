## MODIFIED Requirements

### Requirement: Terra is reserved for irreversible or ambiguous decisions

The system SHALL assign a model to each agent according to the weight
of the role's default output, using only providers the user is
authenticated to. The tiers are:

- **Decision tier — `openai/gpt-5.6-terra`**: roles whose default
  output is an irreversible edit, a high-ambiguity structural
  decision, or an external-facing audit. The roles are `architect`,
  `orchestrator`, `refactor`, `adversarial`, `cotizador`, and the
  `/opsx-propose` command.
- **Planning tier — `openai/gpt-5.6-luna`**: the `plan` agent, which
  triages, investigates, and classifies scope on every request but
  produces a classification that is cheap to revise.
- **Execution tier — `minimax/MiniMax-M3`**: `build`, `general`,
  `frontend`, `backend`, and `qa`.
- **Value tier — `ollama-cloud/gpt-oss:20b`**: `explore`,
  `p5t-installer`, `doctor`, and the global `small_model`.

The system SHALL NOT assign `openai/gpt-5.6-terra` as the default
model for `plan`, `explore`, `build`, `general`, `frontend`,
`backend`, `qa`, `p5t-installer`, or `doctor`.

OpenCode exposes exactly one static `model` per agent, so a
mode-dependent model is not expressible. The system SHALL therefore
assign Terra to `adversarial` unconditionally rather than only in
`full` mode.

A command that produces a durable planning artifact SHALL run on the
decision tier even when the agent that invoked it runs on a cheaper
one, because the artifact's quality sets the ceiling for the
implementation that follows.

#### Scenario: explore never runs on Terra by default

- **WHEN** the global `explore` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b`
  (or the explicitly user-selected override)

#### Scenario: adversarial reviews on the decision tier

- **WHEN** the global `adversarial` agent is dispatched in either
  `targeted` or `full` mode
- **THEN** the configured model SHALL be `openai/gpt-5.6-terra`,
  because adversarial review is a pre-commit gate where a missed
  finding costs more than the token delta

#### Scenario: the propose command runs on the decision tier

- **WHEN** `/opsx-propose` is invoked from a session whose agent is
  `plan` (the planning tier)
- **THEN** the command SHALL declare `model: openai/gpt-5.6-terra` and
  the proposal SHALL be generated on Terra, not on the invoking
  agent's cheaper model

#### Scenario: plan does not run on the decision tier

- **WHEN** the `plan` agent is dispatched
- **THEN** the configured model SHALL be `openai/gpt-5.6-luna` and
  SHALL NOT be `openai/gpt-5.6-terra`

#### Scenario: doctor runs on the value tier

- **WHEN** the global `doctor` subagent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b`
  and SHALL NOT be `openai/gpt-5.6-terra`, because the doctor's role
  is read-only inspection and safe repair, not irreversible decisions

### Requirement: Subagent depth is bounded and auditable

The system SHALL set `subagent_depth` to `1` by default and SHALL
allow a value of `2` only for the `orchestrator` and `refactor`
agents. When a subagent, including `doctor`, attempts to delegate,
the system SHALL refuse and return a structured error that names the
offending call.

#### Scenario: nested delegation is rejected

- **WHEN** a subagent invokes the `task` tool to dispatch another
  agent while `subagent_depth` is `1`
- **THEN** the system SHALL refuse the delegation and SHALL return an
  error whose message names the depth limit and the agent that would
  have been dispatched

#### Scenario: doctor refuses to dispatch nested specialists

- **WHEN** the `doctor` subagent invokes the `task` tool to dispatch
  another agent while `subagent_depth` is `1`
- **THEN** the system SHALL refuse the delegation and SHALL return an
  error whose message names the depth limit and the agent that would
  have been dispatched
