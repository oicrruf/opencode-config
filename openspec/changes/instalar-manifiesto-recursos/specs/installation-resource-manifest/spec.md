# Spec Delta

## Purpose

Define how the global OpenCode configuration records, verifies, and protects
the resources this repository installs, so an install never silently replaces
an operator-owned file and an operator can always tell whether the installed
state is current.

## ADDED Requirements

### Requirement: Installed resources are recorded in a manifest

The system SHALL maintain a manifest inside the global configuration directory
that records, for every resource this repository installs, an identifier, the
install kind, the target path, and the source path or content digest it
represents. The manifest SHALL record the selected profile and the digest of
the rendered root configuration.

#### Scenario: The first install writes the manifest

- **WHEN** the operator runs `bash ./install.sh --profile personal` on a host
  with no previous manifest
- **THEN** the installer SHALL create the manifest with one entry per linked
  resource, the selected profile, and the digest of the rendered root
  configuration

#### Scenario: A later install updates the manifest

- **WHEN** the operator runs the installer again after this repository changed
  its linked resources
- **THEN** the installer SHALL rewrite the manifest so it describes the
  currently installed state, and SHALL write it atomically so an interrupted
  run never leaves a partially written manifest

#### Scenario: The manifest identifies every managed target

- **WHEN** the operator inspects the manifest
- **THEN** it SHALL list every global path the installer links, the source
  path each one points at, and the kind of each entry, and it SHALL NOT list
  any path the installer does not manage

### Requirement: Foreign resources are reported instead of replaced

The system SHALL determine ownership of a global path by comparing it with
the manifest. A path that the manifest does not claim and that is not a link
to a source this repository ships SHALL be reported as a conflict. The system
SHALL NOT replace, move, or delete a conflicting path.

#### Scenario: The operator owns a global skill directory

- **WHEN** `~/.config/opencode/skills` exists as a real directory that the
  manifest does not claim
- **THEN** the installer SHALL report it as a conflict, SHALL NOT replace it,
  and SHALL continue with the remaining managed resources

#### Scenario: A managed target points somewhere else

- **WHEN** a path the manifest claims is a symlink that resolves outside this
  repository
- **THEN** the installer SHALL report it as a conflict and SHALL NOT
  overwrite the link target

#### Scenario: A conflict does not abort the remaining install

- **WHEN** one resource conflicts and the others are in sync
- **THEN** the installer SHALL complete the link and configuration steps for
  the non-conflicting resources and SHALL report the conflict in its final
  summary

### Requirement: Stale managed resources are removed only when they are unchanged

The system SHALL remove a resource recorded in the manifest that this
repository no longer ships, and SHALL remove it only when the path still holds
the exact artifact a previous install created. When that cannot be verified,
the system SHALL keep the resource and report it.

#### Scenario: A linked skill is retired from this repository

- **WHEN** the manifest records a linked skill that this repository no longer
  contains and the global path is still the link a previous install created
- **THEN** the installer SHALL remove that link and SHALL record the removal
  in the rewritten manifest

#### Scenario: The operator replaced a stale link

- **WHEN** a path the manifest records as retired no longer holds the
  artifact a previous install created
- **THEN** the installer SHALL keep the path, SHALL NOT delete it, and SHALL
  report it as retained instead of removed

### Requirement: The manifest is validated before it is trusted

The system SHALL validate the manifest before using it. It SHALL be a JSON
object of a supported version, its entries SHALL carry the required fields,
its identifiers SHALL be unique and safe, and its target paths SHALL resolve
inside the global configuration directory. A manifest that fails validation
SHALL stop the install with a clear error.

#### Scenario: The manifest is corrupted

- **WHEN** the manifest file exists but is not valid JSON, or is not an
  object, or declares an unsupported version
- **THEN** the installer SHALL stop with an error naming the manifest and
  SHALL NOT fall back to treating the global configuration as unmanaged

#### Scenario: A manifest entry escapes the configuration directory

- **WHEN** a manifest entry names a target path that resolves outside the
  global configuration directory, or contains a `..` segment
- **THEN** the installer SHALL stop with an error naming the offending entry
  and SHALL NOT touch that path

#### Scenario: A manifest path crosses an unsafe symlink

- **WHEN** a manifest entry's parent directory inside the global
  configuration is a symbolic link
- **THEN** the installer SHALL stop with an error and SHALL NOT write through
  that link

### Requirement: Installation is idempotent and reports the current state

The system SHALL compare the installed state with the manifest before mutating
anything. When every managed resource is present, points at the expected
source, and the rendered root configuration matches the selected profile, the
install SHALL report that the configuration is already current and SHALL NOT
rewrite it. Otherwise the install SHALL apply only the differences.

#### Scenario: A repeated install finds nothing to change

- **WHEN** the operator runs the installer again with the same profile and no
  repository change
- **THEN** the installer SHALL report that the configuration is already
  current and SHALL leave the rendered root configuration unmodified, keeping
  its previous modification time

#### Scenario: A managed link was replaced by the operator

- **WHEN** a path the manifest claims is missing or no longer points at the
  expected source
- **THEN** the installer SHALL restore that link and SHALL report it as
  repaired

#### Scenario: The selected profile changed

- **WHEN** the operator runs the installer with a different profile than the
  one recorded in the manifest
- **THEN** the installer SHALL re-render the root configuration for the new
  profile, SHALL record the new profile and digest in the manifest, and SHALL
  report the change

### Requirement: Check mode verifies the installed state without mutating it

The system SHALL provide a check mode that compares the installed state with
the manifest and the selected profile, prints the differences it finds, and
exits zero when the configuration is in sync and non-zero otherwise. The check
mode SHALL NOT create, modify, move, or delete any file.

#### Scenario: The check runs against a synchronized host

- **WHEN** the operator runs the check mode on a host whose installed state
  matches the manifest and the selected profile
- **THEN** the check SHALL print that the configuration is in sync and SHALL
  exit zero

#### Scenario: The check runs against an unsynchronized host

- **WHEN** the check mode finds a missing managed resource, a changed source,
  or a root configuration that does not match the selected profile
- **THEN** it SHALL print each difference it found and SHALL exit non-zero

#### Scenario: The check leaves the configuration untouched

- **WHEN** the check mode runs on a host with differences
- **THEN** no file under the global configuration directory SHALL be created,
  modified, moved, or deleted by that run
