## Context

(See `proposal.md` for motivation.) The repo already runs four local
or remote MCP servers (`codegraph`, `context7` remote with
`{env:CONTEXT7_API_KEY}` interpolation, `serena`, `playwright`)
configured in `config/opencode.template.jsonc`'s `mcp` block. The
existing `mcp-profiles` spec defines a per-agent deny-by-default
matrix and the rule that MCP startup respects the union of enabled
agents. The Jev integration has to slot into that infrastructure
unchanged: a new local stdio MCP server, a new column in the matrix,
and possibly a row split for `build`/`plan` to receive `jev_*`
allow-list entries.

The just-archived `add-jev-openrouter` change left three artifacts
that this change reverses:
- `provider.openrouter.models["typesafe/jev-1.13"]` in the template,
- the README's "External / opt-in model ids" section, and
- `openspec/specs/model-providers/spec.md` (zero requirements after
  this change retires the capability via the spec-driven
  retirement policy).

The reverse happens in the same change so the repo lands in a
single coherent state.

## Goals / Non-Goals

**Goals:**
- Build the smallest possible stdio MCP server that exposes a
  single tool (`jev_evaluate`) and proxies correctly to
  `https://openrouter.ai/api/v1/systemone`.
- Match the runtime contract every other local MCP in this repo
  already follows: forked by opencode, `OPENROUTER_API_KEY` in the
  child process env, child dies cleanly when opencode exits.
- Land the rollback of the prior change in the same commit so
  `git status` after the apply shows one coherent diff, not two.

**Non-Goals:**
- Server-side caching, batching, or pre-warming of Jev calls
  (HTTP 429 retry is the SDK's job, not ours).
- A retry policy. If OpenRouter returns 429 / 529, the tool returns
  the upstream status to the agent verbatim and lets the agent
  decide whether to retry.
- Multi-model support in this server. Each future decision model
  is its own MCP server (Decision-as-MCP rule from the spec); we
  do not start building a generic "decision-mcp" abstraction.
- Switching from OpenRouter to direct `api.typesafe.ai`. The user
  has `OPENROUTER_API_KEY` already; switching would invalidate that
  key as the source of truth and add a parallel billing surface.

## Decisions

### D1: Local stdio MCP server, not remote

`codegraph`, `serena`, and `playwright` are already local stdio
MCPs in this repo. Following the existing pattern keeps the diff
small (`mcp` block stays a list of `type: "local"` entries) and
avoids any hosted-deploy story (the server has zero TLS, zero
network egress beyond the OpenRouter call, and never persists
data).

Alternatives considered:
- **Remote MCP** at a hosted URL: adds an externally-hosted
  component, an OAuth dance, and a billing meter; rejected for
  surface and zero-benefit reasons.
- **Same server as a Vercel Edge Function**: violates the
  philosophy "MCPs in this repo are forked by opencode".

### D2: Plain Node ESM stdio server, no SDK (revised during implementation)

The original plan was `@modelcontextprotocol/sdk`. During apply the
framing code turned out to be ~150 lines (Content-Length parsing,
header/body dispatch, JSON-RPC error mapping) — roughly the size of
the SDK itself. Dropping the SDK removed the only node_modules / gitignore
/ `package.json` plumbing the project would otherwise need, kept the
server at one file that an operator can audit top-to-bottom, and
matched the repo's existing convention (no top-level `package.json`).
The MCP stdio transport is small enough that hand-rolled beats
imported for a single-tool server.

Alternatives considered:
- **`@modelcontextprotocol/sdk`** (Node): cleaner handler shape but
  adds a dep, a `node_modules/`, and a `package.json` for one file;
  rejected for surface-area reasons.
- **Pure Python** with `mcp` SDK: matches `docs.typesafe.ai`'s
  Python quickstart but adds a `python3` dep the local MCP
  pipeline doesn't otherwise need; rejected.

### D3: API key flows via the MCP block's `environment` field

The other auth-bearing local MCP (`context7`) is remote, but the
same mechanism works for local: `OPENROUTER_API_KEY` lands in
`process.env` of the forked Node process via opencode's env
interpolation. This matches the docs example and lets the user
keep using `/connect` as the single source of truth for the key;
no project-side env file, no `install.sh` plumbing.

Alternative considered:
- **Server reads `~/.local/share/opencode/auth.json` directly**: works
  but couples the server to a file path and a JSON schema that
  opencode may change; rejected because the env path is what every
  other MCP in this repo already uses.

### D4: The matrix splits the first row

The first row in the current `mcp-profiles` matrix collapses
`build`, `plan`, `general`, `architect`, `refactor`, and
`orchestrator` into a single row because every existing column
(`codegraph`, `context7`, `serena`, `playwright`) treats all six
the same way. Jev breaks that uniformity: `build` and `plan` need
it, the other four don't. Splitting the row is clearer than
adding per-cell qualifiers like "`allow` (build, plan);
`deny` (general, architect, refactor, orchestrator)" which the
existing table format does not support.

### D5: Capability retirement of `model-providers`

The `add-jev-openrouter` change added a `model-providers`
capability with 4 requirements. After this change, every one of
those requirements either (a) is no longer relevant because the
underlying integration was the wrong shape, or (b) becomes a
re-statement of facts already covered by `agent-routing` or the
Jev-MCP requirements in this change's delta. Retiring the
capability at archive time (per the spec-driven retirement
policy: `model-providers` ends up with 0 requirements and the
file is deleted) keeps the main specs catalog honest about what
the repo actually implements.

## Risks / Trade-offs

- **R1: OpenRouter does not actually proxy `/v1/systemone`** →
  OpenRouter lists `typesafe/jev-1.13` in its catalog and charges
  the same per-token price it shows for the model; if the
  routing fails the tool surfaces the upstream status to the
  agent verbatim. Fallback path is to point the server at
  `https://api.typesafe.ai/v1/systemone` and use
  `TYPESAFE_API_KEY` instead; a one-line config change.
- **R2: The server crashes mid-call, orphaning the tool
  invocation** → opencode surfaces the error to the agent and
  the session continues. Tested by killing the server process
  during a pending request; the agent gets a parse error and can
  fall through to its own logic.
- **R3: `OPENROUTER_API_KEY` is not present in the child
  process env even though `/connect` was completed** →
  Symptom is the same as a brand-new install (tool returns
  MCP error -32000 + remediation hint). The hint names
  `/connect` so the fix is one command.
- **R4: A future `model-providers` opt-in (e.g. adding
  `anthropic/claude-3-haiku` as an opt-in model id) loses its
  spec home** → if it does, that's a new capability rename; the
  project's existing convention (per the add-a-new-profile flow
  in `installation-model-profiles`) is to file a follow-up
  OpenSpec change rather than mutating an existing capability
  in place.

