## MODIFIED Requirements

### Requirement: Installer runs to completion on every supported shell

The system SHALL provide a single `install.sh` that runs to
completion on each of the four documented shells without operator
workarounds. Each shell SHALL receive a one-line invocation, a
prerequisite check, and a deterministic final message
(`OpenCode configuration linked from <repo_dir>`).

The installer SHALL create any missing parent directory of every
symlink target before invoking `ln -sfn`, so a first-time install on
any host whose `~/.config/opencode` subtree is fresh completes
without the operator running `mkdir` by hand.

The installer SHALL report, before the Nerd Font step, every
prerequisite tool that is missing from the host and is required by
the steps that follow. The reporting SHALL NOT be fatal; it SHALL be
a warning printed to stderr that names the tool and the install
command for the host's package manager. At minimum the report SHALL
cover `git` (the validator's check #9), `curl` (Nerd Font download),
and `unzip` (Nerd Font extraction).

#### Scenario: Native Linux bash installs the configuration

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  on a Linux host where `node` is on PATH
- **THEN** the installer renders the profile, validates it, links
  the configuration under `~/.config/opencode`, and prints
  `OpenCode configuration linked from <repo_dir>`

#### Scenario: Native macOS bash installs the configuration

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  on a macOS host where `node` is on PATH
- **THEN** the installer renders the profile, validates it, links
  the configuration under `~/.config/opencode`, and prints
  `OpenCode configuration linked from <repo_dir>`

#### Scenario: WSL Ubuntu bash installs the configuration against a Windows node

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  from WSL Ubuntu with the repository under `/mnt/<drive>/<path>`
  and only `node.exe` on PATH
- **THEN** the installer translates `repo_dir` to a Windows path via
  `wslpath -w`, runs the renderer and validator against that path,
  links the configuration under `<homedir>/.config/opencode`, and
  prints `OpenCode configuration linked from <windows_repo_dir>`

#### Scenario: Git Bash on Windows installs the configuration

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  from Git Bash (launched from PowerShell, CMD, or Windows Terminal)
  with the repository at `<windows_repo_dir>` and only `node.exe` on
  PATH
- **THEN** the installer resolves `node.exe` via the two-step
  `command -v` lookup, runs the renderer and validator against the
  Windows path, links the configuration under
  `<homedir>/.config/opencode`, and prints
  `OpenCode configuration linked from <windows_repo_dir>`

#### Scenario: Installer prints the supported-shell matrix on `--help`

- **WHEN** the operator runs `bash ./install.sh --help`
- **THEN** the help body lists the four supported shells (Linux
  bash, macOS bash, WSL Ubuntu bash, Git Bash on Windows), the
  prerequisite (Node.js ≥ 18 on PATH), and the path-translation
  behaviour that activates on WSL or Git Bash on Windows

#### Scenario: clean WSL Ubuntu with native node finishes the install

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  on a fresh WSL Ubuntu host with a native Linux `node` >= 18, `git`,
  `curl`, and `unzip` available, and a fresh clone in `~/Projects/opencode-config`
- **THEN** the installer prints no WSL/Windows-node warning, every
  symlink including `plugins/herdr-agent-state.js` is created, the
  Nerd Font step succeeds, and the gate summary
  `install.sh: OK — <p>/<r> gates passed (<s> skipped)` prints

#### Scenario: clean WSL Ubuntu missing unzip still finishes the OpenCode install

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  on a fresh WSL Ubuntu host with a native Linux `node` and `git`,
  but without `unzip` (and therefore without `curl` for the font)
- **THEN** the installer prints a `install.sh: warning — unzip is
  required to extract the Nerd Font archive; install with:
  apt-get install -y unzip` line before the font step, the font step
  fails non-fatally, and the rest of the install (link step, gate
  summary) completes

### Requirement: Installer translates WSL and Git Bash paths to Windows

The system SHALL translate `$repo_dir` to a Windows path when
`install.sh` runs under WSL Ubuntu or Git Bash on Windows, so that the
renderer and validator — which are invoked as `node.exe`
subprocesses — receive a path their filesystem API can open. The
translation SHALL normalize the result to forward slashes so that
subsequent concatenation with `"/config/..."` produces a path
node.exe can resolve; Win32 accepts forward slashes natively.
The translation SHALL be a no-op on native Linux and macOS.

The translation SHALL trigger only for `$repo_dir` matching
`/mnt/[a-zA-Z]/*`. A WSL repository under `$HOME` SHALL NOT be translated;
such a layout currently resolves because WSL interop sets the node child's
working directory to a `\\wsl.localhost\...` UNC path against which Win32
resolves the Linux absolute arguments. That behaviour is observed and
unsupported: the installer SHALL warn rather than rely on it silently.

When the resolved `node` is a native Linux binary, the translation is
not needed for any path under `$repo_dir`. If the operator is on WSL
with a native `node` and a repository under `/mnt/<drive>/`, the
installer SHALL warn that `config_dir` is derived from the Linux
`$HOME` while the repository is on the Windows side, and SHALL
recommend moving the clone under `/home` or setting
`XDG_CONFIG_HOME` deliberately. The warning SHALL be non-fatal; the
install SHALL continue and the gate summary SHALL print.

#### Scenario: WSL Ubuntu with repo under /mnt/<drive>

- **WHEN** `install.sh` runs from WSL Ubuntu with `$repo_dir`
  matching `/mnt/[a-zA-Z]/*` and `wslpath` on PATH
- **THEN** the installer runs `wslpath -w "$repo_dir"` and
  normalizes any backslashes to forward slashes before using the
  result as the path passed to `node.exe`. For example,
  `/mnt/<drive>/<path>` becomes `<drive>:/<path>` with forward
  slashes throughout.

#### Scenario: Git Bash on Windows with repo under /<drive>/

- **WHEN** `install.sh` runs from Git Bash on Windows with `$repo_dir`
  matching `/mnt/[a-zA-Z]/*` and `wslpath` absent but `cygpath` on
  PATH
- **THEN** the installer runs `cygpath -w "$repo_dir"` and
  normalizes any backslashes to forward slashes before using the
  result as the path passed to `node.exe`

#### Scenario: WSL with no translator available

- **WHEN** `install.sh` runs from a shell where `$repo_dir` matches
  `/mnt/[a-zA-Z]/*` and neither `wslpath` nor `cygpath` is on PATH
- **THEN** the installer exits non-zero with the message
  `install.sh: cannot translate WSL path <path> (need WSL or Git Bash)`

#### Scenario: native Linux with repo under /home

- **WHEN** `install.sh` runs from native Linux with `$repo_dir`
  matching `/home/*`
- **THEN** the translation block is a no-op and `$repo_dir` keeps
  its POSIX form

#### Scenario: WSL with repo under /home is not translated

- **WHEN** `install.sh` runs under WSL with `$repo_dir` matching
  `/home/*` and only `node.exe` on PATH
- **THEN** the translation block is a no-op, `$repo_dir` keeps its POSIX
  form, and the installer warns that the POSIX path resolves only through
  the WSL interop UNC working directory

#### Scenario: WSL with native node and repo under /home

- **WHEN** `install.sh` runs under WSL with a native Linux `node`
  on PATH and `$repo_dir` matching `/home/*`
- **THEN** the translation block is a no-op, no WSL/Windows-node
  warning fires, no WSL/native-node-repo-mismatch warning fires, and
  the install proceeds to the link step

#### Scenario: WSL with native node and repo under /mnt/<drive> warns and continues

- **WHEN** `install.sh` runs under WSL with a native Linux `node`
  on PATH and `$repo_dir` matching `/mnt/[a-zA-Z]/*`
- **THEN** the translation block is a no-op (the native node does not
  need a Windows path), and the installer prints a warning that
  `config_dir` will be on the Linux side while the repository is on
  the Windows side, then continues and prints
  `OpenCode configuration linked from <repo_dir>`