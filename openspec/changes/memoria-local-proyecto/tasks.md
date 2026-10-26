# Tasks

## 1. Storage location, path safety, and versioning

- [ ] 1.1 Add a versioned ignore rule for `.opencode/memory/` to the
  repository's `.gitignore`, covering the database and its auxiliary files;
  and verify that `git check-ignore` reports the store as ignored and that
  `git status` shows no untracked memory paths.
- [ ] 1.2 Implement the repository-root resolution in
  `plugins/project-memory/storage-paths.mjs`: resolve the main checkout
  through Git's common directory so a worktree reaches the main checkout's
  store, and report a clear failure when the root cannot be resolved
  safely; and verify with a focused test that a worktree path resolves to
  the main checkout and that an unresolvable root reports an error instead
  of a path.
- [ ] 1.3 Implement the path safety rules in the same module: refuse to
  create or write through a symbolic link, refuse a path whose components
  are not a regular directory, and apply restrictive permissions where the
  platform allows it; and verify with a focused test that an unsafe path is
  refused and that an existing foreign file at the canonical path is left
  untouched.
- [ ] 1.4 Implement the engine-free payload validation and secret screening
  in `plugins/project-memory/preferences-schema.mjs` and
  `plugins/project-memory/continuity-schema.mjs`: validate the category,
  status, source, scope type, and length limits, and refuse content that
  looks like a credential, a token, or a key; and verify with a focused
  test that each invalid field and each secret-shaped payload is rejected
  with a named reason.

## 2. Schema, migrations, and engine access

- [ ] 2.1 Define the schema in `plugins/project-memory/schema.mjs`: the
  format marker, the schema version, the preference table with its
  categories, statuses, sources, and scope columns, the continuity table
  with its scopes and references, the deletion tombstone table, and the
  metadata table that records the version; and verify that the schema
  module exports a creation script and a migration list.
- [ ] 2.2 Implement the engine access in
  `plugins/project-memory/database.mjs`: load the engine lazily, open the
  canonical database, create the initial schema on a new store, and refuse
  to write to a database whose format marker this plugin does not own or
  whose version is newer than it understands; and verify with a focused
  test that a foreign database is left untouched and reported as inactive.
- [ ] 2.3 Implement the migration runner: apply each pending migration
  inside a transaction, record the new version only after the migration
  completes, and leave the database unchanged when a migration fails; and
  verify with a focused test that a successful migration advances the
  version and that a failing migration leaves both the data and the version
  untouched.
- [ ] 2.4 Make every store failure non-blocking: a locked, corrupted, or
  incompatible database SHALL produce a reported absence instead of an
  exception, and SHALL NOT cause the file to be discarded or recreated; and
  verify with a focused test that an operation against a corrupted database
  returns a failure result and leaves the file in place.

## 3. Preference and continuity tools

- [ ] 3.1 Implement the preference tools in `plugins/project-memory/index.js`:
  `memory_save_preference` storing an unambiguous statement as approved and
  an ambiguous one as proposed, `memory_search_preferences` returning only
  records whose scope applies to the current context, and
  `memory_approve_preference` addressing a record by its exact identifier;
  and verify with a focused test that an unambiguous statement is stored
  approved, that an ambiguous one is stored pending clarification, and that
  a search respects the scope filter.
- [ ] 3.2 Implement `memory_correct_preference` so a correction writes a new
  version linked to the previous one and marks the previous version
  superseded, and `memory_forget_preference` so it deletes the content and
  retains only the opaque identifier and the deletion date; and verify with
  a focused test that the superseded version is no longer returned by a
  search and that the forgotten record leaves no recoverable content.
- [ ] 3.3 Implement the continuity tools `memory_save_continuity` and
  `memory_get_continuity`: save a brief summary with its verified sources,
  checks, blockers, next steps distinguished as proposed, agreed, or pending,
  and confirmed references, and retrieve those records optionally filtered by
  work item; and verify with a focused test that a saved record round-trips
  and that a work-item filter returns only the matching records.
- [ ] 3.4 Give every tool a description that states that the recovered
  content is auxiliary context and never an authorization, that only brief
  summaries belong in the store, and that quoted sources SHALL NOT be
  attributed to the developer; and verify by reading each registered tool's
  description in the plugin's tool list.
- [ ] 3.5 Resolve the current scope from the session location and the Git
  state, and let the agent narrow it; when the scope cannot be resolved, fall
  back to project scope with the resolution noted; and verify with a focused
  test that a session in a worktree records the worktree scope and that an
  unresolvable scope falls back as specified.

## 4. Installation, permissions, and validation gates

- [ ] 4.1 Register the plugin as a managed global resource: add the
  `plugins/project-memory` link entry to the installer and to the resource
  manifest, and report a foreign plugin with the same identifier as a
  conflict instead of replacing it; and verify that an installed foreign
  plugin at that path is reported and left untouched.
- [ ] 4.2 Grant the `memory_*` tools to `plan` and `build` in
  `config/opencode.template.jsonc` and SHALL NOT grant them to `qa`,
  `adversarial`, `explore`, or the other read-only specialists; and verify
  by reading the rendered configuration for the `personal` profile and
  confirming the granted and ungranted agents.
- [ ] 4.3 Add a check to `scripts/validate-config.mjs` that the memory
  permission surface matches the intended agents and that the plugin
  directory is present with its entry point; and verify by temporarily
  granting the tools to `qa` and confirming the validator exits non-zero
  naming the agent.
- [ ] 4.4 Add a group to `scripts/acceptance-harness.mjs` that loads the
  plugin's engine-free modules, exercises the scope resolution, the payload
  validation, and the secret screening, and confirms the tool descriptions
  state the auxiliary-context property; and verify the group reports as
  passing.
- [ ] 4.5 Add a focused test file for the store modules covering the path
  safety, the schema and migrations, the lifecycle operations, and the
  non-blocking failure behavior, and verify it passes with the repository's
  test runner, marking the engine-dependent cases as opt-in when the engine
  is unavailable.

## 5. Documentation and integration verification

- [ ] 5.1 Document the store, its location, its tools, its scope model, its
  lifecycle, and its limits in `README.md`, including that the content is
  auxiliary context and never an authorization, and that the store is
  excluded from version control; and verify that a reader can answer from
  the README alone where the store lives and how to forget a record.
- [ ] 5.2 Record the memory tool surface in `AGENTS.md` so agents know which
  tools exist and that direct SQL access to the store is not the supported
  path; and verify the file names the tools and the restriction.
- [ ] 5.3 Run `node scripts/validate-config.mjs --profile personal`,
  `node scripts/test-model-profiles.mjs`, `node scripts/acceptance-harness.mjs`,
  and `openspec validate --specs --strict --type spec`; verify each result
  and record any pre-existing failure separately from a failure introduced by
  this change.
- [ ] 5.4 Install on this host and exercise the store end to end: save a
  preference, retrieve it, correct it, confirm the previous version is
  superseded, forget it, and confirm the store leaves no recoverable
  content; and record the actual observations in the change verification
  notes.
