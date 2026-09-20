## Purpose

Lets an operator invoke a single command that inspects the host,
detects missing or broken configuration in the OpenCode global
configuration, repairs the safe subset automatically, and reports the
remaining actions that require explicit approval.

## Requirements

### Requirement: Check-only mode is safe to run anytime

The `/doctor` command and `scripts/doctor.mjs` SHALL run in a default
mode that performs no destructive action. The check-only run SHALL
inspect the OS, package manager, configured MCPs, OpenSpec proposals,
symlinks under `~/.config/opencode`, and the validator output, and
SHALL print a single report listing each finding as `ok`, `warn`, or
`fail` with a one-line remediation hint. Exit code SHALL be `0` when
no `fail` is found and non-zero otherwise.

#### Scenario: Operator runs `/doctor` on a fresh machine
- **WHEN** the operator runs `/doctor` with no flags on a host that has
  not installed any of the declared dependencies
- **THEN** the report lists every dependency as `fail` with the
  matching remediation hint, prints no installation output, and exits
  non-zero

#### Scenario: Operator runs `node scripts/doctor.mjs --check-only`
- **WHEN** the script is invoked with `--check-only`
- **THEN** no package manager, `ln`, or `chmod` calls are issued, the
  report is printed to stdout, and the exit code reflects whether any
  `fail` finding was emitted

### Requirement: `--apply-safe` repairs only reversible local actions

When invoked with `--apply-safe`, the doctor SHALL install the missing
`lazygit` and `lazydocker` binaries using the detected package manager
on Linux or macOS, re-create missing symlinks under `~/.config/opencode`
from the canonical paths in the cloned repository, and re-run
`scripts/validate-config.mjs`. Every repair SHALL be idempotent: a
second invocation SHALL NOT re-download, re-link, or re-install.

#### Scenario: Missing `lazygit` is installed
- **WHEN** the operator runs `/doctor --apply-safe` on Linux or macOS
  with `brew` on `PATH` and `lazygit` not present
- **THEN** the doctor invokes `brew install lazygit`, prints the
  package-manager output, marks the `lazygit` finding as `ok` in the
  final report, and exits `0` even if the brew call returned warnings

#### Scenario: Broken symlink under `~/.config/opencode` is repaired
- **WHEN** the doctor detects that `$XDG_CONFIG_HOME/opencode/agents`
  is missing or not a symlink to the clone's `agent/` directory
- **THEN** the doctor re-creates the symlink using the same `link`
  helper shape as `install.sh` (back up non-symlink targets with a
  timestamp suffix first), records the repair in the report, and
  continues inspecting the remaining links

### Requirement: Repairs that touch MCPs, credentials, or OpenSpec proposals require explicit approval

The doctor SHALL NOT enable a disabled MCP, write credentials, modify
permissions, or apply an OpenSpec proposal automatically. When such a
finding is detected, the report SHALL list each action as a
`requires-approval` row that names the file or proposal and the exact
command the operator would run to apply it manually (for example,
`/opsx-apply <change>` or `edit opencode.jsonc`).

#### Scenario: Disabled MCP is surfaced as `requires-approval`
- **WHEN** the doctor finds an MCP in `opencode.jsonc` with
  `enabled: false`
- **THEN** the report prints `requires-approval: enable <mcp>` with the
  file path and the JSON line to edit, and does not modify the file

#### Scenario: OpenSpec change has pending tasks
- **WHEN** `openspec status --json` reports a change with pending
  tasks or an unarchived proposal
- **THEN** the doctor reports the change as `requires-approval: apply`
  with the exact `/opsx-apply <name>` invocation and does not invoke it
  itself

### Requirement: Report is provider-agnostic

The doctor SHALL NOT call `mmx`, Codex, Ollama, or any model CLI as
part of its inspection. All checks SHALL be reproducible from the
local filesystem and the documented CLI tools (`uname`, `command -v`,
`openspec status`, `node scripts/validate-config.mjs`). The agent body
in `agent/doctor.md` MAY call a configured model to interpret the
report, but the script SHALL remain callable without one.

#### Scenario: Operator runs `node scripts/doctor.mjs --check-only` with no model authenticated
- **WHEN** the script runs and no provider in `auth.json` is reachable
- **THEN** the script still emits a complete report and exits with a
  code derived from the findings, and does not retry or block on
  provider availability

### Requirement: `install.sh` advertises `/doctor` instead of installing tools

`install.sh` SHALL keep creating the configuration symlinks as it
does today and SHALL detect the missing `lazygit`, `lazydocker`,
`openspec`, `codegraph`, `serena`, and Nerd Fonts prerequisites. When
one or more are missing, `install.sh` SHALL print a single warning
that names each missing dependency and instructs the operator to run
`/doctor` (or `node scripts/doctor.mjs --apply-safe`) to repair them.
The exit code SHALL remain `0`; the configuration links SHALL still be
created regardless of the missing tools.

#### Scenario: First-run on a clean host
- **WHEN** the operator clones the repository and runs `install.sh`
  on a host without the prerequisites
- **THEN** all symlinks are created, `install.sh` exits `0`, and a
  warning block lists every missing prerequisite with the `/doctor`
  remediation line
