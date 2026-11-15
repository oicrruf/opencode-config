# Spec Delta

## MODIFIED Requirements

### Requirement: Work classification drives model and delegation

The system SHALL classify each implementation request into exactly one of
`small`, `medium`, `spec-required`, or `audit` before any tool call, and
SHALL route it according to the matrix below. A request that does not match
any class defaults to `medium`.

| Class | Default model | Subagent depth | Specialist count | Browser MCP |
|---|---|---:|---:|---|
| `small` | `openai/gpt-5.6-luna` | 0 | 0 | deny |
| `medium` | `openai/gpt-5.6-luna` | 1 | 0–1 | deny |
| `spec-required` | `openai/gpt-5.6-terra` for planning, `openai/gpt-6.1-sol` for implementation | 1 | 0–2 | only with explicit risk |
| `audit` | `openai/gpt-5.6-terra` | 1 | 0–1 | required |

The system SHALL classify a request as `audit` only when the user explicitly
@-mentions `@cotizador` or explicitly requests a quote for development of an
application or development effort. A URL alone, or a request to improve,
redesign, migrate, optimize, audit, or evaluate a site without an explicit
development quote, SHALL NOT be classified as `audit` and SHALL NOT dispatch
`cotizador`.

The system SHALL refuse to delegate deeper than the configured
`subagent_depth` and SHALL surface a clear blocker when a specialist request
would exceed it.

#### Scenario: small request stays inline

- **WHEN** the user asks for an isolated CSS tweak with no schema, dependency,
  or compatibility impact
- **THEN** the primary agent SHALL classify it as `small`, use
  `openai/gpt-5.6-luna`, and SHALL NOT dispatch a subagent or enable browser
  automation

#### Scenario: medium request uses exactly one specialist

- **WHEN** the user asks for bounded multi-file work with no durable design
  decision
- **THEN** the primary agent SHALL classify it as `medium`, use
  `openai/gpt-5.6-luna`, and MAY dispatch at most one specialist with no further
  nesting

#### Scenario: spec-required uses Terra for the proposal only

- **WHEN** the user asks for a new API or observable behavior change that
  triggers `/opsx-propose`
- **THEN** the planning artifact SHALL be generated on
  `openai/gpt-5.6-terra` and implementation SHALL use
  `openai/gpt-6.1-sol`

#### Scenario: a URL alone does not dispatch cotizador

- **WHEN** the user provides a URL or asks to improve, redesign, migrate,
  optimize, audit, or evaluate a site without explicitly requesting a
  development quote and without @-mentioning `@cotizador`
- **THEN** the primary agent SHALL NOT classify the request as `audit` or
  dispatch `cotizador`; it SHALL classify the work as `spec-required` or route
  to `adversarial`/`qa` when the ask is review

#### Scenario: explicit @cotizador mention dispatches the audit

- **WHEN** the user @-mentions `@cotizador` or explicitly asks for a
  development quote, with or without a URL
- **THEN** the primary agent SHALL classify the request as `audit` and dispatch
  the `cotizador` subagent

### Requirement: Terra is reserved for irreversible or ambiguous decisions

The system SHALL assign OpenAI models according to the weight of each role's
default output, using only the OpenAI provider for root, agent, and command
model assignments. The default tiers SHALL be:

- **Decision — `openai/gpt-5.6-terra`**: `architect`, `orchestrator`,
  `refactor`, `adversarial`, `cotizador`, and `/opsx-propose`.
- **Execution — `openai/gpt-6.1-sol`**: root default, `build`, `general`,
  `frontend`, `backend`, `qa`, and `/opsx-apply`.
- **Lightweight — `openai/gpt-5.6-luna`**: `plan`, `explore`, `doctor`,
  `p5t-installer`, `triage`, and root `small_model`.

Both installation profiles SHALL use only IDs from the OpenAI provider. The
`work` profile MAY select a different OpenAI model for its root default, but
SHALL NOT change any consumer to another provider.

The system SHALL NOT assign Terra by default to `plan`, `explore`, `build`,
`general`, `frontend`, `backend`, `qa`, `p5t-installer`, or `doctor`.
OpenCode exposes one static model per agent, so `adversarial` SHALL use Terra
in both `targeted` and `full` modes. A command that produces a durable
planning artifact SHALL use the decision tier even when its invoking agent
uses a lighter tier.

OpenCode's ChatGPT Plus/Pro OAuth path SHALL be the documented way to access
these models. Model usage counts against the ChatGPT plan allowance; the
configuration SHALL NOT silently substitute an OpenAI API key or API billing.

