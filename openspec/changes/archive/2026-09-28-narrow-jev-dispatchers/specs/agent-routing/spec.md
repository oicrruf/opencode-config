## ADDED Requirements

### Requirement: Jev dispatcher list is explicit and narrow

The system SHALL restrict `jev` dispatch to exactly the `build`,
`plan`, and `adversarial` agents, and SHALL additionally allow the
global `opsx-propose` OpenSpec command to dispatch `jev` during
proposal planning. Every other agent and every other command SHALL
NOT dispatch `jev`. The acceptance harness SHALL fail if the
dispatcher list drifts from this rule.

#### Scenario: build dispatches jev

- **WHEN** the `build` agent calls the `task` tool with `agent: "jev"`
- **THEN** the dispatch is allowed by the routing matrix and the
  harness agrees

#### Scenario: general agent does NOT dispatch jev

- **WHEN** the `general` agent calls the `task` tool with `agent: "jev"`
- **THEN** the routing matrix denies the dispatch under the strict
  scope gate

#### Scenario: opsx-propose may use jev

- **WHEN** the global `opsx-propose` command runs and needs a
  calibrated triage during proposal planning
- **THEN** the command MAY dispatch `jev` with a bounded brief, and
  the proposal that follows MAY cite the Jev recommendation as
  supporting evidence

#### Scenario: opsx-apply does NOT dispatch jev

- **WHEN** the global `opsx-apply` command runs
- **THEN** it SHALL NOT dispatch `jev` because implementation is not
  a triage activity; Jev's role is advisory
