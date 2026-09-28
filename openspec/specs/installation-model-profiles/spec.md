# installation-model-profiles Specification

## Purpose

Define persistent, installation-selected model profiles for OpenCode so each
machine can use an approved model assignment without runtime setup.

## Requirements

### Requirement: Installation selects a named model profile
The system SHALL provide a version-controlled manifest of named model profiles
with `personal` as its default profile. The installer SHALL accept
`./install.sh --profile <name>` and SHALL select `personal` when `--profile`
is omitted. The selected profile SHALL persist in the installed configuration,
so a subsequent ordinary `opencode` invocation SHALL require neither a profile
argument nor model environment variables.

#### Scenario: Default installation uses personal
- **WHEN** the user runs `./install.sh` without a profile argument
- **THEN** the installer SHALL install the `personal` model assignment

#### Scenario: Work profile is selected at installation
- **WHEN** the user runs `./install.sh --profile work`
- **THEN** the installer SHALL install the models declared for `work` and report that profile as active

#### Scenario: An unknown profile is rejected
- **WHEN** the user supplies a profile name absent from the manifest
- **THEN** the installer SHALL exit non-zero before changing OpenCode configuration and name the invalid profile

### Requirement: Personal profile preserves the existing assignment
The `personal` profile SHALL assign the model IDs currently used by the
repository for the root default, `small_model`, every global agent, and every
command with a model override. Installing `personal` SHALL preserve the
effective model assignment of the pre-profile configuration.

#### Scenario: Personal profile matches the baseline
- **WHEN** the generated configuration is produced for `personal`
- **THEN** its root, agent, and command model assignments SHALL equal the documented current baseline

### Requirement: Profile assignment is complete and centralized
The manifest SHALL be the single source of model assignments for the root
configuration, global agents, and commands that override an agent model.
Agent and command templates SHALL retain their prompts, permissions, steps, and
other behavior independently of profile selection. Every selected profile SHALL
provide a valid assignment for each configured model consumer.

#### Scenario: A profile changes only model selection
- **WHEN** two valid profiles are installed
- **THEN** their generated configurations MAY differ in model assignments but SHALL preserve the same non-model agent and command behavior

#### Scenario: A profile has incomplete coverage
- **WHEN** a selected profile omits a required model consumer
- **THEN** installation validation SHALL fail before configuration is linked or generated

### Requirement: Installed configuration is generated safely
The installer SHALL validate a selected profile before replacing the installed
OpenCode configuration. It SHALL write a valid generated configuration that
contains the selected model assignments and preserves the existing linked
agents, commands, skills, plugins, and TUI configuration. If generation or
validation fails, the installer SHALL not replace a previously working
installed root configuration.

#### Scenario: Valid profile is materialized
- **WHEN** profile validation succeeds
- **THEN** the installer SHALL create the installed root configuration with that profile's models and complete the existing link installation

#### Scenario: Generation fails
- **WHEN** the selected profile cannot be rendered into a valid OpenCode configuration
- **THEN** the installer SHALL exit non-zero and retain the previously installed root configuration

### Requirement: Profile use is documented
The repository SHALL document the available default profile, installation-time
selection syntax, and the process for proposing durable profile changes. The
documentation SHALL state that profile selection is an installation concern,
not an argument required to launch OpenCode.

#### Scenario: User follows documented default installation
- **WHEN** the user follows the repository installation instructions without selecting a profile
- **THEN** the instructions SHALL state that `personal` is installed and OpenCode can be started normally afterward

### Requirement: Cross-platform installer behaviour is delegated to installer-portability

The system SHALL NOT duplicate the cross-platform installer contract
inside this capability. The four supported shells, the
path-translation rules, the `node` binary resolution, the
`.gitattributes` and check #9 line-ending contract, and the help-body
platform report SHALL be defined exclusively by the
`installer-portability` capability. Any future change to those rules
SHALL land in `installer-portability/spec.md`, not here.

#### Scenario: Cross-platform rules live in installer-portability

- **WHEN** the operator or a future OpenSpec change references the
  cross-platform behaviour of `install.sh`
- **THEN** the `installer-portability` spec SHALL be the source of
  truth, and this capability SHALL contain only the model-profile
  rules that are unique to it

### Requirement: Installer succeeds on every supported shell

The system SHALL reach `OpenCode configuration linked from <path>`
end to end on every shell documented by the `installer-portability`
spec (native Linux bash, native macOS bash, WSL Ubuntu bash, Git Bash
on Windows) without operator workarounds.

#### Scenario: Installation succeeds on every supported shell

- **WHEN** the operator runs `./install.sh --profile <name>` on any of
  the four shells documented by the `installer-portability` spec
- **THEN** the installer SHALL reach `OpenCode configuration linked from <path>`
  end to end and SHALL NOT require any operator workaround
