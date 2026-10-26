# Design

## Context

See `proposal.md` for motivation. This repository is a global OpenCode
distribution: it installs one set of agents, skills, commands, and plugins
into `~/.config/opencode` for every project on the host. It already ships one
plugin, `plugins/herdr-agent-state.js`, installed as a single symlinked file
into the global plugins directory, and its source lives at the repository
root under `plugins/` rather than under `.opencode/plugins/` — that location
matters, because OpenCode auto-discovers `.opencode/plugins/` and would
otherwise load the local copy and the installed copy at the same time.

Three facts shape the approach. First, the runtime that executes plugins is
OpenCode's own runtime, and the reference implementation of this capability
reads its database through `bun:sqlite`; a plugin therefore needs no native
dependency and no new package to install. Second, the repository already
carries a `.opencode/memory/memory.sqlite` file, excluded today only by a
local `.git/info/exclude` rule that no clone receives. Third, the global
plugins directory is shared, so a plugin identifier can collide with one the
operator already installed.

The repository's own conventions constrain the implementation as well: the
validator, the acceptance harness, and the installer are plain ESM `.mjs`
under Node, the installed configuration is validated before it replaces the
previous one, and every durable change goes through the OpenSpec workflow.

## Goals / Non-Goals

**Goals:**

- Make this repository the owner of a local, per-project memory store with a
  versioned schema and a documented tool surface.
- Keep the store inert on hosts that cannot run it: a missing engine, an
  unreadable path, or a foreign database must degrade into a reported
  absence, never into a failure of the session.
- Keep the data boundary explicit: scoped records, no transcripts, no
  credentials, and no automatic promotion of a local decision to a global
  rule.
- Reuse the install and conflict machinery so the new plugin is a managed
  global resource like every other.

**Non-Goals:**

- Replace the triage agent's versioned consultation logs under
  `.opencode/state/`. Those are a different artifact with a different
  lifecycle and they stay versioned.
- Provide a general-purpose knowledge base, a document store, or a vector
  index.
- Make the memory an input to automated decisions. Reading a record never
  authorizes an action.
- Adopt a work-item tracker integration. The reference implementation
  carries recommendation tools bound to a specific tracker; this repository
  has no tracker contract, so those tools are out of scope.
- Change the model-profile manifest, the routing classes, or the step
  ceilings.

## Decisions

### 1. The store lives in the repository, not in the global configuration

The database is at `<repository-root>/.opencode/memory/memory.sqlite`. The
root is resolved through Git's common directory, so a session started in a
worktree reaches the main checkout's database instead of creating a second
one. Storing it per repository is what makes the scope separation
meaningful: a preference recorded in one project must not be visible in
another.

**Alternative considered:** A single store in `~/.config/opencode`. Rejected
because it would mix every project's context on the host into one namespace
and would make per-project scope unenforceable.

### 2. The exclusion rule becomes versioned

The current exclusion lives in `.git/info/exclude`, which is local to one
clone and is not shared. The change adds a versioned rule to `.gitignore`
for the store and its auxiliary files, and the plugin keeps the local
exclusion as a belt-and-braces measure for hosts that already have one.

**Alternative considered:** Rely on `.git/info/exclude` alone. Rejected
because a fresh clone has no such file, and the first `git add .` in a
contributor's checkout would offer to commit the database.

### 3. The engine is `bun:sqlite`, loaded on demand

The plugin imports the engine lazily and treats an unavailable engine as
"memory is not available", which the specification already requires to be
non-blocking. This adds no native dependency, no compilation step, and no
change to the Node.js floor the installer documents. The pure modules —
scope resolution, payload validation, secret detection, path safety — stay
free of any engine dependency so they remain testable under plain Node.

**Alternative considered:** `better-sqlite3` as a declared dependency.
Rejected because it compiles a native addon, and this installer supports
Linux, macOS, WSL, and Git Bash on Windows, where a compilation step is a
recurring source of install failures.

**Alternative considered:** `node:sqlite`. Rejected because it requires a
Node.js version floor far above the one this repository documents, and
because the engine that actually runs the plugin is not Node.

### 4. The schema is owned by this plugin and refuses foreign databases

The store records a format marker and a schema version. A database whose
marker this plugin does not own, or whose version is newer than this plugin
understands, is left untouched: the plugin reports that memory is inactive
and writes nothing. This matters on a shared host, where a store created by
another configuration's plugin may already exist at the same path.

**Alternative considered:** Reuse any existing SQLite file at that path.
Rejected because writing a foreign schema into a file another tool owns
corrupts that tool's data.

### 5. Records are scoped, and the scope is resolved, not assumed

