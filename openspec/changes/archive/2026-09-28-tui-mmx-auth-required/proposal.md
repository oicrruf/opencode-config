## Why

The TUI quota footer in `quota-tui.tsx` reads quota data from two CLI
binaries: `codex app-server` and `mmx quota show`. Both CLIs require
their respective accounts to be logged in, but today only the codex
side surfaces an explicit "requires login" label. The MiniMax side
silently returns `undefined` on failure, so when the user is logged
out of `mmx`, the footer just shows the codex part and the MiniMax
segment is missing — no hint that login is the cause.

This is inconsistent with the codex path (which was hardened in
`fix-quota-stale-state` + the auth-required widening in the prior
commit) and leaves the operator guessing why only one provider is
visible. The same auth-required keywords that the codex side already
recognizes (`authentication required`, `not authenticated`, `unauthorized`,
`token expired`, etc.) are equally applicable to `mmx` and to any
future provider that uses the same exit-non-zero + stderr pattern.

## What Changes

- Reuse the existing `AUTH_REQUIRED_PATTERNS` and the underlying
  case-insensitive matcher for the MiniMax catch path. The current
  `isAuthRequiredError` helper is codex-specific (it inspects the
  JSON-RPC `error.data` envelope). Extract a small
  `messageContainsAuthRequired(message: string | undefined): boolean`
  helper that both providers consume; keep `isAuthRequiredError` as a
  thin wrapper that also inspects `error.data.type` / `error.data.reason`.
- Detect the auth-required pattern in `readMmx`'s catch block. When
  the `mmx quota show` error message contains any pattern, return the
  fresh label string `"󰧑 MiniMax requiere login"` so the footer
  replaces the cached MiniMax segment instead of silently emptying it.
- Add a one-paragraph docblock at the top of `quota-tui.tsx` documenting
  the two CLI prerequisites (`codex login` and `mmx auth login`) so any
  operator reading the plugin for the first time knows what state the
  CLIs must be in for the bar to load. The block also enumerates the
  four footer states the user can see: data, requires-login (codex),
  requires-login (mmx), and the codex-sustained-failure sentinel —
  making the contract explicit instead of buried in helper code.
- Tighten the existing `󰚩 Codex requiere login` label to
  `󰚩 Codex · login` so the visual width matches the MiniMax label and
  the user can infer the remedy (`codex login`) without reading
  external docs. The MiniMax label is left as a full phrase because
  the user has been iterating on this copy and the change is purely
  additive to the prior auth-detection widening.
- Add a new requirement to the `tui-quota-footer` capability covering
  the MiniMax auth-required detection and the prerequisites docblock.
  No existing requirements are modified.

## Capabilities

### Modified Capabilities

- `tui-quota-footer`: Add MiniMax auth-required detection (parallel
  to the existing codex detection), surface a `login` label when
  triggered, and document the two-CLI login prerequisite at the top of
  the plugin file.

### New Capabilities

_None._

## Impact

- **Files**: `quota-tui.tsx` only.
  - One new helper (`messageContainsAuthRequired`) plus a refactor
    that makes the existing `isAuthRequiredError` reuse it.
  - One new branch inside `readMmx`'s `catch` that returns the
    auth-required label string.
  - One docblock at the top of the file documenting prerequisites and
    the four footer states.
  - One rename of the codex auth-required label (shortened).
- **Distribution**: same symlink channel as every prior `fix(tui)` /
  `feat(tui)` commit (`install.sh` links the file into
  `~/.config/opencode/`).
- **Compatibility**: fully backward-compatible. When `mmx` is logged
  in and `mmx quota show` exits zero, the new branch is unreachable
  and the function returns the same string as before. When `mmx`
  fails for any non-auth reason (timeout, ENOENT, malformed JSON),
  the existing catch path is unchanged.
- **Risk**: the assumed failure shape (`mmx quota show` exits non-zero
  with a stderr message containing one of the auth-required keywords)
  has not been validated against a live `mmx` binary in this repo
  environment (the dev box has no `mmx` installed). The patterns are
  chosen conservatively (10 common phrasings, case-insensitive) and
  the failure mode for a false negative is the existing silent
  MiniMax disappearance — i.e., no regression versus the current state.
  A false positive (mmx exits non-zero with an unrelated message that
  happens to match a pattern like "auth") would surface a misleading
  "login" label; the cost is one wrong footer for one refresh cycle
  (≤5 min). Both failure modes are visible immediately on the next
  refresh and easy to diagnose from the existing
  `[quota-footer]` warning stream.