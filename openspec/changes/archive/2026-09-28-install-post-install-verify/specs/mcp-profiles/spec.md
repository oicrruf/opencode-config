## ADDED Requirements

### Requirement: Successful install implies every required gate passed

The `install.sh` script SHALL run, immediately after the symlink
phase, a post-install verification block that exercises the project's
required gates. When `./install.sh` returns zero, every required gate
SHALL have passed against the just-installed configuration. When any
required gate fails, `install.sh` SHALL return non-zero and SHALL
print the failing gate's name and a remediation hint.

#### Scenario: Clean install

- **WHEN** the operator runs `./install.sh` from a healthy checkout
  with no opt-out env vars set
- **THEN** the script exits zero, prints a "X/Y gates passed"
  summary, and the installed `~/.config/opencode` is unchanged by any
  subsequent gate failure

#### Scenario: A required gate fails

- **WHEN** the static `acceptance-harness.mjs` reports any failure
- **THEN** `install.sh` SHALL exit non-zero, name the failing gate,
  and leave the previously installed config (if any) intact

### Requirement: Each gate is independently opt-out

The post-install block SHALL honor `OPENCODE_SKIP_ACCEPTANCE`,
`OPENCODE_SKIP_PROFILE_TESTS`, `OPENCODE_SKIP_JEV_CLIENT_TESTS`, and
`OPENCODE_SKIP_OPENSPEC_VALIDATE` so the operator can run a partial
install. A skipped gate SHALL be printed in the summary, counted as
"skipped" instead of "passed", and SHALL NOT cause a non-zero exit.

#### Scenario: Skip the runtime acceptance harness

- **WHEN** `OPENCODE_SKIP_ACCEPTANCE=1 ./install.sh` runs on a
  checkout where the static harness would fail
- **THEN** the script exits zero, prints `acceptance-harness:
  skipped`, and does not run that gate

### Requirement: Summary line is the last line on success

`install.sh` SHALL print, on success, a single trailing line of the
form `install.sh: OK — <passed>/<required> gates passed (<skipped>
skipped)` so the operator can grep for it in CI logs.

#### Scenario: CI consumes the summary

- **WHEN** CI runs `./install.sh` and captures stdout
- **THEN** the last line matches the documented `OK — ...` format
  when the install is healthy, and is absent (or replaced with an
  error line) when the install fails
