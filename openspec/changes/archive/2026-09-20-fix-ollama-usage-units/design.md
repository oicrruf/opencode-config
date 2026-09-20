## Context

The Ollama Cloud segment added by `tui-ollama-cloud-usage` renders
`limits.monthly.usage` directly as dollars. That field is a **fraction** of
the plan's included monthly credit, not a dollar amount: measured on this
`pro` account, `0.04` renders on the web dashboard as `$2.40 of $60 used`,
and `0.04 × 60 = 2.40` exactly. The footer reports `$0.04` — a factor of 60
low. See `proposal.md` — Why for the full evidence table.

Two constraints shape the fix, both established against the live API:

1. `GET https://ollama.com/api/usage` returns only
   `limits.monthly.usage` (fraction) and `limits.monthly.models[]`
   (`request_count` per model). It carries no cap and no reset timestamp —
   verified by reading the full payload.
2. `POST https://ollama.com/api/me` returns the account record including a
   top-level `Plan` string (`"pro"` on this account), using the same
   `Authorization: Bearer` credential the usage request already uses. The
   included credit per plan is published only on the pricing page, not in
   any API response.

The existing failure semantics stay untouched: the login label on missing
or rejected credentials, one `[quota-footer]` warning per failed cycle, and
the cached segment preserved across transient failures.

## Goals / Non-Goals

**Goals:**

- Render the Ollama Cloud consumption as dollars by multiplying the reported
  fraction by the plan's included monthly credit.
- Resolve the plan from the account endpoint, cached for the session.
- Degrade to a percentage of the included credit when the allowance cannot
  be resolved, without ever multiplying by a guessed value.
- Keep the credential out of every log, warning, error message, and rendered
  label.

**Non-Goals:**

- Adding a percentage *bar*. The primary path stays a dollar figure and no
  5-segment bar is introduced in either form.
- Adding a reset indicator. The endpoint still exposes no reset timestamp.
- Deriving the allowance from usage data. It is not present in the payload;
  the static table is the only source.
- Changing the request-count rendering, the icon, the provider label, or the
  credential resolution path.
- Reconstructing per-model dollar costs from tokens. The aggregate fraction is
  already the authoritative billed amount.

## Decisions

**Resolve the allowance from `POST /api/me`, not by inverting the fraction.**
The cap cannot be derived from a single sample of the fraction, and any
inversion would need a token-priced estimate that duplicates Ollama's own
accounting. The account endpoint exposes the plan directly, so the mapping
from plan to published credit is the only untrusted link — and it is
replaceable by a table edit.

**Cache the allowance for the session in a small mutable record owned by the
`tui` closure, not in module scope.** A plan change is rare and the usage
request already dominates the cycle's latency, so re-issuing the plan
request every 5 minutes is pure overhead. Module scope would leak the cache
across sessions; the closure is per-session by construction and therefore
matches the spec's "discarded only when the session ends". Shape:
`{ resolved: boolean; allowance?: number; warned: boolean }` — `resolved`
distinguishes "not yet attempted" from "attempted and unknown", `allowance`
absent means unknown, and `warned` enforces the one-warning-per-session
rule.

**Pass the session record into `readOllamaCloud` rather than moving the
Ollama read into the closure.** The read stays a testable module-level
function; the only per-session state travels as a parameter, so the function
keeps its current shape and call signature grows by one argument.

**Fall back to a percentage only when the allowance is unknown, and encode
that in the formatter.** `formatOllamaUsage` takes the fraction plus an
optional allowance: with an allowance it emits dollars, without it emits
`X.Y%` (trailing `.0` omitted). The fallback is exactly what the API
reports, so it needs no cap and cannot be wrong by a plan-mapping error.

**Treat an unresolvable plan as a soft failure, never as a segment
suppression.** A failed plan request is logged at most once per session and
the segment still renders. Suppressing the segment would hide valid usage
data because an unrelated endpoint failed, and a stale pricing table would
become a blank footer instead of a correct percentage.

**Keep the allowance table static in the source.** `pro → 60`, `max → 300`,
`team → 1000`, from the published pricing page. There is no API that exposes
it, and fetching the pricing page at runtime would trade a rare, reviewable
table edit for an HTML scrape that breaks whenever the page is restyled.

## Risks / Trade-offs

- **The allowance table drifts when Ollama changes pricing** → The value is
  unverified beyond the `pro` account. The unknown-plan fallback covers the
  *unknown plan* case but not *known plan, changed credit*: a `pro` account
  whose credit moved from `$60` would still render a wrong dollar figure. The
  table is small, reviewable, and carries a comment naming the pricing page;
  a `pro` value that stops reconciling with the dashboard is the signal to
  re-read it.
- **The plan endpoint shape is not contractual** → `POST /api/me` is inferred
  from the live account response, and `Plan` is read case-sensitively. A
  renamed field would surface as an unresolvable plan, which degrades to the
  percentage fallback rather than a wrong dollar amount — the failure is
  visible, not silent.
- **One extra request per session** → Issued once, bounded by the existing
  `COMMAND_TIMEOUT_MS`, and only on the first cycle that has a credential.
  A session that never authenticates issues neither request.
- **Percentage fallback changes the segment's shape for unknown plans** → The
  segment is wider or narrower than the dollar form and carries a `%` the
  previous spec forbade. That prohibition was premised on the cap being
  unavailable; it is rewritten in the delta, so spec and implementation agree.

## Migration Plan

Single-file change to `quota-tui.tsx` plus the delta spec. No persisted state
migration: the cached footer value is in-memory `api.kv` and is overwritten on
the first refresh after restart. Rollback is reverting the commit; no external
state is written by the fix.

## Open Questions

None. The allowance source, the fallback form, and the cache lifetime are all
resolved above and encoded in the delta spec.
