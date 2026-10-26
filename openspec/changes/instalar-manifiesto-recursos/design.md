# Design

## Context

See `proposal.md` for motivation. The current installer resolves the node
binary, validates the selected profile, renders
`~/.config/opencode/opencode.jsonc` from `config/opencode.template.jsonc`
plus `config/model-profiles.json`, and then symlinks seven paths into the
global configuration directory:

| Managed path | Kind |
|---|---|
| `agents` | symlink to `agent/` |
| `commands` | symlink to `commands/` |
| `skills` | symlink to `skills/` |
| `tui.jsonc` | symlink to the repository file |
| `herdr-tui-session.js` | symlink to the repository file |
| `quota-tui.tsx` | symlink to the repository file |
| `plugins/herdr-agent-state.js` | symlink to the repository file |

It also removes a legacy `plugins/autonomy.js` link, and it backs up any
non-symlink path it finds in the way before replacing it. It has no
`--check` mode, no record of what it manages, and no way to distinguish "the
operator's own file" from "a link this installer made" when the target
already exists.

Two constraints shape the approach. First, the symlink model is deliberate:
the README documents that a `git pull` is enough for repository changes to
reach the global configuration, and switching to per-file copies would
remove that property. Second, the global configuration directory is shared by
every project on the host, so the installer must never be the reason an
operator loses a file they own.

## Goals / Non-Goals

**Goals:**

- Give the installer an authoritative, validated record of the global
  resources it manages.
- Make "did the installer damage something I own?" structurally impossible
  by comparing against that record before every write.
- Make the install idempotent and observable, and add a read-only mode that
  answers "is my installed configuration current?".
- Keep the change inside the existing install flow: no new runtime
  dependency, no change to the rendered configuration, no change to the
  model-profile manifest.

**Non-Goals:**

- Change the symlink-based install model or the per-shell support matrix.
- Track individual files inside the linked directories. The manifest protects
  whole managed links; it does not inventory their contents.
- Make the manifest portable between hosts. It records absolute paths and
  lives in the host's configuration directory, not in this repository.
- Replace the existing `scripts/validate-config.mjs` checks. The validator
  keeps validating the repository's own configuration; the manifest governs
  the installed state.
- Introduce a general-purpose configuration manager for the whole
  `~/.config/opencode` tree.

## Decisions

### 1. One manifest file, JSON, versioned, inside the configuration directory

The manifest lives at `~/.config/opencode/.opencode-resource-manifest.json`
and carries a `version` field. JSON keeps it readable with the same tooling
the repository already uses for `config/model-profiles.json` and
`config/opencode.template.jsonc`, and it survives a crash as either the
previous complete file or the new complete file because the write is a
rename.

The manifest is host-local state, never versioned in this repository, and
never copied between hosts.

**Alternative considered:** A manifest inside this repository, describing the
expected global state. Rejected because the expected state depends on the
host's configuration directory, the selected profile, and the paths actually
installed; a repository-hosted manifest would drift from every host that
installed a different profile or moved the checkout.

### 2. Ownership is decided by comparing the path with the manifest, never by deleting what it finds

A global path is *ours* when the manifest records it and the path still
resolves to the source the manifest names. Everything else at a managed
location is foreign: it is reported and left alone. The current behavior of
moving an existing non-symlink path to a `.bak` file is replaced by this
rule, because a backup is still a takeover.

**Alternative considered:** Back up and replace, as the installer does today.
Rejected because a backup is only a partial mitigation: the operator's file
disappears from the location the tooling reads, and the installer cannot
distinguish an intentional local edit from a stale link.

### 3. The manifest records links, not file inventories

Each managed entry records an identifier, its kind (`symlink` or `file`), its
target path, and either the source path it points at or, for the rendered
root configuration, the content digest and the profile that produced it.

Per-file hashing of the linked trees was rejected: the linked directories
(`agent/`, `commands/`, `skills/`) are covered by the repository's own
validation gates, and the manifest's job is to protect the global boundary,
not to duplicate the repository's checks. The accepted limitation is
documented in the spec's conflict requirement and in the README.

### 4. The manifest is the single source of truth for the install plan

