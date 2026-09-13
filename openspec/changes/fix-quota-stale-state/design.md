## Context

The quota footer plugin in `quota-tui.tsx` refreshes every 5 minutes by
spawning `codex app-server --stdio`, running the JSON-RPC initialize
handshake, requesting `account/rateLimits/read`, and updating a kv-backed
`FooterState` rendered into the TUI `app_bottom` slot.

Today, when `readCodex()` resolves to `undefined` — the return path for any
non-auth failure, any missing rate-limit field, or any caught exception
other than `ENOENT` — the refresh loop preserves the previous codex value
indefinitely. The footer has no diagnostic channel and no way to surface
that data is stale. See `proposal.md` for the symptom and `specs/tui-quota-footer/spec.md`
for the target behavior.

This change touches one file and one refresh function. No new dependency,
no external API change, no migration.

## Goals / Non-Goals

**Goals:**
- Make sustained `readCodex()` failures visible in the footer after
  approximately 15 minutes (three refresh cycles at the 5-minute cadence).
- Surface the failure reason in the dev console through the OpenCode plugin
  logger so the next "stuck at X%" report carries an actionable cause.
- Keep the existing happy path byte-for-byte identical (no rendering
  regression when the codex app-server responds normally).
- Keep the existing `ENOENT` behavior (empty codex segment, no failure
  count) so the binary-missing case continues to be its own signal.

