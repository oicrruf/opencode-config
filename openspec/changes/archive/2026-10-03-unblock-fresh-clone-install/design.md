# Design

## Context

Two unrelated blockers stand between a fresh clone and a working install on
this host. Both are silent-today: the first stops the installer with a
message that points at the wrong thing (a missing file instead of a missing
local checkout), and the second changes behaviour without saying anything.

Constraints that shaped the decisions below:

- `install.sh` runs before `opencode` has ever been started on the machine.
  Any new check must therefore tolerate a virgin environment.
- The validator is invoked by three callers: `install.sh` (twice — source
  tree and rendered output), and directly by the operator. All three see
  the same repo checkout, so a repo-local notion of "local-only" is
  available to all of them.
- `scripts/validate-config.mjs` already shells out to Git for check #9
  (`execFileSync('git', ['ls-files', '-z'])` at line 213 and
  `git show :<path>` at line 236), and already degrades gracefully when Git
  is absent (line 219 comment). A Git-based decision introduces no new
  dependency.

## Goals / Non-Goals

**Goals**

- `./install.sh` completes on a fresh clone that has no local-only skills
  linked, while still refusing to install when a committed skill is broken.
- The operator learns, from install output alone, that a Windows node on WSL
  degrades catalog validation and splits the install target.

**Non-Goals**

- Shipping `mmx-cli` content in the repository.
- Making the WSL `$HOME`-repo case a first-class supported layout (it works
  by accident today; this change documents the accident and warns, it does
  not engineer support for it).
- Changing any model assignment, profile, or gate threshold.

## Decisions

### Decision 1: Git-ignored means local-only

Check 5b classifies a missing injected path with `git check-ignore`:

```
git check-ignore -q -- skills/mmx-cli/SKILL.md
```

Exit 0 means the path is ignored by the repository, which is exactly the
convention `.gitignore:27-29` documents for local-only skill symlinks.
Then the validator warns instead of failing. A non-zero result normally
means the path is not ignored and remains a strict failure.

If Git cannot answer, the validator falls back to reading `.gitignore` for
a conservative literal-path match. This is required on this WSL host:
Windows Git resolves the WSL checkout to `\\wsl.localhost\...` and refuses
it as "dubious ownership" (exit 128), so the authoritative lookup is
unavailable exactly where the distinction matters. The fallback handles
literal rules with optional leading `/`, trailing-slash directory markers,
and unanchored path-segment matches; it deliberately skips glob and
negation syntax. Anything it cannot decide remains a strict failure. Git
stays authoritative when available, while the documented
`/skills/mmx-cli` convention works even when Git is unusable.

**Why not an explicit allowlist file** (`config/local-only-skills.json`
listing `["mmx-cli"]`). It is more explicit and needs no Git at runtime, but
it adds a second source of truth that must be edited in lockstep with
`.gitignore`. The ignore pattern already exists, already carries a comment
explaining the intent, and is enforced by Git itself. Two lists describing
the same fact drift.

**Why not "warn for everything missing".** That deletes the check's whole
purpose. The `skill-surface` spec requires a renamed or deleted committed
skill to fail validation rather than ship a wrapper that injects nothing;
`/archify` is the canonical case. Git-ignore lookup preserves that guarantee
exactly where it matters.

**Why a conservative fallback instead of strict on missing Git.** Strictness
is retained for unknown rules. Refusing to match the exact literal
`/skills/mmx-cli` in `.gitignore` would silently revert to the bug today
whenever Git is unusable, which on Windows / WSL with Git-for-Windows is the
common case. The literal parser is deterministic, has no subprocess cost,
and does not weaken the guard for committed skills.

**Cost.** One `execFileSync` per missing path, and only on the failure
branch — the happy path spawns no Git process. Each call is ~5ms; the
realistic number of missing injected paths on a fresh clone is two.

**Naming the warning.** The message keeps the existing phrasing so existing
grep habits still work, and appends the remedy:

