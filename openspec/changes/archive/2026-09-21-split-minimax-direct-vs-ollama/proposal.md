## Why

The execution tier currently sends every execution-role agent — `build`,
`general`, `frontend`, `backend`, `qa` — to `minimax/MiniMax-M3` through the
direct MiniMax API at $0.3/$1.2 per million tokens with a 1 048 576-token
context window. The same model weights are available through Ollama Cloud
as `ollama-cloud/minimax-m3` with a 512 000-token context window. The
direct-MiniMax pool serves both bounded multi-file edits and `spec-required`
implementations that need the full 1M context, so the two share a single
quota with no isolation and bounded work can starve the long-context work
whenever the direct quota is tight.

Splitting the execution tier into a direct-MiniMax half and an Ollama-MiniMax
half reserves the 1M-context direct pool for `spec-required` implementations
whose context budget genuinely exceeds 512k (large proposals, cross-cutting
refactors, long multi-file investigations), and routes ordinary bounded
execution work to Ollama Cloud where the smaller context window is
sufficient and the quota is independent from the direct pool.

The Ollama Cloud tier is $0.6/$2.4 per million tokens, which is higher than
the direct tier per token. This change trades a per-token markup for two
things: (1) the direct 1M-context quota stays available for the work that
needs it, and (2) bounded execution work no longer shares that quota with
long-context work. The change is **not** motivated by saving money; the
cost framing is honest about the markup.

## What Changes

- Introduce a new `ollama-cloud/minimax-m3` model id resolved against the
  existing `ollama-cloud` provider already declared in `auth.json` (no new
  provider onboarding).
- Split the existing execution tier into two model tiers in
  `opencode.jsonc`, `agent/routing.md`, and the `agent-routing` spec:
  - **Direct-MiniMax tier (`minimax/MiniMax-M3`)**: the global root `model`
    and the `spec-required` class implementation step only.
  - **Ollama-MiniMax tier (`ollama-cloud/minimax-m3`)**: `build`, `general`,
    `frontend`, `backend`, and `qa`.
- Keep the decision tier (`openai/gpt-5.6-terra`), the planning tier
  (`openai/gpt-5.6-luna`), and the value tier (`ollama-cloud/gpt-oss:20b`)
  unchanged. `audit` stays on Terra because the spec reserves Terra for
  irreversible / external-facing decisions; this change does not alter that
  contract. If the operator later wants `audit` on direct MiniMax too, that
  is a separate change.
- Add a static check in `scripts/validate-config.mjs` that the new
  `ollama-cloud/minimax-m3` id is present in the OpenCode models catalog
  when a catalog exists, so a phantom id fails the install the same way the
  existing tier check does.
- Add `ollama-cloud/minimax-m3` to the validator's missing-catalog skip
  notice so a fresh machine that has never started OpenCode still installs.

## Capabilities

### New Capabilities

- `minimax-tier-split`: declare the direct-MiniMax and Ollama-MiniMax tiers,
  name the agents that resolve to each, and require that every configured
  id resolves against the authenticated provider catalog.

### Modified Capabilities

- `agent-routing`: the `Execution tier` requirement is replaced by two
  requirements — `Direct-MiniMax tier` (spec-required implementation) and
  `Ollama-MiniMax tier` (build, general, frontend, backend, qa). The
  class-vs-model matrix row for `medium` now points to `ollama-cloud/minimax-m3`.
  The `spec-required` row keeps Terra for planning and direct MiniMax for
  implementation. The `audit` row, the value tier, and the decision tier
  remain unchanged.

## Impact

- `opencode.jsonc`: `model` (root default) stays `minimax/MiniMax-M3`; agent
  blocks for `build`, `general`, `frontend`, `backend`, `qa` change from
  `minimax/MiniMax-M3` to `ollama-cloud/minimax-m3`.
- `agent/routing.md`: the `Model tiers` table gains the Ollama-MiniMax row;
  the `Per-agent defaults` table updates the five execution agents; the
  class-vs-model matrix updates the `medium` row.
- `agent/*.md`: frontmatter `model:` lines for the five execution agents
  change from `minimax/MiniMax-M3` to `ollama-cloud/minimax-m3` if any
  duplicate the config (currently none — agents inherit from
  `opencode.jsonc`).
- `commands/*.md`: no command currently overrides the execution agents'
  model, so no change. If a future command does, it must resolve against
  the new tier.
- `scripts/validate-config.mjs`: extend the catalog check to recognise
  `ollama-cloud/minimax-m3` and report it in the skip notice when the
  catalog is absent.
- `openspec/specs/agent-routing/spec.md`: delta requirements replacing the
  `Execution tier` clause with the two new tiers, and updating the
  class-vs-model matrix.
- No new provider is added. `auth.json` already declares `ollama-cloud`;
  the only new model id is `ollama-cloud/minimax-m3`, served by that same
  provider.
- No change to `steps`, `permission`, MCP gating, `subagent_depth`,
  routing classes, the `audit` definition, the `cotizador` dispatch gate,
  or the skill surface.
