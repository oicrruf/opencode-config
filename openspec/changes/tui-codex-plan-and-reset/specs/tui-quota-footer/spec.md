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
indicator to the codex label, formatted from the distance between
`resetsAt` and `Date.now() / 1000`:

- distance `< 24 * 60 * 60` seconds → `reset en Xh` where `X` is the
  integer number of hours remaining (rounded)
- distance `< 7 * 24 * 60 * 60` seconds → `reset en X d` where `X` is
  the integer number of days remaining
- otherwise → `reset MMM D` with month abbreviated to three letters in
  English (`Jan`, `Feb`, `Mar`, `Apr`, `May`, `Jun`, `Jul`, `Aug`,
  `Sep`, `Oct`, `Nov`, `Dec`) and day as an ordinal-free integer

The indicator MUST be preceded by one space and MUST NOT be colored.
When `resetsAt` is missing, null, or non-positive, no indicator is
appended.

#### Scenario: Reset under 24 hours shows hours

- **WHEN** the response carries `resetsAt` whose value is less than
  24 hours from now
- **THEN** the codex label ends with ` reset en Xh` where `X` is the
  rounded number of hours remaining

#### Scenario: Reset under one week shows days

- **WHEN** `resetsAt` is between 24 hours and 7 days from now
- **THEN** the codex label ends with ` reset en X d` where `X` is the
  integer number of days remaining

#### Scenario: Reset beyond one week shows absolute date

- **WHEN** `resetsAt` is more than 7 days from now
- **THEN** the codex label ends with ` reset MMM D` using English
  three-letter month abbreviation and integer day

#### Scenario: Reset field missing renders no indicator

- **WHEN** `resetsAt` is missing, null, zero, negative, or not a
  finite number
- **THEN** the codex label ends exactly at the percentage (or badge if
  one is present), with no trailing whitespace
