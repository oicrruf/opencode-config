# Spec Delta

## ADDED Requirements

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
