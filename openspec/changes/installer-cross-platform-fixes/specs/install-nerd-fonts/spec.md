## MODIFIED Requirements

### Requirement: Cross-platform font installation entrypoint

The system SHALL provide a way for `install.sh` to install
JetBrainsMono Nerd Font on Linux, macOS and Windows, choosing the right
installer per operating system without requiring elevated privileges.
The supported POSIX shells and the path-translation behaviour that
selects between `install-nerd-fonts.sh` and `install-nerd-fonts.ps1`
SHALL be governed by the `installer-portability` spec.

#### Scenario: Linux user runs the bundled installer

- **WHEN** `install.sh` runs on a Linux host and the user has not
  opted out of the font step
- **THEN** JetBrainsMono Nerd Font ends up under
  `~/.local/share/fonts/JetBrainsMonoNerdFont` (or an equivalent
  user-scope directory) and `fc-cache` reports the new family as
  available

#### Scenario: macOS user runs the bundled installer

- **WHEN** `install.sh` runs on macOS and the user has not opted out
  of the font step
- **THEN** JetBrainsMono Nerd Font files end up under
  `~/Library/Fonts` and the system Font Book can enumerate them

#### Scenario: Windows user runs the native PowerShell installer

- **WHEN** the user runs `scripts/install-nerd-fonts.ps1` on Windows
  10+ with PowerShell 5.1 or later
- **THEN** JetBrainsMono Nerd Font files end up under
  `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (the per-user fonts
  directory) without requiring administrator rights

#### Scenario: install.sh on Windows defers to the PowerShell font installer

- **WHEN** `install.sh` runs on a Windows host (Git Bash or WSL
  Ubuntu driving a Windows `node.exe`) and the user has not opted
  out of the font step
- **THEN** the bash font installer SHALL NOT be invoked because
  `scripts/install-nerd-fonts.sh` is either absent or non-executable
  in that environment, and `install.sh` SHALL print a non-fatal
  message pointing the operator at
  `scripts/install-nerd-fonts.ps1` as the documented Windows font
  path
