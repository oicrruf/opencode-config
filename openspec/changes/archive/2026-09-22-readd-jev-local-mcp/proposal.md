## Why

The operator uses Jev for structured development decisions such as
"what commit type does this change need?". Jev accepts a typed
`{state, questions}` request at OpenRouter's `/v1/systemone` endpoint,
not a chat-completion request, so it cannot be configured as an
OpenCode model. The official remote OpenRouter MCP is intentionally for
catalog, billing, documentation, and chat test messages; its own guide
says applications must call the API directly to run models, and it does
not expose a generic SystemOne tool.

A small local MCP wrapper is the appropriate bridge: it lets selected
OpenCode agents call the existing REST endpoint as a typed tool, without
forcing Jev through a chat-model interface or making the operator
manually copy REST responses into every decision.

## What Changes

- Reintroduce Jev as a **local stdio MCP server** with one tool,
  `jev_evaluate(state, questions)`, backed by
  `POST https://openrouter.ai/api/v1/systemone` using model
  `typesafe/jev-1.13`.
- The wrapper MUST be launched through an **absolute path in the rendered
  config**, not a path relative to the user's active project. The prior
  wrapper timed out after 30 seconds because a relative script path could
  resolve outside this configuration repository.
- Resolve OpenRouter credentials from `OPENROUTER_API_KEY` when OpenCode
  passes it to the local MCP process, with a safe read-only fallback to
  the already-authenticated per-user OpenCode auth store. No key may be
  copied to tracked files or logged.
- Give `build`, `plan`, and `adversarial` access to `jev_*`; all other
  agents remain denied. This keeps Jev available where commit
  classification, risk gating, and review routing happen without exposing
  an additional billable tool to unrelated roles.
- Update the MCP matrix/spec, renderer, README, and verification suite.
  The README will describe Jev as an opt-in decision tool and state that
  OpenRouter's hosted MCP remains separate (discovery and chat testing,
  not Jev evaluation).
- Do not add the hosted `https://mcp.openrouter.ai/mcp` server in this
  change. It is useful for OpenRouter discovery but cannot execute
  SystemOne requests, and would add a second OAuth flow unrelated to the
  requested Jev tool.

## Capabilities

### New Capabilities

<!-- none. The local Jev server extends the existing MCP policy. -->

### Modified Capabilities

- `mcp-profiles`: add the `jev` tool family to the agent-scoped MCP
  matrix and define the local SystemOne wrapper's typed, secure,
  timeout-safe behavior.

## Impact

- `config/opencode.template.jsonc`: new local `mcp.jev` block plus
  `jev_*` allow-list entries only for `build`, `plan`, and
  `adversarial`.
- `scripts/render-config.mjs`: render the local server script path as an
  absolute path based on the repository root, preserving relocatability
  after re-running `./install.sh`.
- `.opencode/mcp/jev/server.mjs` (new): a dependency-free Node stdio MCP
  server which translates MCP tool calls to OpenRouter SystemOne REST
  calls.
- `README.md`: replace the REST-only note with tool setup, supported
  primitives (`noul`, `choice`, `score`), and operational limits.
- `openspec/specs/mcp-profiles/spec.md`: extended policy matrix and
  tool contract.
- Runtime: one local child process when OpenCode starts the Jev MCP;
  outgoing HTTPS requests occur only when an allowed agent calls the
  tool. OpenRouter billing applies to each evaluation.
- Sensitive data: the wrapper reads credentials only from process env or
  the user's existing OpenCode auth store; it never renders, logs, or
  persists an API key.
