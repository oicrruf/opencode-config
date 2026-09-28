## ADDED Requirements

### Requirement: Detect MiniMax CLI login requirement

The system SHALL detect when the `mmx` CLI requires authentication and
surface a clear, recoverable label in place of the silent failure that
the pre-change behavior produces. The detection reuses the same
keyword table the codex auth-required path consumes.

#### Scenario: MiniMax login label is shown when the CLI is not authenticated

- **WHEN** `readMmx()` invokes `mmx quota show --output json --quiet`
  and the process exits non-zero with an error message (on stderr or
  in the thrown `Error.message`) whose lowercased text contains any of
  the patterns the codex auth-required detector also matches (e.g.,
  `authentication required`, `not authenticated`, `login required`,
  `unauthorized`, `token expired`, `session expired`)
- **THEN** `readMmx()` returns the fresh label string
  `󰧑 MiniMax requiere login` so the footer replaces the cached
  MiniMax segment for that refresh cycle

#### Scenario: MiniMax login label does not appear for unrelated failures

- **WHEN** `readMmx()` catches an error whose message does NOT match
  any auth-required pattern (e.g., `mmx timed out`, a malformed-JSON
  parse error from `JSON.parse`, or any other non-zero exit whose
  stderr does not mention authentication)
- **THEN** `readMmx()` returns `undefined` (silent empty segment), as
  before; the auth-required label is never shown for these cases

#### Scenario: ENOENT for mmx keeps the existing empty-segment behavior

- **WHEN** the `run()` helper throws an error whose message includes
  `ENOENT` (the `mmx` binary is not on `PATH`)
- **THEN** `readMmx()` returns `null` (the existing ENOENT sentinel)
  and emits exactly one `[quota-footer]` warning; the auth-required
  path is not taken because ENOENT is checked before
  auth-required detection

#### Scenario: Successful MiniMax read clears the login label

- **WHEN** `readMmx()` returns a fresh MiniMax quota label string
  after the auth-required label has been displayed in the previous
  refresh cycle
- **THEN** the cached MiniMax segment in `FooterState.minimax` is
  replaced by the new label, and the auth-required label is no
  longer visible

#### Scenario: Plugin documents the two CLI login prerequisites

- **WHEN** an operator reads the top of `quota-tui.tsx` for the
  first time (e.g., to debug a missing quota bar)
- **THEN** the file's leading comment block states explicitly that
  the `codex` and `mmx` CLIs must each be logged in for their
  respective bars to render, names the recovery commands
  (`codex login`, `mmx login`), and enumerates the four footer
  states the user can see (data, codex login, mmx login, codex
  sustained-failure sentinel)

### Requirement: Codex auth-required label uses the short `login` form

The codex auth-required label SHALL render as `󰚩 Codex · login` so it
visually balances the longer MiniMax login label and removes the
non-English verb form that the prior widening introduced.

#### Scenario: Codex auth-required renders the shortened label

- **WHEN** `readCodex()` resolves to the auth-required string after
  the change is applied
- **THEN** the codex segment of the footer shows exactly `󰚩 Codex · login`
  with no trailing whitespace

#### Scenario: Codex data path is unaffected

- **WHEN** `readCodex()` returns a fresh data label (any non-empty
  percentage bar with reset indicator or plan badge)
- **THEN** the codex segment renders as before; the new requirement
  only governs the auth-required branch