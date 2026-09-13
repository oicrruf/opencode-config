## Why

The quota TUI footer in `quota-tui.tsx` silently preserves the last known
Codex value when `readCodex()` returns `undefined`. After a transient failure
of the codex app-server handshake, a malformed JSON-RPC response, or a
process crash, the footer displays a stale percentage indefinitely with no
visual indication that the data is no longer fresh. The same configuration
is shared across multiple machines and the symptom has reproduced on at
least two of them ("Codex 87%" frozen for days).

The refresh loop runs every 5 minutes, so a single bad read can keep stale
data on screen for the whole session, and across sessions if the plugin's
`api.kv` state survives restarts.

## What Changes

- Track consecutive failures inside the refresh loop. When `readCodex()`
  returns `undefined` three times in a row (≈15 minutes), replace the cached
  Codex line with a sentinel string (`󰚩 Codex · sin datos`) instead of
  preserving the previous value. Reset the counter on the next successful
  read.
- On each `readCodex()` failure, emit one warning via `api.logger.warn(...)`
  with the failure reason (auth, JSON-RPC error, ENOENT, timeout, exception
  message) so the cause is visible in the dev console. This is the first
  observability hook for this plugin.
- Keep successful refresh and MiniMax path untouched.
- No change to the codex spawn/handshake logic — the fix is purely in the
  display and diagnostic layer.

## Capabilities

### New Capabilities

- `tui-quota-footer`: Defines the visible behavior of the TUI quota footer
  plugin, including the failure handling contract (no silent stale display,
  sentinel after sustained failure, diagnostic log per failure).

### Modified Capabilities

_None — no existing capability describes this plugin._

## Impact

- **Files**: `quota-tui.tsx` (~30 lines added, no removals beyond the
  silent fallback branch).
- **Distribution**: this file is symlinked into `~/.config/opencode/` by
  `install.sh`; the change ships through the same channel as every prior
  `feat(tui)` / `fix(tui)` commit.
- **Runtime cost**: one extra integer counter and one optional logger call
  per refresh; the spawn of `codex app-server` per cycle is unchanged.
- **Compatibility**: no behavior change when the codex app-server returns
  fresh data. The footer for `mmx quota` is unchanged. No new dependency.
