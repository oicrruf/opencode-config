## Why

The execution-tier model assignments in `config/model-profiles.json` are
split across two profiles (`personal` and `work`) and three model ids
(`ollama-cloud/minimax-m3`, `openai/gpt-5.6-terra`, `minimax/MiniMax-M3`).
The 5 bounded-execution agents (`build`, `general`, `frontend`, `backend`,
`qa`) end up on different model ids depending on which profile the
operator selects at install time:

- **`personal`** assigns them `ollama-cloud/minimax-m3` ($0.6/$2.4 per
  million tokens, 512k context, Ollama-served).
- **`work`** assigns them `openai/gpt-5.6-terra` ($2/$12 per million
  tokens, the decision tier).

`ollama-cloud/minimax-m3` (Ollama-MiniMax) is a paid hosted proxy of the
MiniMax open-weight model. The Ollama-hosted MiniMax variant consumes
tokens fast enough that the operator's monthly budget disappears well
before the end of the billing cycle, while the underlying model is also
available natively on `minimax/MiniMax-M3` at a lower per-token rate. The
Ollama proxy exists to give the operator a second, isolated quota when
the direct quota is exhausted; it is not a budget choice. Choosing it
for the bounded-execution tier by default was a misread of the cost
shape.

`openai/gpt-5.6-terra` for those 5 agents in the `work` profile is also
wrong for the workload: those agents do bounded multi-file edits and
review, not irreversible structural decisions. Terra is reserved for the
roles whose output IS the decision (`architect`, `orchestrator`,
`refactor`, `adversarial`, `cotizador`, `/opsx-propose`). Routing the
execution agents through Terra pays a 6× input / 40× output premium for
no additional capability on this workload.

The two profiles are the operator's only two install-time choices (no
`medium`-mode flag exists). When the operator runs
`./install.sh --profile work` expecting a "more capable" work session,
they actually get the same execution agents on a more expensive model —
and the session still lands on `minimax/MiniMax-M3` for the root default
and `/opsx-apply`, so the per-session bill grows without a real
capability bump.

This change unifies the 5 bounded-execution agents on
`ollama-cloud/gpt-oss:20b` ($0.07/$0.3, 131k context, validated for
tool calling in earlier operator probes) across **both** profiles.
`minimax/MiniMax-M3` (direct) stays as the root default and the
`spec-required` implementation tier because its 1M context window and
the direct-quota isolation are still load-bearing for that workload.
`openai/gpt-5.6-terra` stays on the decision tier. The change does not
alter the catalog of model ids available to any agent; it moves the
mapping of those ids to the bounded-execution agents in both profiles.

## What Changes

- `config/model-profiles.json` — both `profiles.personal.agents` and
  `profiles.work.agents` for `build`, `general`, `frontend`, `backend`,
  and `qa` change to `ollama-cloud/gpt-oss:20b`.
- `opencode.jsonc` — the 5 corresponding `agent.<name>.model` blocks
  regenerate to `ollama-cloud/gpt-oss:20b` after the next render of the
  `personal` profile (the file is the rendered `personal` output by
  convention).
- `agent/routing.md` — the `medium` row in the work-classes table, the
  `Ollama-MiniMax` row in the model-tiers table, and the 5 rows in the
  per-agent defaults table for `build`/`general`/`frontend`/`backend`/
  `qa` update to reflect the new tier. The "Ollama-MiniMax" tier row
  drops entirely; the Value tier is the new bounded-execution tier.
- `agent/cotizador.md` — line 36 names `model MiniMax M3` for the
  default `build` agent; update to `gpt-oss:20b`.
- `scripts/test-model-profiles.mjs` — check 1 hardcodes
  `ollama-cloud/minimax-m3` as the expected default render for `build`;
  update to `ollama-cloud/gpt-oss:20b`. Check 3 asserts that
  `personal.agent.build.model !== work.agent.build.model`. After this
  change, both profiles render the same model id for those 5 agents, so
  the assertion must drop or change shape (the only remaining
  differentiator is `root.model` and the `opsx-apply` command).
