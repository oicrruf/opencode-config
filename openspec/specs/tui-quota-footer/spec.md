# tui-quota-footer Specification

## Purpose
Defines the visible behavior of the TUI quota footer plugin: how it presents
fresh codex and MiniMax quota data, how it surfaces sustained read failures
instead of silently preserving stale values, and what diagnostic output is
emitted when a read fails.

## Requirements

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

### Requirement: Plan badge appended to codex label

The system SHALL append a single Nerd Font `nf-md-` icon to the codex
label as the LAST component (after any reset indicator), chosen from
the response field `planType`:

- `self_serve_business_usage_based` (and any other value starting with
  `self_serve_business`) → briefcase icon `󰃖`
- `free`, `plus`, `pro`, `team` → account icon `󰀄`
- any other value, missing field, or non-string → no badge (label
  rendered without suffix)

The badge MUST be separated from the previous component by exactly one
space. The badge MUST NOT be colored; it inherits the same
`textMuted` foreground the rest of the label uses.

#### Scenario: Business plan shows briefcase

- **WHEN** `readCodex` returns a label string and the response's root
  `planType` is `self_serve_business_usage_based`
- **THEN** the rendered codex label ends with a single space followed by
  `󰃖` after every other component

#### Scenario: Personal plan shows account icon

- **WHEN** `readCodex` returns a label string and `planType` is one of
  `free`, `plus`, `pro`, `team`
- **THEN** the rendered codex label ends with a single space followed by
  `󰀄` after every other component

#### Scenario: Unknown plan renders no badge

- **WHEN** `readCodex` returns a label string and `planType` is
  missing, an empty string, or a value not in the mapping table
- **THEN** the rendered codex label ends exactly at the percentage (or
  reset indicator if one is present), with no trailing whitespace or
  icon

#### Scenario: Badge does not appear when there is no codex label

- **WHEN** `readCodex` returns `undefined` or `null` (no codex data for
  this cycle, including ENOENT or sustained-failure sentinel cases)
- **THEN** no badge is rendered at all; the helper output is never
  appended to a non-codex label

### Requirement: Reset indicator immediately after any quota bar

When the response carries a reset timestamp for any quota window, the
system SHALL append a reset indicator immediately after the bar of
that window (single space separator, no leading word). The indicator
applies uniformly to all providers and all windows; the format is:

- Distance between the reset timestamp and `Date.now() / 1000` is
  `>= 86400` seconds (one day or more) → ` {d}d` where `{d}` is
  `floor(diffSeconds / 86400)`. Hours and minutes are dropped in this
  case so the indicator stays compact at long horizons.
- Distance is `> 0` and `< 86400` seconds (less than one day) →
  ` {h}h`, ` {m}m`, or ` {h}h {m}m` depending on which components are
  non-zero (omit any component whose value is zero). Days are dropped
  in this case.
- Distance is `0` or negative (clock-skew window) → no indicator.
- The reset timestamp is missing, null, zero, negative, or not a
  finite number → no indicator.

The indicator MUST be preceded by exactly one space, MUST NOT include
the word "reset" or any other label, MUST NOT be colored, and MUST NOT
include any separator character (`·`, dash, slash, etc.) — only the
single space between hours and minutes when both are present.

For the **codex** provider the reset timestamp is read from
`rateLimits.individualLimit.resetsAt` and is expressed in Unix seconds.
For the **MiniMax** provider the 5-hour interval's reset timestamp is
read from `model_remains[general].end_time` and the weekly window's
reset timestamp is read from `model_remains[general].weekly_end_time`;
both are expressed in Unix milliseconds and MUST be converted to Unix
seconds before being passed to the indicator function.

#### Scenario: Reset more than one day shows days only

- **WHEN** the reset timestamp for a window is one day or more from
  now
- **THEN** the label for that window, immediately after the
  percentage bar, ends with ` {d}d` where `{d}` is the integer day
  count; no hours, no minutes, no `·`

#### Scenario: Reset less than one day shows hours and/or minutes

- **WHEN** the reset timestamp for a window is between 1 minute and
  24 hours from now
- **THEN** the label for that window, immediately after the
  percentage bar, ends with ` {h}h {m}m` when both components are
  non-zero, ` {h}h` when only hours are non-zero, or ` {m}m` when
  only minutes are non-zero — never with a days component

#### Scenario: Reset under one minute renders no indicator

- **WHEN** the reset timestamp for a window is less than 60 seconds
  from now or already in the past
- **THEN** no reset indicator is appended to that window

#### Scenario: Reset field missing renders no indicator

- **WHEN** the reset timestamp for a window is missing, null, zero,
  negative, or not a finite number
- **THEN** no reset indicator is appended to that window

#### Scenario: MiniMax 5-hour interval renders hours

- **WHEN** the MiniMax response carries `end_time` (Unix ms) for the
  general model and the distance from `end_time / 1000` to now is
  less than 24 hours
- **THEN** the MiniMax `5h` part ends with an hour-based indicator
  (e.g., ` 2h` or ` 5h 30m`) immediately after its percentage bar

