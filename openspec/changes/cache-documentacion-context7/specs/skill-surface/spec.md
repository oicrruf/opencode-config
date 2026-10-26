# Spec Delta

## MODIFIED Requirements

### Requirement: Delivery skills stay model-invocable

The skills `debugging`, `surgical-patch`, `verify-and-stop`,
`lean-build`, `code-review`, `dedupe`, `investigate-first`, `safe-refactor`,
`frontend-design`, `interface-design`, `refactoring`, and
`documentacion-context7-compartida` SHALL remain model-invocable (no
`disable-model-invocation` flag) and SHALL keep their descriptions concise
enough that the union of all their descriptions fits within 3000
characters.

#### Scenario: delivery skills are reachable by description

- **WHEN** the primary agent encounters a bug, a layout decision, a
  refactor, or a verification gate
- **THEN** the relevant delivery skill SHALL be reachable from the agent's
  description alone, with no manual invocation required

#### Scenario: the shared documentation skill stays reachable

- **WHEN** the primary agent needs library documentation for a library,
  framework, or API whose behavior may vary by version
- **THEN** the `documentacion-context7-compartida` skill SHALL be reachable
  from the agent's description alone, and the union of all model-invocable
  skill descriptions SHALL still fit within 3000 characters
