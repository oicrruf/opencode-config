## MODIFIED Requirements

### Requirement: Each agent declares a step budget

The system SHALL distinguish primary continuity from bounded specialist execution. It SHALL omit `steps` for `build` and `plan`. Specialist budgets SHALL be 25 for `explore` and `triage`, 80 for `general`, `frontend`, and `backend`, 60 for `qa`, and 100 for `architect`, `orchestrator`, `refactor`, `adversarial`, `cotizador`, `p5t-installer`, and `doctor`. Agents with targeted/full modes SHALL declare the highest-mode budget. A ceiling is not a quota: completed bounded work SHALL stop early. Compaction SHALL remain independent of this policy and SHALL NOT be described as renewing a step allowance.

An incomplete specialist SHALL return evidence and pending work to its coordinator. A targeted adversarial summary SHALL identify the final diff or scope examined, checks completed, and material risk not verified. Existing review and permission gates SHALL remain authoritative.

#### Scenario: explore stops at its budget
- **WHEN** explore has not completed its unit after 25 iterations
- **THEN** it SHALL return findings, gaps, and the next recommended action to its coordinator

#### Scenario: targeted adversarial review stops when scope is complete
- **WHEN** adversarial has reviewed the final diff and required dependencies
- **THEN** it SHALL return its verdict without unrelated investigation

#### Scenario: targeted adversarial review reaches its budget
- **WHEN** adversarial cannot verify a material risk before exhausting its budget
- **THEN** it SHALL return a structured incomplete summary without expanding to unrelated checks or restarting itself

#### Scenario: primary work outlives a former ceiling
- **WHEN** build or plan still has authorized work and is making progress beyond a previous fixed allowance
- **THEN** it SHALL continue in the same turn without requiring the user to renew that allowance
