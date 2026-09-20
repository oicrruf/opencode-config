## ADDED Requirements

### Requirement: Display Ollama Cloud monthly consumption

The system SHALL render an Ollama Cloud segment in the footer derived from
`GET https://ollama.com/api/usage`, reporting the consumed amount for the
current month taken from `limits.monthly.usage` and the summed
`request_count` across every entry in `limits.monthly.models`.

The segment SHALL render the consumed amount as US dollars formatted to two
decimal places (for example, `limits.monthly.usage` of `0.029` renders as
`$0.03`) and SHALL render the request total as a plain integer count. The
segment SHALL be prefixed with a single Nerd Font `nf-md-assistant` icon
(`󰁤`) and a `Ollama` label, matching the icon-plus-provider-name shape the
codex and MiniMax segments use.

The segment MUST NOT render a percentage bar and MUST NOT render a reset
indicator. The endpoint exposes neither a plan credit cap nor a reset
timestamp, so a remaining-percentage or a countdown would be fabricated
rather than observed.

When `limits.monthly.usage` is missing or is not a finite number, or when
`limits.monthly.models` is absent, the segment SHALL NOT be rendered for
that refresh cycle and the failure-handling requirement below applies.

#### Scenario: Consumption and request count are rendered

- **WHEN** the endpoint returns `limits.monthly.usage` as the number
  `0.029` and `limits.monthly.models` contains entries whose
  `request_count` values sum to `113`
- **THEN** the footer shows the Ollama Cloud segment containing `$0.03`
  and `113` alongside the `nf-md-assistant` icon (`󰁤`) and the `Ollama`
  label

#### Scenario: No percentage bar is rendered

- **WHEN** the endpoint returns a valid `limits.monthly.usage` value
- **THEN** the rendered segment contains no 5-segment Unicode bar and no
  `%` character

#### Scenario: No reset indicator is rendered

- **WHEN** the endpoint returns a valid `limits.monthly.usage` value and
  carries no reset timestamp
- **THEN** the rendered segment ends without a day- or hour-based
  indicator and without any leading-word separator

#### Scenario: Zero consumption is rendered as a value

- **WHEN** the endpoint returns `limits.monthly.usage` of `0`
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
