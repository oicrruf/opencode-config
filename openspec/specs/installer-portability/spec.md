# installer-portability Specification

## Purpose
Define the cross-platform installer contract: the four supported
shells, the path-translation behaviour, the `node` binary resolution
rules, the line-ending contract enforced by `.gitattributes` and
check #9, and the platform report emitted by `install.sh --help`.
The contract is the single source of truth for "where does
`install.sh` work" so the README, the doctor agent, and the
acceptance harness do not drift.

## Requirements

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

#### Scenario: WSL Ubuntu with repo under /mnt/c

- **WHEN** `install.sh` runs from WSL Ubuntu with `$repo_dir`
  matching `/mnt/[a-zA-Z]/*` and `wslpath` on PATH
- **THEN** the installer runs `wslpath -w "$repo_dir"` and
  normalizes any backslashes to forward slashes before using the
  result as the path passed to `node.exe`. For example,
  `$repo_dir=/mnt/c/Users/o/Projects/opencode-config` becomes
  `<drive>:/<path>` with forward slashes throughout.

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

### Requirement: Installer warns when it resolves a Windows node on WSL

The system SHALL detect when `install.sh` resolves a Windows `node.exe`
while running on a Linux shell under WSL, and SHALL print a warning before
invoking any node subprocess. The warning SHALL name that `os.homedir()`
inside node is the Windows profile, so the models catalog is looked up on
the Windows side and the catalog check is skipped rather than satisfied;
that the configuration directory is derived from the Linux `$HOME` while
`opencode.exe` reads the Windows profile; and that installing a native Linux
Node.js >= 18 removes these conditions.

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

#### Scenario: Help identifies every supported shell

- **WHEN** the operator runs `bash ./install.sh --help`
- **THEN** the output SHALL name Linux bash, macOS bash, WSL Ubuntu bash,
  and Git Bash on Windows with their prerequisites and one-line invocations

### Requirement: Installer exposes a non-mutating check mode and an idempotency report

El instalador SHALL aceptar --check junto a --profile y conservar las cuatro invocaciones por shell existentes. SHALL documentar los resultados: 0 sincronizado, 1 diferencias/conflictos y 2 argumentos/estado inválido/error operativo. El modo check SHALL usar el perfil registrado si no recibe uno explícito y SHALL NOT crear temporales, instalar fuentes, ejecutar reparaciones o invocar gates con escrituras. La instalación sin --profile SHALL conservar defaultProfile y su resumen de gates, identificando omisiones.

#### Scenario: Comprobación sincronizada
- **WHEN** el operador ejecuta bash ./install.sh --check con instalación y manifiesto válidos sin diferencias
- **THEN** SHALL informar sincronización y salir 0 sin modificar archivos o mtimes

#### Scenario: Comprobación con diferencias
- **WHEN** hay recursos faltantes, root distinto o recursos conservados pendientes
- **THEN** SHALL informar cada diferencia y salir 1 sin mutaciones

#### Scenario: Comprobación con perfil registrado
- **WHEN** se comprueba sin --profile una instalación que registra work
- **THEN** SHALL comprobar work sin sustituirlo por defaultProfile

#### Scenario: Argumento o estado inválido
- **WHEN** el argumento es desconocido, el perfil no existe o el manifiesto es inválido
- **THEN** SHALL salir 2 con explicación y sin modificar la instalación

#### Scenario: Ayuda compatible
- **WHEN** el operador consulta --help
- **THEN** SHALL documentar --check, --profile, códigos de salida y las cuatro shells soportadas