```
validate-config: warn — commands/mmx.md injects 'mmx-cli/SKILL.md' but
skills/mmx-cli/SKILL.md does not exist; it is a local-only (git-ignored)
skill, so /mmx will inject nothing until you link it:
ln -s <path-to>/mmx-cli skills/mmx-cli
```

Warnings go to stdout alongside the existing `skip` notice, matching how
the catalog skip already reports a non-fatal condition. They do not affect
the exit code.

### Decision 2: Detect WSL in bash, warn once, keep going

After the node resolution at `install.sh:151-156`, and before any node
subprocess runs, install.sh evaluates:

```
case "$NODE_BIN" in *.exe|*.EXE) windows_node=1 ;; *) windows_node=0 ;; esac
```

and WSL is detected as `WSL_DISTRO_NAME` being non-empty **or**
`/proc/version` containing `microsoft`. When both hold, print a warning
block and continue.

**Why warn rather than fail.** The user needs the install to run. A WSL +
Windows-node host is a legitimate configuration the
`installer-portability` spec already blesses for repos under `/mnt/<drive>`.
Refusing there would be a regression.

**Why detect on both signals.** `WSL_DISTRO_NAME` is set by WSL's own shell
integration but not exported in every non-interactive context; the
`/proc/version` kernel string is the reliable one. Either alone produces
false negatives on some hosts.

**Why require the `.exe` suffix too.** Git Bash on Windows resolves
`node.exe` and is a *supported* shell where a Windows node is expected and
the home directories agree. Warning there would be noise. The hazard is
specifically the Linux/Windows home split, which only exists when the shell
is Linux and the node is Windows.

**Why warn before the first node call.** The warnings concern `homedir()`
resolution and the catalog lookup, both of which the operator needs context
for while reading the validator output that follows. Emitting them after
the validator's own skip notice would put the explanation below its effect.

### Decision 3: Make the catalog skip self-explaining

`scripts/validate-config.mjs:491-497` already prints the absolute catalog
path, which is why the Windows path leaked into the transcript. When
`process.platform === 'win32'` and the resolved path is not the POSIX home,
append one line naming the cause and the remedy. Guarding on the platform
keeps native Linux output byte-identical.

### Decision 4: Warn about the install target too

`config_dir` is `${XDG_CONFIG_HOME:-$HOME/.config}/opencode`, expanded by
bash, so under WSL it is always the **Linux** path. `opencode.exe` reads the
**Windows** user profile. A completed install can therefore be inert. The
warning names both paths so the operator can decide, rather than the
installer deciding for them.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Weakening check 5b lets a genuinely broken committed wrapper through | Only Git-ignored paths downgrade; `archify` and every other committed skill keep failing. Covered by a planted test (tasks 3.2). |
| `git check-ignore` adds a subprocess to the failure path | Only runs when a path is already missing; bounded at the number of injected paths. When Git is unusable the literal `.gitignore` reader takes over and keeps the strict guarantee for everything it cannot classify. |
| Warning output grows on a fresh clone (two extra blocks) | The alternative is an install that refuses to run for a documented, intentional reason. Warnings are the honest report. |
| Operator installs to the Linux config dir and never notices | Decision 4 names both paths in the same warning that explains the node mismatch. |
| Docs drift: README claims the install is one command | The README task in this change records the local-skill link step. |

## Migration Plan

1. Land the validator change. Fresh clones warn instead of failing; machines
   with `skills/mmx-cli` already linked see no new output (the lookup only
   runs on the missing branch).
2. Land the installer warning. No behavioural change.
3. Re-run `./install.sh` and confirm it links.

Rollback is a revert; neither change moves data or rewrites installed
configuration.

## Open Questions

1. **Which side of the WSL fence should hold the configuration?** The
   operator must choose: keep the Linux `~/.config/opencode` and run a
   Linux `opencode` (requires a native Linux Node), or set
   `XDG_CONFIG_HOME` to the Windows profile and target `opencode.exe`.
   Deferred to the operator; the installer only reports the split.
2. **Should `mmx-cli` ever be committed?** If the skill becomes
   repo-tracked, the local-only warning disappears on its own and
   `.gitignore` loses the carve-out. Out of scope here, but this change is
   the mechanism that would notice.