#### Scenario: explore never runs on Terra by default

- **WHEN** the global `explore` agent is dispatched
- **THEN** it SHALL use `openai/gpt-5.6-luna` unless the operator explicitly
  selects another OpenAI model

#### Scenario: build runs on the Value tier

- **WHEN** `build` is dispatched for bounded implementation work
- **THEN** it SHALL use `openai/gpt-6.1-sol` and SHALL NOT use an ID from any
  provider other than OpenAI

#### Scenario: spec-required implementation runs on the direct-MiniMax tier

- **WHEN** a spec-required session transitions from proposal to implementation
- **THEN** implementation SHALL use `openai/gpt-6.1-sol`

#### Scenario: adversarial reviews on the decision tier

- **WHEN** `adversarial` is dispatched in `targeted` or `full` mode
- **THEN** it SHALL use `openai/gpt-5.6-terra`

#### Scenario: the propose command runs on the decision tier

- **WHEN** `/opsx-propose` is invoked from a planning-tier session
- **THEN** the command SHALL use `openai/gpt-5.6-terra`

#### Scenario: plan does not run on the decision tier

- **WHEN** the `plan` agent is dispatched
- **THEN** it SHALL use `openai/gpt-5.6-luna` and SHALL NOT use
  `openai/gpt-5.6-terra` by default

#### Scenario: doctor runs on the value tier

- **WHEN** the read-only `doctor` subagent is dispatched
- **THEN** it SHALL use `openai/gpt-5.6-luna`

### Requirement: Triage is a value-tier decision specialist

The system SHALL configure `triage` as a non-delegating, read-only subagent on
the lightweight OpenAI tier. Primary agents MAY dispatch it only for bounded
structured consultation about effort, risk, priority, classification,
proposal review, or architecture options. The dispatch SHALL include
alternatives when a selection is required and SHALL treat Triage output as
advisory evidence, not authority to bypass scope gates or OpenSpec workflow.

#### Scenario: Bounded option selection uses Triage

- **WHEN** a primary agent needs a recommendation among documented technical
  options and the decision does not itself require a durable plan
- **THEN** it MAY dispatch `triage` with a bounded brief and use the
  recommendation and confidence as evidence

#### Scenario: Triage cannot recursively delegate

- **WHEN** the `triage` subagent attempts to dispatch another specialist
- **THEN** the system SHALL refuse the nested dispatch under the configured
  subagent-depth limit

### Requirement: Agents opt in to the value tier when no implementation work is required

The system SHALL assign `openai/gpt-5.6-luna` to `explore`, `p5t-installer`,
and `doctor` regardless of work classification because those roles do not
perform implementation. These defaults SHALL remain OpenAI model IDs.

#### Scenario: explore runs on the value tier

- **WHEN** the `explore` agent is dispatched
- **THEN** it SHALL use `openai/gpt-5.6-luna` unless the operator explicitly
  selects another OpenAI model

#### Scenario: doctor runs on the value tier

- **WHEN** the `doctor` agent is dispatched
- **THEN** it SHALL use `openai/gpt-5.6-luna`

#### Scenario: p5t-installer runs on the value tier

- **WHEN** the `p5t-installer` agent is dispatched
- **THEN** it SHALL use `openai/gpt-5.6-luna`

### Requirement: /opsx-propose runs on the decision tier regardless of the invoking agent

The `/opsx-propose` command SHALL use `openai/gpt-5.6-terra` so the proposal
is generated on the decision tier even when its invoking agent uses a lighter
model. The proposal quality sets the ceiling for the implementation that
follows.

#### Scenario: /opsx-propose runs on Terra from a planning-tier session

- **WHEN** the operator invokes `/opsx-propose <name>` from a session whose
  agent is `plan`
- **THEN** the command SHALL run on `openai/gpt-5.6-terra`

## ADDED Requirements

### Requirement: Agent and command model assignments use only OpenAI

The root model, `small_model`, every global agent, and every command model
override in every installation profile SHALL use an `openai/` model ID.
Validation SHALL report the profile and consumer when any assignment uses
another provider. This restriction applies to OpenCode model routing; it does
not change separately invoked external services used by tools.

#### Scenario: a non-OpenAI profile assignment is rejected

- **WHEN** any profile assigns a root, agent, or command model whose ID does
  not begin with `openai/`
- **THEN** configuration validation SHALL fail and identify that profile and
  consumer

#### Scenario: a non-OpenAI command override is rejected

- **WHEN** a command frontmatter declares a model outside the OpenAI provider
- **THEN** configuration validation SHALL fail and identify the command
