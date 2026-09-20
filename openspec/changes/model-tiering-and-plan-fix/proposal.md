## Why

The per-agent model assignment has three problems that make the effective
behaviour unpredictable and more expensive than it needs to be:

1. **A configured model does not exist.** `agent/plan.md` and
   `opencode.jsonc` both declare `openai/gpt-5.6-terra-fast`. The `openai`
   provider (ChatGPT OAuth) exposes no such id — its `gpt-5.6` family is
   `gpt-5.6`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, plus
   `gpt-6-astra`. The only `*-fast` variant anywhere in the models catalog
   is `vercel/openai/gpt-5.6-terra-fast`, which is not the configured
   provider. `plan` therefore either fails to resolve or silently falls back.
   The `agent-routing` spec also mandates `openai/gpt-5.6-terra` for the
   planning step of `spec-required`, so the spec and the config disagree and
   neither reflects reality.

2. **The most expensive tier is applied broadly.** Five agents
   (`architect`, `orchestrator`, `refactor`, `adversarial`, `cotizador`) run
   on Terra at $2 in / $12 out per million tokens. Only some of them perform
   work that is genuinely irreversible or external-facing; the rest are
   review loops that read a lot of files.

3. **The cheapest available capacity is unused.** Ollama Cloud is
   authenticated (`auth.json` → `ollama-cloud`) and serves reasoning models
   with tool calling at a fraction of the cost — `gpt-oss:20b` at
   $0.07/$0.3, `glm-5.3-flash` at $0.15/$0.5, `deepseek-v4.1-flash` at
   $0.15/$0.6, `nemotron-3-super` at $0.015 in. Today only `openai` and
   `minimax` are used by any agent, so `explore`, `p5t-installer`, and
   `small_model` pay MiniMax prices for work a cheaper model handles.

The goal is a **tiered** assignment: capacity where a role makes an
irreversible or external-facing decision, the value tier where a role
executes or reads.

## What Changes

- Replace the non-existent `openai/gpt-5.6-terra-fast` with
  `openai/gpt-5.6-luna` (1M ctx, reasoning, $0.2/$1.2) in `agent/plan.md`,
  `opencode.jsonc`, and the `agent-routing` spec, and retarget the
  `spec-required` planning model to `luna` for consistency.
- Move the high-volume, low-risk execution roles to Ollama Cloud:
  `explore` → `ollama-cloud/gpt-oss:20b`, `p5t-installer` →
  `ollama-cloud/gpt-oss:20b`.
- Move `small_model` from `minimax/MiniMax-M2.7-highspeed` ($0.6/$2.4) to
  `ollama-cloud/gpt-oss:20b` ($0.07/$0.3).
- Retarget `/opsx-propose` from `openai/gpt-5.6-terra` to
  `openai/gpt-5.6-luna` so the planning story is coherent.
- Keep Terra for the roles that make irreversible edits or external-facing
  audits: `architect`, `orchestrator`, `refactor`, `adversarial`,
  `cotizador`. Keep MiniMax M3 for `build`, `general`, `frontend`,
  `backend`, `qa`.
- Reconcile the `agent-routing` spec with the effective configuration:
  Terra is reserved for irreversible/external roles (dropping the
  "adversarial only in `full` mode" clause, which the config never honoured),
  `plan` uses `luna`, `explore` uses the value tier, and `p5t-installer`
  is named explicitly.
- Add a static check to `scripts/validate-config.mjs` that fails when a
  configured `provider/model` is absent from the OpenCode models catalog,
  so a phantom model id is caught at install time instead of at dispatch.

## Non-Goals

- No change to `steps`, `permission`, MCP gating, `subagent_depth`, or the
  routing classes themselves. This change moves models only.
- No new providers are onboarded; only `openai`, `minimax`, and
  `ollama-cloud`, which are already authenticated in `auth.json`.
- No change to the skill surface. Skills do not carry a `model` field in
  OpenCode — a skill runs on the model of the agent or command that loads
  it — so skill model cost is governed entirely by this agent/command map.
- No re-tuning of the `audit` class definition or the `cotizador` dispatch
  gate.
