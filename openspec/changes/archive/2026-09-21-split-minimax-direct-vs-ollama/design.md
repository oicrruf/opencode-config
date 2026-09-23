## Context

The repository currently declares `minimax/MiniMax-M3` as the model for the
five execution-tier agents (`build`, `general`, `frontend`, `backend`,
`qa`) and as the root default in `opencode.jsonc`. The `minimax` provider
is already authenticated and the model id resolves against the OpenCode
catalog at a 1 048 576-token context window and $0.3/$1.2 per million
tokens. The `ollama-cloud` provider is also already authenticated and
serves `ollama-cloud/minimax-m3` at a 512 000-token context window and
$0.6/$2.4 per million tokens — same open weights as the direct tier,
smaller context, higher per-token cost, independent quota.

The relevant files are:

- `opencode.jsonc` — root default, agent blocks, MCP and permission
  configuration.
- `agent/routing.md` — the routing matrix that mirrors the config and is
  read by every agent.
- `openspec/specs/agent-routing/spec.md` — the durable contract.
- `scripts/validate-config.mjs` — the validator that catches phantom ids.

No agent frontmatter currently duplicates the model; everything inherits
from `opencode.jsonc`. No command frontmatter overrides the execution
agents, so command files are not in the change set. The
`add-installation-model-profiles` change (in flight) is orthogonal: it
introduces an install-time profile picker and will not affect this tier
split once both are applied.

The Ollama Cloud tier is not chosen for cost reasons — the per-token price
is double the direct tier. It is chosen for two things: (1) the smaller
context window is a non-binding constraint for bounded execution work and
(2) the quota is independent from the direct pool, so long-context
`spec-required` work no longer competes with bounded execution for the
same rate-limit window.

## Goals / Non-Goals

**Goals:**

- Move the five execution-tier agents from `minimax/MiniMax-M3` to
  `ollama-cloud/minimax-m3` without changing their behaviour, permissions,
  `steps`, or tool surface.
- Keep the root default `model` and the `spec-required` implementation
  step on `minimax/MiniMax-M3`.
- Extend `scripts/validate-config.mjs` so the new id is checked and a
  missing catalog prints a skip notice that names the new id.
- Update `agent/routing.md` and the spec delta to keep the routing matrix
  and the durable contract consistent with the new assignment.

**Non-Goals:**

- Do not onboard a new provider. `ollama-cloud` is already in `auth.json`.
- Do not change which provider the user pays for or any pricing policy.
- Do not move `audit`, `architect`, `orchestrator`, `refactor`, `plan`,
  `explore`, `p5t-installer`, or `doctor` off their current tier. Those
  decisions belong to other changes (`model-tiering-and-plan-fix`,
  `add-installation-model-profiles`).
- Do not introduce runtime profile selection. The choice is a
  configuration-level swap, not a per-launch argument.
- Do not modify the `agent-routing` spec's audit classification rules,
  dispatch contract, subagent-depth policy, or audit-mode semantics.

## Decisions

### Update the config first, then the routing matrix, then the spec delta

Apply the change in the order: `opencode.jsonc` → `agent/routing.md` →
the spec delta in the change folder → `scripts/validate-config.mjs` →
run the validator. This ordering matches how the project already landed
`model-tiering-and-plan-fix` and keeps the validator as the last gate so a
missed id is caught before archive.

Alternatives considered:

- **Update the spec first, then the config**: rejected because the spec
  is a contract over the config; updating the contract before the
  implementation creates a transient where the validator would reject the
  config until both move together.
- **Land everything in one commit**: rejected because the change spans
  multiple files with different audiences (root config vs routing matrix
  vs validator) and a per-file rollout makes regressions easier to bisect.

### Keep the root `model` on `minimax/MiniMax-M3`

The root default is what OpenCode uses when no agent-specific override
exists. Keeping it on the direct MiniMax means the user's manual session
(typing into the editor without selecting an agent) still hits the paid
quota, which matches the intent of the change: the user pays for the
session they explicitly drive, and the agents they did not pick route to
the cheaper tier. The `small_model` stays on `ollama-cloud/gpt-oss:20b`
for trivial reads.

Alternatives considered:

- **Move the root default to Ollama-MiniMax**: rejected because manual
  sessions are the user's conscious choice; defaulting those to a
  cheaper tier hides the cost from the user instead of letting the agent
  classification do it.

### Treat the new id like every other execution-tier id in the validator

`scripts/validate-config.mjs` already enumerates execution-tier ids when
it walks the config and the catalog. Adding `ollama-cloud/minimax-m3` to
that enumeration means a phantom id fails the install with the same
diagnostic the other tiers get, and a missing catalog prints the same
skip notice. No new validation rule is needed — only the id list grows.

Alternatives considered:

- **Write a one-off check for the new id**: rejected because every
  execution-tier id should be treated uniformly, and a dedicated check
  would drift from the others over time.

### Do not touch `agent/*.md` frontmatter

The agents currently inherit their model from `opencode.jsonc`; their
Markdown files do not declare `model:`. The `add-installation-model-profiles`
change (when applied) will surface this fact by removing duplicate model
declarations from frontmatter — that work belongs to that change, not
here. This change touches only `opencode.jsonc` and the validator, plus
the documentation/surfaces that mirror them.

## Risks / Trade-offs

- **[`ollama-cloud/minimax-m3` is not yet in the OpenCode catalog]** →
  The validator catches it and prints the offending id, so the
  operator knows to refresh the catalog (`opencode` reads its catalog
  from the provider the first time it runs) before re-running the
  validator. The catalog on the build machine already lists this id
  (verified during planning), so the validator should pass on first
  run.
- **[Ollama Cloud rate-limits the MiniMax weights]** → The value tier
  and the decision tier are unaffected. If Ollama Cloud rate-limits
  MiniMax specifically, the five execution agents degrade while
  `spec-required` and `audit` still work. The operator can revert by
  restoring the previous `opencode.jsonc` and rerunning the validator.
- **[A bounded execution session's context exceeds 512 000 tokens]**
  → `ollama-cloud/minimax-m3` truncates at 512k; the agent would lose
  context that the direct tier would have kept. In practice the five
  execution agents work on bounded multi-file edits that fit in 512k;
  if a session grows past 512k, the agent dispatcher routes the next
  step to `spec-required` and the user gets the direct tier for the
  remainder. The 1M-direct pool stays reserved for that case.
- **[Per-token cost is higher on the Ollama-MiniMax tier]** → This is
  the honest tradeoff: $0.6/$2.4 vs $0.3/$1.2 doubles the per-token
  price for bounded execution work. The change trades that markup for
  quota isolation and context-window adequacy. If the operator later
  decides the cost outweighs the isolation, they can revert by editing
  `opencode.jsonc` and `agent/routing.md` back to the single direct
  tier; no spec or validator change is needed for that revert because
  the catalog still resolves the direct id.
- **[The `add-installation-model-profiles` change lands later and
  conflicts with the rendered profile]** → Both changes touch
  `opencode.jsonc` indirectly (the profile change replaces the symlink
  with a generated render). They can coexist as long as the profile
  manifest declares the new tier split before the renderer is finalised;
  if the manifest does not, the renderer falls back to the current
  assignment and the operator reruns `./install.sh --profile personal`.

## Migration Plan

1. **Apply**:
   - Edit `opencode.jsonc` so `agent.build`, `agent.general`,
     `agent.frontend`, `agent.backend`, and `agent.qa` use
     `ollama-cloud/minimax-m3`; leave `model` (root) and
     `agent.routing.md` content unchanged.
   - Edit `agent/routing.md` so the class-vs-model matrix `medium` row
     shows `ollama-cloud/minimax-m3`, the per-agent defaults for the
     five agents show the new id, and the `Model tiers` table lists
     both the Direct-MiniMax and Ollama-MiniMax rows.
   - Extend `scripts/validate-config.mjs` to include
     `ollama-cloud/minimax-m3` in the execution-tier enumeration and the
     missing-catalog skip notice.
   - Run `node scripts/validate-config.mjs` to confirm the new id
     resolves against the catalog and the rest still passes.
   - Run `openspec validate split-minimax-direct-vs-ollama --strict` to
     confirm the change is internally consistent.
   - Run `node scripts/acceptance-harness.mjs` to confirm the routing
     and skill-surface assertions still hold.

2. **Roll back**: restore the previous `opencode.jsonc`, `agent/routing.md`,
   and `scripts/validate-config.mjs` from the working tree's last commit
   and rerun the validator. No data migration is involved — the routing
   change is configuration-only.

3. **Archive** the change once the validator and acceptance harness are
   green. The archive step syncs the spec delta into
   `openspec/specs/agent-routing/spec.md` and removes the
   `minimax-tier-split` capability folder.

## Open Questions

- The exact Ollama Cloud id is whatever the provider currently exposes
  (`minimax-m3` as of this change). If the provider later exposes a
  quantised tag (e.g. `minimax-m3:q4_K_M`) the operator can swap the id
  in `opencode.jsonc` without touching the spec — the spec only pins
  the `ollama-cloud/minimax-m3` prefix, not a specific tag. This is
  documented as a design-time assumption, not a deferred decision.
- Whether the Ollama Cloud quota and rate limit match the workload is
  not measured at apply time. If `build`, `general`, `frontend`,
  `backend`, and `qa` saturate the Ollama Cloud quota on a real
  session, the operator observes the rate-limit message in the next
  session log and can either wait it out or revert the affected agent
  to the direct tier. No automated detection.
