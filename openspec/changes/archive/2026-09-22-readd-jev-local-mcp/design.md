## Context

The current template contains four MCPs (`codegraph`, `context7`,
`serena`, and `playwright`) and no Jev entry. `mcp-profiles` currently
has a four-column permission matrix. The validator checks that every
enabled MCP has a matching permission token, but it does not validate
that a local command path starts successfully.

The prior Jev MCP implementation proved the REST endpoint and all three
Jev primitives work, but an OpenCode call later timed out at 30 seconds.
The wrapper command used `.opencode/mcp/jev/server.mjs`, a path relative
to the directory from which the operator launched OpenCode. The local
server therefore could not be found from unrelated project directories.

OpenRouter's official hosted MCP guide was reviewed. It explicitly
positions `https://mcp.openrouter.ai/mcp` as a remote discovery/testing
server; `send-message` is chat-oriented and the guide says application
model execution remains a direct OpenRouter API call. It cannot replace
a SystemOne adapter for Jev.

## Goals / Non-Goals

**Goals:**
- Make Jev callable by `build`, `plan`, and `adversarial` as a reliable,
  typed MCP tool for commit classification and similar calibrated
  decisions.
- Remove the CWD-sensitive startup failure and bound upstream failures
  before OpenCode's 30-second client timeout.
- Keep the wrapper dependency-free and credential-safe.

**Non-Goals:**
- Add OpenRouter's hosted MCP; catalog, credits, and chat test messages
  are outside this Jev evaluation change.
- Make Jev a default chat model, change any profile model assignment, or
  expose it to all agents.
- Add request caching, batch evaluation, retries, or a generic decision
  framework.
- Persist calls, answers, probabilities, prompts, or credentials.

## Decisions

### D1: Local stdio adapter owns the SystemOne translation

The new server speaks MCP JSON-RPC over stdio and exposes one tool,
`jev_evaluate`. It serializes typed `state` and `questions` directly to
`POST https://openrouter.ai/api/v1/systemone` with model
`typesafe/jev-1.13`.

This is the narrowest bridge between OpenCode tools and Jev's non-chat
protocol. The hosted OpenRouter MCP is excluded because it has no
generic SystemOne tool; wrapping it would still require a second REST
adapter and a separate short-lived OAuth credential.

### D2: Plain Node ESM, no MCP package dependency

The server uses Node's built-in stdio, `fetch`, `AbortController`, and
JSON framing. This avoids adding a repository-level `package.json`,
install-time package management, or `node_modules` for a one-tool
adapter. The protocol surface is limited to initialize, tools/list,
tools/call, and ping, so a small explicit implementation is easier to
audit than a general framework.

### D3: Render an absolute server path

The template declares a dedicated `{__repo_root__}` token in the Jev
server argument. `scripts/render-config.mjs` substitutes the repository
root before writing `opencode.jsonc`. The checked-in template stays
portable; every `./install.sh` re-render corrects the path after a clone
move. The rendered command is therefore independent of the project CWD
where the operator invokes OpenCode.

Alternatives considered:
- Relative path: rejected; caused the observed 30-second timeout.
- Hard-coded user path: rejected; not portable between clones or hosts.
- Symlink another directory beneath `~/.config/opencode`: rejected;
  increases installer link surface for one script.

### D4: Environment first, OpenCode auth-store fallback

The server reads `OPENROUTER_API_KEY` from its child environment when
OpenCode interpolates it. If that value is absent, it reads the existing
OpenCode API-auth entry (`openrouter.key`) from the per-user auth store.
The fallback is read-only and never logs the value. It makes the wrapper
compatible with OpenCode versions that do not expand `{env:VAR}` in local
MCP `environment` fields.

### D5: Internal upstream deadline of 25 seconds

Each fetch uses an `AbortController` deadline shorter than OpenCode's
30-second tool deadline. The adapter maps abort, network, upstream HTTP,
and missing-credential cases to structured MCP tool errors and remains
alive for later calls. It does not retry automatically because retries
can multiply billing and make a classification decision stale.

### D6: Narrow permission scope

Only `build`, `plan`, and `adversarial` receive `jev_*`. Those roles make
commit classification, scope/risk, and review decisions; other roles
retain their current tool surface. The main matrix splits the existing
combined row to represent this difference clearly.

## Risks / Trade-offs

- **OpenRouter removes or changes `/v1/systemone`** → The server returns
  the upstream HTTP error, rather than silently coercing it through chat
  completions. Update the endpoint/model in a focused change.
- **OpenCode auth-store schema changes** → Env propagation remains the
  primary path; fallback failure produces a `/connect` remediation hint.
- **25 seconds is insufficient during an upstream incident** → Tool
  returns a structured error rather than a 30-second timeout; the agent
  can proceed without Jev or ask the operator.
- **Agents overuse a billable tool** → Scope is limited to three agents;
  prompts/docs tell them to use Jev only for a bounded typed decision,
  never as general reasoning or authorization.

## Migration Plan

1. Add the server, render-time token substitution, MCP block, and three
   permission grants.
2. Replace the REST-only README note with the local tool contract,
   including the fact that hosted OpenRouter MCP is a different service.
3. Re-render and install.
4. Verify protocol startup from an unrelated CWD, no-key behavior, abort
   behavior, and live `noul`/`choice`/`score` calls with the user's
   existing OpenRouter authentication.
5. Run validator, harness, profile tests, and strict OpenSpec validation.

Rollback: remove the local MCP entry, permission grants, server, and
renderer token substitution; re-render and reinstall. The operator can
still call Jev's REST endpoint manually.

## Open Questions

- None. The official hosted OpenRouter MCP was considered and explicitly
  excluded because it cannot evaluate Jev SystemOne payloads.
