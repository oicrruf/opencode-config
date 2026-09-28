## Why

`/opsx-propose` generates the proposal, the delta specs, the design, and the
tasks for a change. That output is the **durable specification** the
implementation is later held to. It is the highest-leverage artifact in the
whole workflow: a weak proposal is not caught by a cheaper implementation,
it is multiplied by it.

The previous change (`model-tiering-and-plan-fix`) placed `/opsx-propose` on
the planning tier (`openai/gpt-5.6-luna`, $0.2/$1.2) alongside the `plan`
agent. That was a misclassification, and it contradicts the criterion the
same change wrote into `agent-routing`:

> The roles allowed to default to Terra are roles whose default output drives
> an irreversible change, a high-ambiguity decision, or an external-facing
> audit.

A proposal is precisely a high-ambiguity decision with irreversible
downstream cost. The `plan` agent is different: it triages, investigates,
and classifies scope, and it is the highest-volume agent — the cost
argument applies there and does not apply here.

Moving `/opsx-propose` back to the decision tier also removes an internal
inconsistency: the same change left `plan` and `/opsx-propose` sharing a
tier even though they do materially different work.

## What Changes

- Change `/opsx-propose` from `openai/gpt-5.6-luna` to
  `openai/gpt-5.6-terra` (the decision tier already used by `architect`,
  `orchestrator`, `refactor`, `adversarial`, and `cotizador`).
- Keep the `plan` agent on `openai/gpt-5.6-luna`; the planning tier still
  exists and still covers triage.
- Update the `agent-routing` spec so the planning tier names only `plan`,
  the decision tier names `/opsx-propose`, and the "spec-required uses Terra
  for the proposal only" scenario matches its own name (Terra for the
  proposal, M3 for the implementation).
- Update `agent/routing.md` so its model-tier table agrees.

## Non-Goals

- No change to `plan`, to any other agent, or to any implementation-tier
  model.
- No provider onboarding. `terra` is on the already-authenticated `openai`
  provider via ChatGPT OAuth.
- No change to the OpenSpec workflow itself, its artifacts, or its gates.

## Verification note

All three candidate models (`luna`, `terra`, `sol`) were confirmed to
respond through the OpenCode OAuth path before choosing. There is **no
benchmark** behind the claim that `terra` produces better proposals than
`luna` — the justification is the decision-weight criterion and consistency
with the other decision roles, not a measured quality delta.
