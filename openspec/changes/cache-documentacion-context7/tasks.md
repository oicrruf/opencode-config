# Tasks

## 1. Version resolution and freshness

- [ ] 1.1 Implement the package version resolver in
  `plugins/project-memory/documentation-stack.mjs`: read the project's
  supported npm lockfile, look the package up as a direct dependency, and
  return the exact version; and verify with a focused test that a lockfile
  pinning the package returns that version and that the source lockfile name
  is reported.
- [ ] 1.2 Make the resolver report an indeterminate version with a reason
  when the lockfile is absent, of an unsupported format, unreadable, or does
  not pin the package directly; and verify with a focused test that each
  case returns the indeterminate status and the matching reason and that no
  version is invented.
- [ ] 1.3 Implement the freshness rules in
  `plugins/project-memory/documentation-freshness.mjs`: a status of
  current, stale, invalidated, or unverified, the entry's retrieval,
  verification, and expiry times, a longer window for a resolved version
  than for an indeterminate one, and the rule that only a current entry may
  be served; and verify with a focused test that an entry inside its window
  is current, one past its window is stale, an invalidated one is never
  servable, and an unverified one is reported as pending verification.

## 2. Store schema for documentation and cache

- [ ] 2.1 Extend the store schema in `plugins/project-memory/schema.mjs` with
  a documentation table keyed by project and identity, holding the library,
  the package name and version, the version status, the topic, the source
  URL, the source kind, the recording agent, the content, the three
  timestamps, and the status, plus an index over the lookup fields; and
  verify that the schema module exports the creation script and the
  migration that adds it.
- [ ] 2.2 Extend the store schema with a cache table keyed by project and
  identity, holding the tool name, the arguments, the library, the package
  name and version, the version status, the response, the retrieval and
  expiry times, and the status; and verify that a second write for the same
  identity updates the entry instead of duplicating it.
- [ ] 2.3 Apply the migration through the migration runner from
  `memoria-local-proyecto` and verify that an existing store advances to the
  new version without losing its records and that a failing migration leaves
  the store unchanged.

## 3. Cache wrapper and documentation tools

- [ ] 3.1 Implement the identity computation for a Context7 request: the
  project, the tool, the arguments, the library, the package name, the
  package version, and the topic, resolved into a deterministic key; and
  verify with a focused test that the same request yields the same key and
  that a change in any component yields a different key.
- [ ] 3.2 Implement the wrapper that intercepts the Context7 tools: answer
  from a current cache entry when one exists, perform the call and record
  the result otherwise, re-query a stale or invalidated entry, and report an
  unavailable cache without failing the lookup; and verify with a focused
  test that a repeated request is answered without a network call and that a
  stale entry triggers a new call.
- [ ] 3.3 Implement `documentation_save`: validate the identity, the
  library, the package, the version status, the topic, the source URL, the
  source kind, the agent, the content, and the timestamps, screen the
  content for credential-shaped values, and store it; and verify with a
  focused test that a valid record round-trips and that a credential-shaped
  record is refused.
- [ ] 3.4 Implement `documentation_search`: filter by library, package,
  version, topic, and status, prefer current records over stale ones, and
  report the version, the version status, the source, the recording agent,
  and the freshness status of every result; and verify with a focused test
  that the filters apply and that an indeterminate version is shown as such.
- [ ] 3.5 Make every cache and version-resolution failure fall back to the
  live lookup and report the cause, and make a failure of the documentation
  service report a failed lookup without failing the session; and verify
  with a focused test that a cache write error still returns a lookup
  result and that a service failure is reported as a failed lookup.
- [ ] 3.6 Give the two tools descriptions that state that a record is
  auxiliary context, that only documentation actually verified belongs in
  the store, and that a record SHALL NOT be attributed to the developer;
  and verify by reading the registered tool descriptions.

## 4. Shared documentation skill

- [ ] 4.1 Add the `documentacion-context7-compartida` skill under `skills/`
  with frontmatter and a body that tells the agent to search the project
  cache first, to query Context7 when no current entry exists, to record
  only the documentation it verified, and to treat a record as auxiliary
  context; and verify the file is discovered as a skill.
- [ ] 4.2 Keep the new skill's description within the remaining budget of
  the `skill-surface` cap and verify that the union of all model-invocable
  skill descriptions still fits within 3000 characters; and verify the
  validator's skill-budget check passes and fails when the new description
  is temporarily inflated.
- [ ] 4.3 Grant the `documentation_*` tools to the agents that may already
  query Context7, and SHALL NOT grant them to the agents that may not; and
  verify by reading the rendered configuration for the `personal` profile and
  confirming the granted and ungranted agents.

## 5. Validation gates

- [ ] 5.1 Add a check to `scripts/validate-config.mjs` that the
  documentation tool permissions match the Context7 tool permissions, so an
  agent that may query Context7 but not the documentation tools fails
  validation; and verify by temporarily revoking a grant and confirming the
  validator exits non-zero naming the agent.
- [ ] 5.2 Add a check to `scripts/acceptance-harness.mjs` that the
  documentation skill is model-invocable, that its description is within the
  cap, and that the version resolver and the freshness rules behave as
  specified; and verify the group reports as passing.
- [ ] 5.3 Add a focused test file for the documentation modules covering the
  version resolution, the freshness transitions, the identity computation,
  the record round-trip, the credential screening, and the fallback
  behavior; and verify it passes with the repository's test runner.

## 6. Documentation and integration verification

- [ ] 6.1 Document the cache, its location, the versioning rule, the
  freshness statuses, the two tools, and the shared documentation workflow
  in `README.md`, including that a record is auxiliary context and never an
  authorization; and verify that a reader can answer from the README alone
  what a stale record means and how a version is resolved.
- [ ] 6.2 Run `node scripts/validate-config.mjs --profile personal`,
  `node scripts/test-model-profiles.mjs`, `node scripts/acceptance-harness.mjs`,
  and `openspec validate --specs --strict --type spec`; verify each result
  and record any pre-existing failure separately from a failure introduced by
  this change.
- [ ] 6.3 On this host, query the same library twice through Context7 and
  confirm the second query is answered from the store, then record a
  verified answer and retrieve it with the documentation search tool; and
  record the actual observations in the change verification notes.
