## Context

The repository is the global OpenCode configuration for a single operator
who develops on Windows (PowerShell + Git Bash + WSL Ubuntu), macOS, and
Linux interchangeably. `install.sh` is the documented single entry point
for the four shells the README claims to support: native Linux bash,
native macOS bash, WSL Ubuntu bash, and Git Bash on Windows (the
`bash.exe` shipped with Git for Windows, launched from CMD, PowerShell,
or Windows Terminal).

Three independent defects make `install.sh` non-functional on three of
those four shells today. Defect (1) breaks every shell. Defect (2)
breaks the documented Windows shell (Git Bash from PowerShell). Defect
(3) breaks the WSL Ubuntu shell, which is the only way to drive the
Windows `node.exe` from a Linux daily-driver shell. Defect (4) is a
guard gap: there is nothing preventing a future Windows contributor
from re-introducing CRLF in a new script and silently breaking the
installer again.

The current `origin/main` HEAD has the following baseline, verified by
walking the working tree with `git ls-files` and a binary CRLF probe
(`\r\n`):

- 408 files contain CRLF (404 excluding `node_modules`).
- `.sh` extensions: `install.sh`, `scripts/install-nerd-fonts.sh` — both
  CRLF.
- `.mjs` extensions: 162 files CRLF (all runtime scripts).
- `.md` extensions: 171 files CRLF (no runtime impact).
- `.json` extensions: 39 files CRLF (no runtime impact).
- `.jsonc` extensions: 3 files CRLF (`opencode.jsonc` plus the two
  MCP configs).
- `.js`, `.ts`, `.tsx`, `.yaml`, `.node_modules`: CRLF counts listed in
  the proposal.
- `git config --get core.autocrlf` returns `true` on the operator's
  checkout; no `.gitattributes` is checked in.

## Goals / Non-Goals

**Goals**

1. `install.sh` runs to completion on the four supported shells:
   native Linux bash, native macOS bash, WSL Ubuntu bash, and Git Bash
   on Windows.
2. The four shells share one `install.sh`; no per-shell fork.
3. Future commits cannot reintroduce CRLF in shell/runtime files
   without `scripts/validate-config.mjs` failing.
4. The fix is small and surgical: the patch in `install.sh` is at most
   ~12 lines; the new validator check is one function.
5. The behaviour for native Linux and macOS users is unchanged. They
   pay no startup cost from the new translation step.

**Non-Goals**

1. No renormalization of non-runtime artefacts (`.md`, `.json`,
   `.jsonc`, `.yaml`). They may be addressed in a follow-up change
   after this one lands.
2. No new installer entry points. `install.sh` remains the single
   POSIX entry point; `install-nerd-fonts.ps1` remains the Windows
   font entry point.
3. No support for shells other than bash 3.2+. macOS ships bash 3.2;
   Linux distros ship bash 4+ or 5+; WSL Ubuntu and Git Bash ship
   bash 4+ or 5+. The `set -euo pipefail` baseline stays.
4. No change to the renderer, the model profile manifest, the
   acceptance harness routing checks, or the doctor agent.

## Decisions

### Decision: `.gitattributes` declares LF for all text files, future-only

The repository is a content repo with a single operator contributor
today and no public CI. A repo-wide `git config core.autocrlf input` or
`git config core.autocrlf false` would not survive clones on Windows
where the operator has `core.autocrlf=true` set globally. The only
mechanism that survives every clone is `.gitattributes` with `* text=auto
eol=lf`, which forces LF in the working tree on every checkout and in
the index on every add, regardless of the operator's local config.

`text=auto` lets Git treat image, font, and binary fixtures as binary
and skip the EOL rewrite for them; `eol=lf` forces LF for everything
Git classifies as text.

The decision deliberately does **not** renormalize the existing CRLF
blobs in this commit. Doing so would touch ~400 files and inflate the
diff for no functional gain (the installer does not parse `.md` or
`.json`). The new check #9 enforces LF only for shell/runtime files
that the installer actually parses; the non-runtime CRLF files are
flagged here as a known follow-up but are not a blocker for the
installer.

Alternatives considered:

- **`* text=auto eol=lf` + `git add --renormalize .` in this commit.**
  Rejected: touches ~400 files; high PR friction; the installer is
  not parsing those files anyway.
- **Per-extension explicit lines (`.sh text eol=lf`, `.mjs text eol=lf`,
  …).** Rejected: brittle; the umbrella `* text=auto eol=lf` covers
  every new extension a future contributor might introduce.
- **`core.autocrlf=input` in a contributor doc.** Rejected: does not
  travel with the clone; the operator's global config wins.

### Decision: `repo_dir` translation lives in `install.sh`, not in the renderer

The renderer (`scripts/render-config.mjs`) and the validator
(`scripts/validate-config.mjs`) are pure Node scripts. They expect to
read POSIX paths because that is what `process.argv` gives them when
they are launched from a POSIX shell. Moving the translation into Node
would mean every script handles both POSIX and Win32 input, doubling
the surface and inviting drift.

