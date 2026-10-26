# Proposal

## Why

Consulting library documentation is one of the most repeated and most
expensive actions in a delivery session. The Context7 MCP is available to
the planning and implementation agents, but every lookup is a fresh network
call whose result lives only in the conversation: a second agent, a later
session, or a follow-up question repeats the same query, pays the same
latency, and may receive a different answer if the upstream documentation
changed in between. The repository also has no place to record which version
of a library a documented answer refers to, so a stale answer can be reused
as if it were current.

## What Changes

- Cache Context7 lookups per project, keyed by the library, the package
  version, and the topic, so an identical repeated lookup is answered from
  the local store instead of the network.
- Resolve the package version from the project's own lockfile and record it
  with the cached documentation; when the version cannot be determined, say
  so instead of guessing, and never reuse that entry for a version-specific
  claim.
- Give every cached entry a freshness window and an explicit status, so a
  stale entry is re-queried, an invalidated entry is never served, and an
  unverified entry is clearly marked as such.
- Expose `documentation_save` and `documentation_search` so an agent can
  record the documentation it verified and a later agent can retrieve it,
  with the source, the version, and the agent that recorded it.
- Share the documentation across the planning and implementation phases of
  the same project, so a fact established while planning is available while
  implementing.
- Add a shared documentation skill that tells the agents to search the
  project cache before querying Context7, and to record the documentation
  they actually verified.
- Keep the cache local, free of credentials, and non-blocking: a cache
  failure falls back to a live lookup instead of failing the session.

## Capabilities

### New Capabilities

- `documentation-cache`: a per-project cache of library documentation with
  version resolution, freshness status, and a shared record of what was
  verified.

### Modified Capabilities

- `skill-surface`: add the shared documentation skill to the model-invocable
  delivery skills and keep the description budget satisfied.

## Impact

- Plugin source: `plugins/project-memory/` gains the documentation schema,
  the version resolution module, the freshness module, the cache wrapper for
  the Context7 tools, and the two documentation tools. This change depends on
  `memoria-local-proyecto`, which owns the store these records live in.
- Configuration: the Context7 MCP entry stays as it is; the new tools are
  granted to the same agents that may query Context7.
- Validation: the validator and the acceptance harness gain assertions for
  the new permission surface, the version resolution, and the description
  budget.
- Documentation: `README.md` describes the cache and the shared
  documentation workflow.
- No change to the model-profile manifest, the routing classes, or the
  rendered root configuration beyond the new permission entries.
