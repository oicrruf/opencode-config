## Purpose

Defines the visible behavior of the TUI quota footer plugin: how it presents
fresh codex and MiniMax quota data, how it surfaces sustained read failures
instead of silently preserving stale values, and what diagnostic output is
emitted when a read fails.

## ADDED Requirements

### Requirement: Display fresh codex quota

The system SHALL render a codex quota bar (5-segment Unicode bar plus a
rounded integer percent) using the value from `codex app-server`
`account/rateLimits/read` response field
`rateLimits.individualLimit.remainingPercent` when that field is present and
is a number in the closed interval [0, 100].

#### Scenario: Individual limit present and numeric

- **WHEN** the codex response includes
  `result.rateLimits.individualLimit.remainingPercent` as a number `N`
  with `0 ≤ N ≤ 100`
- **THEN** the footer shows the codex prefix followed by a 5-segment bar
  representing `N` percent and the rounded value `N%`

#### Scenario: Individual limit missing

- **WHEN** the codex response omits `individualLimit` or its
  `remainingPercent` is not a number
- **THEN** no codex bar is rendered for that refresh cycle and the
  failure-handling requirements below apply

### Requirement: Sentinel after sustained failure

The system MUST NOT preserve a previously rendered codex value indefinitely
when `readCodex()` returns no fresh data. After three consecutive refresh
cycles in which `readCodex()` resolves to `undefined` (no fresh value and
no auth-required signal), the system SHALL replace the cached codex line
with the sentinel string `󰚩 Codex · sin datos` until a subsequent
successful read replaces it again.

#### Scenario: Three consecutive failures reach the sentinel

- **WHEN** `readCodex()` resolves to `undefined` for three consecutive
  refresh cycles
- **THEN** the next render of the footer displays the sentinel
  `󰚩 Codex · sin datos` in place of the previously cached codex line

#### Scenario: Successful read clears the sentinel

- **WHEN** `readCodex()` returns a fresh codex label string after the
  sentinel has been displayed
- **THEN** the consecutive-failure counter resets to zero and the cached
  value is replaced by the new label

#### Scenario: Auth-required response does not count as failure

- **WHEN** `readCodex()` resolves to the string `󰚩 Codex requiere login`
  because the codex server reports an authentication-required error
- **THEN** that response resets the consecutive-failure counter to zero and
  the auth-required label is displayed; the sentinel rule does not trigger

### Requirement: One diagnostic warning per failed read

For every refresh cycle in which `readCodex()` does not produce a fresh
codex value (i.e., it resolves to `undefined` or throws), the system SHALL
emit exactly one warning through the plugin's diagnostic channel. The
warning SHALL include a recognizable plugin prefix and the failure reason
(auth-error message, JSON-RPC error message, `ENOENT`, timeout, or caught
exception message) so an operator can diagnose the cause without
instrumenting the plugin.

#### Scenario: ENOENT is logged once

- **WHEN** `readCodex()` catches an error whose message includes `ENOENT`
  (codex binary not on PATH)
- **THEN** exactly one warning naming `ENOENT` is emitted for that cycle
  and the consecutive-failure counter is not incremented (the existing
  empty-codex-segment behavior for ENOENT is preserved)

#### Scenario: Timeout or JSON-RPC error logs and counts

- **WHEN** `readCodex()` resolves to `undefined` or throws because of a
  timeout, a JSON-RPC error, a malformed response, or a process crash
- **THEN** exactly one warning containing the failure reason is emitted
  and the consecutive-failure counter increments by one
