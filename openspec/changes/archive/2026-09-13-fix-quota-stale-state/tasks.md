## 1. State and constants

- [x] 1.1 Add `MAX_CONSECUTIVE_FAILURES = 3`, `CODEX_SENTINEL = "󰚩 Codex · sin datos"`, and `CODEX_LOG_PREFIX = "[quota-footer]"` constants near the existing `STATE_KEY` constant and verify they appear at module scope in `quota-tui.tsx`

## 2. Failure-channel wiring

- [x] 2.1 Extend `readCodex` to accept an optional `onFailure(reason: string)` callback and invoke it from every failure path (JSON-RPC error, undefined rate-limit fields, caught exception) with a short human-readable reason; verify by tracing each `return undefined` / `return null` branch and confirming exactly one `onFailure?.(reason)` call precedes it

## 3. Refresh-loop sentinel and counter

- [x] 3.1 Add a closure-scoped `consecutiveFailures` counter inside the `tui` function and update the `refresh` function to increment it when `readCodex` resolves to `undefined` (excluding `null` ENOENT), reset to zero on any successful read or auth-required response, and substitute `CODEX_SENTINEL` for the cached codex line once the counter reaches `MAX_CONSECUTIVE_FAILURES`; verify by re-reading the four spec scenarios for "Sentinel after sustained failure" against the new logic
- [x] 3.2 Wire `console.warn(CODEX_LOG_PREFIX, reason)` from the `readCodex` failure callback inside `refresh` so each failed cycle emits exactly one warning; verify by tracing the call graph and confirming no other `console.*` calls are added in this change

## 4. Spec verification

- [x] 4.1 Walk every scenario in `specs/tui-quota-footer/spec.md` and confirm the implementation satisfies each `WHEN`/`THEN` clause; record the trace as a brief inline comment block at the top of the `refresh` function in `quota-tui.tsx` if any scenario requires a non-obvious branch