#### Scenario: MiniMax weekly interval renders days when over 24 hours

- **WHEN** the MiniMax response carries `weekly_end_time` (Unix ms)
  for the general model and the distance from `weekly_end_time / 1000`
  to now is 24 hours or more
- **THEN** the MiniMax `sem` part ends with a day-based indicator
  (e.g., ` 3d`) immediately after its percentage bar

#### Scenario: MiniMax weekly interval renders hours when under 24 hours

- **WHEN** the MiniMax weekly cycle is in its final day (less than
  24 hours remaining)
- **THEN** the MiniMax `sem` part ends with an hour-based indicator
  rather than a day-based one, reflecting the actual remaining time
  regardless of the cycle's nominal length

### Requirement: Display Ollama Cloud monthly consumption

The system SHALL render an Ollama Cloud segment in the footer derived from
`GET https://ollama.com/api/usage`.

The endpoint field `limits.monthly.usage` SHALL be interpreted as the
**fraction of the account plan's included monthly usage credit already
consumed**, not as a US dollar amount. The segment SHALL render the consumed
amount as US dollars, computed as `limits.monthly.usage` multiplied by the
plan's included monthly credit resolved through the allowance requirement
below, formatted to two decimal places.

The segment SHALL render the summed `request_count` across every entry in
`limits.monthly.models` as a plain integer count. The segment SHALL be
prefixed with a single Nerd Font `nf-md-assistant` icon (`󰁤`) and a `Ollama`
label, matching the icon-plus-provider-name shape the codex and MiniMax
segments use.

When the plan's included monthly credit cannot be resolved, the segment
MUST NOT multiply by a guessed allowance. The system SHALL instead render
the consumed fraction directly as a percentage of the included credit,
formatted to one decimal place with a trailing `.0` omitted (for example, a
`limits.monthly.usage` of `0.031` renders as `3.1%`), alongside the same
icon, `Ollama` label, and request count. This allows the segment to report
consumption without depending on an allowance the endpoint does not expose.

The segment MUST NOT render a 5-segment Unicode bar in either form. The
segment MUST NOT render a reset indicator: the endpoint exposes no reset
timestamp, so a countdown would be fabricated rather than observed.

When `limits.monthly.usage` is missing or is not a finite number, or when
`limits.monthly.models` is absent, the segment SHALL NOT be rendered for
that refresh cycle and the failure-handling requirement below applies.

#### Scenario: Consumption and request count are rendered

- **WHEN** the endpoint returns `limits.monthly.usage` as the number
  `0.031`, `limits.monthly.models` contains entries whose `request_count`
  values sum to `117`, and the account plan resolves to an included monthly
  credit of `60`
- **THEN** the footer shows the Ollama Cloud segment containing `$1.86`
  and `117` alongside the `nf-md-assistant` icon (`󰁤`) and the `Ollama`
  label

#### Scenario: Consumption is not rendered as the raw fraction

- **WHEN** the endpoint returns `limits.monthly.usage` as the number
  `0.031` and the account plan resolves to an included monthly credit of
  `60`
- **THEN** the rendered segment contains `$1.86` and MUST NOT contain
  `$0.03` or any other dollar value equal to the unconverted fraction

#### Scenario: Unknown plan renders the fraction as a percentage

- **WHEN** the account plan is missing, is `free`, or is a value not in the
  allowance mapping, and the endpoint returns `limits.monthly.usage` as the
  number `0.031`
- **THEN** the footer shows the Ollama Cloud segment containing `3.1%`
  alongside the same icon, `Ollama` label, and request count, and the
  segment is displayed rather than suppressed

#### Scenario: No percentage bar is rendered

- **WHEN** the endpoint returns a valid `limits.monthly.usage` value
- **THEN** the rendered segment contains no 5-segment Unicode bar

#### Scenario: No reset indicator is rendered

- **WHEN** the endpoint returns a valid `limits.monthly.usage` value and
  carries no reset timestamp
- **THEN** the rendered segment ends without a day- or hour-based
  indicator and without any leading-word separator

#### Scenario: Zero consumption is rendered as a value

- **WHEN** the endpoint returns `limits.monthly.usage` of `0` and the
  account plan resolves to an included monthly credit of `60`
- **THEN** the segment renders `$0.00` and the segment is displayed rather
  than suppressed

#### Scenario: Malformed payload suppresses the segment

- **WHEN** the endpoint returns a body in which `limits.monthly.usage` is
  absent or is not a finite number
- **THEN** no Ollama Cloud segment is rendered for that refresh cycle

### Requirement: Ollama Cloud credential resolution

The system SHALL resolve the Ollama Cloud credential from the `ollama-cloud`
entry that OpenCode maintains in its data directory's `auth.json` file.
The data directory is resolved through the same XDG rule OpenCode applies at
startup (`$XDG_DATA_HOME/opencode` with `$XDG_DATA_HOME` defaulting to
`~/.local/share`), not via the plugin API (which exposes the state directory
but not the data directory).

The system MUST NOT require an environment variable, a second login step,
or a configuration change to `opencode.jsonc` for the segment to render.

