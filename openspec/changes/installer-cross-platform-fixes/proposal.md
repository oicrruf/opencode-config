## Why

The repository declares "Linux, macOS, or Windows" support but `install.sh`
only works in a narrow subset of that surface today. Three concrete defects
block the documented matrix, and one latent defect will silently break any
future Windows contributor:

1. **`install.sh` aborts on line 2.** The script is committed with Windows
   CRLF line endings, so `set -euo pipefail\r` is rejected by bash with
   `set: pipefail: invalid option name`. The same bug exists in
   `scripts/install-nerd-fonts.sh`. The repository has no `.gitattributes`
   to control EOL, so `core.autocrlf=true` on Windows checkouts is the
   default behaviour and is the cause.

2. **`command -v node` is unreliable on the documented Windows path.** When
   the operator runs `bash ./install.sh` from PowerShell with `node.exe` on
   PATH, `install.sh` reports `node is required` and exits 1, even though
   `node.exe` is present and invok able. Git Bash on this host resolves
   `node.exe` only when `command -v node.exe` is asked; `command -v node`
   returns success with an empty stdout, which `install.sh` does not
   validate, so the subsequent `node ...` invocation launches nothing.

3. **WSL cannot drive `node.exe` through `install.sh` today.** When
   `install.sh` runs from WSL Ubuntu and the user has only `node.exe`
   (a Windows binary) on PATH, `install.sh` resolves `$repo_dir` to a path
   like `/mnt/c/Users/.../opencode-config` and passes that path to
   `node.exe`. `node.exe` is a Win32 binary; its `fs.readFileSync` does not
   translate `/mnt/c/...` and tries `C:\mnt\c\...`, which fails with
   `ENOENT`. This is the only native Windows path that lets the operator
   keep WSL as their daily shell, and it does not work.

4. **There is no static guard for line endings.** The repository has 404
   files committed with CRLF (excluding `.node_modules`). Of those, all
   `.sh` and `.mjs` scripts are shell/runtime parsed and a single new
   CRLF file in `scripts/` re-introduces the abort from defect (1).

The goal is a cross-platform installer that runs to completion on the
four shells the repo claims to support — Linux bash, macOS bash, WSL
Ubuntu bash, and Git Bash on Windows (launched from either CMD or
PowerShell) — and a static gate that prevents CRLF from sneaking back
in.

## What Changes

- Add `.gitattributes` with `* text=auto eol=lf` so future commits keep
  shell and runtime files LF regardless of `core.autocrlf` on the
  contributor's checkout.
- Add a `repo_dir` translation step in `install.sh` that converts
  `/mnt/<drive>/...` paths to `<Drive>:\...` when `wslpath` (WSL) or
  `cygpath` (Git Bash on Windows) is available, with a clear error when
  neither is present.
- Replace the `command -v node` check in `install.sh` with a robust
  resolution that tries `node` then `node.exe` and validates that the
  resolved binary is executable, then threads the resolved path through
  every `node ...` call.
- Extend the `--help` output of `install.sh` to list the four supported
  shells and the per-shell prerequisites.
- Renormalize the existing CRLF files that are in scope of the new gate
  (`.sh`, `.ps1`, `.mjs`, `.js`, `.ts`, `.tsx`, `.cjs`, `.mts`, `.cts`)
  to LF in this change. Non-executable artefacts (`.md`, `.json`,
  `.jsonc`, `.yaml`) are deliberately left out of this change; a
  follow-up may renormalize them, but they are not blocking the
  installer.
- Add check #9 to `scripts/validate-config.mjs` that fails when any
  tracked file with a shell/runtime extension has CRLF line endings, by
  inspecting the Git index via `git show :<path>` so the check reflects
  what is committed, not the operator's working tree.
- Add a new `installer-portability` capability under
  `openspec/specs/installer-portability/spec.md` with the requirements
  and scenarios for the four supported shells, the node resolution
  rules, the EOL contract, and the platform report on `--help`.
- Add a `MODIFIED` delta to `installation-model-profiles` that defers
  the Windows installer narrative to `installer-portability`, and a
  `MODIFIED` delta to `install-nerd-fonts` that documents the Windows
  bash fallback (no `install-nerd-fonts.sh` invocation; explicit
  pointer to the `.ps1`).
- Update `README.md` to enumerate the four supported shells with the
  exact command per shell, and update `AGENTS.md` with a one-paragraph
  note about the LF contract and the new check #9.

## Capabilities

### New Capabilities

- `installer-portability`: the cross-platform installer behaviour, the
  node resolution rules, the EOL contract, and the platform report.

### Modified Capabilities

- `installation-model-profiles`: clarify that the Windows installer
  narrative is governed by `installer-portability`, and add a scenario
  that the installer reaches `OpenCode configuration linked from ...`
  end to end on each supported shell.
- `install-nerd-fonts`: state that `install.sh` does not invoke the
  bash font installer on Windows, and point to `install-nerd-fonts.ps1`
  as the documented Windows path.

## Impact

- `install.sh` — add path translation and node resolution hardening
- `scripts/install-nerd-fonts.sh` — line ending normalization only
- `scripts/render-config.mjs` — line ending normalization only
- `scripts/validate-config.mjs` — add check #9 (LF guard for
  shell/runtime files in the Git index)
- `scripts/test-model-profiles.mjs` — line ending normalization only
- `scripts/acceptance-harness.mjs` — line ending normalization only
- `scripts/doctor.mjs` — line ending normalization only
- `agent/lib/*.mjs` and `agent/lib/test/*.mjs` — line ending
  normalization only (runtime parsed)
- `.gitattributes` — new file, `* text=auto eol=lf`
- `openspec/specs/installer-portability/spec.md` — new capability
- `openspec/specs/installation-model-profiles/spec.md` — delta
- `openspec/specs/install-nerd-fonts/spec.md` — delta
- `README.md` — installation section expanded to four shells
- `AGENTS.md` — short note about the LF contract and check #9
- `openspec/changes/installer-cross-platform-fixes/` — proposal,
  design, tasks, and spec deltas

## Non-Goals

- No renormalization of `.md`, `.json`, `.jsonc`, `.yaml`, or any other
  non-runtime file in this change. They are not blocking the installer
  and touching them inflates the diff for no functional gain. A
  follow-up change may renormalize them after this one lands.
- No new installer entry points. `install.sh` stays the single entry
  point for Linux, macOS, WSL, and Git Bash; `install-nerd-fonts.ps1`
  stays the Windows-native font entry point.
- No change to the model profile manifest, the renderer, the
  validator's profile-aware checks, or the acceptance harness routing
  checks. Those contracts are owned by their respective changes.
- No support for `sh` (POSIX shell), `dash`, `zsh`, or `fish`. The
  shebang `#!/usr/bin/env bash` and the `set -euo pipefail` baseline
  stay; bash 3.2+ (macOS default) remains the floor.
