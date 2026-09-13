## ADDED Requirements

### Requirement: Plan badge after codex label

The system SHALL append a single Nerd Font `nf-md-` icon to the codex
label, chosen from the response field `planType`:

- `self_serve_business_usage_based` (and any other value starting with
  `self_serve_business`) → briefcase icon `󰃖`
- `free`, `plus`, `pro`, `team` → account icon `󰀄`
- any other value, missing field, or non-string → no badge (label
  rendered without suffix)

The badge MUST be separated from the percentage by exactly two spaces,
matching the spacing already used between the codex bar and any
primary/secondary bar. The badge MUST NOT be colored; it inherits the
same `textMuted` foreground the rest of the label uses.

#### Scenario: Business plan shows briefcase

- **WHEN** `readCodex` returns a label string and the response's root
  `planType` is `self_serve_business_usage_based`
- **THEN** the rendered codex label ends with two spaces followed by
  `󰃖` after the percentage

#### Scenario: Personal plan shows account icon

- **WHEN** `readCodex` returns a label string and `planType` is one of
  `free`, `plus`, `pro`, `team`
- **THEN** the rendered codex label ends with two spaces followed by
  `󰀄` after the percentage

#### Scenario: Unknown plan renders no badge

- **WHEN** `readCodex` returns a label string and `planType` is
  missing, an empty string, or a value not in the mapping table
- **THEN** the rendered codex label ends exactly at the percentage, with
  no trailing whitespace or icon

#### Scenario: Badge does not appear when there is no codex label

- **WHEN** `readCodex` returns `undefined` or `null` (no codex data for
  this cycle, including ENOENT or sustained-failure sentinel cases)
- **THEN** no badge is rendered at all; the helper output is never
  appended to a non-codex label

### Requirement: Reset date indicator after codex label

When the response carries `rateLimits.individualLimit.resetsAt` as a
finite positive number (Unix seconds), the system SHALL append a reset
indicator to the codex label, decomposed into days, hours, and minutes
from the distance between `resetsAt` and `Date.now() / 1000`:

- Days: integer `floor(diffSeconds / 86400)`
- Hours: integer `floor(diffSeconds % 86400 / 3600)`
- Minutes: integer `floor(diffSeconds % 3600 / 60)`

The system MUST omit any component whose value is zero and MUST NOT
render a leading zero. The label format rules are:

- days > 0 AND (hours > 0 OR minutes > 0) → ` reset {d}d · {h}h {m}m`
- days > 0 AND hours = 0 AND minutes = 0 → ` reset {d}d`
- days = 0 AND hours > 0 AND minutes > 0 → ` reset {h}h {m}m`
- days = 0 AND hours > 0 AND minutes = 0 → ` reset {h}h`
- days = 0 AND hours = 0 AND minutes > 0 → ` reset {m}m`
- all three zero → empty (no indicator appended)

The `·` (U+00B7 middle dot) appears ONLY between the days component
and a sub-day component. Within hours and minutes, a single space is
used; no `·` ever appears there.

The indicator MUST be preceded by exactly one space and MUST NOT be
colored. When `resetsAt` is missing, null, zero, negative, or not a
finite number, no indicator is appended. When the computed distance is
zero or negative (clock-skew window), no indicator is appended.

#### Scenario: Reset more than one week shows days only

- **WHEN** `resetsAt` is more than 7 days from now and the hours and
  minutes components both compute to zero
- **THEN** the codex label ends with ` reset {d}d` where `{d}` is the
  integer day count, with no sub-day suffix and no `·`

#### Scenario: Reset between one day and one week decomposes with middle dot

- **WHEN** `resetsAt` is between 24 hours and 7 days from now and at
  least one of hours or minutes computes to a non-zero value
- **THEN** the codex label ends with ` reset {d}d · {h}h {m}m` where
  every non-zero component is present and the `·` separates days from
  hours

#### Scenario: Reset under one day shows hours and minutes

- **WHEN** `resetsAt` is between 1 minute and 24 hours from now
- **THEN** the codex label ends with ` reset {h}h {m}m` when both are
  non-zero, ` reset {h}h` when only hours are non-zero, or ` reset {m}m`
  when only minutes are non-zero — never with a days component

#### Scenario: Reset under one minute renders no indicator

- **WHEN** `resetsAt` is less than 60 seconds from now or already in
  the past
- **THEN** no reset indicator is appended; the codex label ends exactly
  at the percentage (or badge if one is present)

#### Scenario: Reset field missing renders no indicator

- **WHEN** `resetsAt` is missing, null, zero, negative, or not a
  finite number
- **THEN** no reset indicator is appended; the codex label ends exactly
  at the percentage (or badge if one is present)
