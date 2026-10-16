# Spec Delta

## MODIFIED Requirements

### Requirement: Each agent declares a step budget
The system SHALL set an explicit `steps` value for every agent defined in
`opencode.jsonc`. The default budget per class is:

| Class                                   | Default `steps` |
|-----------------------------------------|-----------------|
| `explore`                               | 25              |
| `general`, `frontend`, `backend`        | 40              |
| `build`                                 | 60              |
| `plan`, `architect`, `refactor`, `orchestrator`, `adversarial`, `cotizador`, `p5t-installer` | 100 |

OpenCode accepts exactly one `steps` value per agent, so an agent with
`targeted` / `full` modes SHALL declare the budget of its **highest**
mode. `steps` is a ceiling, not a quota: a targeted run SHALL stop when
it has completed its declared bounded scope and SHALL NOT consume
remaining iterations searching for unrelated findings.

When a session reaches its step limit the agent SHALL emit a structured
completion summary instead of looping. A targeted `adversarial` summary
that is incomplete SHALL identify the final diff or scope examined,
checks completed, material risk not verified, and the operator decision
or next bounded check required.

#### Scenario: explore stops at its budget

- **WHEN** the `explore` agent has not produced a complete answer after 25
  iterations
- **THEN** it SHALL return a summary listing what was found, what was not,
  and the next recommended action

#### Scenario: targeted adversarial review stops when scope is complete

- **WHEN** `adversarial` has reviewed the final diff and directly affected
  dependencies required by its targeted scope
- **THEN** it SHALL return its verdict without spending remaining step
  budget on unrelated audit axes

#### Scenario: targeted adversarial review reaches its budget

- **WHEN** `adversarial` reaches its step budget before it can verify a
  material risk in targeted mode
- **THEN** it SHALL return the required structured incomplete summary and
  SHALL NOT continue by expanding to unrelated checks
