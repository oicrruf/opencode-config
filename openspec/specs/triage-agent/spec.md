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
