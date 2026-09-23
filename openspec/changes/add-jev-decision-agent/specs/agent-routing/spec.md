## ADDED Requirements

### Requirement: Jev is a value-tier decision specialist

The system SHALL configure `jev` as a non-delegating, read-only subagent on
the value tier. Primary agents MAY dispatch it only for bounded structured
consultation whose outcome is an effort, risk, priority, classification,
proposal-review, or architecture-option decision. The dispatch SHALL include
the alternatives when a selection is required and SHALL treat Jev's output as
advisory evidence, not authority to bypass scope gates or OpenSpec workflow.

#### Scenario: Bounded option selection uses Jev

- **WHEN** a primary agent needs a recommendation among documented technical
  options and the decision does not itself require a durable plan
- **THEN** it MAY dispatch `jev` with a bounded brief and use the returned
  recommendation and confidence in its own decision

#### Scenario: Jev cannot recursively delegate

- **WHEN** the `jev` subagent attempts to dispatch another specialist
- **THEN** the system SHALL refuse the nested dispatch under the configured
  subagent-depth limit