- `scripts/acceptance-harness.mjs` — `EXPECTED_AGENT_MODELS` for
  `build`, `general`, `frontend`, `backend`, `qa` updates to
  `ollama-cloud/gpt-oss:20b`.
- `scripts/validate-config.mjs` — the skip-notice strings in the
  missing-catalog path stop naming `ollama-cloud/minimax-m3` and name
  the new id alongside the other Ollama Cloud ids.
- `openspec/specs/agent-routing/spec.md` — the `medium` row in the
  class-vs-model matrix, the Ollama-MiniMax tier bullet, and the
  `build runs on the Ollama-MiniMax tier` scenario update. The other
  scenarios that reference the Ollama-MiniMax id inline update their
  expectations.
- `openspec/specs/minimax-tier-split/spec.md` — the entire spec is
  about the split between `minimax/MiniMax-M3` (direct) and
  `ollama-cloud/minimax-m3` (Ollama proxy) for the bounded-execution
  agents. After this change, the Ollama-MiniMax tier carries zero
  assignments; the spec describes a state that no longer exists. Mark
  the spec `## REMOVED` and delete the requirements.
- `openspec/changes/unify-execution-tier-on-gpt-oss/` — proposal,
  design, tasks, and the two spec deltas above.

## Capabilities

### Modified Capabilities

- `agent-routing`: the `medium` class row, the Ollama-MiniMax tier
  bullet, and the `build runs on the Ollama-MiniMax tier` scenario
  become stale and update to reflect the unified Value tier.

### Removed Capabilities

- `minimax-tier-split`: the spec describes a tier split that no longer
  exists. After this change, every bounded-execution agent sits on
  `ollama-cloud/gpt-oss:20b` regardless of profile; the spec's central
  claim ("`ollama-cloud/minimax-m3` is assigned to `build`, `general`,
  `frontend`, `backend`, `qa`") becomes false. The spec is removed.

## Impact

- `config/model-profiles.json` — 10 values across 2 profiles
- `opencode.jsonc` — 5 model fields regenerate via the renderer
- `agent/routing.md` — 7 references (1 in class matrix, 1 in tier table,
  5 in per-agent defaults) plus the `Ollama-MiniMax` tier row drops
- `agent/cotizador.md` — 1 inline reference
- `scripts/test-model-profiles.mjs` — check 1 expected model id, check
  3 distinct-assignments assertion changes shape
- `scripts/acceptance-harness.mjs` — 5 values in `EXPECTED_AGENT_MODELS`
- `scripts/validate-config.mjs` — 2 skip-notice strings
- `openspec/specs/agent-routing/spec.md` — MODIFIED
- `openspec/specs/minimax-tier-split/spec.md` — REMOVED
- `openspec/changes/unify-execution-tier-on-gpt-oss/` — new change

## Non-Goals

- No change to `minimax/MiniMax-M3` (direct). It stays as the root
  default, the `spec-required` implementation tier, and the
  `/opsx-apply` command model.
- No change to `openai/gpt-5.6-terra` (decision tier). It stays on the
  roles whose output is the decision.
- No change to `ollama-cloud/gpt-oss:20b`'s existing assignments
  (`explore`, `doctor`, `p5t-installer`, `small_model`, `archify`,
  `dedupe`, `mmx`, `mmx-h3-video`, `jev`). The change extends the same
  model id to 5 more slots.
- No new model id added; no model id removed from the manifest.
- No change to the OpenCode catalog (`~/.cache/opencode/models.json`).
- No change to `agent/build.md`, `agent/general.md`,
  `agent/frontend.md`, `agent/backend.md`, `agent/qa.md` frontmatter;
  their `model:` field is removed in the templates (those files do
  not currently declare a `model:` line for those agents, only the
  manifest does) so no edit is needed.
- No change to `config/opencode.template.jsonc`; it does not pin a
  per-agent model id.
- No change to the install.sh or any post-install verification gate.
