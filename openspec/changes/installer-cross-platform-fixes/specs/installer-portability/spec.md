## Purpose

Define the cross-platform installer contract: the four supported
shells, the path-translation behaviour, the `node` binary resolution
rules, the line-ending contract enforced by `.gitattributes` and
check #9, and the platform report emitted by `install.sh --help`.
The contract is the single source of truth for "where does
`install.sh` work" so the README, the doctor agent, and the
acceptance harness do not drift.

## ADDED Requirements

### Requirement: Installer runs to completion on every supported shell

The system SHALL provide a single `install.sh` that runs to
completion on each of the four documented shells without operator
workarounds. Each shell SHALL receive a one-line invocation, a
prerequisite check, and a deterministic final message
(`OpenCode configuration linked from <path>`).

#### Scenario: Native Linux bash installs the configuration

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  on a Linux host where `node` is on PATH
- **THEN** the installer renders the profile, validates it, links
  the configuration under `~/.config/opencode`, and prints
  `OpenCode configuration linked from /home/<user>/Projects/opencode-config`

#### Scenario: Native macOS bash installs the configuration

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  on a macOS host where `node` is on PATH
- **THEN** the installer renders the profile, validates it, links
  the configuration under `~/.config/opencode`, and prints
  `OpenCode configuration linked from /Users/<user>/Projects/opencode-config`

#### Scenario: WSL Ubuntu bash installs the configuration against a Windows node

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  from WSL Ubuntu with the repository at `/mnt/c/Users/.../opencode-config`
  and only `node.exe` on PATH
- **THEN** the installer translates `repo_dir` to a Windows path via
  `wslpath -w`, runs the renderer and validator against that path,
  links the configuration under
  `C:\Users\<user>\.config\opencode`, and prints
  `OpenCode configuration linked from C:\Users\<user>\Projects\opencode-config`

#### Scenario: Git Bash on Windows installs the configuration

- **WHEN** the operator runs `bash ./install.sh --profile personal`
  from Git Bash (launched from PowerShell, CMD, or Windows Terminal)
  with the repository at `C:\Users\<user>\Projects\opencode-config`
  and only `node.exe` on PATH
- **THEN** the installer resolves `node.exe` via the two-step
  `command -v` lookup, runs the renderer and validator against the
  Windows path, links the configuration under
  `C:\Users\<user>\.config\opencode`, and prints
  `OpenCode configuration linked from C:\Users\<user>\Projects\opencode-config`

#### Scenario: Installer prints the supported-shell matrix on `--help`

- **WHEN** the operator runs `bash ./install.sh --help`
- **THEN** the help body lists the four supported shells (Linux
  bash, macOS bash, WSL Ubuntu bash, Git Bash on Windows), the
  prerequisite (Node.js ≥ 18 on PATH), and the path-translation
  behaviour that activates on WSL or Git Bash on Windows

### Requirement: Installer resolves the node binary reliably

The system SHALL resolve the node binary before invoking any `node`
subprocess. The resolution SHALL try `node` first, then `node.exe`,
and SHALL validate that the resolved path is executable. Every
subsequent `node …` call in `install.sh` SHALL use the resolved
binary, not a bare `node` literal.

#### Scenario: node is on PATH

- **WHEN** the operator has `node` on PATH and runs
  `bash ./install.sh --profile personal`
- **THEN** `install.sh` resolves `node`, threads it through every
  `node …` call, and proceeds without printing an error

#### Scenario: only node.exe is on PATH

- **WHEN** the operator has only `node.exe` on PATH (Windows native
  install) and runs `bash ./install.sh --profile personal`
- **THEN** `install.sh` resolves `node.exe`, validates it is
  executable, threads it through every `node …` call, and proceeds
  without printing the `node is required` error

#### Scenario: node is missing

- **WHEN** the operator has neither `node` nor `node.exe` on PATH
  and runs `bash ./install.sh --profile personal`
- **THEN** `install.sh` exits non-zero with the message
  `install.sh: node is required to render the selected profile; install Node.js >= 18.`
  and prints the same prerequisite line in the doctor summary

### Requirement: Installer translates WSL and Git Bash paths to Windows

The system SHALL translate `$repo_dir` to a Windows path when
`install.sh` runs under WSL Ubuntu or Git Bash on Windows, so that
the renderer and validator — which are invoked as `node.exe`
subprocesses — receive a path their filesystem API can open. The
translation SHALL normalize the result to forward slashes so that
subsequent concatenation with `"/config/..."` produces a path
node.exe can resolve; Win32 accepts forward slashes natively.
The translation SHALL be a no-op on native Linux and macOS.

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

### Requirement: Repository tracks LF for shell and runtime files

The system SHALL keep shell and runtime files at LF in the Git
index. `.gitattributes` SHALL declare `* text=auto eol=lf` so every
new commit and every fresh checkout use LF for text content. The
validator SHALL refuse to pass when any tracked file with a
shell or runtime extension has CRLF in its index blob.

#### Scenario: A new contributor commits a CRLF .sh file

- **WHEN** a contributor on a Windows checkout with
  `core.autocrlf=true` adds a new `scripts/install-nerd-fonts.sh`
  with CRLF endings and runs `node scripts/validate-config.mjs`
- **THEN** the validator exits non-zero with the message
  `scripts/install-nerd-fonts.sh: file has CRLF line endings; repository requires LF (see .gitattributes)`

#### Scenario: A tracked .mjs file gains a CRLF pair

- **WHEN** any tracked `.mjs` file ends up with a `\r\n` byte
  sequence in the Git index
- **THEN** `validate-config.mjs` exits non-zero and names the file

#### Scenario: A binary fixture is committed

- **WHEN** a contributor commits a font, image, or wasm fixture
- **THEN** check #9 does not inspect the file because
  `.gitattributes` classifies it as binary via `text=auto`, and the
  validator does not raise a CRLF error

#### Scenario: All shell and runtime files are LF

- **WHEN** every tracked `.sh`, `.ps1`, `.mjs`, `.js`, `.ts`,
  `.tsx`, `.cjs`, `.mts`, and `.cts` file has only LF line endings
  in the Git index
- **THEN** `node scripts/validate-config.mjs` exits zero and check
  #9 contributes no failures

### Requirement: Installer documents the supported shells in its help

The system SHALL document the four supported shells and the per-shell
prerequisites in `install.sh --help` so the operator does not need
to consult the README to confirm whether their shell is supported.

#### Scenario: --help lists the four shells

- **WHEN** the operator runs `bash ./install.sh --help`
- **THEN** the help body contains one paragraph per supported
  shell (Linux bash, macOS bash, WSL Ubuntu bash, Git Bash on
  Windows) with the prerequisite (Node.js ≥ 18) and the exact
  one-line invocation

#### Scenario: --help mentions path translation

- **WHEN** the operator runs `bash ./install.sh --help`
- **THEN** the help body contains a paragraph explaining that on
  WSL Ubuntu or Git Bash on Windows the installer translates
  `$repo_dir` to a Windows path via `wslpath -w` or `cygpath -w`
  before invoking `node.exe`