Before touching anything, the installer computes a plan: `keep`, `create`,
`repair`, `remove`, or `conflict` for each managed entry, plus the root
configuration action (`keep`, `render`, or `backup-and-render`). The install
applies that plan; the check mode prints the same plan without applying it.
Both modes therefore answer the same question from the same code.

**Alternative considered:** Let the shell script implement the link logic and
the node script only write the manifest. Rejected because the two would
drift, and the check mode would then be unable to describe what the install
would do.

### 5. A missing manifest bootstraps; an invalid manifest stops the install

A first install has no manifest. The installer performs the current linking
behavior, then records the state it observed as the manifest and reports
that it adopted the existing state. A manifest that exists but is
unreadable, is not JSON, is not an object, declares an unsupported version,
or contains an entry that escapes the configuration directory stops the
install with an error.

**Alternative considered:** Treat an invalid manifest as "nothing is
managed" and re-link everything. Rejected because that is the exact failure
the manifest exists to prevent: a corrupted file would silently reintroduce
the takeover behavior.

### 6. The link and manifest logic lives in one Node script that both modes call

`scripts/resource-manifest.mjs` owns the manifest schema, the ownership
test, the plan, and the application of the plan. `install.sh` keeps its
current responsibilities — resolving `node`, translating WSL and Git Bash
paths, running the font step, and running the gates — and delegates the
link step and the check mode to the script.

This keeps the Node requirement that already exists in the installer, so no
new runtime dependency appears.

**Alternative considered:** Keep the link logic in bash and add a separate
manifest writer. Rejected for the drift reason given in decision 4.

### 7. The root configuration is recorded by profile and digest

The rendered root configuration is the one managed artifact that is a real
file rather than a link, and the one whose content depends on the selected
profile. The manifest records the profile and the SHA-256 of the rendered
content, so a re-render with a different profile is detected as a difference
and an unchanged profile is detected as current.

The existing backup behavior for a previous root configuration is kept, and
it is recorded in the plan as `backup-and-render` rather than as an
unconditional overwrite.

### 8. The legacy link removal becomes an explicit retired entry

The current installer removes a leftover `plugins/autonomy.js` link that a
previous version of this repository installed. Under the manifest model that
removal is only justified while the path is the artifact a previous install
created, so it is recorded as a retired entry with the same verification
rule as any other removal.

## Risks / Trade-offs

- [The operator adds a skill inside the linked `skills/` directory and a
  later install removes it] → The link is replaced only by a link to the
  same source, and the directory content is the repository's own; the
  operator's own additions under a linked directory are a documented
  limitation of link-granularity protection.
- [The operator moves or renames the checkout, so every recorded source path
  is stale] → The ownership test compares the resolved link target against
  the current source path; a link pointing elsewhere is reported as a
  conflict rather than repaired, and the operator resolves it explicitly.
- [The manifest drifts from reality because the operator edited the global
  configuration by hand] → The check mode reports every difference, and the
  install rebuilds the manifest from the state it observes rather than
  trusting a stale record.
- [The manifest becomes a new file that can be corrupted] → The manifest is
  written atomically through a rename, validated on every read, and its
  corruption stops the install instead of silently reverting to takeover
  behavior.
- [The install becomes slower because it inspects every managed path] → The
  plan inspects seven paths and one file; the cost is a handful of
  `lstat` and `realpath` calls, which is negligible next to the renderer
  and the gates that already run.
- [Link-granularity protection misses files inside the linked
  directories] → Accepted and documented; a file-level inventory would
  duplicate the repository's own validation for no additional safety at the
  global boundary.

## Migration Plan

1. Implement `scripts/resource-manifest.mjs` with manifest read, validation,
   plan computation, and plan application, and cover each rule with a
   focused test.
2. Replace the `link()` function in `install.sh` with a delegation to that
   script, keeping the final `OpenCode configuration linked from
   <repo_dir>` message and the existing gate summary.
3. Add the `--check` mode and document it in `--help` and the README.
4. On the first run after this change, no manifest exists: the installer
   links as it does today, records the observed state, and reports that it
   adopted the current installation.
5. Roll back by restoring the previous `install.sh` and deleting the
   manifest file. The manifest holds no user data, so removing it loses
   nothing; the global configuration itself is unaffected.
