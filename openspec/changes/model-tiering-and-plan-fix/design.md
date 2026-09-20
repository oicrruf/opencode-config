## Context

The per-agent model map lives in two places that must agree: the frontmatter
of `agent/*.md` and the `agent.*.model` keys in `opencode.jsonc`. A third
place documents the intent: `openspec/specs/agent-routing/spec.md`. Before
this change the three disagree — the spec promises Terra for `adversarial`
only in `full` mode (the config sets it unconditionally), the spec never
names `p5t-installer`, and `plan` points at a model id that no configured
provider serves.

Cost context, from the authenticated providers (in / out, USD per million
tokens):

| Tier | Model | In | Out | Notes |
|------|-------|----|-----|-------|
| Frontier | `openai/gpt-5.6-sol` / `gpt-6-astra` | $4–10 | $20–50 | not used |
| Decision | `openai/gpt-5.6-terra` | $2 | $12 | irreversible / external |
| Planning | `openai/gpt-5.6-luna` | $0.2 | $1.2 | 1M ctx, fast, cheap |
| Value | `minimax/MiniMax-M3` | $0.3 | $1.2 | 1M ctx / 512k out |
| Value | `ollama-cloud/gpt-oss:20b` | $0.07 | $0.3 | tool calling confirmed |
| Value | `ollama-cloud/glm-5.3-flash` | $0.15 | $0.5 | 1M ctx, tool calling |
| Value | `ollama-cloud/deepseek-v4.1-flash` | $0.15 | $0.6 | 1M ctx, tool calling |

## Goals / Non-Goals

**Goals**

- Every configured model id resolves against a provider the user is
  authenticated to.
- Cost follows decision weight: the frontier/decision tiers stay on the
  roles that commit irreversible change or produce an external artifact;
  reading and mechanical execution run on the value tier.
- The spec, the frontmatter, and `opencode.jsonc` state the same thing.

**Non-Goals**

- Onboarding a new provider.
- Changing routing classes, `steps`, `permission`, MCP gating, or depth.
- Re-pricing the `cotizador` workflow or the `audit` class gate.

## Decisions

### Decision: `plan` runs on `openai/gpt-5.6-luna`

`plan` investigates a request, classifies scope, and produces a plan. It
does not commit irreversible change, and it is the most frequently invoked
primary agent, so its cost dominates. `luna` is a real, tool-calling,
1M-context reasoning model on the already-authenticated `openai` provider at
$0.2/$1.2 — a 10x reduction against Terra with more context than Terra's
competitors in the MiniMax line.

Alternatives considered:

- **`openai/gpt-5.6-terra`** — matches the current spec text and the other
  decision roles. Rejected: `plan` is high-volume and low-risk, and the spec
  text is itself part of what this change corrects.
- **`minimax/MiniMax-M3`** — cheapest of the three. Rejected: it collapses
  the planning/execution distinction the routing class `spec-required`
  depends on.
- **Keep a `-fast` id** — no such id exists on the `openai` provider.
  Rejected.

### Decision: value tier runs on Ollama Cloud

`ollama-cloud` is authenticated and serves reasoning models with tool
calling. Verified with live calls against the stored credential:
`gpt-oss:20b` (3.6s), `deepseek-v4.1-flash` (1.7s), `nemotron-3-super`
(2.3s), `glm-5.3-flash` (1.3s), and `minimax-m2.7` (1.5s) each return a
well-formed tool call. `nemotron-3-nano:30b` returned no tool call in the
same probe (11.4s) and is therefore excluded from any agent assignment.

`explore` and `p5t-installer`, plus the `small_model` slot, move to
`ollama-cloud/gpt-oss:20b` at $0.07/$0.3.

Alternatives considered:

- **`glm-5.3-flash` / `deepseek-v4.1-flash`** — both fast and capable, but
  2x the input price of `gpt-oss:20b` for work that is read-mostly.
- **Keep MiniMax** — rejected: ~4x the input cost for the same read-only
  and mechanical work.

### Decision: the "Terra only in full mode" clause is dropped, not implemented

The spec required Terra for `adversarial` only in `full` mode. OpenCode has
one static `model` per agent, so a mode-dependent model is not expressible
without a second paired agent, which the previous change already rejected
for `steps` for the same reason. The spec is corrected to state Terra for
`adversarial` unconditionally, matching the config and the rationale that
adversarial review is a pre-commit gate.

Alternatives considered:

- **Paired `adversarial-targeted` agent on a cheaper model** — rejected:
  adds an agent, a command surface, and a dispatch decision for a modest
  saving on a role that runs rarely.

### Decision: the validator asserts model ids resolve

`scripts/validate-config.mjs` gains a check that reads the OpenCode models
cache (`~/.cache/opencode/models.json`) when it exists and fails when a
configured `provider/model` is absent from it. The check is skipped with a
printed notice when the cache is absent, so `install.sh` does not fail on a
fresh machine that has never started OpenCode.

Alternatives considered:

- **Fetch the catalog from models.dev inside the validator** — rejected:
  adds a network dependency to install.
- **Pin a vendored allow-list** — rejected: goes stale silently, which is
  the failure this check exists to prevent.

## Risks / Trade-offs

- **[Risk]** `gpt-oss:20b` is a smaller model than MiniMax M3; `explore`
  and `p5t-installer` quality may drop on large repos or gnarly lockfile
  conflicts. → **Mitigation**: both roles are read-mostly and report back
  rather than commit; `p5t-installer` retains `bash: allow` and escalates a
  blocker instead of guessing. If quality regresses, the change is a
  one-line revert per agent.
- **[Risk]** Ollama Cloud availability and rate limits are outside the
  user's control. → **Mitigation**: the `openai` and `minimax` tiers remain
  configured for the decision and execution roles, so a provider outage
  degrades `explore` only, not delivery.
- **[Risk]** The validator's catalog check depends on a cache file that
  OpenCode rewrites. → **Mitigation**: treat a missing cache as "skip", and
  treat a parse failure as "skip with warning", never as a failure.
- **[Trade-off]** `plan` on `luna` rather than `terra` may produce weaker
  first-pass plans on ambiguous requests. → Accepted: `plan` gates on
  `spec-required` and hands off to the OpenSpec workflow, where a weak plan
  is caught by proposal review rather than by an irreversible edit.

## Migration Plan

1. Edit the five agent frontmatter files and the five `opencode.jsonc`
   `model` keys.
2. Edit the two command files (`opsx-propose`) and `opencode.jsonc`
   `small_model`.
3. Update `openspec/specs/agent-routing/spec.md` to the corrected matrix.
4. Add the catalog check to `scripts/validate-config.mjs`.
5. Verify: `node scripts/validate-config.mjs`, a cross-check that frontmatter
   and `opencode.jsonc` agree, and `openspec validate --specs --strict`.
6. Restart OpenCode (config is loaded once at startup).

**Rollback strategy**: revert the commit. No schema, no dependency, and no
permission change is involved; the previous model ids remain valid.

## Open Questions

- Whether `adversarial` should stay on Terra now that its default mode is
  `targeted`. Deferred: it is a pre-commit gate where a missed finding is
  more expensive than the token cost, so the decision tier is retained.
- Whether `qa` should move to a cheaper tier once its runtime cost per
  session is measured. Deferred to the metrics surface.
