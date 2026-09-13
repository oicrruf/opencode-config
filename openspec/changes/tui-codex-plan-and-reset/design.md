## Context

`quota-tui.tsx` renders a codex quota label in the TUI footer from a
`codex app-server` `account/rateLimits/read` response. The current
label uses only `individualLimit.remainingPercent` to build the bar.
The response already carries `planType` at the root and `resetsAt` on
the individual limit, but the plugin drops both. See `proposal.md` for
the user-visible motivation.

The footer already uses Nerd Font Material Design icons (`󰚩 Codex`,
`󰧑 MiniMax`), so adding two more icons from the same family matches
the visual contract without introducing a new typography.

This change does not modify the prior `fix-quota-stale-state` sentinel
behavior, the consecutive-failure counter, or the ENOENT path. It only
adds two small helpers and appends their output to the existing
`parts.join("  ")` line.

## Goals / Non-Goals

**Goals:**
- Disambiguate business vs personal accounts at a glance via a single
  Nerd Font icon suffix.
- Give the user a concrete "when does this number change" cue via the
  reset indicator.
- Stay silent on unknown values rather than mislabeling.

**Non-Goals:**
- Adding color to the badge or reset indicator (the user explicitly
  excluded this from v1; revisitable later).
- Computing or displaying a daily/weekly breakdown that codex no longer
  exposes. The reset date replaces the lost weekly bar, not an
  attempt to reconstruct it.
- Reading additional fields from the codex response (credits,
  `limitId`, `limitName`, `spendControlReached`, etc.). Those can land
  in a follow-up if they become useful.

## Decisions

### Plan mapping as a `Record<string, string>` with explicit fallback

**Choice:** a small lookup table:

```ts
const PLAN_BADGE: Record<string, string> = {
  self_serve_business_usage_based: "󰃖",
}
function planBadge(planType?: string | null): string {
  if (typeof planType !== "string" || planType.length === 0) return ""
  if (planType.startsWith("self_serve_business")) return ` 󰃖`
  if (/^(free|plus|pro|team)$/.test(planType)) return ` 󰀄`
  return ""
}
```

**Rationale:** the response exposes only one explicit business
identifier (`self_serve_business_*`) and the personal tiers are
inferred from a known small set. Anything else is unknown and renders
nothing, which is the safe default. A future codex release that
introduces a new plan type shows up as "no badge" rather than a wrong
badge.

**Alternatives considered:**
- Single regex against the whole string — fragile, may match substrings
  in future plan names.
- Hardcoded icon per plan in a switch — verbose for a two-icon feature
  and obscures the fallback rule.

### Reset formatter branches on `Date.now()` distance

**Choice:**

```ts
function resetLabel(resetsAt?: number | null): string {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt <= 0) return ""
  const diffSeconds = resetsAt - Math.floor(Date.now() / 1000)
  if (diffSeconds < 24 * 60 * 60) return ` reset en ${Math.max(0, Math.round(diffSeconds / 3600))}h`
  if (diffSeconds < 7 * 24 * 60 * 60) return ` reset en ${Math.max(0, Math.round(diffSeconds / 86400))} d`
  const date = new Date(resetsAt * 1000)
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]
  return ` reset ${month} ${date.getUTCDate()}`
}
```

**Rationale:** Unix-seconds arithmetic avoids constructing a `Date`
object for the two short-form branches (which would need their own
parsing of the difference). The absolute-date branch needs `Date` to
get the month name; UTC is used so the indicator is stable regardless
of the user's local timezone. The `Math.max(0, ...)` clamps protect
against the brief window where `resetsAt` is in the past by a few
seconds due to clock skew.

**Alternatives considered:**
- Always render the absolute date — loses the urgency cue when the
  reset is imminent.
- Use `Intl.DateTimeFormat` for locale-aware formatting — overkill for
  a three-letter English abbreviation, and would force a decision
  about locale that is out of scope.
- Render the date in the user's local timezone — causes "the indicator
  changed while I was using it" jitter when the user crosses midnight;
  UTC is a stable reference.

### Helpers return leading-space strings, appended after the percentage

**Choice:** `planBadge` returns `" 󰃖"` (two-space separator) and
`resetLabel` returns `" reset en 5 d"` (single-space separator).
`readCodex` appends them in order to the joined parts.

**Rationale:** two-space separator for the badge matches the existing
spacing between codex bar and primary/secondary bars (`parts.join("  ")`).
Single-space for the reset indicator visually groups it with the
percentage (same tight pair). Putting the separator inside the helper
output keeps the call site simple:

```ts
const codexLabel = `󰚩 Codex ${quotaBar(individualRemaining)}${planBadge(planType)}${resetLabel(individual?.resetsAt)}`
```

**Alternatives considered:**
- Build the suffix at the call site with explicit `+- ` operators —
  verbose and easy to introduce spacing bugs.
- Always include both suffixes even when empty — would render stray
  spaces. Helpers return `""` when not applicable, which the call site
  concatenates safely.

### No color on the badge or indicator

**Choice:** the badge and indicator inherit the default `textMuted`
foreground, same as the rest of the codex label.

**Rationale:** the user explicitly excluded color in v1. The icons
themselves are visually distinct enough that color is not required for
disambiguation. The `coloredLabel()` function already colors the quota
bar based on its fill level; adding more colored regions would
overload the visual channel.

**Alternatives considered:**
- `theme.warning` for business, `theme.success` for personal — color
  would reinforce the distinction but was deferred by user request.

## Risks / Trade-offs

- **Risk:** `planType` values change in future codex releases and our
  mapping misses them, leaving users without a badge. → **Mitigation:**
  the default-empty fallback is the safe behavior; the badge table can
  be extended in a one-line follow-up without a spec change because the
  scenario "Unknown plan renders no badge" is already part of the spec.
- **Risk:** the day-of-month formatter uses `date.getUTCDate()` so a
  user in a UTC-X timezone crossing midnight locally before UTC sees a
  one-day discrepancy. → **Mitigation:** the indicator is approximate
  anyway; users comparing it to a wall calendar will not be off by more
  than one day, and the absolute-date form is only used when the reset
  is more than a week away.
- **Risk:** Nerd Font rendering requires the user's terminal to have
  a Nerd Font installed. → **Mitigation:** confirmed by the user that
  the terminal already renders `󰚩` and `󰧑`, so the font is in place.
- **Trade-off:** the reading of `planType` and `resetsAt` is added
  inline inside `readCodex`, which is the function the previous change
  was trying to keep simple. → **Mitigation:** both helpers are pure
  and trivial; the inline call site is one extra line. Splitting into
  a separate `formatCodexLabel` function would be premature for two
  helpers.

## Migration Plan

- No data migration. The footer now carries more text on the codex
  line; nothing else changes.
- Rollout: ship through the existing `install.sh` symlink. Restart
  OpenCode so the new plugin is loaded (already documented in
  `README.md`).
- Rollback: revert the commit; the footer returns to its previous
  two-helper-less state.

## Open Questions

None. All decisions are deterministic from the diagnosis, the spec,
and the user's confirmation that color is out of scope for v1.