## Migration Plan

Apply in one commit:
1. Add `.opencode/mcp/jev/server.mjs` and `package.json` (or a
   pinned `dependencies` line if the repo doesn't have one yet).
   Install the dependency via the existing `npm` install
   pathway (or, if the repo uses `pnpm`, follow that).
2. Update `config/opencode.template.jsonc`:
   - Add `mcp.jev` with `type: "local"`, the Node command, and
     `environment: { OPENROUTER_API_KEY: "{env:OPENROUTER_API_KEY}" }`.
   - Remove `provider.openrouter` entirely.
   - Add `jev_*` to the `permission` blocks of `build`, `plan`,
     and `adversarial`.
3. Replace the README's "External / opt-in model ids" section
   with a new "Jev decision tool" section: explains the tool,
   lists the three primitives, and shows a working
   `mcp__jev__jev_evaluate` payload.
4. Re-render `opencode.jsonc` and run `./install.sh`. Run the
   full validation suite.
5. Archive the change. Sync step retires `model-providers`.

Rollback: revert the four edits in (1)–(3), re-render and
re-install. Net effect: Jev-as-MCP disappears, the previous
`add-jev-openrouter` archived state would not be restored (the
template entry is gone), `model-providers` spec is gone. The user
can re-run the archived `add-jev-openrouter` to bring back the
non-working model integration, but the prior implementation
should not be revived; reverting further requires a new change.

## Open Questions

- Whether to ship the `mcp__jev__jev_evaluate` tool with an
  argument-shape helper (a short readme in the server's directory
  explaining the three primitives) or rely solely on the JSON
  schema the tool returns at `tools/list`. The latter is more
  uniform; deferring to apply-time.
