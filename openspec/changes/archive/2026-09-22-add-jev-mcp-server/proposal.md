## Why

Jev 1.13 is a "decision model" (`/v1/systemone` endpoint, typed
`{state, questions}` payload, returns `{answers: {<id>: {...}}}`) — it
is NOT an OpenAI-compatible chat-completion model. OpenCode's
`provider.<name>.models` mechanism routes every model through the AI
SDK's chat-completions pipeline (`/v1/chat/completions`, `messages:
[{role, content}]`), so Jev cannot fit there no matter how we name the
provider. The prior change (`add-jev-openrouter`, just archived)
declared `provider.openrouter.models["typesafe/jev-1.13"]: {}` and
the entry will not surface as a usable model in `/models` regardless
of how often the TUI restarts.

What Jev actually wants is the inverse of a model: a `tool` that any
agent can call. The natural opencode surface for "tool that the agent
calls with typed JSON and gets typed JSON back" is an MCP server
(stdio), exactly like `codegraph`/`serena`/`playwright` already are in
this repo. This change builds a small local MCP server exposing
`jev_evaluate(state, questions)` and wires it into the existing
`mcp-profiles` per-agent scoping matrix.

## What Changes

- Add a local MCP server at `.opencode/mcp/jev/server.mjs` that
  implements the MCP `tools/list` and `tools/call` JSON-RPC methods
  over stdio (using `@modelcontextprotocol/sdk` or the upstream
  `mcp` JS package — whichever runs in plain Node without a
  transpiler). The server exposes a single tool, `jev_evaluate`,
  whose arguments are `state` (string | object | array) and
  `questions` (a map of typed primitives), and which proxies the
  request to OpenRouter at `https://openrouter.ai/api/v1/systemone`
  using `Authorization: Bearer ${OPENROUTER_API_KEY}`.
- Add `mcp.jev` to `config/opencode.template.jsonc`, with the server
  declared `type: "local"` and the same autostart shape as
  `serena`/`codegraph`. The API key reaches the server via the
  `environment` field referencing `{env:OPENROUTER_API_KEY}`, so no
  secret is baked into the rendered config.
- Extend the per-agent matrix in the `mcp-profiles` spec: `build`,
  `plan`, and `adversarial` get `jev_*` tools allowed; everything
  else (`explore`, `general`, `frontend`, `backend`, `qa`,
  `cotizador`, `refactor`, `architect`, `orchestrator`,
  `p5t-installer`, `doctor`) stays `deny` for `jev_*`.
- README gets a new "Jev decision tool" section that points users at
  the `mcp__jev__jev_evaluate` tool and lists the three primitives
  (`noul`, `choice`, `score`) with a working payload example.
- **Rollback** (in the same change, since the prior integration is
  superseded):
  - Remove `provider.openrouter` from
    `config/opencode.template.jsonc` (the Jev model id entry).
  - Replace the README's "External / opt-in model ids" section with
    the new "Jev decision tool" section (or, if the opt-in framing
    is useful generically, leave a one-line pointer to the new MCP
    section and remove the rest).
  - On archive, the `model-providers` capability added by
    `add-jev-openrouter` becomes empty (zero requirements); the
    spec-sync step retires it and the file is removed under the
    rules in the spec-driven workflow's retirement policy.

## Capabilities

### New Capabilities

<!-- none. The change extends an existing capability rather than
     introducing a new one. -->

### Modified Capabilities

- `mcp-profiles`: the per-agent MCP matrix becomes a five-column
  table that includes `jev` alongside `codegraph`, `context7`,
  `serena`, and `playwright`; the requirements contract acquires
  `jev_*` rows/columns where appropriate.

## Impact

- **New file**: `.opencode/mcp/jev/server.mjs` — small Node stdio
  MCP server (~80 lines). Listed under `.gitignore` exemptions
  already in place for `.opencode/`.
- **New dependency**: `package.json` (or just an `npm install` line in
  the README / install doc) for `@modelcontextprotocol/sdk` (or
  whichever SDK is current at apply time). Pinned to a version that
  matches what other local MCPs in this repo use.
- **Template edits**: `mcp.jev` entry added; `provider.openrouter`
  removed in the rollback.
- **Agent permission edits**: `build`, `plan`, `adversarial` gain
  `"jev_*": "allow"` in their `permission.skill` blocks (mirroring
  the existing `codegraph_*` / `context7_*` pattern).
- **README**: replace the "External / opt-in model ids" section with
  a "Jev decision tool" section.
- **OpenSpec state**: the previously-archived `add-jev-openrouter`
  change contributed `model-providers` to `openspec/specs/`; this
  change retires that capability (zero requirements remain) per the
  retirement rules in the spec-driven workflow, so
  `openspec/specs/model-providers/spec.md` is deleted on archive.
- **Auth**: still uses `~/.local/share/opencode/auth.json` via the
  `OPENROUTER_API_KEY` slot the user already populated with
  `/connect`. No new secrets to provision.
- **Sensitive surface**: zero. The API key flows through
  opencode's standard env-substitution path; no secret lands in
  tracked files.
