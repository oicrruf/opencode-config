# Spec Delta

## MODIFIED Requirements

### Requirement: Check-only mode is safe to run anytime

The `/doctor` command and `scripts/doctor.mjs` SHALL run in a default
mode that creates, modifies, moves, or deletes no files. The check-only
run SHALL inspect the OS, package manager, configured MCPs, OpenSpec
proposals, installed resources under the effective OpenCode configuration
directory, and the validator output. It SHALL use the same resource
inventory and ownership rules as the installer and SHALL print a report
listing each finding as `ok`, `warn`, `fail`, or `requires-approval` with
a one-line remediation hint. Exit code SHALL be `0` when no `fail` is
found and non-zero otherwise. The report SHALL distinguish distribution
from runtime loading and SHALL NOT infer runtime success from file presence.

#### Scenario: Operator runs `/doctor` on a fresh machine
- **WHEN** the operator runs `/doctor` with no flags on a host that has
  not installed any of the declared dependencies
- **THEN** the report lists every dependency as `fail` with the matching
  remediation hint, prints no installation output, and exits non-zero

#### Scenario: Operator runs `node scripts/doctor.mjs --check-only`
- **WHEN** the script is invoked with `--check-only`
- **THEN** no package manager, `ln`, or `chmod` calls are issued, no files
  including temporaries or backups are created, the report is printed to
  stdout, and the exit code reflects whether any `fail` finding was emitted

#### Scenario: Rendered root is valid
- **WHEN** the installed root is a regular file matching the recorded
  digest and the expected rendering of the selected profile
- **THEN** doctor SHALL report it as a valid rendered resource and SHALL NOT
  report a missing symlink or propose converting the root into a symlink

#### Scenario: Root drift or competing configuration files
- **WHEN** the root differs from its recorded digest or the effective
  configuration has competing root files whose precedence is not verified
- **THEN** doctor SHALL report the drift or ambiguity without modifying
  either file or declaring the installed configuration current

#### Scenario: Missing plugin or incorrect link origin
- **WHEN** an expected plugin entrypoint is absent or a managed link no
  longer points at its recorded origin
- **THEN** doctor SHALL identify the affected path and reason, distinguish
  an absence from a modified resource, and SHALL NOT declare runtime loading
  verified based on a different file or an import-only check

### Requirement: `--apply-safe` repairs only reversible local actions

When invoked with `--apply-safe`, the doctor SHALL retain the existing
installation of missing `lazygit` and `lazydocker` binaries using the detected
package manager on Linux or macOS and SHALL re-run
`scripts/validate-config.mjs`. Resource repair SHALL use the installer's
shared inventory, validated ownership record, and preflight conflict rules.
It SHALL recreate only absent resources whose ownership is established and
whose recreation has no conflict. A rendered root SHALL remain a regular
file produced by the selected profile. The doctor SHALL NOT move, replace,
or delete a foreign resource, a modified root, a modified link, or an
existing directory merely to restore an expected location. Every repair
SHALL be idempotent: a second invocation SHALL NOT re-download, re-link,
re-render, or re-install an unchanged resource. Dependency installation
SHALL NOT be expanded beyond its existing contract by this change.

#### Scenario: Missing `lazygit` is installed
- **WHEN** the operator runs `/doctor --apply-safe` on Linux or macOS
  with `brew` on `PATH` and `lazygit` not present
- **THEN** the doctor invokes `brew install lazygit`, prints the
  package-manager output, marks the `lazygit` finding as `ok` in the
  final report, and exits `0` if no other failure exists even if the brew
  call returned warnings

#### Scenario: Broken symlink under `~/.config/opencode` is repaired
- **WHEN** the agents path under the effective configuration directory
  is absent, its validated ownership record identifies the clone's
  agent directory, and preflight finds no resource conflict
- **THEN** doctor SHALL recreate only that link through the shared resource
  rules, record the repair, and leave unrelated resources unchanged

#### Scenario: Operator replaced a managed link or directory
- **WHEN** a recorded target is now a different symlink, regular file,
  directory, or another resource whose ownership cannot be established
- **THEN** doctor SHALL preserve it and its target, report the conflict,
  and SHALL NOT rename it to a backup or overwrite it as a safe repair

#### Scenario: Rendered root is missing
- **WHEN** the regular root is absent, its validated ownership record and
  selected profile are available, and preflight finds no conflict
- **THEN** doctor SHALL recreate it through the shared renderer and
  installation rules as a regular file and record its digest

#### Scenario: Rendered root was modified
- **WHEN** an existing root no longer matches its recorded identity
- **THEN** doctor SHALL preserve it and report the conflict without
  overwriting it or replacing it with a symlink

#### Scenario: Herdr resource is foreign
- **WHEN** the expected Herdr location contains an unowned or modified
  resource
- **THEN** doctor SHALL preserve it and report the conflict without
  taking over the externally managed integration

#### Scenario: Manifest is missing or unsafe
- **WHEN** doctor cannot establish ownership because the manifest is
  absent, malformed, unsupported, or uses an unsafe path
- **THEN** resource repair SHALL remain blocked with a diagnostic directing
  the operator to the installation or reconciliation procedure; doctor SHALL
  NOT infer ownership from a filename or silently bootstrap it

#### Scenario: Dry-run does not perform repairs
- **WHEN** doctor is invoked with `--apply-safe --dry-run`
- **THEN** it SHALL describe proposed actions without invoking a package
  manager or creating, modifying, moving, or deleting files