The translation belongs at the boundary: `install.sh` resolves
`$repo_dir` once, before the first `node -e` call, and converts it to
Win32 when running under WSL or Git Bash on Windows. Every downstream
script then sees the same path style their authors wrote for, and the
POSIX users see no change.

```bash
case "$repo_dir" in
  /mnt/[a-zA-Z]/*)
    if command -v wslpath >/dev/null 2>&1; then
      repo_dir="$(wslpath -w "$repo_dir")"
    elif command -v cygpath >/dev/null 2>&1; then
      repo_dir="$(cygpath -w "$repo_dir")"
    else
      printf 'install.sh: cannot translate WSL path %s (need WSL or Git Bash)\n' "$repo_dir" >&2
      exit 1
    fi
    ;;
esac
```

`wslpath` is the WSL translation primitive (`wslpath -w
/mnt/c/foo` → `C:\foo`); `cygpath` is the Git Bash translation
primitive (`cygpath -w /c/Users/foo` → `C:\Users\foo`). Both are
invoked unconditionally; one will exist on every supported Windows
shell. Linux and macOS users never enter this branch because their
paths do not match `/mnt/<drive>/`.

The renderer output stays in the rendered target dir, which is also
on the Windows mount under WSL; `$installed_root="$config_dir/opencode.jsonc"`
becomes `C:\Users\<user>\.config\opencode\opencode.jsonc`. The `mv`
from `rendered_tmp` (which is in WSL's `/tmp`, not on the Windows
mount) to `$installed_root` is a cross-filesystem move; on the 9p
mount, `mv` does the right thing.

The `link()` helper still creates symlinks with `ln -sfn "$source"
"$target"`. Under WSL, `ln` is GNU coreutils and handles mixed
POSIX/Win32 paths correctly via the 9p translator.

### Decision: `install.sh` resolves `node` to a verified path, then threads it

`command -v node` returns exit code 0 with empty stdout on Git Bash
on this host when only `node.exe` is on PATH. That makes
`if ! command -v node; then … fi` unreliable. The new resolution:

```bash
NODE_BIN="$(command -v node 2>/dev/null || true)"
[ -z "$NODE_BIN" ] && NODE_BIN="$(command -v node.exe 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  printf 'install.sh: node is required to render the selected profile; install Node.js >= 18.\n' >&2
  exit 1
fi
```

Every subsequent `node …` invocation in `install.sh` is rewritten to
`"$NODE_BIN" …`. Five call sites: lines 91, 106, 112, 133, 152, 160
in the current `install.sh` (six total when the inline JSON lookups
are counted).

`PATH` on Git Bash on Windows includes the winget node path
(`C:\Users\…\AppData\Local\Microsoft\WinGet\Packages\…\node-v24.19.0-win-x64`)
when the operator has run `winget install OpenJS.NodeJS.LTS`, but the
Git Bash implementation of `command -v` does not strip the `.exe`
suffix automatically. `command -v node.exe` resolves; `command -v node`
returns success with empty stdout. The order above (`node` first, then
`node.exe`) works on every shell.

Alternatives considered:

- **Add a shim script `node` that wraps `node.exe` and is prepended to
  PATH.** Rejected: requires operator setup before `install.sh` runs;
  contradicts the "single command" UX.
- **Detect Windows and search `%ProgramFiles%\nodejs`, nvm-windows,
  and winget paths directly.** Rejected: brittle, drifts as Windows
  installers change; the `command -v` lookup already covers every
  standard install path on Windows.
- **Document that the operator must `PATH=…/node.exe:$PATH` before
  running install.sh.** Rejected: defeats the single-command goal.

### Decision: check #9 inspects the Git index, not the working tree

`git ls-files -z` enumerates every path Git knows about. For each
path, `git show :<path>` reads the blob from the index (or HEAD if
the file is not staged). That is what `git commit` will store and
what every clone will see. A CRLF blob in the index is a CRLF blob
on every checkout, regardless of the operator's local
`core.autocrlf`.

The check inspects the blob buffer for the `\r\n` byte sequence.
Files with extensions that are not parsed by the installer
(`.png`, `.jpg`, `.gif`, `.ico`, `.webp`, `.woff2`, `.ttf`, `.otf`,
`.pdf`, `.zip`, `.tar`, `.gz`, `.wasm`) are skipped; Git's
`isBinary` heuristic handles the rest, and `.gitattributes`
`text=auto` keeps the contract narrow.

The check is one function in `scripts/validate-config.mjs`. It runs
on every `validate-config.mjs` invocation (default and `--profile`
modes) and exits non-zero with the offending path. It is
idempotent and read-only; it does not modify the working tree.

Alternatives considered:

- **Inspect the working tree file directly with `readFileSync`.**
  Rejected: returns CRLF when the operator's `core.autocrlf=true`
  has materialized the blob as CRLF on disk, even after the
  renormalize commit. The check would then fail forever on Windows.
- **Run `git diff --check` on the whole tree.** Rejected: only
  inspects the working tree vs the index, not the index itself.
- **Run `git ls-files -z | xargs -0 … | grep -l $'\r\n'`.** Rejected:
  requires the operator to have grep and a POSIX shell, defeats the
  purpose of having a Node-side check.

### Decision: only the four shells are supported, documented, and tested

The supported matrix is the four shells the README names: native
Linux bash, native macOS bash, WSL Ubuntu bash, Git Bash on Windows.
Each is documented with the exact one-line invocation, the
prerequisite (Node.js ≥ 18), and the expected terminal output
("OpenCode configuration linked from …").

Other shells (zsh, fish, dash, Nushell) are out of scope. PowerShell
native (without bash) is also out of scope; the Windows path is Git
Bash + PowerShell-as-launcher, not PowerShell-as-shell. That decision
is documented in the README and in the `installer-portability` spec.

### Decision: renormalize only the shell/runtime files

Of the 404 CRLF blobs in `origin/main`, this commit renormalizes the
ones in the installer's runtime path:

- `.sh`: `install.sh`, `scripts/install-nerd-fonts.sh`
- `.mjs`: every `scripts/*.mjs`, every `agent/lib/*.mjs`,
  every `agent/lib/test/*.mjs`
- `.js`: `agent/lib/*.js` (if any)
- `.ts`, `.tsx`: `quota-tui.tsx`, `tui.jsonc` is JSONC and stays
  out of this change
- `.ps1`: `scripts/install-nerd-fonts.ps1` and
  `scripts/test-install-nerd-fonts.ps1`

Everything else (`.md`, `.json`, `.jsonc`, `.yaml`) stays as is and
is called out as a known follow-up. The check #9 only fires on the
shell/runtime extensions above, so leaving the rest alone does not
regress the gate.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `wslpath`/`cygpath` path translation changes the renderer input in unexpected ways | Low | Both tools are deterministic and well-documented; translation is logged in `--verbose` mode (future enhancement) |
| `command -v node` resolution adds measurable startup overhead | Negligible | Two `command -v` calls, no subprocess |
| Check #9 is slow on large repos | Low | One `git show` per file, run once per validation; current repo has ~3000 files, takes well under 1s |
| A new contributor on Windows with `core.autocrlf=true` accidentally introduces CRLF | Low (now caught) | Check #9 in `validate-config.mjs` is the gate; the contributor runs `git status` and sees the failure |
| `.gitattributes` rewrites a binary file on checkout | Negligible | `text=auto` lets Git classify; fonts and images are correctly identified |
| PowerShell-native users (without bash) hit a wall | Low | Documented: the supported Windows path is Git Bash + PowerShell-as-launcher, not PowerShell-as-shell |
| The new `.gitattributes` clashes with a future contributor's `.git/info/attributes` | None | `.gitattributes` is the repo-wide mechanism; personal overrides win by layering, no conflict |

## Validation gates

`/opsx-apply` MUST NOT complete until every gate below is green:

1. **`git ls-files | xargs git show :` shows LF for every `.sh`, `.ps1`,
   `.mjs`, `.js`, `.ts`, `.tsx` blob in the index.** Verified by
   `scripts/validate-config.mjs` check #9 returning zero.
2. **`node scripts/validate-config.mjs --profile personal` exits 0**
   and prints `validate-config: OK`.
3. **`node scripts/test-model-profiles.mjs` exits 0** and prints
   `all checks passed`.
4. **`openspec validate installer-cross-platform-fixes --strict` exits
   0**.
5. **`openspec validate --specs --strict` exits 0**.
6. **`bash ./install.sh --help` does not abort on the `set -euo
   pipefail` line and prints the new shell matrix in the help body.**
7. **`bash ./install.sh --profile personal` runs end to end on the
   operator's WSL Ubuntu shell** and prints `OpenCode configuration
   linked from <path>`.

Gates 1–6 are scriptable. Gate 7 is the operator's manual smoke test;
the proposal calls it out explicitly so the operator knows it is the
last step before `/opsx-archive`.

## Out of scope (deferred)

- Renormalization of `.md`, `.json`, `.jsonc`, `.yaml` to LF. These do
  not affect the installer. A follow-up change can do a wholesale
  `git add --renormalize .` after this one lands.
- A `--verbose` mode for `install.sh` that logs each translation step.
- A CI workflow that runs `node scripts/validate-config.mjs` on every
  push. The repo is operator-private; CI is intentionally absent.
- A `tests/` directory with golden-output smoke tests for `install.sh`.
  The current gate is `bash ./install.sh --help` plus the operator's
  manual end-to-end run.
