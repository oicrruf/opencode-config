# triage-decision-agent Specification

## Purpose
Provide a low-context, calibrated decision specialist that recommends a
single engineering option through OpenRouter SystemOne without MCP startup.

## Requirements

### Requirement: Triage provides bounded structured consultation

The system SHALL provide a read-only `triage` subagent for effort estimation,
risk and priority assessment, change classification, proposal review, and
architecture-option evaluation. It SHALL accept a bounded decision brief and
return a structured result containing the selected option, confidence,
rationale, and any decision-critical missing information.

#### Scenario: Evidence supports a recommendation

- **WHEN** a brief supplies explicit options and sufficient evidence to rank
  them
- **THEN** Triage SHALL select one option as the recommendation rather than
  returning an unranked list

#### Scenario: Evidence is insufficient

- **WHEN** a brief lacks information that would materially change the chosen
  option
- **THEN** Triage SHALL report uncertainty and name the missing information
  without inventing a recommendation

#### Scenario: Consultation remains read-only

- **WHEN** Triage is dispatched by another agent
- **THEN** it SHALL not edit files, delegate another agent, or expose
  credentials in its response

### Requirement: Triage avoids MCP transport startup

The system SHALL invoke SystemOne through a local direct client when Triage
consultation is requested and SHALL NOT register a Triage MCP server.

#### Scenario: OpenCode starts without Triage MCP

- **WHEN** OpenCode starts after Triage is configured as a decision agent
- **THEN** its MCP status list SHALL not contain Triage or wait for a Triage MCP
  operation timeout

### Requirement: Triage unavailability is non-blocking

The system SHALL treat missing credentials, unavailable network access,
upstream errors, timeouts, and unverifiable recommendations as an unavailable
optional consultation. The parent workflow SHALL continue without a Triage
recommendation unless it independently requires a human decision.

#### Scenario: OpenRouter credentials are missing

- **WHEN** Triage cannot resolve an OpenRouter credential
- **THEN** it SHALL return `status: "unavailable"` with reason
  `missing_credentials`, and the dispatcher SHALL continue without Triage

#### Scenario: Upstream consultation fails

- **WHEN** SystemOne times out or returns an upstream error
- **THEN** Triage SHALL report the unavailable result without repeatedly
  retrying or blocking the parent workflow

#### Scenario: Triage succeeds

- **WHEN** a consultation returns a valid evidence-backed recommendation
- **THEN** the dispatcher MAY use it as advisory input and SHALL continue to
  own the final decision

### Requirement: Approved decision agents may dispatch Triage

The system SHALL permit `build`, `plan`, `adversarial`, `architect`,
`orchestrator`, and `refactor`, plus `opsx-propose`, to dispatch the optional
`triage` subagent with a bounded brief. All other agents SHALL be denied.

#### Scenario: Architecture or refactor work uses Triage

- **WHEN** `architect`, `orchestrator`, or `refactor` dispatches Triage
- **THEN** the dispatch SHALL be permitted and remain advisory

#### Scenario: Unavailable Triage does not block approved callers

- **WHEN** an approved caller receives `status: "unavailable"`
- **THEN** it SHALL continue without a Triage recommendation

### Requirement: Allowed dispatchers are explicit

The `triage` host prompt SHALL declare its allowed dispatchers as
exactly `build`, `plan`, `adversarial`, `architect`, `orchestrator`, and
`refactor`, plus the global `opsx-propose` command for proposal planning.
Any other agent or
command SHALL be treated as an unauthorized dispatcher and the host
prompt SHALL refuse the request.

#### Scenario: Authorized dispatcher

- **WHEN** an approved decision agent or `opsx-propose` dispatches
  `triage` with a valid bounded brief
- **THEN** Triage accepts the brief, calls SystemOne via the local
  direct client, and returns the structured recommendation

#### Scenario: Unauthorized dispatcher

- **WHEN** any other agent or command dispatches `triage`
- **THEN** the host prompt returns a structured `unauthorized_dispatcher`
  error without contacting SystemOne and without writing to the audit
  log (when the audit log is later introduced)

### Requirement: Triage relays the upstream recommendation verbatim

The system SHALL require the `triage` host agent to relay the upstream
recommendation exactly as it appears in `details.evidence`. The agent
MUST NOT paraphrase or invent a recommendation when
`status === "unavailable"`. The audit log under
`.opencode/state/triage/consultations.jsonl` SHALL be considered the
canonical record of every consultation; in case of conflict between
the agent's prose and the log, the log wins.

#### Scenario: Evidence supports a recommendation

- **WHEN** a brief supplies explicit options and sufficient evidence to
  rank them
- **THEN** Triage SHALL relay the upstream recommendation verbatim and
  report the upstream confidence without modification

#### Scenario: Evidence is insufficient

- **WHEN** a brief lacks information that would materially change the
  chosen option
- **THEN** Triage SHALL report uncertainty and name the missing
  information without inventing a recommendation

#### Scenario: Consultation remains read-only

- **WHEN** Triage is dispatched by another agent
- **THEN** it SHALL not edit files, delegate another agent, expose
  credentials in its response, or rewrite the upstream recommendation
