# agent-routing Specification

## Purpose
Define a single routing contract that maps work classification to model,
delegation depth, and allowed tool surface for every global agent, so that
session cost and capability are predictable from the classification alone.

## Requirements

### Requirement: Work classification drives model and delegation

The system SHALL classify each implementation request into exactly one of
`small`, `medium`, `spec-required`, or `audit` before any tool call, and
SHALL route it according to the matrix below. A request that does not match
any class defaults to `medium`.

| Class        | Default model            | Subagent depth | Specialist count | Browser MCP |
|--------------|--------------------------|----------------|------------------|-------------|
| `small`      | `minimax/MiniMax-M2.7-highspeed` | 0              | 0                | deny        |
| `medium`     | `minimax/MiniMax-M3`     | 1              | 0–1              | deny        |
| `spec-required` | `openai/gpt-5.6-terra` for planning, `minimax/MiniMax-M3` for implementation | 1              | 0–2              | only with explicit risk |
| `audit`      | `openai/gpt-5.6-terra`    | 1              | 0–1              | required    |

The system SHALL classify a request as `audit` **only** when the user
explicitly @-mentions `@cotizador` OR explicitly requests a quote
(cotizar/presupuestar) for the development of an application or a
development effort. A URL on its own, or a request to improve, redesign,
migrate, optimize, audit, or evaluate a site without an explicit quoting
intent, SHALL NOT be classified as `audit` and SHALL NOT dispatch
`cotizador`.

The system SHALL refuse to delegate deeper than the configured `subagent_depth`
and SHALL surface a clear blocker when a specialist request would exceed it.

#### Scenario: small request stays inline

- **WHEN** the user asks for a single-line CSS tweak with no schema, dependency,
  or compatibility impact
- **THEN** the primary agent SHALL classify the work as `small`, run on
  `minimax/MiniMax-M2.7-highspeed`, and SHALL NOT dispatch any subagent or
  enable browser automation

#### Scenario: medium request uses exactly one specialist

- **WHEN** the user asks for a bounded multi-file change with no durable design
  decision
- **THEN** the primary agent SHALL classify the work as `medium`, run on
  `minimax/MiniMax-M3`, and MAY dispatch at most one specialist with no
  further nesting

#### Scenario: spec-required uses Terra for the proposal only

- **WHEN** the user asks for a new API or observable behavior change that
  triggers `/opsx-propose`
- **THEN** the planning step SHALL run on `openai/gpt-5.6-terra` and the
  implementation step SHALL run on `minimax/MiniMax-M3`

#### Scenario: a URL alone does not dispatch cotizador

- **WHEN** the user pastes a URL, or asks to improve, redesign, migrate,
  optimize, audit, or evaluate a site without explicitly requesting a
  development quote and without @-mentioning `@cotizador`
- **THEN** the primary agent SHALL NOT classify the request as `audit` and
  SHALL NOT dispatch the `cotizador` subagent; it SHALL classify the work
  as `spec-required` (or route to `adversarial`/`qa` when the ask is review)

#### Scenario: explicit @cotizador mention dispatches the audit

- **WHEN** the user @-mentions `@cotizador` or explicitly asks to quote
  (cotizar/presupuestar) the development of an application or a development
  effort, with or without a URL
- **THEN** the primary agent SHALL classify the request as `audit` and
  dispatch the `cotizador` subagent

### Requirement: Terra is reserved for irreversible or ambiguous decisions

The system SHALL assign `openai/gpt-5.6-terra` only to roles whose default
output drives an irreversible change, a high-ambiguity decision, or an
external-facing audit. The roles allowed to default to Terra are: `plan`,
`architect`, `refactor` (when the OpenSpec change is `spec-required`),
`orchestrator`, `adversarial` (only when its audit mode is `full`), and
`cotizador`.

The system SHALL NOT assign `openai/gpt-5.6-terra` as the default model for
`explore`, `build`, `general`, `frontend`, `backend`, or `qa`.

#### Scenario: explore never runs on Terra by default

- **WHEN** the global `explore` agent is dispatched
- **THEN** the configured model SHALL be `minimax/MiniMax-M3` (or the
  explicitly user-selected override)

### Requirement: Subagent depth is bounded and auditable

The system SHALL set `subagent_depth` to `1` by default and SHALL allow a
value of `2` only for the `orchestrator` and `refactor` agents. When a
subagent attempts to delegate, the system SHALL refuse and return a
structured error that names the offending call.

#### Scenario: nested delegation is rejected

- **WHEN** a subagent invokes the `task` tool to dispatch another agent while
  `subagent_depth` is `1`
- **THEN** the system SHALL refuse the delegation and SHALL return an error
  whose message names the depth limit and the agent that would have been
  dispatched

### Requirement: Audit roles expose targeted and full modes

The `qa`, `adversarial`, and `cotizador` agents SHALL each support a
`mode` parameter with values `targeted` (default) and `full`. In `targeted`
mode the agent runs the minimal verification or audit required for the
declared scope; in `full` mode the agent expands surface to lint, types,
tests, coverage, accessibility, security, performance, and Playwright crawl.

The system SHALL require an explicit user request OR a documented risk
signal (security change, schema migration, external-facing artifact, or
open incident) before switching an audit role to `full`.

#### Scenario: adversarial stays targeted unless asked

- **WHEN** the user requests "revisa estos cambios" without specifying an
  audit depth
- **THEN** the `adversarial` agent SHALL default to `targeted` mode and SHALL
  scan only the axes directly relevant to the changed files

#### Scenario: cotizador upgrades to full on confirmed scope

- **WHEN** the user has confirmed the URL, client, final client, scope, rate,
  currency, validity, payment terms, exclusions, and access details
- **THEN** `cotizador` MAY switch to `full` mode and crawl up to the documented
  page budget

### Requirement: Specialist dispatch contract

When a primary agent dispatches a specialist via the `task` tool, the
dispatch payload SHALL include: the work classification, the relevant files
or symbols, the expected outcome, any user constraints, and the verification
criteria. The specialist SHALL return only: classification, decision,
changed files, verification results, blockers, and any OpenSpec task impact.

#### Scenario: build dispatches frontend with full contract

- **WHEN** the `build` agent decides a frontend specialist is needed for a
  bounded UI change
- **THEN** the dispatch payload SHALL include the classification (`small`,
  `medium`, or `spec-required`), the affected files, the expected output, and
  the verification criteria, and SHALL NOT include the full conversation
  history
