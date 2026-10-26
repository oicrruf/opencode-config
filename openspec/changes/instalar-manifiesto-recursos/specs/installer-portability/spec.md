# Spec Delta

## ADDED Requirements

### Requirement: Installer exposes a non-mutating check mode and an idempotency report

The installer SHALL accept `--check` alongside the existing `--profile`
selection, SHALL document it in `--help`, and SHALL keep the documented
per-shell invocation unchanged. The installer SHALL print a final line stating
whether the configuration was installed or was already current, and the check
mode SHALL report the same state without writing to disk.

#### Scenario: The operator checks the installed state

- **WHEN** the operator runs `bash ./install.sh --check` on a host whose
  installed configuration is in sync
- **THEN** the installer SHALL print that the configuration is in sync and
  SHALL exit zero without creating, modifying, moving, or deleting any file

#### Scenario: The operator checks an out-of-sync host

- **WHEN** the operator runs `bash ./install.sh --check` and the installed
  state does not match the manifest and the selected profile
- **THEN** the installer SHALL print each difference it found and SHALL exit
  non-zero

#### Scenario: The help text documents the check mode

- **WHEN** the operator runs `bash ./install.sh --help`
- **THEN** the help body SHALL list `--check` alongside the profile selection
  and SHALL state that it verifies the installed configuration without
  modifying it

#### Scenario: An unknown argument is still rejected

- **WHEN** the operator runs `bash ./install.sh --unknown`
- **THEN** the installer SHALL exit non-zero with an unknown-argument error
  and SHALL NOT modify the installed configuration
