## Why

`bash ./install.sh` on `main` aborts before it links anything:

```
install.sh: profile=personal
validate-config: skip — models catalog not found at C:\Users\VictorReyes\.cache\opencode\models.json; ollama-cloud/gpt-oss:20b and other provider/model ids are not checked
validate-config: commands\mmx.md: injects 'mmx-cli/SKILL.md' but skills/mmx-cli/SKILL.md does not exist
validate-config: commands\mmx-h3-video.md: injects 'mmx-cli/h3-video/SKILL.md' but skills/mmx-cli/h3-video/SKILL.md does not exist
OpenCode configuration validation failed; refusing to link.
```

Two independent defects are visible in that transcript.

**1. Check 5b treats a local-only skill as a repository defect.**
`commands/mmx.md` and `commands/mmx-h3-video.md` inject
`~/.config/opencode/skills/mmx-cli/SKILL.md` and
`~/.config/opencode/skills/mmx-cli/h3-video/SKILL.md`. `skills/mmx-cli`
is a **local-only symlink**: `.gitignore:27-29` excludes `/skills/mmx-cli`
with the comment "Local-only skill symlinks (e.g. skills/mmx-cli -> an
absolute path in $HOME). Real skills are committed as directories;
absolute symlinks break on clone." It was never committed
(`git log --all -- skills/mmx-cli` is empty) and it does not exist on the
host. Check 5b in `scripts/validate-config.mjs:350-365` calls
`fail()` for every missing injected path, so the validator exits 1 and
`install.sh:200-204` refuses to link. A fresh clone therefore **cannot
install at all** unless the operator happens to have the mmx-cli skill
checked out in `$HOME` first.

Verified as the sole blocker: with two stub files planted at
`skills/mmx-cli/SKILL.md` and `skills/mmx-cli/h3-video/SKILL.md`, the
validator prints `validate-config: OK` and exits 0. The stubs were removed
afterwards. The `skill-surface` spec already requires that check 5b fail on
a missing path — but it does not distinguish a *committed* skill that went
missing from a *local-only* skill that was never meant to be in the repo.
That distinction is the defect.

**2. The Windows-looking paths are a platform mismatch the installer never
reports.** This host is WSL2 with no Linux `node` on PATH;
`install.sh:151-152` falls back to
`/mnt/c/Program Files/nodejs/node.exe`. Node then reports
`process.platform === 'win32'` and `os.homedir() === 'C:\Users\VictorReyes'`,
which is why the catalog path prints with drive letters and backslashes.
Two consequences the operator cannot see:

- The models-catalog check silently skips, so `ollama-cloud/gpt-oss:20b`
  and every other model id are **never validated** on this host. The skip
  is indistinguishable from "this machine never started OpenCode".
- `install.sh:12-29` only translates `repo_dir` when it matches
  `/mnt/[a-zA-Z]/*`. This repo lives at `/home/vmreyes/Projects/...`, so no
  translation happens. Node still resolves the Linux absolute paths only
  by accident: WSL interop sets the child's cwd to
  `\\wsl.localhost\Ubuntu\home\...`, and Win32 resolves `/home/...`
  against that UNC share. Move the repo anywhere the UNC fallback does not
  cover and the same command breaks with a bare ENOENT.

The installer never mentions either condition. The
`installer-portability` spec covers WSL only for a repo under `/mnt/<drive>`
with `wslpath` available; it says nothing about WSL with a repo under `$HOME`
and a Windows node, which is the configuration this host is actually in.

## What Changes

- Make check 5b distinguish local-only skills from repository skills. A
  missing injected path that Git ignores SHALL emit a warning naming the
  path and how to satisfy it; a missing injected path that Git tracks (or
  would track) SHALL keep failing the validator. When Git itself is
  unavailable or the tree is not a repository, the check SHALL stay strict.
- Have `install.sh` detect that it resolved `node.exe` while running under
  WSL, and print a warning covering the three consequences: the
  Windows-side home used for the models catalog, the silent catalog skip,
  and the config directory that ends up on the Linux side of the fence
  while `opencode.exe` reads the Windows one.
- Make the validator's catalog-skip notice actionable when it fires under a
  Windows node, so `node scripts/validate-config.mjs` run by hand is as
  informative as the installer.
- Document in `installer-portability` that a WSL repo under `$HOME` is
  resolved through the interop UNC cwd rather than `wslpath`, and state
  that reliance as unsupported-but-observed behaviour.

## Capabilities

### Modified Capabilities

- `skill-surface`: extend `Command wrappers preserve the skill as single
  source of truth` so a Git-ignored (local-only) injected skill warns
  instead of failing, while a committed-but-missing skill still fails.
  Authoritative when `git check-ignore` answers; falls back to a
  conservative literal match against `.gitignore` (optional leading `/`,
  directory suffix, unanchored segment match) when Git is unavailable.
  Unknown rules stay strict.
- `agent-routing`: extend `Configured model ids resolve against
  authenticated providers` so the missing-catalog skip notice names the
  remedy when the catalog was looked up under a Windows home.

### Added Capabilities

- `installer-portability`: add a requirement that the installer warns
  when it resolves a Windows node on WSL, covering the home-directory
  split, the catalog skip, and the install target.

## Impact

- `scripts/validate-config.mjs` — check 5b gains a Git-ignore lookup; the
  catalog skip notice gains a conditional extra line
- `install.sh` — one WSL-detection block after the node resolution
- `openspec/specs/skill-surface/spec.md`, `openspec/specs/agent-routing/spec.md`,
  `openspec/specs/installer-portability/spec.md` — spec deltas
- `scripts/acceptance-harness.mjs` — coverage for both new behaviours
- `openspec/changes/unblock-fresh-clone-install/` — this proposal, design,
  tasks, and spec deltas

## Non-Goals

- No `mmx-cli` skill content is added to the repository. The local-only
  symlink convention stays; only the validator's treatment of it changes.
- No change to `install.sh`'s exit codes or to its "refusing to link"
  message. Genuine repository defects still block the install.
- No promotion of local-only warnings to failures. Considered and rejected:
  an `OPENCODE_STRICT_LOCAL_SKILLS=1` escape hatch. Nothing in the repo's
  gates needs it today, and a toggle that nobody sets is untested surface.
- No automatic `XDG_CONFIG_HOME` rewriting. Which side of the WSL fence the
  configuration belongs on is an operator decision (see design.md, Open
  question 1), not something the installer should guess.
- No vendoring of `node.exe` path translation for the `$HOME`-under-WSL case.
  The installer will warn; it will not start translating paths that already
  resolve.