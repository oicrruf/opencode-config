## ADDED Requirements

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
