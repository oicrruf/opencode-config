# Spec Delta

## ADDED Requirements

### Requirement: install.sh on Windows defers to the PowerShell font installer

`install.sh` SHALL NOT invoke `scripts/install-nerd-fonts.sh` when the
script is absent or non-executable in the host environment (Windows
Git Bash or WSL Ubuntu driving a Windows `node.exe`). Instead it SHALL
print a non-fatal message pointing the operator at
`scripts/install-nerd-fonts.ps1` as the documented Windows font path.
This rule exists so the bash font installer never blocks the rest of
the install on a host where it cannot succeed.

#### Scenario: install.sh on Windows defers to PowerShell

- **WHEN** `install.sh` runs on a Windows host (Git Bash or WSL
  Ubuntu driving a Windows `node.exe`) and the user has not opted
  out of the font step
- **THEN** the bash font installer SHALL NOT be invoked because
  `scripts/install-nerd-fonts.sh` is either absent or non-executable
  in that environment, and `install.sh` SHALL print a non-fatal
  message pointing the operator at
  `scripts/install-nerd-fonts.ps1` as the documented Windows font
  path
