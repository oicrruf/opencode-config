# OpenCode configuration

This repository is the canonical, version-controlled global OpenCode setup.
It provides autonomous permissions, global role agents, reusable commands and
skills, and Herdr integration.

## Install on Linux, macOS, or Windows

### Linux and macOS

```bash
git clone https://github.com/oicrruf/opencode-config.git ~/Projects/opencode-config
~/Projects/opencode-config/install.sh
```

The installer creates symbolic links under `~/.config/opencode`. It refuses to
replace existing non-link paths. The Herdr-managed plugin is left untouched.

Restart OpenCode after installing or pulling changes, because configuration is
loaded only at startup.

### Windows (native, PowerShell 5.1+)

```powershell
git clone https://github.com/oicrruf/opencode-config.git $HOME\Projects\opencode-config
powershell -ExecutionPolicy Bypass -File $HOME\Projects\opencode-config\scripts\install-nerd-fonts.ps1
# Then create the configuration links by hand or run install.sh under WSL.
```

Restart OpenCode after installing or pulling changes, because configuration is
loaded only at startup.

## Nerd Fonts

The TUI quota footer (`quota-tui.tsx`) renders Nerd Font `nf-md-*` icons in the
bottom bar for the codex, MiniMax, and Ollama Cloud providers. Without a Nerd
Font installed, those icons render as `` or silently disappear. The installer
takes care of the font on Linux and macOS; on Windows the same step is split
into a native PowerShell script.

### What gets installed

