## MODIFIED Requirements

### Requirement: Installer documents the supported shells in its help

The system SHALL document the four supported shells and the per-shell
prerequisites in `install.sh --help` so the operator does not need
to consult the README to confirm whether their shell is supported.
The help body SHALL be rendered verbatim by the heredoc that
`print_help()` writes: bash SHALL NOT perform parameter expansion,
command substitution, or arithmetic expansion inside the help body,
and the help command SHALL NOT emit any bytes to stderr.

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

#### Scenario: --help renders the post-install summary line verbatim

- **WHEN** the operator runs `bash ./install.sh --help`
- **THEN** the help body contains the literal line
  ``On success the final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.``
  rendered verbatim, including the surrounding backticks

#### Scenario: --help emits no bytes to stderr

- **WHEN** the operator runs `bash ./install.sh --help 2>/tmp/help.err`
- **THEN** the command exits 0 and `/tmp/help.err` is empty (zero bytes)
