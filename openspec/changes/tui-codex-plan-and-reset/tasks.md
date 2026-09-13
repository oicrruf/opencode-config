## 1. Types and mapping

- [x] 1.1 Extend `CodexQuota` with an optional `planType?: string | null` field at the same level as `rateLimits` and add a `PLAN_BADGE: Record<string, string>` constant mapping `self_serve_business_usage_based` to `󰃖` near the existing module-level constants; verify both additions compile cleanly against the locally-installed `@opencode-ai/plugin/dist/tui.d.ts`

## 2. Plan badge helper

- [x] 2.1 Add a module-level `planBadge(planType?: string | null): string` helper that returns `" 󰃖"` for any `self_serve_business_*` value, `" 󰀄"` for `free|plus|pro|team`, and `""` otherwise; verify by tracing each spec scenario for "Plan badge after codex label" against the helper output
- [x] 2.2 Append `planBadge(response?.result?.planType)` after the reset indicator in the codex-label `parts.push` inside `readCodex`; verify by reading the assembled string format for the four plan-badge scenarios

## 3. Reset indicator helper

- [x] 3.1 Add a module-level `resetLabel(resetsAt?: number | null): string` helper that returns ` {d}d` for any distance >= 24h and ` {h}h`, ` {m}m`, or ` {h}h {m}m` for sub-day distances, with no leading word and no separator character; verify by tracing each spec scenario for "Reset indicator immediately after any quota bar" against the helper output
- [x] 3.2 Append `resetLabel(individual?.resetsAt)` immediately after the codex bar (before the plan badge) in the same `parts.push` line; verify the assembled string matches `Codex <bar> 18d 󰃖` on the user's current codex response
- [x] 3.3 Extend the `MmxQuota` `model_remains` element with optional `end_time?: number` (Unix ms, end of the 5h interval) and `weekly_end_time?: number` (Unix ms, end of the weekly window); verify by running `mmx quota show --output json` against the live CLI and confirming both fields are present for the `general` model
- [x] 3.4 Append `resetLabel(Math.floor(end_time / 1000))` after the MiniMax 5h bar and `resetLabel(Math.floor(weekly_end_time / 1000))` after the weekly bar inside `readMmx`; verify by tracing the three new MiniMax scenarios against the assembled string

## 4. Spec verification

- [x] 4.1 Walk all scenarios in `specs/tui-quota-footer/spec.md` (four plan-badge, four reset-indicator core, three MiniMax reset-specific) and confirm the implementation satisfies each `WHEN`/`THEN`; trace the four prior scenarios from `fix-quota-stale-state` against the new wiring to confirm no regression in sentinel, counter reset, or ENOENT paths

