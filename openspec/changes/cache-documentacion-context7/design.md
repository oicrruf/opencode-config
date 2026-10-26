# Design

## Context

See `proposal.md` for motivation. Context7 is configured in this repository
as a remote MCP server with an API key supplied through the environment, and
the `plan`, `build`, `backend`, `adversarial`, `doctor`, `orchestrator`,
`architect`, and `refactor` agents may call its tools. The tool surface
lives outside the repository's own configuration: the MCP server is a remote
endpoint, and every call is a fresh network request.

The repository has no storage of its own beyond the memory work introduced
by `memoria-local-proyecto`, which this change depends on. That change
establishes the project's local store, its schema-versioning discipline, its
non-blocking failure rule, and the plugin that exposes it. Reusing that store
is what keeps the change small: the documentation records are two more
tables in a store whose lifecycle, path safety, and failure behavior are
already specified.

One constraint shapes the skill side of the change. The
`skill-surface` specification caps the union of all model-invocable skill
descriptions at 3000 characters, and the current union is 2664 characters.
A new model-invocable skill therefore has roughly 330 characters of room,
including its separator, and the validator fails the build when the union
exceeds the cap.

## Goals / Non-Goals

**Goals:**

- Answer an identical repeated documentation lookup from the project's local
  store instead of the network.
- Bind every cached answer to the package version it refers to, or say
  explicitly that the version is unknown.
- Make the freshness of an answer visible to whoever reads it, and never
  present an expired or invalidated answer as current.
- Let a verified answer recorded during planning be reused during
  implementation, with its provenance intact.
- Keep every cache and record failure non-blocking.

**Non-Goals:**

- Build a general documentation corpus or a semantic index. The store holds
  what a project actually looked up.
- Support ecosystems other than the npm lockfile format in this change. A
  package whose version cannot be resolved is reported as indeterminate; it
  is not guessed.
- Replace the Context7 MCP server or change how it is authenticated.
- Change the agent routing classes, the model-profile manifest, or the step
  ceilings.
- Add a user-invoked command wrapper. The skill is model-invocable, so the
  agent reaches it without a wrapper.

## Decisions

### 1. The records live in the project's store, in two dedicated tables

The documentation records and the raw cache entries are separate tables in
the store owned by `memoria-local-proyecto`: one holds the documentation an
agent chose to record, the other holds the raw responses served to the
tool wrapper. They answer different questions — "what did we verify" and
"what was already fetched" — and keeping them apart lets the raw cache be
discarded without touching the recorded knowledge.

**Alternative considered:** A separate database for documentation. Rejected
because it would duplicate the path safety, the migration discipline, and
the failure handling that the memory store already specifies.

### 2. The wrapper intercepts the Context7 tool calls, so the call site does not change

The plugin transforms the Context7 tools it can see. An agent calls
`resolve-library-id` or the documentation tool exactly as it does today; the
wrapper computes the identity of the request, looks for a current entry,
and either answers from the store or performs the call and records the
result. No agent has to learn a second API to benefit from the cache.

**Alternative considered:** A separate lookup tool that agents call instead
of Context7. Rejected because it would make the cached path the only path,
would break the existing permission grants for `context7_*`, and would
remove the upstream service from the picture instead of accelerating it.

### 3. The identity of an entry is a deterministic function of the request

The identity key is derived from the project, the tool name, the arguments,
the library identifier, the package name, the package version, and the
topic. The store enforces uniqueness per project, so a second entry for the
same identity updates the first rather than duplicating it.

**Alternative considered:** Keying only on the library and the topic.
Rejected because the arguments carry the specific question, and answering a
different question with a cached answer would be wrong even when the library
matches.

### 4. Version resolution reads the project's lockfile and reports its failures

The resolver reads the npm lockfile format this repository's projects
already use, looks the package up as a direct dependency, and returns the
exact version. When the lockfile is absent, of an unsupported format, or
does not pin that package directly, the resolver returns an indeterminate
status together with the reason. The reason is stored with the record, so a
reader can see why the version is unknown.