`JetBrainsMono Nerd Font` from the official
[`ryanoasis/nerd-fonts`](https://github.com/ryanoasis/nerd-fonts) GitHub
release marked `latest`. The installer always picks the latest release; it does
not pin a version.

| Platform  | Script                              | Destination (per-user, no elevation)                  |
| --------- | ----------------------------------- | ---------------------------------------------------- |
| Linux     | `scripts/install-nerd-fonts.sh`     | `~/.local/share/fonts/JetBrainsMonoNerdFont`         |
| macOS     | `scripts/install-nerd-fonts.sh`     | `~/Library/Fonts/JetBrainsMonoNerdFont`              |
| Windows   | `scripts/install-nerd-fonts.ps1`    | `%LOCALAPPDATA%\Microsoft\Windows\Fonts\JetBrainsMonoNerdFont` |

`install.sh` calls the Bash installer automatically. The PowerShell installer
must be invoked by hand on Windows because `install.sh` is a Bash script.

### Opt-out

Set `OPENCODE_INSTALL_NERD_FONTS=0` before running `install.sh` (or pass
`--Skip` to the PowerShell script, or set the env var there too) to skip the
font step silently. The OpenCode configuration links are always created.

### Manual terminal selection

Installing the font does not activate it. After the script finishes, open your
terminal's profile settings and pick **JetBrainsMono Nerd Font** as the font
family:

- **Windows Terminal**: Settings → Profiles → Defaults → Appearance → Font face.
- **Terminal.app** (macOS): Profiles → Text → Font → Change.
- **iTerm2** (macOS): Preferences → Profiles → Text → Font.
- **GNOME Terminal** (Linux): Preferences → Unnamed profile → Text → Custom
  font.
- **Kitty** (Linux/macOS): edit `~/.config/kitty/kitty.conf` and set
  `font_family JetBrainsMono Nerd Font`.
- **WezTerm** (cross-platform): set `config.font = { family = "JetBrainsMono Nerd Font" }`
  in your `wezterm.lua`.

### Manual install (offline mode)

If the GitHub API is unreachable from the host (rate-limited, blocked, behind a
firewall), download `JetBrainsMono.zip` from the
[latest release page](https://github.com/ryanoasis/nerd-fonts/releases/latest)
once on a machine that does have access, copy it to the target host, and run:

```bash
# Linux/macOS
scripts/install-nerd-fonts.sh --offline /path/to/JetBrainsMono.zip
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\install-nerd-fonts.ps1 -Offline C:\path\to\JetBrainsMono.zip
```

## Update

```bash
git -C ~/Projects/opencode-config pull --ff-only
```

The links point to the clone, so no reinstall is needed after a successful
pull. Restart OpenCode to use the update.

## Code intelligence

CodeGraph is the default MCP for daily navigation and impact analysis. Serena
is reserved for behavior-preserving semantic refactors. Install and initialize
both prerequisites before starting OpenCode:

```bash
npm install -g @colbymchenry/codegraph
codegraph telemetry off
uv tool install -p 3.13 serena-agent
serena init
```

`/p5t-init` creates the local `.codegraph/` index with telemetry disabled.
OpenCode must restart before a newly created index is exposed through MCP.
Serena starts without an active project and creates project state only when
`build` activates it for an identified behavior-preserving refactor.

## Routing, budgets, and MCPs

Each work request is classified into one of `small`, `medium`,
`spec-required`, or `audit`. The classification picks a model, a
subagent depth, and a tool surface. The full matrix lives in
`agent/routing.md`; the relevant excerpt:

| Class          | Default model                       | Depth | Browser |
|----------------|-------------------------------------|-------|---------|
| `small`        | `minimax/MiniMax-M2.7-highspeed`    | 0     | deny    |
| `medium`       | `minimax/MiniMax-M3`                | 1     | deny    |
| `spec-required`| Terra (plan) + M3 (implement)       | 1     | only with risk |
| `audit`        | Terra                               | 1     | required |

`opencode.jsonc` enforces the policy globally:

- `tool_output.max_lines` defaults to `400` and `max_bytes` to `16384`,
  with a truncation footer that points to the full output on disk.
- `compaction.prune: true`, `tail_turns: 6`, `preserve_recent_tokens:
  4000`, `reserved: 2000` so each session compacts predictably.
- `subagent_depth: 1` globally; only `orchestrator` and `refactor`
  inherit depth `2` for their bounded units.
- `permission` is deny-by-default at the baseline; each agent carries
  its own `permission` block with the minimum tool surface it needs
  (MCP tools gated by `codegraph_*`, `playwright_*`, `context7_*`,
  `serena_*`).

Per-agent overrides follow the budget matrix in `agent/routing.md`.
The `validate-config.mjs` script (run by `install.sh`) enforces that
no agent exposes an unallowed MCP tool family and that the union of
skill descriptions stays within the model-invocable budget.

The MCP set still loads at startup; the per-agent `permission` block
hides the corresponding tool families from agents that should not see
them. Use `node scripts/validate-config.mjs` to verify the policy
before committing.

## OpenSpec CLI

The global `/opsx-*` commands and `/p5t-init` require the `openspec` binary.
Install it once with Node.js 20.19 or newer:

```bash
npm install -g @fission-ai/openspec
```

`install.sh` warns if the binary is unavailable. Set `OPENCODE_CHECK_OPENSPEC=0`
to suppress that warning.

## Initialize a project

Run the global bootstrap command from a project's repository root:

```text
/p5t-init
```

The `architect` agent inspects the stack and existing project configuration,
initializes OpenSpec for OpenCode when needed, updates `AGENTS.md`, and creates
only the project-specific agents justified by the repository. It writes the
configuration automatically, verifies it, and reports optional skill or MCP
improvements separately so dependencies and services are never enabled without
approval.

OpenSpec is available in every initialized project, but artifacts are
proportional to the work. The global `plan` and `build` agents classify each
request as:

- `small`: direct implementation and focused verification.
- `medium`: short plan, implementation, and relevant verification.
- `spec-required`: OpenSpec proposal and apply workflow before implementation.

Features, observable behavior changes, APIs, schemas, migrations, external
integrations, security or compatibility work, architectural refactors, and
materially ambiguous requests are `spec-required`. Existing OpenSpec changes
remain authoritative for their scope. If direct work grows into that category,
the agent stops before expanding it and asks to create or update the change.

Install the dependencies and prepare missing local configuration afterward:

```text
/p5t-install
```

The `p5t-installer` follows project lockfiles and documented setup commands. It
never upgrades dependencies, overwrites existing local configuration, invents
secrets, or runs migrations and services. Its final OpenCode report lists
commands executed, files created, missing values, prerequisites, and overall
readiness.
