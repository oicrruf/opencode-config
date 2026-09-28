# jev-decision-agent Specification

## Purpose
Provide a low-context, calibrated decision specialist that recommends a
single engineering option through OpenRouter SystemOne without MCP startup.

## Requirements

### Requirement: Jev provides bounded structured consultation

The system SHALL provide a read-only `jev` subagent for effort estimation,
risk and priority assessment, change classification, proposal review, and
architecture-option evaluation. It SHALL accept a bounded decision brief and
return a structured result containing the selected option, confidence,
rationale, and any decision-critical missing information.

#### Scenario: Evidence supports a recommendation

- **WHEN** a brief supplies explicit options and sufficient evidence to rank
  them
- **THEN** Jev SHALL select one option as the recommendation rather than
  returning an unranked list

#### Scenario: Evidence is insufficient

- **WHEN** a brief lacks information that would materially change the chosen
  option
- **THEN** Jev SHALL report uncertainty and name the missing information
  without inventing a recommendation

#### Scenario: Consultation remains read-only

- **WHEN** Jev is dispatched by another agent
- **THEN** it SHALL not edit files, delegate another agent, or expose
  credentials in its response

### Requirement: Jev avoids MCP transport startup

The system SHALL invoke SystemOne through a local direct client when Jev
consultation is requested and SHALL NOT register a Jev MCP server.

#### Scenario: OpenCode starts without Jev MCP

- **WHEN** OpenCode starts after Jev is configured as a decision agent
- **THEN** its MCP status list SHALL not contain Jev or wait for a Jev MCP
  operation timeout

### Requirement: Allowed dispatchers are explicit

The `jev` host prompt SHALL declare its allowed dispatchers as
exactly `build`, `plan`, and `adversarial`, plus the global
`opsx-propose` command for proposal planning. Any other agent or
command SHALL be treated as an unauthorized dispatcher and the host
prompt SHALL refuse the request.

#### Scenario: Authorized dispatcher

- **WHEN** `build`, `plan`, `adversarial`, or `opsx-propose` dispatches
  `jev` with a valid bounded brief
- **THEN** Jev accepts the brief, calls SystemOne via the local
  direct client, and returns the structured recommendation

#### Scenario: Unauthorized dispatcher

- **WHEN** any other agent or command dispatches `jev`
- **THEN** the host prompt returns a structured `unauthorized_dispatcher`
  error without contacting SystemOne and without writing to the audit
  log (when the audit log is later introduced)
