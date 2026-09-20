## MODIFIED Requirements

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

## ADDED Requirements

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
