## Why

The codex TUI footer in `quota-tui.tsx` today renders only the percentage
from `rateLimits.individualLimit.remainingPercent`. Two pieces of context
that the codex response already provides are silently dropped, which makes
the footer ambiguous:

1. **The account type.** The response carries `planType` at the root
   (`self_serve_business_usage_based`, `free`, `plus`, `pro`, `team`,
   etc.). Showing this disambiguates the user's mental model — the same
   "Codex 87%" reads very differently on a credit-based business plan
   than on a throttled personal plan. Users running multiple codex
   accounts (one per workspace) need a glance to know which one is
   reporting.

2. **The reset window.** The response carries `resetsAt` on
   `individualLimit` (Unix seconds). Without it, a static percentage
   reads as "stuck"; with it, the user sees when the next refresh
   happens. This is strictly more informative than the removed weekly
   bar that older codex versions exposed through `secondary`.

The footer already uses Nerd Font Material Design icons (`󰚩 Codex`,
`󰧑 MiniMax`), so the badge can use the same family without breaking
the visual contract.

## What Changes

- Append a plan badge to the codex label using a Nerd Font icon from the
  `nf-md-` family: briefcase `󰃖` for `self_serve_business_*` plans,
  account `󰀄` for personal tiers (`free`, `plus`, `pro`, `team`).
  Unknown plans render no badge (better to omit than to mislabel).
- Append a reset indicator computed from `individualLimit.resetsAt`
  using a small distance formatter: under 24h → "reset en Xh", under
  7 days → "reset en X d", otherwise → "reset MMM D" (absolute month +
  day, English locale, no year because the window is always near).
- Both additions are purely additive: the existing fresh-read, sentinel,
  counter-reset, and ENOENT behavior is untouched. No color is added to
  the badge; the icon alone distinguishes.
- Add one new requirement to the `tui-quota-footer` capability for each
  of the two additions. No requirements are modified.

## Capabilities

### Modified Capabilities

- `tui-quota-footer`: Append the plan badge and reset indicator to the
  rendered codex label when the corresponding fields are present and
  recognized.

### New Capabilities

_None._

## Impact

- **Files**: `quota-tui.tsx` only. Two small helpers (`planBadge`,
  `resetLabel`), two reads of fields that the response already provides,
  one extra `parts.push` slot per helper.
- **Distribution**: same symlink channel as every prior `fix(tui)` /
  `feat(tui)` commit (`install.sh` links the file into
  `~/.config/opencode/`).
- **Compatibility**: fully backward-compatible. When `planType` is
  unrecognized or `resetsAt` is missing, the helpers return empty
  strings and the footer renders exactly as it does today. Existing
  users on personal plans see the badge appear after restart; existing
  users on business plans see both the badge and the reset indicator.
- **Risk**: the set of `planType` values is not exhaustively documented
  by codex CLI. The default-empty fallback covers unknown values
  safely. New plan types can be added to the mapping table in a
  follow-up without a spec change if and when they appear.