**Alternative considered:** Falling back to the installed version in
`node_modules`, or to a version range in the manifest. Rejected because
both are less precise than the lockfile, and an approximate version used in
a cache identity silently produces entries that do not match each other.

### 5. A pinned version earns a longer freshness window

An entry whose version was resolved is valid for a longer window than one
whose version is indeterminate, because documentation pinned to a released
version does not change under the reader. The window is stored per entry, so
the rule is visible rather than implicit.

**Alternative considered:** One window for every entry. Rejected because it
would either expire pinned documentation too often, or keep version-less
documentation alive too long.

### 6. Status is explicit and only one status is servable

The status is one of `current`, `stale`, `invalidated`, or `unverified`. Only
`current` entries are served. A `stale` entry is re-queried and replaced. An
`invalidated` entry is never served and is replaced on the next encounter.
An `unverified` entry exists and is visible, but the search result marks its
verification as pending instead of presenting it as established.

**Alternative considered:** Deleting entries when they expire. Rejected
because an expired answer is still evidence of what the documentation said
at the time, and discarding it would hide the fact that a re-query was
needed.

### 7. The recording tools are explicit and separate from the cache

`documentation_save` records documentation an agent verified, and
`documentation_search` retrieves the recorded documentation. The cache is
implicit in the wrapper. The split matters: the cache holds raw responses,
while the recorded documentation carries the agent's judgment about which
part of it is relevant and verified.

**Alternative considered:** Making the cache itself the searchable artifact.
Rejected because a raw response is rarely the answer, and a search over raw
responses would encourage agents to cite a page they did not read.

### 8. The shared documentation skill is model-invocable and short

The skill `documentacion-context7-compartida` tells the agent to search the
project cache first, to query Context7 when the cache has no current entry,
to record what it actually verified, and to treat a record as auxiliary
context. Its description stays within the remaining budget of the
`skill-surface` cap.

**Alternative considered:** A user-invoked command with a `deny` skill
pattern, as the operation-specialized skills use. Rejected because the
common case is an agent that needs documentation while working, not an
operator who asks for it explicitly.

### 9. The service credential is never stored, and stored content is screened

The cache stores the response body, and a recorded document stores the
content the agent verified. Both are screened for values that look like
credentials before they are written, and the service's API key is never part
of either.

### 10. Every failure falls back instead of propagating

A cache read or write error falls back to the live call and reports that the
cache was unavailable. A version-resolution error produces an indeterminate
version and does not stop the lookup. A failure of the documentation service
is reported as a failed lookup. None of them fail the session.

## Risks / Trade-offs

- [A cached answer is outdated because the upstream documentation changed
  without a version bump] → The freshness window limits the exposure, the
  status is visible to the reader, and a stale entry is re-queried rather
  than served.
- [The wrapper does not intercept the remote MCP tools in the installed
  OpenCode version] → The capability is verified against the installed
  OpenCode before the change is accepted; if interception is unavailable, the
  recorded documentation and the search tool still work and the change is
  reported as partially delivered rather than silently ignored.
- [The new skill description exhausts the description budget] → The
  remaining budget was measured before the change (2664 of 3000 characters
  used) and the validator fails the build when the union exceeds the cap, so
  the limit is enforced rather than assumed.
- [A recorded document contains a credential copied from a documentation
  page] → The write path screens for credential-shaped content and refuses
  it.
- [The version resolver reads the wrong lockfile] → Only the project's own
  lockfile is read, the source file is recorded with the entry, and an
  unsupported format yields an explicit indeterminate status.
- [The store grows with every lookup] → The cache holds one entry per
  identity and replaces it on re-query, so repeated lookups do not
  accumulate.

## Migration Plan

1. Apply `memoria-local-proyecto` first; this change reuses its store,
   plugin, and failure contract.
2. Add the documentation and cache tables to the store schema, with the
   migration that creates them.
3. Implement the version resolver, the freshness module, the cache wrapper,
   and the two documentation tools.
4. Add the `documentacion-context7-compartida` skill and verify the
   description budget still holds.
5. Extend the validator and the acceptance harness.
6. Roll back by removing the skill and the tool grants and reverting the
   migration. The stored documentation records stay in the project's store
   and are harmless once the tools are gone.