**Non-Goals:**
- Fixing the JSON-RPC handshake itself (Bug #3 from the diagnosis). That
  is a separate, speculative risk until a reproduction exists.
- Adding a weekly indicator when codex 0.150+ does not expose `secondary`.
  That is a codex API reality, not a plugin bug.
- Caching across OpenCode restarts. The `api.kv` semantics are out of
  scope for this change; if persistence proves to be the root cause of
  the original "stuck for days" report, a follow-up change will address it.
- Replacing the spawn-per-refresh strategy with a long-lived codex
  app-server connection. Performance optimization is not in scope.

## Decisions

### Failure counter as a closure variable, not part of `FooterState`

**Choice:** keep a module-local `consecutiveFailures` counter inside the
`tui` function closure, separate from `FooterState` in `api.kv`.

**Rationale:** `FooterState` is the rendered value; mixing a counter into
it would either leak diagnostic state into the TUI render path or require
filtering it out at every read. A closure variable is reset only by the
refresh loop, never read by the render, and dies with the plugin instance.

**Alternatives considered:**
- Counter in `api.kv` — would survive plugin reloads, but `api.kv` is a
  render-facing store and would need a sentinel field ignored by the
  footer. More moving parts for no benefit, since the refresh loop already
  controls its own bookkeeping.
- Per-render detection — impossible without keeping history somewhere.

### Sentinel string `󰚩 Codex · sin datos`

**Choice:** literal sentinel rendered in place of the codex line after the
threshold.

**Rationale:** matches the existing codex icon prefix (󰚩) and reads as
natural Spanish (the user's language) so the "no data" state is self-
documenting in the footer without an extra legend.

**Alternatives considered:**
- Empty segment — indistinguishable from ENOENT, loses information.
- Dim/grey bar — requires theme knowledge; the literal string works
  regardless of theme.
- English sentinel — would diverge from the user's working language for no
  reason; OpenCode is bilingual in practice.

### Threshold of three consecutive failures

**Choice:** `MAX_CONSECUTIVE_FAILURES = 3`.

**Rationale:** at the 5-minute refresh cadence, three failures span
roughly 15 minutes — long enough that an intermittent transient
(auth-token retry, codex cold start under load) does not trigger the
sentinel, but short enough that a real outage is visible inside a typical
working session.

**Alternatives considered:**
- 1 (every failure) — too noisy; a single `app-server` cold start could
  flash the sentinel.
- 5 (~25 min) — risk that the user dismisses the footer as broken without
  noticing for the rest of the session.

### Diagnostic output via `console.warn`

**Choice:** call `console.warn("[quota-footer] codex read failed:", reason)`
in the refresh function when `readCodex()` fails.

**Rationale:** the OpenCode `TuiPluginApi` (verified against
`@opencode-ai/plugin/dist/tui.d.ts` at the version installed in this repo)
does not expose a `logger` field on the plugin API surface. `console.warn`
is the conventional fallback used by Node-based TUI plugins and routes to
the OpenCode dev console when OpenCode is launched in dev mode. The
sentinel in the footer remains the user-visible signal regardless of
whether the dev console is attached.

**Correction note:** an earlier draft of this design proposed
`api.logger?.warn(...)` with optional chaining. That is incorrect: the
field does not exist on `TuiPluginApi` at the current OpenCode plugin
version, so optional chaining would have been dead code and TypeScript
would have flagged it as an error in strict mode. `console.warn` is
intentional and the surface the spec scenarios target.

**Alternatives considered:**
- `api.ui.toast({ variant: "warning", ... })` — visible to the user but
  transient (toasts disappear after a few seconds) and noisy on every
  refresh cycle during an outage. Better suited to one-shot notifications
  than per-cycle diagnostics.
- Throw — would crash the refresh loop, lose the next cycle's chance to
  recover, and surface to OpenCode as a plugin error that the user
  cannot easily ignore.
- `api.event.emit(...)` — meant for plugin-to-plugin communication on
  `TuiEventBus`, not for diagnostic logging; would mislead consumers
  into subscribing to log noise.

### Failure reason surfaced via a callback parameter

**Choice:** extend `readCodex` with an optional `onFailure(reason: string)`
parameter. The refresh loop passes a callback that does the warn and the
counter increment.

```ts
async function readCodex(
  signal: AbortSignal,
  onFailure?: (reason: string) => void,
): Promise<string | null | undefined>
```

**Rationale:** the current `readCodex` catches all errors internally and
returns `undefined` (or `null` for ENOENT) with no channel to report the
cause. Adding a return-value shape like `{ ok: false, reason }` would
expand the function's contract and pull diagnostic concern into the spawn
layer. A callback is a one-line extension, keeps the existing return
shape, and lets the refresh loop own the counter and the warn policy.

**Alternatives considered:**
- Return `{ status: "stale", reason: "..." }` and parse it in refresh —
  more expressive but expands the contract surface of `readCodex` and
  adds a discriminated-union that has to be unwrapped at every call site.
- Closure variable shared with refresh — introduces mutable shared state
  with implicit ordering assumptions.
- Re-throw and let refresh catch — would force the refresh loop to
  re-implement the ENOENT-vs-other distinction already encoded inside
  `readCodex`, doubling the classification logic.

## Risks / Trade-offs

- **Risk:** the OpenCode `TuiPlugin` type does not expose `api.logger`,
  and the warning is silently dropped. → **Mitigation:** the sentinel in
  the footer is the user-visible signal. The logger is best-effort
  diagnostics for developers; absence is acceptable for v1.
- **Risk:** the 5-minute refresh interval is hardcoded and longer than
  the 15-minute threshold for some failure modes (e.g., if a user changes
  the interval). → **Mitigation:** the threshold is expressed in
  *cycles*, not seconds, so it scales with whatever interval the plugin
  uses. If the interval drops below 1 minute the threshold becomes too
  eager; that is a follow-up tuning concern, not a correctness bug.
- **Risk:** an aggressive transient (e.g., auth-token mid-refresh) could
  still produce three undefineds back-to-back and flash the sentinel
  briefly. → **Mitigation:** `null` (ENOENT) is excluded from counting, so
  the most common transient is already handled; if a real transient
  causes a 15-minute outage the sentinel is correct, not a false positive.
- **Trade-off:** the change adds ~25 lines to `quota-tui.tsx`. The
  alternative — a dedicated `quota-state.ts` module — would isolate the
  counter logic but is disproportionate for one counter and one string.
  Revisit if the file grows past the next behavior change.

## Migration Plan

- No data migration. The `FooterState` shape is unchanged; only the value
  rendered for the codex line may now be the sentinel string.
- Rollout: ship through the existing `install.sh` symlink channel. After
  pulling, the user must restart OpenCode so the new plugin is loaded —
  already documented in `README.md` under the "Update" section.
- Rollback: revert the commit; the old behavior returns (silent stale
  fallback). No on-disk state to clean.

## Open Questions

None. All decisions are deterministic from the diagnosis and the spec.
