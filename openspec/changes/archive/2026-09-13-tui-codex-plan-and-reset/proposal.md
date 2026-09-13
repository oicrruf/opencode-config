## Why

The TUI quota footer in `quota-tui.tsx` today renders only the
percentages from each provider's response. Two pieces of context the
responses already provide are silently dropped, which makes the
footer ambiguous:

1. **The codex account type.** The codex response carries `planType`
   at the root (`self_serve_business_usage_based`, `free`, `plus`,
   `pro`, `team`, etc.). Showing this disambiguates the user's mental
   model — the same "Codex 87%" reads very differently on a
   credit-based business plan than on a throttled personal plan.

2. **The reset window for every bar.** Both providers carry reset
   timestamps that are silently dropped:
   - codex: `rateLimits.individualLimit.resetsAt` (Unix seconds)
   - MiniMax: `model_remains[general].end_time` (Unix milliseconds,
     end of the 5h interval) and `weekly_end_time` (Unix
     milliseconds, end of the weekly window)

   Without these, a static percentage reads as "stuck"; with them, the
   user sees when the next refresh happens for every bar. The same
   day-boundary formatter handles both providers: sub-day cycles
   (codex sub-day, MiniMax 5h interval, MiniMax weekly final day)
   render hours and/or minutes; multi-day horizons (codex business
   plan, MiniMax weekly mid-week) render days.

The footer already uses Nerd Font Material Design icons (`󰚩 Codex`,
`󰧑 MiniMax`), so the codex badge can use the same family without
breaking the visual contract.

## What Changes

- Append a plan badge to the codex label using a Nerd Font icon from
  the `nf-md-` family: briefcase `󰃖` for `self_serve_business_*`
  plans, account `󰀄` for personal tiers (`free`, `plus`, `pro`,
  `team`). Unknown plans render no badge (better to omit than to
  mislabel). The badge is the trailing component of the codex label,
  placed after the reset indicator.
- Append a reset indicator after each bar in the footer, computed from
  the corresponding reset timestamp:
  - Codex: ` {d}d` when ≥ 24h, ` {h}h` / ` {m}m` / ` {h}h {m}m` when
    < 24h, hidden otherwise.
  - MiniMax 5h interval: same formatter applied to `end_time / 1000`.
  - MiniMax weekly window: same formatter applied to
    `weekly_end_time / 1000`.
- Generalize the existing reset requirement to cover any quota bar,
  not only the codex bar, since the formatter is provider-agnostic.
- The badge and reset are purely additive: the existing fresh-read,
  sentinel, counter-reset, and ENOENT behavior is untouched. No color
  is added to the badge; the icon alone distinguishes.
- Add one new requirement to the `tui-quota-footer` capability for
  the badge and one generalized requirement for the reset indicator
  across providers. No requirements are modified.

## Capabilities

### Modified Capabilities

- `tui-quota-footer`: Add the plan badge to the codex label and a
  reset indicator after every quota bar (codex, MiniMax 5h, MiniMax
  weekly).

### New Capabilities

_None._

## Impact

- **Files**: `quota-tui.tsx` only. Two small helpers (`planBadge`,
  `resetLabel`), three reads of fields the responses already provide
  (`resetsAt` from codex, `end_time` and `weekly_end_time` from
  MiniMax), one extra `parts.push` slot per bar.
- **Distribution**: same symlink channel as every prior `fix(tui)` /
  `feat(tui)` commit (`install.sh` links the file into
  `~/.config/opencode/`).
- **Compatibility**: fully backward-compatible. When `planType` is
  unrecognized or any reset timestamp is missing, the helpers return
  empty strings and the footer renders exactly as it does today.
- **Risk**: the set of `planType` values is not exhaustively
  documented by codex CLI; the default-empty fallback covers unknown
  values safely. The MiniMax CLI exposes reset timestamps directly;
  if a future release renames `end_time` / `weekly_end_time`, the
  indicators will silently disappear — a re-probe recovers the field
  names and the type can be updated.
