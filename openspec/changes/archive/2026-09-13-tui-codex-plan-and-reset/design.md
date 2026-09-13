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

### Reset formatter: days above the day boundary, hours/minutes below

**Choice:** branch on the day boundary. At or above one day, render
days only; below one day, render hours and/or minutes only. No
multi-scale output, so no separator character is ever needed:

```ts
function resetLabel(resetsAt?: number | null): string {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt <= 0) return ""
  const totalSeconds = Math.max(0, resetsAt - Math.floor(Date.now() / 1000))
  if (totalSeconds === 0) return ""
  if (totalSeconds >= 86400) return ` ${Math.floor(totalSeconds / 86400)}d`
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const subDay: string[] = []
  if (hours > 0) subDay.push(`${hours}h`)
  if (minutes > 0) subDay.push(`${minutes}m`)
  if (subDay.length > 0) return ` ${subDay.join(" ")}`
  return ""
}
```

**Rationale:** the user wants compact indicators at every horizon —
hours/minutes for sub-day windows (relevant for short-window providers
like minimax's 5h cycle and codex's sub-day quota if any), days only
for windows of one day or more (where hour granularity becomes noise
on long windows like the user's 18-day business quota). The day
boundary is the natural split: at and above it, hour granularity is
not informative; below it, day granularity is not informative.

The single space between hours and minutes (within the sub-day case)
matches the typographic style already used between the bar's segments
(`█░`) and between percentage components. The `Math.max(0, ...)` clamp
plus the `totalSeconds === 0` early return cover the clock-skew
window; the indicator hides there rather than rendering ` 0m`.

**Alternatives considered:**
- Decomposed format with `·` separator (`3d · 2h 40m`) — replaced per
  user feedback. The user observed that at long horizons the hour
  granularity is noise and a 24h+ indicator with hours becomes
  visually heavy; better to drop hours entirely when days suffice.
- Fixed three-branch format (`<24h` / `<7d` / absolute) — replaced
  earlier with the decomposed format; now replaced again with the
  two-branch format. Each user iteration simplifies the prior one.
- Locale-aware formatting (`Intl.DateTimeFormat`) — out of scope; the
  units `d`/`h`/`m` are locale-neutral and short.

### Badge placement: at the end of the codex label

**Choice:** the badge is appended after the reset indicator (or after
the percentage bar when no reset applies). Layout:

```
󰚩 Codex <bar> [reset] [badge]
```

Concretely with the user's current account:

```
󰚩 Codex ████░ 87% 18d 󰃖
```

**Rationale:** the user asked that the reset indicator sit next to
the bar (`déjalo al lado de cada barra`), so the indicator is placed
immediately after the bar with a single space. The badge, which is
metadata about the account rather than the quota, is placed last as
the trailing annotation. This puts the most informative component
(quota + reset) at the front and the contextual component (account
type) at the back, matching how the eye reads left-to-right.

**Alternatives considered:**
- Reset last, badge in the middle — rejected because it pushes the
  reset data away from the bar it relates to.
- Badge first, then bar, then reset — rejected because it breaks the
  existing `<bar>%` reading order.

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
- **Risk:** the indicator switches between `Xd` and `Xh Xm` as the
  reset crosses the 24-hour boundary within a single refresh window.
  → **Mitigation:** the refresh interval is 5 minutes and the boundary
  case only changes the label once a day at most; the switch is the
  correct signal that the reset is imminent.
- **Risk:** Nerd Font rendering requires the user's terminal to have
  a Nerd Font installed. → **Mitigation:** confirmed by the user that
  the terminal already renders `󰚩` and `󰧑`, so the font is in place.
  The new indicator format uses only ASCII-letter units (`d`, `h`, `m`)
  with single-space separators, which any font handles.
- **Trade-off:** the reading of `planType` and `resetsAt` is added
  inline inside `readCodex`, which is the function the previous change
  was trying to keep simple. → **Mitigation:** both helpers are pure
  and trivial; the inline call site is one extra line. Splitting into
  a separate `formatCodexLabel` function would be premature for two
  helpers.

## Migration Plan

- No data migration. The footer now carries more text on the codex
  and MiniMax lines; nothing else changes.
- Rollout: ship through the existing `install.sh` symlink. Restart
  OpenCode so the new plugin is loaded (already documented in
  `README.md`).
- Rollback: revert the commit; the footer returns to its previous
  helper-less state.

## Open Questions

None. All decisions are deterministic from the diagnosis, the spec,
and the user's confirmation that color is out of scope for v1.

## Extension: MiniMax reset indicators

The same `resetLabel()` helper that powers the codex reset indicator
is reused for the MiniMax provider's two quota windows. The MiniMax
API (`mmx quota show --output json`) exposes reset timestamps for
both the 5-hour interval and the weekly window inside
`model_remains[general]`:

- `end_time`: Unix milliseconds marking the end of the current 5h
  interval.
- `weekly_end_time`: Unix milliseconds marking the end of the current
  weekly window.

Both fields are converted to Unix seconds (`Math.floor(value / 1000)`)
before being passed to `resetLabel()`. No new helpers, no new format
branches; the day-boundary logic in `resetLabel()` produces the
correct unit per window. In typical use, the 5h interval will show
hours (e.g., `2h`, `5h 30m`) because the interval ends within 5 hours
of the previous cycle boundary, and the weekly window will show days
(e.g., `3d`) when more than 24 hours remain — but in the final day
before the weekly reset, the weekly window will correctly switch to
hours (e.g., `6h`), reflecting the actual remaining time regardless of
the cycle's nominal length.

### Risks specific to the MiniMax extension

- **Risk:** MiniMax adds or removes reset-timestamp fields in a future
  CLI release, leaving the indicator silently empty. → **Mitigation:**
  the existing `resetLabel` empty-fallback rule covers the missing
  field gracefully; the bar still renders. A user noticing the
  missing reset indicator can re-probe the API and we can update the
  type.
- **Risk:** the 5h interval and the weekly window could in theory have
  the same end-time (if the week starts at a 5h-cycle boundary),
  producing two identical indicators next to two different bars.
  → **Mitigation:** that coincidence is informative, not a bug; the
  user can read both bars against the same clock.

