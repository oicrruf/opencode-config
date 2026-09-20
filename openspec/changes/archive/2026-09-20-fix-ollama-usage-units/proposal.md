## Why

The Ollama Cloud footer segment renders the wrong number. It reads
`limits.monthly.usage` from `GET https://ollama.com/api/usage` and formats
it as US dollars, but that field is not a dollar amount: it is the
**fraction of the plan's included monthly usage credit already consumed**.

Measured against this account (plan `pro`, $60 of included monthly credit
per the pricing page), the relationship is exact and constant across
sampling points:

| Local token cost, computed with published prices | `limits.monthly.usage` | ratio |
|---|---|---|
| `$1.810138` | `0.030` | `60.34` |
| `$1.831624` | `0.031` | `59.09` |
| `$1.862215` | `0.031` | `60.07` |

The token cost is the sum over this account's `ollama-cloud` `step-finish`
parts of `input × price_in + cache_read × price_cached + output × price_out`
using the published `deepseek-v4.1-flash` and `qwen3.5:397b` rates. The
ratio converges on `60`, which is exactly the Pro plan's included credit.
So the footer's `$0.03` is really `3%` of a `$60` allowance — a `$1.81`
consumption rendered as three cents. The web dashboard shows the correct
`$1.81` because it multiplies by the plan allowance; the footer does not.

The root cause is shared: `openspec/changes/tui-ollama-cloud-usage/specs/tui-quota-footer/spec.md`
codifies the misreading, asserting that `limits.monthly.usage` is "the
consumed amount" and that `0.029` "renders as `$0.03`". The implementation
faithfully follows the spec, so `openspec validate --strict` passes and the
change reads as complete while the segment is wrong by a factor of 60.

The same requirement also claims the endpoint "exposes neither a plan
credit cap nor a reset timestamp". That half is true for the reset
timestamp and false for the cap: the cap is not in the usage payload, but
it is derivable from the account's plan.

## What Changes

- **Fix the unit interpretation.** The segment renders US dollars computed
  as `limits.monthly.usage × included_monthly_credit(plan)`, not
  `limits.monthly.usage` directly. The Pro account in the evidence above
  renders `$1.86` instead of `$0.03`.
- **Resolve the plan and its included credit.** Read the account plan from
  `POST https://ollama.com/api/me` (the same key already in the footer's
  credential scope) and map it to the included monthly credit published on
  the pricing page: `pro → $60`, `max → $300`, `team → $1000`. The plan
  read is cached for the session rather than repeated every refresh cycle,
  because a plan change is rare and the usage request already dominates.
- **Define the unknown-plan fallback.** When the plan is missing, `free`,
  or not in the mapping table — including the case where the mapping itself
  is stale because Ollama changed its pricing — the segment MUST NOT
  multiply by a guessed allowance. It renders the consumed fraction as a
  percentage of the included credit instead, which is exactly what the API
  reports and needs no cap. This supersedes the current requirement that
  forbids a `%` in the segment.
- **Keep the request count** and the existing `󰁤 Ollama` prefix, icon, and
  credential handling unchanged.
- **Correct the record.** The `tui-quota-footer` requirement that
  established the dollar misreading and the no-percentage prohibition is
  rewritten to state the observed semantics, so the spec no longer
  contradicts the endpoint.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `tui-quota-footer`: rewrites the Ollama Cloud consumption requirement to
  interpret `limits.monthly.usage` as a fraction of the plan's included
  credit, adds plan/allowance resolution with its unknown-plan fallback,
  and removes the prohibition on rendering a percentage (which was premised
  on the cap being unavailable).

## Impact

- **Files**: `quota-tui.tsx` (allowance mapping, plan read with session
  cache, corrected `formatOllamaUsage`, docblock), `README.md` if the
  segment example is quoted there, plus the `tui-quota-footer` delta in
  this change.
- **New I/O**: one additional HTTPS request (`POST /api/me`) per session
  rather than per refresh cycle. The Ollama Cloud usage request, credential
  resolution, icon, request count, and failure handling are unchanged.
- **Spec sequencing**: `tui-ollama-cloud-usage` is complete but not yet
  archived, so the requirement this change modifies is not yet in
  `openspec/specs/tui-quota-footer/spec.md`. That change must be archived
  (or its delta synced) for this delta to apply to a spec that contains the
  requirement. Recorded in design.md.
- **Not covered**: no percentage *bar* is added — the fallback renders a
  `%` value only when the allowance is unknown, and the primary path stays
  a dollar figure. No reset indicator is added; the endpoint still exposes
  no reset timestamp.
- **Risk**: the allowance table is derived from a public pricing page and
  verified only on a `pro` account. It is not contractually exposed by the
  API, so it can drift. The unknown-plan fallback is what keeps drift from
  producing a wrong dollar figure.
