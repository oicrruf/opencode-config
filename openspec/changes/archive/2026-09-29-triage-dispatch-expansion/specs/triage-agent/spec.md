## MODIFIED Requirements

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