The system MUST NOT write the credential to any log, warning stream, error
message, or rendered label. The credential SHALL be sent only in the
`Authorization` header of the usage request.

When no readable `ollama-cloud` credential is available — the file is
absent, the entry is absent, or the entry carries no usable key — the
system SHALL render the Ollama Cloud login label in place of the
consumption segment, so the operator can distinguish "not authenticated"
from "read failing".

#### Scenario: Credential present renders consumption

- **WHEN** the state directory's `auth.json` contains an `ollama-cloud`
  entry with a usable key
- **THEN** the system issues the usage request with that key and renders
  the consumption segment

#### Scenario: Credential absent renders login label

- **WHEN** the state directory's `auth.json` has no `ollama-cloud` entry,
  or the entry carries no usable key
- **THEN** the footer renders the Ollama Cloud login label and no usage
  request is issued

#### Scenario: Credential is never echoed

- **WHEN** the system emits a diagnostic warning for a failed or
  unauthorized Ollama Cloud read
- **THEN** the emitted text contains the failure reason but never the
  credential value

### Requirement: One warning per failed Ollama Cloud read

For every refresh cycle in which the Ollama Cloud read does not produce a
fresh consumption value, the system SHALL emit exactly one warning through
the plugin's existing `[quota-footer]` diagnostic channel, naming the
failure reason so an operator can diagnose the cause without instrumenting
the plugin.

A transient failure SHALL NOT overwrite a previously cached Ollama Cloud
segment, so a single failed request does not blank a value that was
recently valid.

#### Scenario: Transient failure logs once and preserves the cached value

- **WHEN** a refresh cycle's Ollama Cloud request fails for a non-auth
  reason such as a timeout, a transport error, or a non-success status
- **THEN** exactly one warning naming the reason is emitted and the
  previously cached Ollama Cloud segment remains rendered

#### Scenario: Unauthorized response is not a transient failure

- **WHEN** the endpoint rejects the credential as unauthorized
- **THEN** the footer renders the Ollama Cloud login label and the
  login label is treated as fresh content rather than as a transient
  failure

#### Scenario: Successful read replaces the login label

- **WHEN** a refresh cycle returns valid consumption data after the login
  label has been displayed
- **THEN** the cached login label is replaced by the consumption segment

### Requirement: Included monthly credit resolution by plan

The system SHALL resolve the account plan's included monthly usage credit
from `POST https://ollama.com/api/me` using the same Ollama Cloud credential
the usage request uses, reading the plan identifier from the response's
`Plan` field.

The system SHALL map the plan identifier to the included monthly credit
published on the Ollama pricing page:

- `pro` → `60` US dollars
- `max` → `300` US dollars
- `team` → `1000` US dollars

The system SHALL cache the resolved allowance for the lifetime of the
footer session and MUST NOT re-issue the plan request on every refresh
cycle: a plan change is rare, while the usage request already dominates the
cycle's latency. A cached allowance SHALL be discarded only when the
session ends.

The system MUST NOT treat an unresolvable plan as an error that suppresses
the consumption segment. When the plan request fails, when the plan
identifier is absent, or when it is not in the mapping table — including
when the mapping has gone stale because the published pricing changed — the
system SHALL fall back to rendering the consumed fraction as a percentage,
as the consumption requirement specifies, and SHALL emit at most one
warning through the existing `[quota-footer]` diagnostic channel for that
plan-resolution failure per session.

The plan request MUST NOT cause the Ollama Cloud credential to appear in
any log, warning stream, error message, or rendered label; the credential
SHALL be sent only in the `Authorization` header.

#### Scenario: Known plan resolves its included credit

- **WHEN** the plan request returns `Plan` as `pro`
- **THEN** the system resolves an included monthly credit of `60` and the
  consumption segment renders a dollar amount derived from it

#### Scenario: Every mapped plan resolves its published credit

- **WHEN** the plan request returns `Plan` as `max` and then, in a later
  session, as `team`
- **THEN** the resolved included monthly credits are `300` and `1000`
  respectively, and each session's segment reflects that session's plan

#### Scenario: Unmapped plan falls back without suppressing the segment

- **WHEN** the plan request returns `Plan` as `free`, returns a value the
  mapping does not contain, or omits `Plan` entirely
- **THEN** the consumption segment still renders, using the percentage form
  of the consumed fraction, and the segment is not suppressed

#### Scenario: Plan request failure does not blank a valid segment

- **WHEN** the plan request fails with a timeout, a transport error, or a
  non-success status while the usage request succeeds
- **THEN** the consumption segment renders in the percentage form and at
  most one `[quota-footer]` warning naming the plan-resolution failure is
  emitted for the session

#### Scenario: Allowance is not re-requested every cycle

- **WHEN** the plan has been resolved once in a session and several refresh
  cycles elapse
- **THEN** no further plan request is issued during that session

#### Scenario: Plan request never echoes the credential

- **WHEN** the system emits a diagnostic warning for a failed plan request
- **THEN** the emitted text contains the failure reason but never the
  credential value
