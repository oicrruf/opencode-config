# Proposal

## Why

Agents currently lose every durable decision when a session ends: the
operator's stated preferences, the reasoning behind a scope decision, and
the verified state of a task all exist only in the conversation that produced
them. That forces the same questions to be re-asked, the same research to be
repeated, and it makes a resumed session unable to tell an established
decision from a passing remark. The repository already has a
`.opencode/memory/memory.sqlite` file, but nothing in this repository owns
that storage, defines its schema, or exposes it through a stable tool
surface.

## What Changes

- Make this repository the owner of a local memory store per project, with
  a versioned schema, atomic migrations, and one canonical database shared
  by the repository's worktrees.
- Expose a stable tool surface so agents can record and retrieve developer
  preferences, and save and resume work continuity, without writing SQL.
- Separate the scope of every record — project, worktree, branch, work item,
  OpenSpec change, or session — so a decision made inside one branch is not
  silently promoted to a project-wide rule.
- Give preferences an explicit lifecycle: an unambiguous statement is saved
  approved, an ambiguous one is not persisted until it is clarified, a
  correction supersedes the previous version, and forgetting keeps only an
  opaque identifier and a date.
- State explicitly, in the routing contract, that recovered context is
  auxiliary: it never authorizes an action, never replaces a current
  instruction, and never substitutes for the authoritative source.
- Keep the store local, unversioned, and free of transcripts and
  credentials, and keep every memory failure non-blocking.

## Capabilities

### New Capabilities

- `project-memory`: local, per-project persistence for developer preferences
  and work continuity, with scoped records, an explicit lifecycle, and
  non-blocking failures.

### Modified Capabilities

- `agent-routing`: add the rule that recovered project context is auxiliary
  context and never an authorization, a criterion, or a substitute for the
  current instruction.

## Impact

- New plugin source: `plugins/project-memory/` with the storage-path,
  schema, and migration modules, installed as a managed global plugin.
- Installer: `install.sh` gains the new managed link entry, and the
  resource manifest from `instalar-manifiesto-recursos` records it.
- Configuration: `config/opencode.template.jsonc` grants the memory tools
  to the agents that may use them, and the validator and acceptance harness
  gain assertions for that surface.
- Version control: a versioned ignore rule for the memory store, replacing
  today's local-only exclusion.
- Documentation: `README.md` describes the store, its tools, and its limits;
  `AGENTS.md` records the tool surface for agents.
- No change to the model-profile manifest, the agent routing classes, or
  the rendered root configuration beyond the new permission entries.
