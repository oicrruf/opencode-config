## Why

`bash ./install.sh --profile personal` on a clean WSL Ubuntu machine
(the configuration the user just stood up) aborts partway through the
link step on every first-time install:

```
install.sh: installed rendered personal profile to <config_dir>/opencode.jsonc
install-nerd-fonts: resolving latest JetBrainsMono Nerd Font release ...
install-nerd-fonts: error: unzip is required to extract the font archive but was not found on PATH
ln: No such file or directory
```

Two pre-existing defects are visible in that transcript, and the spec
that is supposed to cover this case says nothing about either of them.

**1. `link()` does not create the target's parent directory** (lines
314-333). Every `link` call assumes its `target` already lives under a
directory that exists, but `install.sh` only does `mkdir -p "$config_dir"`
once (line 249). The call that links `plugins/herdr-agent-state.js` lands
in `$config_dir/plugins/`, which was never created, so `ln -sfn` aborts
with "No such file or directory" — and because `set -euo pipefail` is
in effect, the script dies before the gate summary prints, the
`OpenCode configuration linked from <path>` line is never emitted, and
the operator is left guessing whether the install succeeded. The same
defect would bite any future `link` target whose parent is not already
in place.

**2. The Nerd Font step requires `unzip` (and `curl` for the release
lookup) but the installer never checks for them.** On a clean WSL
Ubuntu install, none of them are present by default; the script
downloads the font, the extraction fails, and the rest of the install
succeeds anyway only because the step is non-fatal — but the operator
gets a warning without an actionable hint, and the rendered config
relies on the TUI's `nf-md-*` icons that won't render without the font.
The non-fatal design is correct; the silence on `unzip` is the bug.

The `installer-portability` spec covers the WSL and Windows shells
(Requirement: Installer runs to completion on every supported shell;
Requirement: Installer translates WSL and Git Bash paths to Windows;
Requirement: Installer warns when it resolves a Windows node on WSL),
but no scenario in those requirements states that a clean WSL Ubuntu
host with a native Linux `node` and a fresh clone in `/home/<user>/`
runs to completion without operator workarounds, nor that prerequisite
tools are reported before they block the install.

A third, smaller gap: a WSL host whose repo lives under `/mnt/c/...`
and whose `node` is a **native Linux** binary (the WSL default once you
install one) gets no WSL warning and no path translation, but the
`config_dir` derived from the Linux `$HOME` lands on the Linux side
while the repo was on the Windows side. Today the spec scenario for
"WSL Ubuntu with repo under /mnt/c" is written against `node.exe`, so
the native-node variant is undocumented.

## What Changes

- Make `link()` create the target's parent directory before invoking
  `ln -sfn`, so any first-time install completes without an operator
  `mkdir` step. Apply this to every `link` call without changing the
  public surface (still symlinks to the same targets).
- Move the prerequisite check (`unzip`, `curl`, `git`) up to the start
  of the install, alongside the existing `node` and `openspec` checks,
  so the operator learns what is missing *before* the install
  attempts to use them. The existing non-fatal-on-failure behaviour
  for the Nerd Font step stays; the new check is a warning, not a gate.
- Document the WSL + native-Linux-node + repo-under-`/mnt/...`
  configuration in the spec, and warn (non-fatally) that `config_dir`
  is on the Linux side while the repo is on the Windows side.
- Document the WSL + native-Linux-node + repo-under-`/home/...`
  configuration as the supported clean install, including the
  `plugins/` parent fix and the `unzip` prerequisite notice.

## Capabilities

### Modified Capabilities

- `installer-portability`:
  - Extend `Installer runs to completion on every supported shell` to
    state that prerequisite tools (`unzip`, `curl`, `git`) are checked
    and reported before the install tries to use them, and that the
    `link` step creates any missing parent directories.
  - Extend `Installer translates WSL and Git Bash paths to Windows`
    with two scenarios: a WSL host with a native Linux `node` and a
    repo under `/home/<user>/` runs to completion without translation,
    and a WSL host with a native Linux `node` and a repo under
    `/mnt/<drive>/` is not translated but warns that `config_dir`
    lives on the Linux side.

## Impact

- `install.sh` — `link()` adds `mkdir -p $(dirname "$target")`; the
  prerequisite check is hoisted to print `unzip` / `curl` / `git`
  warnings before the Nerd Font step.
- `openspec/specs/installer-portability/spec.md` — scenarios added to
  the two MODIFIED requirements; no wording change to existing
  scenarios.
- `scripts/acceptance-harness.mjs` — one new static check that the
  Nerd Font prerequisite list is reported by `install.sh` in a
  pre-install dry run, and one that the rendered `link` target set
  includes `plugins/herdr-agent-state.js` whose parent directory was
  pre-created.
- `openspec/changes/install-on-clean-wsl/` — this proposal, design,
  tasks, and the spec delta.

## Non-Goals

- No change to the `node` resolution or the WSL/Windows-node guard
  shipped in `unblock-fresh-clone-install`. Both stay.
- No promotion of the Nerd Font step to a hard gate. The existing
  non-fatal behaviour is the right answer for a long-running install.
- No rewrite of the path translation table for the
  `/mnt/<drive>/...` + native-node case. The new scenario is a
  documentation delta, not a behaviour change.
- No new profile, model assignment, or skill. This change makes
  `./install.sh` finish on a clean host, nothing more.