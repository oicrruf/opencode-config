# Spec Delta

## ADDED Requirements

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
