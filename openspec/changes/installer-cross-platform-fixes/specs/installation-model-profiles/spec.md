## MODIFIED Requirements

### Requirement: Installation selects a named model profile

The system SHALL provide a version-controlled manifest of named model profiles
with `personal` as its default profile. The installer SHALL accept
`./install.sh --profile <name>` and SHALL select `personal` when `--profile`
is omitted. The selected profile SHALL persist in the installed configuration,
so a subsequent ordinary `opencode` invocation SHALL require neither a profile
argument nor model environment variables. The cross-platform behaviour of the
installer — the four supported shells, the path-translation rules, and the
node-binary resolution — SHALL be governed by the `installer-portability`
spec.

#### Scenario: Default installation uses personal

- **WHEN** the user runs `./install.sh` without a profile argument
- **THEN** the installer SHALL install the `personal` model assignment

#### Scenario: Work profile is selected at installation

- **WHEN** the user runs `./install.sh --profile work`
- **THEN** the installer SHALL install the models declared for `work` and report that profile as active

#### Scenario: An unknown profile is rejected

- **WHEN** the user supplies a profile name absent from the manifest
- **THEN** the installer SHALL exit non-zero before changing OpenCode configuration and name the invalid profile

#### Scenario: Installation succeeds on every supported shell

- **WHEN** the operator runs `./install.sh --profile <name>` on any of
  the four shells documented by the `installer-portability` spec
  (native Linux bash, native macOS bash, WSL Ubuntu bash, Git Bash on
  Windows)
- **THEN** the installer SHALL reach `OpenCode configuration linked from <path>`
  end to end and SHALL NOT require any operator workaround

## ADDED Requirements

### Requirement: Installation cross-platform behaviour is delegated

The system SHALL NOT duplicate the cross-platform installer contract
inside this capability. The four supported shells, the
path-translation rules, the `node` binary resolution, the
`.gitattributes` and check #9 line-ending contract, and the help-body
platform report SHALL be defined exclusively by the
`installer-portability` capability.

#### Scenario: Cross-platform rules are not duplicated here

- **WHEN** the operator or a future OpenSpec change references the
  cross-platform behaviour of `install.sh`
- **THEN** the `installer-portability` spec SHALL be the source of
  truth, and this capability SHALL contain only the model-profile
  rules that are unique to it

### Requirement: Installed configuration is generated safely

The installer SHALL validate a selected profile before replacing the installed
OpenCode configuration. It SHALL write a valid generated configuration that
contains the selected model assignments and preserves the existing linked
agents, commands, skills, plugins, and TUI configuration. If generation or
validation fails, the installer SHALL not replace a previously working
installed root configuration. The cross-platform rules that govern the
installer shell, path handling, and `node` binary resolution are owned by
the `installer-portability` spec and are NOT duplicated here.

#### Scenario: Valid profile is materialized

- **WHEN** profile validation succeeds
- **THEN** the installer SHALL create the installed root configuration with that profile's models and complete the existing link installation

#### Scenario: Generation fails

- **WHEN** the selected profile cannot be rendered into a valid OpenCode configuration
- **THEN** the installer SHALL exit non-zero and retain the previously installed root configuration
