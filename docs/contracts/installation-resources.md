# Installed-resource ownership

`install.sh`, `install.sh --check`, and `scripts/doctor.mjs` share the inventory
and ownership rules in `scripts/resource-manifest.mjs`. The configuration
root is `$XDG_CONFIG_HOME/opencode`, or `~/.config/opencode` by default.

## Resources and ownership

The root `opencode.jsonc` is a **regular rendered file**. Agents, commands,
skills, TUI resources, and the Herdr/worktree/sandbox plugin entrypoints are
links to this checkout. The inventory maps global `agents` to repository
`agent` and maps plugin entrypoints to their actual source directories; doctor
uses these mappings rather than guessing source paths from destination names.

`.opencode-resource-manifest.json` records version, checkout root, profile,
resource identifiers, link origins and the SHA-256 of the rendered root.
Identifiers are relative allowlisted targets, never arbitrary deletion paths.
Missing or corrupt ownership evidence never grants permission to overwrite.

- An unchanged owned artifact can be kept or updated. An owned absence can
  be recreated. A root update preserves its old bytes in a unique
  `opencode.jsonc.bak.<uuid>` file.
- A changed root, redirected link, real directory at a link location, or an
  unowned resource is a conflict. The entire destination plan is inspected
  before writes. Conflicts preserve all managed destinations; moving a foreign
  file into a backup is not considered preservation of its active location.
- A retired artifact is removed only if it still matches its recorded
  identity. Modified or unowned retired artifacts remain and are reported on
  subsequent checks. Merely having the name `plugins/autonomy.js` never grants
  ownership. Unowned retired artifacts are never adopted by observing them.
- Herdr resources installed or changed outside this checkout are preserved.
  This installer does not edit Herdr's plugin code.

The boundary is the whole managed link. Files inside `agents`, `commands`,
or `skills` are not individually inventoried; they are the checkout's files.
Pulling or editing the checkout changes those linked contents. Installation
never resets the checkout or removes local additions inside those directories.

## Migration and check

With no installed manifest, installation can adopt only exact legacy links
from this checkout and a root whose entire bytes equal a known profile render.
A root link additionally must point at this checkout's known legacy root.
Ambiguous matching profiles need explicit `--profile`; edited or foreign data
remains a conflict. Check mode reports missing ownership instead of adopting.
A manifest from another checkout location, a malformed manifest, traversal,
symlink parents or unsafe file types are refused. Use canonical paths if the
configuration directory's parents are symlinks (for example `/private/tmp`
instead of `/tmp` on macOS).

```
bash ./install.sh --profile personal
bash ./install.sh --check
bash ./install.sh --check --profile work
```

An ordinary install without `--profile` uses the model manifest's default.
A check without that flag uses the **installed** manifest's profile. Checking
against another profile only compares; it does not activate it. Competing
`opencode.json` and `opencode.jsonc` roots or an `OPENCODE_CONFIG` override to a
different root are reported rather than silently selecting precedence.

Check exit codes are 0 (synchronized), 1 (differences/conflicts/retained
obsolete resources), and 2 (invalid arguments, unsafe state or operational
error). Check creates no temporary files, backups, directories or manifest;
it does not repair, install fonts, run model CLIs or execute writing gates.
`doctor --check-only` and `doctor --apply-safe --dry-run` are also read-only.

Doctor shares the inspection but retains its own report exit contract:
0 when there are no `fail` rows, 1 otherwise, and 2 for invalid arguments.
`--apply-safe` can recreate only recorded absences after conflict-free
preflight and source validation. Missing ownership requires installation or
manual reconciliation, not a doctor bootstrap. Existing lazygit/lazydocker
package-manager behavior remains separate and needs an authorized invocation.

## Partial failure and recovery

Install applications serialize with an exclusive `.opencode-install.lock`.
The plan is inspected again under the lock and identities are rechecked
before mutations and before committing the manifest. Root and manifest writes
use exclusive temporary files and renames on the same filesystem. This is
not an atomic transaction across all resources.

A failure during application preserves `.opencode-install-journal.json`, with
the previous/expected manifest, planned operations, backup identity where
applicable, and completed observed artifacts. Subsequent installs and checks
stop and name the journal. There is no automatic destructive recovery.

For operator-led reconciliation:

1. Preserve the journal, manifest and backups. Verify whether an installing
   process is still running; age or a missing coordinator alone is not proof
   that a lock may be removed.
2. Compare each journal operation's before/expected identity and completed
   observations against the actual paths. A crash may occur after a mutation
   and before the completion observation was recorded, so inspect planned as
   well as completed entries.
3. Decide explicitly whether to finish or roll back this installation. Touch
   only artifacts whose identities are attributable to it. Preserve anything
   modified since the failure. For a root restore, verify the backup bytes
   against the previous digest; do not follow unknown symlinks.
4. Resolve metadata only after the filesystem is reconciled and the installing
   owner is gone. Never delete the manifest or journal just to bypass a check.
   Re-run check and record the result. Unknown state remains blocked.

No recovery command or unverified force option is supplied by this change.
A foreign-resource conflict needs the operator to choose which installation
should own that path; the installer cannot decide that on their behalf.

## Verification and activation

```
node --test scripts/test-resource-manifest.mjs scripts/test-installation-state.mjs
node scripts/validate-config.mjs --profile personal
node scripts/validate-config.mjs --profile work
node scripts/test-model-profiles.mjs
node scripts/acceptance-harness.mjs
```

Fixtures use disposable canonical directories, HOME/XDG_CONFIG_HOME,
non-sensitive source files, disabled fonts and stubbed dependency tools.
They never install into the operator's real global configuration. Skipped
post-install gates print `PARTIAL` and their count; they are not evidence
that verification passed.

The entrypoint import test proves installed imports and unique tool names,
not runtime discovery by OpenCode. A real loading claim requires an OpenCode
session inside sandbox-control, with the tools observed once and an external
report. Missing Linux/WSL2, Docker or declared sandbox configuration blocks
that proof without provisioning or substituting host execution.

Global activation requires an installation invocation in the intended
environment followed by check and a fresh OpenCode execution. No automatic
activation is part of applying this code change. Rollback preserves ownership
metadata and restores only verified own backups; reverting source does not
justify deleting user resources or erasing ownership records.
