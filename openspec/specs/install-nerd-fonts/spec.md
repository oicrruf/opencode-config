# install-nerd-fonts Specification

## Purpose

Lets the OpenCode configuration installer detect, download and register
JetBrainsMono Nerd Font on Linux, macOS and Windows so the TUI quota
footer and any other Nerd Font icon surface renders correctly out of
the box.

## Requirements

### Requirement: Cross-platform font installation entrypoint

The system SHALL provide a way for `install.sh` to install
JetBrainsMono Nerd Font on Linux, macOS and Windows, choosing the right
installer per operating system without requiring elevated privileges.

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

### Requirement: Idempotent re-runs

Re-running the font installer SHALL NOT download or copy fonts when a
complete JetBrainsMono Nerd Font installation is already present in the
target directory, and SHALL be safe to invoke repeatedly.

#### Scenario: Already installed on Linux

- **WHEN** the Linux installer detects the expected JetBrainsMono
  Nerd Font files already in the target directory
- **THEN** it exits successfully without contacting GitHub and without
  overwriting existing files

#### Scenario: Already installed on Windows

- **WHEN** the PowerShell installer detects the expected JetBrainsMono
  Nerd Font files already in `%LOCALAPPDATA%\Microsoft\Windows\Fonts`
- **THEN** it exits successfully without contacting GitHub and
  without overwriting existing files

### Requirement: Latest official release as the source

The installer SHALL download JetBrainsMono Nerd Font from the official
`ryanoasis/nerd-fonts` GitHub release marked "latest", resolving the
release URL from the GitHub API. The installer MUST NOT pull from a
fork or mirror and MUST NOT embed a base64 font payload.

#### Scenario: Resolving the latest release

- **WHEN** the installer needs to know which release to download
- **THEN** it queries the GitHub API
  `https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest`
  and uses the `tag_name`, `zipball_url` and asset URLs returned in
  that response

#### Scenario: Network failure during release resolution

- **WHEN** the GitHub API call fails (DNS, HTTP error, rate-limit,
  timeout) or returns a non-2xx response
- **THEN** the installer exits with a non-zero status and a message
  naming the step that failed, the URL it tried, and the remediation
  hint `re-run with --offline once you have the archive locally` when
  the user explicitly opted in to offline mode

### Requirement: Non-fatal failure when font install cannot complete

The font step SHALL be non-blocking for the rest of `install.sh`: a
failure to install JetBrainsMono Nerd Font MUST NOT prevent the OpenCode
configuration links from being created. The installer SHALL print a
warning naming the cause and the steps the user can run manually.

#### Scenario: Curl missing on a Linux host

- **WHEN** the Linux installer is invoked and neither `curl` nor
  `wget` is on `PATH`
- **THEN** the installer prints a warning instructing the user to
  install one of them or to download the archive manually, and exits
  with a non-zero status that `install.sh` treats as non-fatal

#### Scenario: Sandbox blocks writes to the fonts directory

- **WHEN** the installer cannot write to the target fonts directory
  (read-only mount, sandbox)
- **THEN** it prints a warning naming the path it tried and exits
  with a non-zero status; `install.sh` continues with the rest of the
  configuration links

### Requirement: Refreshing the font cache after install

After a successful copy, the Linux and macOS installer SHALL refresh
the local font cache so applications see the new family without
requiring a logout or reboot.

#### Scenario: fc-cache refresh on Linux

- **WHEN** the Linux installer finishes copying the fonts and
  `fc-cache` is on `PATH`
- **THEN** it invokes `fc-cache -f` (or `fc-cache -fv`) on the
  destination directory and reports success only if `fc-cache` exits
  zero

#### Scenario: No fc-cache available on Linux

- **WHEN** the Linux installer finishes copying the fonts and
  `fc-cache` is not on `PATH`
- **THEN** it prints a hint suggesting `fc-cache -fv ~/.local/share/fonts`
  and exits successfully because the files are already in the expected
  directory

### Requirement: Documenting manual terminal selection

The README SHALL describe the three installers, the systems they cover
and the explicit step the user has to take inside their terminal
profile to use JetBrainsMono Nerd Font. Installing the font MUST NOT
be presented as sufficient on its own.

#### Scenario: Reader reaches the Nerd Fonts section

- **WHEN** the reader opens the README and finds the new "Nerd Fonts"
  section
- **THEN** the section names the installer scripts that ship with the
  repo, the supported platforms (Linux, macOS, Windows native), and
  the explicit instruction to select "JetBrainsMono Nerd Font" in the
  terminal profile (Windows Terminal, Terminal.app, iTerm2, GNOME
  Terminal, etc.)

#### Scenario: Windows reader follows the README

- **WHEN** a Windows user follows the "Install" steps in the README
- **THEN** the README directs them to run
  `powershell -ExecutionPolicy Bypass -File scripts/install-nerd-fonts.ps1`
  (or equivalent) and then to pick the font inside Windows Terminal
  settings

### Requirement: Documenting the dependency in the TUI footer

The docblock at the top of `quota-tui.tsx` SHALL mention Nerd Fonts as
a prerequisite so an operator reading the plugin file learns the
dependency without consulting the README.

#### Scenario: Reader opens quota-tui.tsx

- **WHEN** an operator reads the top JSDoc of `quota-tui.tsx`
- **THEN** the docblock lists JetBrainsMono Nerd Font as a
  prerequisite and points to the README's "Nerd Fonts" section for the
  install command
