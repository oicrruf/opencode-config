## ADDED Requirements

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
