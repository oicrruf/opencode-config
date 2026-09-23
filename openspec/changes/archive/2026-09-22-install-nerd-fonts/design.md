## Context

See `proposal.md` for the motivation and scope. The current state is:

- `install.sh` only creates symlinks under `~/.config/opencode/` and
  refuses to touch dependencies.
- The README documents WSL/Linux only and never names Nerd Fonts,
  although `quota-tui.tsx` already renders `nf-md-*` icons in the
  bottom bar (icons `󰧑`, `󰚩`, `󰃖`, `󰀄`).
- There is no Windows-native installer; WSL is the only documented
  Windows path.
- The user explicitly chose "latest oficial" (no pinned version or
  checksum) and "Windows nativo" for the install path.

The new work has to add three installers (Bash for Linux/macOS,
PowerShell for Windows), an opt-out flag, and a README section, all
without regressing the existing symlink-based configuration install.

## Goals / Non-Goals

**Goals:**

- A single command path that works on Linux, macOS and Windows without
  WSL.
- Idempotent re-runs and clear, non-fatal failure modes so a missing
  network, missing `curl`, or sandbox restrictions never break the
  rest of `install.sh`.
- A README section that names the manual terminal-font selection step
  on every platform.

**Non-Goals:**

- Pinning the release to a specific tag or verifying a checksum. The
  user explicitly chose "latest oficial"; this design honours that and
  leaves pinning for a follow-up change if the supply-chain risk
  becomes material.
- Modifying the OpenCode TUI or `quota-tui.tsx` beyond a docblock
  addition in the prerequisites section.
- Configuring any specific terminal to use the font automatically. The
  terminal font is a user preference and varies by host; the README
  documents the manual step instead.
- Detecting whether a Nerd Font is already installed in any other
  variant (Hack, FiraCode, Meslo). Only the exact JetBrainsMono Nerd
  Font directory check counts as "already installed".

## Decisions

### Three installers under `scripts/`, dispatched from `install.sh`

**Choice:** place the Linux/macOS Bash installer at
`scripts/install-nerd-fonts.sh` and the Windows PowerShell installer
at `scripts/install-nerd-fonts.ps1`. `install.sh` detects the OS
(uname) and runs the Bash script directly; Windows users run the
PowerShell script themselves (no `install.sh` on Windows).

**Rationale:** keeps Linux/macOS on the existing Bash toolchain that
the rest of `install.sh` already uses, and keeps Windows native. A
single cross-shell installer would have to assume Bash 3.2 (the macOS
default) and a Windows-friendly shell such as MSYS or Git Bash, which
is what we are trying to move away from.

**Alternatives considered:**

- A Node.js installer. Adds a Node dependency for a task that only
  needs `curl`/`wget` and `unzip`/`Expand-Archive`.
- Homebrew tap. macOS-only; would not cover Linux or Windows.

### Latest release resolved via the GitHub API, not a hard-coded URL

**Choice:** both installers query
`https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest`,
parse `tag_name` and `assets[]` for the JetBrainsMono zip, and
download from the resolved asset URL.

**Rationale:** the user picked "latest oficial" over a pinned version.
Hard-coding a tag would be a behaviour change. The API call is small
(one request) and matches the chosen contract.

**Alternatives considered:**

- Hard-coded tag like `v3.2.1`. Rejected because it contradicts the
  user's choice.
- Web scrape of the release page. Fragile; the API is the supported
  way.

### Install into the per-user fonts directory

**Choice:** Linux → `~/.local/share/fonts/JetBrainsMonoNerdFont` (and
`fc-cache -f` on it). macOS → `~/Library/Fonts/JetBrainsMonoNerdFont`.
Windows → `%LOCALAPPDATA%\Microsoft\Windows\Fonts\JetBrainsMonoNerdFont`.

**Rationale:** none of these require elevation. The directories are the
canonical user-scope paths that the respective fontconfig/CoreText/DirectWrite
stacks enumerate.

**Alternatives considered:**

- System-wide paths (`/usr/share/fonts`,
  `/Library/Fonts`, `%WINDIR%\Fonts`). Would require `sudo`/UAC, which
  we explicitly want to avoid for a developer-tool installer.
- A `brew install --cask font-jetbrains-mono-nerd-font` shortcut on
  macOS. Fails on Linux/Windows and adds a Homebrew dependency.

### Failures are non-fatal for `install.sh`

**Choice:** `install.sh` calls the Bash installer with a guard. If the
installer exits non-zero, `install.sh` prints a warning and continues
with the symlinks.

**Rationale:** the user explicitly chose "instalar automáticamente",
but a font failure should not block the rest of the configuration. The
README documents how to retry the font step.

**Alternatives considered:**

- Hard-fail. Rejected because the rest of `install.sh` is symlink-only
  and not font-dependent.
- Silent ignore. Rejected because the user has to know the font did
  not get installed.

### Manual terminal font selection is documented, not automated

**Choice:** the README explicitly tells the user to pick
"JetBrainsMono Nerd Font" in their terminal profile after the script
finishes.

**Rationale:** automating per-terminal config would require knowing the
terminal (Windows Terminal, Terminal.app, iTerm2, GNOME Terminal,
Kitty, WezTerm, etc.) and writing its JSON/plist/ini. The README is
faster to maintain and harder to break.

**Alternatives considered:**

- Detect and patch Windows Terminal `settings.json`. Brittle (file
  format changes) and would not cover macOS/Linux.
- Print per-OS instructions only at install time. The README is a
  durable artefact; the install log is not.

## Risks / Trade-offs

- **Latest-release trust** → mitigated by installing per-user only;
  a compromised release still requires the user to grant execution and
  can be uninstalled by deleting the fonts directory.
- **GitHub API rate-limit on unauthenticated requests** → mitigated by
  failing loudly with the message naming the URL; the user can retry
  with `--offline` once they have the archive.
- **PowerShell 5.1 vs 7** → the script targets 5.1 (ships with
  Windows 10/11) and avoids 7-only syntax. Documented in the README.
- **Terminal font must be selected manually** → mitigated by the
  README section naming the menu path on the major terminals; the
  user explicitly accepted this trade-off.
- **Sandboxed CI** → installer prints a non-fatal warning and `install.sh`
  continues; the symlink-based configuration still installs.

## Migration Plan

- Add `scripts/install-nerd-fonts.sh` and
  `scripts/install-nerd-fonts.ps1`.
- Wire `install.sh` to call the Bash installer with a non-fatal guard.
- Update the README with the new "Nerd Fonts" section above the
  "Initialize a project" section.
- Add the dependency to the JSDoc prerequisites block in
  `quota-tui.tsx` (no behaviour change).
- Rollback: delete the two scripts and revert the README / JSDoc
  edits; `install.sh` becomes a symlink-only installer again.
