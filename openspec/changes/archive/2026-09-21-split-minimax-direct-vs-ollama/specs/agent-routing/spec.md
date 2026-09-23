## MODIFIED Requirements

### Requirement: Work classification drives model and delegation

The system SHALL classify each implementation request into exactly one of
`small`, `medium`, `spec-required`, or `audit` before any tool call, and
SHALL route it according to the matrix below. A request that does not match
any class defaults to `medium`.

| Class        | Default model            | Subagent depth | Specialist count | Browser MCP |
|--------------|--------------------------|----------------|------------------|-------------|
| `small`      | `ollama-cloud/gpt-oss:20b` | 0              | 0                | deny        |
| `medium`     | `ollama-cloud/minimax-m3` | 1              | 0–1              | deny        |
| `spec-required` | `openai/gpt-5.6-terra` for planning, `minimax/MiniMax-M3` for implementation | 1              | 0–2              | only with explicit risk |
| `audit`      | `openai/gpt-5.6-terra`    | 1              | 0–1              | required    |

The system SHALL classify a request as `audit` **only** when the user
explicitly @-mentions `@cotizador` OR explicitly requests a quote
(cotizar/presupuestar) for the development of an application or a
development effort. A URL on its own, or a request to improve, redesign,
migrate, optimize, audit, or evaluate a site without explicitly requesting
a development quote, SHALL NOT be classified as `audit` and SHALL NOT
dispatch `cotizador`.

The system SHALL refuse to delegate deeper than the configured `subagent_depth`
and SHALL surface a clear blocker when a specialist request would exceed it.

#### Scenario: small request stays inline

- **WHEN** the user asks for a single-line CSS tweak with no schema, dependency,
  or compatibility impact
- **THEN** the primary agent SHALL classify the work as `small`, run on
  `ollama-cloud/gpt-oss:20b`, and SHALL NOT dispatch any subagent or
  enable browser automation

#### Scenario: medium request uses exactly one specialist

- **WHEN** the user asks for a bounded multi-file change with no durable design
  decision
- **THEN** the primary agent SHALL classify the work as `medium`, run on
  `ollama-cloud/minimax-m3`, and MAY dispatch at most one specialist with
  no further nesting

#### Scenario: spec-required uses Terra for the proposal only

- **WHEN** the user asks for a new API or observable behavior change that
  triggers `/opsx-propose`
- **THEN** the planning step SHALL run on `openai/gpt-5.6-terra` and the
  implementation step SHALL run on `minimax/MiniMax-M3`, matching the
  scenario name; the proposal carries the decision weight because it is the
  contract the implementation is held to

#### Scenario: a URL alone does not dispatch cotizador

- **WHEN** the user pastes a URL, or asks to improve, redesign, migrate,
  optimize, audit, or evaluate a site without explicitly requesting a
  development quote and without @-mentioning `@cotizador`
- **THEN** the primary agent SHALL NOT classify the request as `audit` and
  SHALL NOT dispatch the `cotizador` subagent; it SHALL classify the work
  as `spec-required` (or route to `adversarial`/`qa` when the ask is review)

#### Scenario: explicit @cotizador mention dispatches the audit

- **WHEN** the user @-mentions `@cotizador` or explicitly asks to quote
  (cotizar/presupuestar) the development of an application or a
  development effort, with or without a URL
- **THEN** the primary agent SHALL classify the request as `audit` and
  dispatch the `cotizador` subagent

### Requirement: Terra is reserved for irreversible or ambiguous decisions

The system SHALL assign a model to each agent according to the weight of the
role's default output, using only providers the user is authenticated to.
The tiers are:

- **Decision tier — `openai/gpt-5.6-terra`**: roles whose default output is
  an irreversible edit, a high-ambiguity structural decision, or an
  external-facing audit. The roles are `architect`, `orchestrator`,
  `refactor`, `adversarial`, `cotizador`, and the `/opsx-propose` command.
- **Planning tier — `openai/gpt-5.6-luna`**: the `plan` agent, which
  triages, investigates, and classifies scope on every request but produces
  a classification that is cheap to revise.
- **Direct-MiniMax tier — `minimax/MiniMax-M3`** (1 048 576 ctx, $0.3/$1.2):
  the global root `model` and the `spec-required` class implementation step
  only. Reserved for sessions whose context budget genuinely exceeds 512k
  or whose execution depends on the direct-quota isolation guarantee.
- **Ollama-MiniMax tier — `ollama-cloud/minimax-m3`** (512 000 ctx,
  $0.6/$2.4): `build`, `general`, `frontend`, `backend`, and `qa`. Same
  open-weight model as the direct tier, served through Ollama Cloud with an
  independent quota and a smaller (but sufficient for bounded execution)
  context window.
- **Value tier — `ollama-cloud/gpt-oss:20b`** (131 072 ctx, $0.07/$0.3):
  `explore`, `p5t-installer`, `doctor`, and the global `small_model`.

The system SHALL NOT assign `openai/gpt-5.6-terra` as the default model for
`plan`, `explore`, `build`, `general`, `frontend`, `backend`, `qa`,
`p5t-installer`, or `doctor`.

OpenCode exposes exactly one static `model` per agent, so a mode-dependent
model is not expressible. The system SHALL therefore assign Terra to
`adversarial` unconditionally rather than only in `full` mode.

A command that produces a durable planning artifact SHALL run on the
decision tier even when the agent that invoked it runs on a cheaper one,
because the artifact's quality sets the ceiling for the implementation that
follows.

#### Scenario: explore never runs on Terra by default

- **WHEN** the global `explore` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` (or the
  explicitly user-selected override)

#### Scenario: build runs on the Ollama-MiniMax tier

- **WHEN** the global `build` agent is dispatched for a bounded multi-file
  edit that does not require a durable planning artifact
- **THEN** the configured model SHALL be `ollama-cloud/minimax-m3` and
  SHALL NOT be `minimax/MiniMax-M3` or `openai/gpt-5.6-terra`

#### Scenario: spec-required implementation runs on the direct-MiniMax tier

- **WHEN** a `spec-required` session transitions from the planning step on
  Terra to the implementation step
- **THEN** the implementation step SHALL run on `minimax/MiniMax-M3` and
  SHALL NOT be downgraded to `ollama-cloud/minimax-m3`

#### Scenario: adversarial reviews on the decision tier

- **WHEN** the global `adversarial` agent is dispatched in either `targeted`
  or `full` mode
- **THEN** the configured model SHALL be `openai/gpt-5.6-terra`, because
  adversarial review is a pre-commit gate where a missed finding costs more
  than the token delta

#### Scenario: the propose command runs on the decision tier

- **WHEN** `/opsx-propose` is invoked from a session whose agent is `plan`
  (the planning tier)
- **THEN** the command SHALL declare `model: openai/gpt-5.6-terra` and the
  proposal SHALL be generated on Terra, not on the invoking agent's cheaper
  model

#### Scenario: plan does not run on the decision tier

- **WHEN** the `plan` agent is dispatched
- **THEN** the configured model SHALL be `openai/gpt-5.6-luna` and SHALL NOT
  be `openai/gpt-5.6-terra`

#### Scenario: doctor runs on the value tier

- **WHEN** the global `doctor` subagent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` and
  SHALL NOT be `openai/gpt-5.6-terra`, because the doctor's role is
  read-only inspection and safe repair, not irreversible decisions
