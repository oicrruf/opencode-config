## ADDED Requirements

### Requirement: Installer warns when it resolves a Windows node on WSL

The system SHALL detect when `install.sh` resolves a Windows `node.exe`
while running on a Linux shell under WSL, and SHALL print a warning before
invoking any node subprocess. The warning SHALL name, at minimum: that
`os.homedir()` inside node is the Windows profile, so
`~/.cache/opencode/models.json` is looked up on the Windows side and the
models catalog check is skipped rather than satisfied; that the configuration
directory is derived from the Linux `$HOME` while `opencode.exe` reads the
Windows profile; and that installing a native Linux Node.js >= 18 removes
both conditions.

The installer SHALL NOT treat the condition as fatal. It SHALL continue and
complete the install. The warning SHALL NOT be printed when the resolved
node is a native `node`, and SHALL NOT be printed when a Windows node is
resolved from Git Bash on Windows, where a Windows node and a Windows home
are the expected pairing.

#### Scenario: WSL with only node.exe on PATH warns and installs

- **WHEN** the operator runs `bash ./install.sh --profile personal` under
  WSL with only `node.exe` on PATH and the repository under `$HOME`
- **THEN** the installer prints the warning naming the Windows-side home,
  the skipped catalog check, and the Linux install target, then continues
  and prints `OpenCode configuration linked from <repo_dir>`

#### Scenario: native Linux with node prints no warning

- **WHEN** the operator runs `bash ./install.sh --profile personal` on a
  native Linux host with `node` on PATH
- **THEN** the installer prints no WSL/node warning and proceeds

#### Scenario: Git Bash on Windows with node.exe prints no warning

- **WHEN** the operator runs `bash ./install.sh --profile personal` from
  Git Bash on Windows, where `node.exe` is the only node on PATH and the
  shell's `$HOME` is the Windows user profile
- **THEN** the installer prints no WSL/node warning, because the node home
  and the shell home are the same profile

#### Scenario: the warning precedes the validator output

- **WHEN** the warning fires
- **THEN** it is printed before the first `node` subprocess runs, so the
  operator reads the cause before the validator's own catalog-skip notice

## MODIFIED Requirements

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

#### Scenario: WSL Ubuntu with repo under /mnt/c

- **WHEN** `install.sh` runs from WSL Ubuntu with `$repo_dir`
  matching `/mnt/[a-zA-Z]/*` and `wslpath` on PATH
- **THEN** the installer runs `wslpath -w "$repo_dir"` and
  normalizes any backslashes to forward slashes before using the
  result as the path passed to `node.exe`. For example,
  `$repo_dir=/mnt/c/Users/o/Projects/opencode-config` becomes
  `C:/Users/o/Projects/opencode-config` (not `C:\Users\o\Projects\opencode-config`).

#### Scenario: Git Bash on Windows with repo under /c/

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