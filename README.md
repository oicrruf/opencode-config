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

The installer creates symbolic links under `~/.config/opencode` for the
`agent/`, `commands/`, `skills/`, `tui.jsonc`, `quota-tui.tsx`, and
`herdr-tui-session.js` paths. The root `opencode.jsonc` is rendered from
`config/opencode.template.jsonc` and the selected profile in
`config/model-profiles.json`; the installer writes it directly rather than
symlinking it. The previous root config is backed up to
`opencode.jsonc.bak.<timestamp>` when the renderer overwrites it. The
installer refuses to replace existing non-link paths. The Herdr-managed
plugin is left untouched.

Restart OpenCode after installing or pulling changes, because configuration is
loaded only at startup.

### Profile selection

The model assignments live in `config/model-profiles.json`. The installer
reads the manifest at install time, picks the profile named by `--profile`
(or `defaultProfile`, normally `personal`), renders it, validates it, and
atomically replaces the installed `~/.config/opencode/opencode.jsonc`. The
selected profile persists; ordinary `opencode` invocations need no profile
flag or environment variable.

```bash
./install.sh                       # default: the manifest's defaultProfile (currently personal)
./install.sh --profile personal    # explicit selection
./install.sh --profile work        # demonstration profile (NOT a recommendation; see AGENTS.md)
./install.sh --help
```

To add a new profile, follow the OpenSpec workflow (see `AGENTS.md`): open a
change under `openspec/changes/<name>/`, declare the profile in the
manifest, validate with `node scripts/validate-config.mjs --profile <name>`,
then archive. The validator rejects profiles with missing consumers or
phantom IDs before any installed configuration is touched.

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

## Diagnose and repair (`/doctor`)

The global `doctor` subagent inspects the host, the configuration
symlinks, the OpenSpec change state, and the declared MCPs, then prints
a single report with one of four levels per finding: `ok`, `warn`,
`fail`, or `requires-approval`. Use it after `install.sh`, after
pulling changes, or whenever a command complains about missing tools.

### Modes

- `/doctor` or `node scripts/doctor.mjs --check-only` (default) —
  reads the filesystem and exits non-zero only when a `fail` is
  found. Never installs anything and never relinks.
- `/doctor --apply-safe` or `node scripts/doctor.mjs --apply-safe` —
  installs missing `lazygit`/`lazydocker` via the detected package
  manager, recreates missing `~/.config/opencode/<entry>` symlinks
  from the clone, and re-runs `scripts/validate-config.mjs`. Add
  `--dry-run` to print the actions without executing them. The
  repairs are idempotent.

### What the report covers

- **Tooling prerequisites** — `lazygit`, `lazydocker`, `openspec`,
  `codegraph`, `serena`. Missing entries are `fail`; the report
  prints the matching remediation line.
- **Symlinks under `~/.config/opencode`** — every entry that
  `install.sh` links is checked; missing or non-symlink paths are
  `fail`.
- **OpenSpec change state** — any change with pending tasks is
  reported as `requires-approval` with the exact `/opsx-apply <name>`
  invocation. The doctor never applies an OpenSpec change on its
  own.
- **MCP configuration** — disabled MCPs are reported as
  `requires-approval` (the doctor never flips `enabled: true`); MCPs
  enabled but unreferenced by any agent permission are `warn`.
- **Configuration validator** — the same checks `install.sh` runs
  (`scripts/validate-config.mjs`).

### Opt-out

Set `OPENCODE_DOCTOR=0` before running `install.sh` to silence the
final "doctor: prerequisite(s) missing" reminder. The configuration
links are always created regardless of the warning.

## Update

```bash
git -C ~/Projects/opencode-config pull --ff-only
```

The links point to the clone, so no reinstall is needed after a successful
pull. Restart OpenCode to use the update.

### Switching profiles

Re-running the installer with a different `--profile` re-renders the root
config from the new profile and atomically replaces the installed
`opencode.jsonc`. The previous root config is backed up to
`opencode.jsonc.bak.<timestamp>`. The other symlinked resources (agents,
commands, skills, plugins, TUI) are unchanged.

```bash
~/Projects/opencode-config/install.sh --profile work
```

The renderer validates the new profile against the catalog (when the
catalog is present) before the install commit, so a phantom id in the
manifest fails the install before any file in `~/.config/opencode/` is
touched.

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

The `audit` class is selected **only** for an explicit `@cotizador` mention or
an explicit request to quote (cotizar/presupuestar) the development of an
application or a development effort. A URL on its own — or a request to
improve, redesign, optimize, audit, or evaluate a site — never selects
`audit` or dispatches `cotizador`.

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

Per-agent overrides follow the budget matrix in `agent/routing.md`. An
agent with `targeted` / `full` modes declares the `steps` budget of its
highest mode (`agent/routing.md` carries the full table); `steps` is a
ceiling, so a `targeted` run that finishes early stops early.
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
