## Context

`agent-routing` defines four model tiers. The previous change assigned
`/opsx-propose` to the planning tier and `plan` to the same tier, on the
argument that both "investigate and specify but do not commit irreversible
change".

That argument holds for `plan` and fails for `/opsx-propose`. The two do
different work:

| Role | Default output | Reversibility | Volume |
|---|---|---|---|
| `plan` | a classification and a plan | cheap to revise | highest of any agent |
| `/opsx-propose` | proposal + delta specs + design + tasks | the contract implementation is held to | one per change |

The spec's own decision-tier criterion — "irreversible change, a
high-ambiguity decision, or an external-facing audit" — describes a proposal
and not a triage classification. The prior change wrote that criterion and
then placed the proposal outside it.

## Goals / Non-Goals

**Goals**

- `/opsx-propose` runs on a model whose quality matches the leverage of its
  output.
- The spec, `agent/routing.md`, and the command frontmatter agree.
- The planning tier keeps a real member (`plan`) so the tier is not vestigial.

**Non-Goals**

- Moving `plan`. It stays on the value/planning tier; its cost profile
  differs and its output is cheap to revise.
- Touching implementation-tier or value-tier assignments.
- Introducing a benchmark. None exists for these models in this repo, and
  inventing one would be worse than stating the gap.

## Decisions

### Decision: `/opsx-propose` moves to the decision tier (`terra`)

The proposal is the artifact that the `spec-required` class exists to
produce, and the class gate refuses to implement until it exists. Its
quality sets the ceiling for everything downstream, so it belongs with the
other irreversible-output roles (`architect`, `orchestrator`, `refactor`,
`adversarial`, `cotizador`).

Cost context, per million tokens in/out:

| Model | In | Out | Tier |
|---|---|---|---|
| `openai/gpt-5.6-luna` | $0.2 | $1.2 | planning (current) |
| `openai/gpt-5.6-terra` | $2 | $12 | decision (chosen) |
| `openai/gpt-5.6-sol` | $4 | $20 | frontier |

A proposal is a single, bounded artifact per change, so the absolute cost
delta is small — unlike `plan`, which runs on every request.

Alternatives considered:

- **`gpt-5.6-sol` (2x terra)** — plausible if proposals are the main quality
  bottleneck, but no evidence supports it over terra, and terra is already
  the established decision tier. Rejected for consistency and cost.
- **`gpt-6-astra` (~5x terra)** — no measured justification. Rejected.
- **Keep `luna`** — rejected: it contradicts the spec's own decision-tier
  criterion and under-invests in the artifact with the most downstream
  leverage.

### Decision: `plan` stays on `luna`

`plan` triages and classifies. It runs on every implementation request, so
its volume dominates total cost, and its output (a classification) is cheap
to correct. The prior change's reasoning holds here and only here.

Keeping `plan` on the planning tier also keeps that tier meaningful rather
than collapsing it into the decision tier.

Alternatives considered:

- **Move both to `terra`** — rejected: it applies the proposal's cost
  rationale to a role that does not share its leverage or volume profile.

### Decision: the verification states its own limit

The proposal records that model quality was **not** benchmarked. The three
candidates were only confirmed to respond through the OAuth path. This is
deliberate: two earlier changes in this repo shipped config assertions that
static checks certified as correct while the runtime behaved differently, so
this change states what is measured (reachability, price) and what is not
(quality).

## Risks / Trade-offs

- **[Risk]** `terra` may not measurably beat `luna` on proposal quality, so
  the change could pay 10x for no gain. → **Mitigation**: the cost is bounded
  (one artifact per change) and the change is a one-line revert. The
  decision-weight argument stands even if the quality delta is unmeasured.
- **[Risk]** `terra` availability depends on the OAuth session. → Verified
  responding before the change; the same provider already serves five other
  agents, so an outage would affect them equally.
- **[Trade-off]** The planning tier now covers only `plan`. → Accepted: a
  tier with one member is still meaningful, and the alternative (folding
  `plan` into the decision tier) is the more expensive mistake.

## Migration Plan

1. Edit the `model:` in `commands/opsx-propose.md`.
2. Update the planning/decision tier text in
   `openspec/specs/agent-routing/spec.md`.
3. Update the tier table in `agent/routing.md`.
4. Verify: model-id resolution, spec validation, and the acceptance harness.
5. Restart OpenCode.

**Rollback strategy**: revert the commit; `luna` remains valid and configured
for `plan`.

## Open Questions

- Whether proposal quality should be measured before any further tier
  moves. Deferred: it needs a rubric and a sample of changes, which is a
  larger piece of work than this tier correction.