A record carries one of six scope types: project, worktree, branch, work
item, OpenSpec change, or session. The plugin resolves the current worktree
and branch from the session location and the Git state, and the agent may
narrow the scope further. When the scope cannot be resolved, the record
falls back to project scope with the resolution noted, rather than being
stored with an invented identifier.

**Alternative considered:** A single project-wide scope. Rejected because a
decision taken inside one branch would then be indistinguishable from a
standing project rule.

### 6. The preference lifecycle is explicit and identifier-driven

Saving stores the record with a category, a status, a source, and a scope.
Approval, correction, and forgetting all address a record by its exact
identifier: a correction writes a new version and marks the previous one
superseded, and forgetting deletes the content and leaves only an opaque
identifier and a date in a tombstone table. No operation accepts free-text
matching against the record content.

**Alternative considered:** Search-and-replace semantics for corrections.
Rejected because it makes "correct this" ambiguous whenever two records
mention the same subject, and because the operator's intent to forget one
record must not remove another.

### 7. The tool surface is closed, and agents never touch SQL

The plugin exposes seven tools: save, search, approve, correct, forget for
preferences, and save and get for continuity. Agents have no path to the
database other than these tools, so the validation, the scope resolution,
and the secret screening cannot be bypassed.

**Alternative considered:** Let agents run `sqlite3` against the store. It
is simpler, but it makes every rule in this specification advisory: scope
separation, secret screening, and the lifecycle all depend on the agent
behaving, and the repository's guidance already says that managing these
records through direct SQL is not allowed.

### 8. Only the primary agents get the memory tools

`plan` and `build` receive the memory tools. The audit specialists `qa` and
`adversarial`, the explorers, and the read-only reviewers do not: their
value comes from an independent view of the change, and a stored preference
in their context would blur that independence.

**Alternative considered:** Grant the tools to every agent. Rejected because
a read-only audit that has seen the operator's stated preferences is no
longer an independent audit.

### 9. The plugin identifier is stable and the install treats a collision as a conflict

The plugin is installed as `plugins/project-memory` and identifies itself as
`project-memory`. The resource manifest from
`instalar-manifiesto-recursos` governs the target path, so a global plugin
with the same identifier that this repository did not install is reported as
a conflict and is not replaced.

**Alternative considered:** A distinctive identifier such as
`opencode-config-project-memory`. Rejected as unnecessary obfuscation; the
conflict rule is the actual protection, and a stable identifier makes the
tool names predictable.

### 10. Secret screening happens on write, and stored content stays short

The write path screens the payload for values that look like credentials,
tokens, and keys, and refuses them. Records are length-limited to brief
summaries. Continuity records store the verified sources a claim rests on,
not the transcripts that produced them, and the tool description states that
the developer's voice must not be manufactured from quoted sources.

**Alternative considered:** Screening only by convention. Rejected because a
credential pasted once would be persisted in a file that is excluded from
Git but still readable by every process running as that user.

## Risks / Trade-offs

- [A host runs a plugin with the same identifier] → The manifest's conflict
  rule reports it and does not replace it; the installer prints the
  conflict instead of silently taking over the path.
- [The engine is unavailable, for example when a plugin is exercised outside
  OpenCode] → The tool reports that memory is unavailable and the session
  continues; the engine-dependent tests are opt-in and the engine-free
  modules are covered by the default test run.
- [An existing store at the canonical path was created by another
  configuration] → The format marker and version check refuse to write to
  it, and the diagnostic says which file was left untouched.
- [A stored record is mistaken for current truth] → The routing contract
  states that recovered context is auxiliary, and the search results carry
  the reminder that the record must be re-verified against its source.
- [The store grows without bound] → The store is local and small; the
  continuity records are summaries, and the design accepts that the operator
  may forget old records explicitly.
- [The plugin is installed globally and runs in every project on the host]
  → The plugin resolves the repository root and stays inert when there is
  none, creating nothing outside a repository.
- [A wrong record is stored and then acted upon] → Nothing in the tool
  surface authorizes an action, the search result states that the record is
  auxiliary, and the routing requirement forbids relying on it without
  re-verification.

## Migration Plan

1. Add the versioned ignore rule for the store and its auxiliary files.
2. Implement the plugin modules: path resolution and safety, payload
   validation and secret screening, the schema and its migrations, and the
   tool definitions.
3. Register the plugin as a managed global resource and grant the memory
   tools to `plan` and `build` in the configuration template.
4. Extend the validator and the acceptance harness with static assertions
   for the permission surface and for the engine-free modules.
5. Install and verify on this host: the store is created, a preference
   round-trips, a correction supersedes its predecessor, and a forgotten
   record leaves only its identifier.
6. Roll back by uninstalling the plugin, removing the granted permissions,
   and deleting the store. The store holds no data the operator cannot
   regenerate, and its removal does not affect any other repository.
