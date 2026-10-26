# Spec Delta

## ADDED Requirements

### Requirement: Recovered project context is auxiliary and never an authorization

The system SHALL treat any context recovered from the local project memory —
a stored preference, a stored decision, or a continuity record — as
auxiliary history. Recovered context SHALL NOT authorize an action, SHALL
NOT replace the current request, a current instruction, or a current policy,
and SHALL NOT be widened by inference. An agent that relies on recovered
context SHALL re-verify it against the authoritative source before acting.

#### Scenario: A stored preference appears to permit a step

- **WHEN** a stored preference suggests that an action the current request
  does not authorize would be acceptable
- **THEN** the agent SHALL treat the current request and the current
  policies as the only sources of authorization and SHALL NOT act on the
  stored preference alone

#### Scenario: A stored decision contradicts the current instruction

- **WHEN** a stored decision conflicts with the developer's current
  instruction
- **THEN** the current instruction SHALL prevail and the agent SHALL NOT
  resolve the conflict silently in favor of the stored record

#### Scenario: A continuity record is used to resume work

- **WHEN** an agent resumes a task from a stored continuity record
- **THEN** the agent SHALL re-verify the recorded state against the
  authoritative source — the repository, the work item, the specification, or
  the task list — before relying on it, and SHALL report a divergence
  instead of assuming the record is current
