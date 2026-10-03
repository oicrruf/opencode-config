# Design

## Context

The user just installed WSL Ubuntu from scratch and ran `./install.sh`
for the first time. The script aborts mid-link. Two pre-existing defects
surface, both invisible to today's `installer-portability` spec:

1. `link()` (lines 314-333) does not create the target's parent
   directory, so the first install on any host whose `$config_dir`
   subtree is fresh fails with `ln: No such file or directory` on the
   `plugins/herdr-agent-state.js` link.
2. The Nerd Font step needs `unzip` and `curl`, but the script does not
   check for them; the user only sees the failure when the font
   download attempts to extract.

This change makes `./install.sh` finish on a clean WSL Ubuntu host with
no operator workarounds, and tightens the spec so the next reviewer can
see that contract.

## Goals / Non-Goals

**Goals**

- A fresh clone on a clean WSL Ubuntu host with native `node >= 18`,
  `git`, `curl`, and `unzip` available runs to completion and prints
  `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.
- The same host *without* `unzip` finishes the OpenCode links
  (non-fatal font step stays non-fatal) but prints a clear, actionable
  warning *before* the font step that names `unzip` and points at
  `apt install unzip`.
- The `link()` step is robust against any new target whose parent
  directory is missing.

**Non-Goals**

- No change to the WSL+Windows-node guard, the path translation, the
  `node` resolution, or any profile assignment. This change is
  strictly about the *last* mile of a clean install.
- No promotion of the Nerd Font step to a gate. Long-running installs
  in CI deliberately skip it via `OPENCODE_INSTALL_NERD_FONTS=0`; we
  don't want to break that escape hatch.
- No new diagnostic about `lazygit` / `lazydocker`. Those warnings
  already exist at the bottom of the script and are out of scope.

## Decisions

### Decision 1: `link()` creates the parent directory

The `link()` function becomes:

```sh
link() {
  local source="$1"
  local target="$2"
  local target_dir
  target_dir="$(dirname -- "$target")"
  if [ ! -d "$target_dir" ]; then
    mkdir -p -- "$target_dir"
  fi
  # existing back-up + ln -sfn logic ...
}
```

**Why inside `link()` and not a one-off `mkdir` before the `plugins/`
line.** Any future `link` call that lands in a new subdirectory gets
the fix automatically, and the call sites stay readable. The cost is
one `dirname` and a `mkdir -p` per link, both of which are no-ops when
the directory already exists.

**Why not `mkdir -p` everywhere up-front.** The script already does
`mkdir -p "$config_dir"` once. Adding more would be redundant and would
force a re-derivation of the target tree every time the script runs.

### Decision 2: Hoist the prerequisite check to the start

Today the prerequisite check is at the bottom of the script, in the
`doctor` block (lines 421-441), and it only reports `openspec`,
`lazygit`, and `lazydocker`. Move a *narrow* check to right after the
`node` resolution (around line 162) that warns about the tools the rest
of the script will actually use: `git` (the validator's check #9), and
`unzip` + `curl` (the Nerd Font step). The bottom-of-script
`missing_deps` block stays for the slower / more discretionary tools.

The early warning prints to stderr and exits 0; the script continues
and the Nerd Font step's own failure path stays non-fatal. The reason
to hoist is sequencing: by the time the existing check fires, the
operator has already watched the validator, the renderer, the link
step, and the font step run, so a missing `unzip` is a confusing
postscript. With the early check, the operator knows upfront.

**Why not gate.** A gate would break installs on hosts that
deliberately skip the font (CI). The warning is enough.

### Decision 3: Add a WSL + native-Linux-node + repo-under-`/mnt/...`
warning

If `repo_dir` is under `/mnt/<drive>/` and the resolved `node` is a
native Linux binary, the install will run but `config_dir` lands on
the Linux side while the repo is on the Windows side. That is the
opposite of what most operators want. The spec should document the
shape; the script should print a one-liner.

The detection is `repo_dir=/mnt/*` AND `node_is_windows=0`. Print to
stderr, continue, exit 0.

### Decision 4: Spec wording

The spec scenarios follow the existing template. The two new scenarios
under Requirement: Installer runs to completion on every supported
shell cover the clean-WSL and missing-`unzip` cases. The two new
scenarios under Requirement: Installer translates WSL and Git Bash
paths to Windows cover the WSL+native-node + repo-under-`/home` and
WSL+native-node + repo-under-`/mnt` cases.

No scenario contradicts an existing one. The WSL+Windows-node
requirement (Requirement: Installer warns when it resolves a Windows
node on WSL) keeps its current wording — that warning is about
`node.exe`, not the native-node case this change introduces.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `mkdir -p` inside `link()` masks a misconfigured `target` (typo) by silently creating an unintended directory | The current code path requires every `target` to be inside `$config_dir`, which `install.sh` controls. The risk is contained. |
| Hoisted prerequisite check makes the install verbose | The check is two or three lines on stderr, only when something is missing. Same pattern as the existing `node is required` error. |
| WSL + `/mnt/...` + native-node warning repeats the same advice as the WSL + Windows-node guard | Different condition (native vs Windows node), different remedy (move repo to `/home` or set `XDG_CONFIG_HOME`). The wording will be distinct. |
| `git` is hard to require; some WSL Ubuntu installs come without it | The validator already shells out to `git`. If `git` is missing, the script still installs; the validator skips the catalog check the same way the existing `git not on PATH` branch already does. No behaviour change. |

## Migration Plan

1. Land the `link()` and the hoisted prerequisite check.
2. Re-run `./install.sh` on this WSL host; confirm the link step
   completes without `mkdir` manual, and that the prerequisite warning
   fires (or doesn't, depending on what is installed).
3. Add the spec scenarios and the acceptance-harness checks.
4. No data migration; nothing in the change moves installed state.

## Open Questions

1. **Should the script suggest `apt install unzip` automatically, or
   stay distro-agnostic?** Today the doctor block says
   `apt/dnf/pacman (Linux)`; we will follow the same pattern in the
   hoisted check. The fix is operator-visible text, not a
   distro-detection agent.

2. **Should `link()` also `chmod` the parent to a safe mode?** No — the
   parents are under `$config_dir`, which `opencode` itself manages.
   Out of scope.