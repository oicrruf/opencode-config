## Context

`quota-tui.tsx` is a TUI footer plugin that polls two provider CLIs
(`codex app-server` and `mmx quota show`) and renders their quota
data as a Nerd Font bar in the bottom of every OpenCode session. Both
CLIs require the user to be logged in to their respective accounts;
without a session, neither can return quota data.

The codex path was hardened in two prior changes:

1. `fix-quota-stale-state` introduced the `consecutiveCodexFailures`
   counter and the `󰚩 Codex · sin datos` sentinel so a sustained
   failure stops showing a stale percentage.
2. The preceding unmerged edit widened the auth-required detection
   from the literal substring `"authentication required"` to 10 common
   phrasings (`not authenticated`, `login required`, `unauthorized`,
   `token expired`, `session expired`, etc.) and now also inspects
   the JSON-RPC `error.data.type` / `error.data.reason` envelope.

The MiniMax path is structurally parallel (returns a string on
success, `undefined` on failure, `null` on ENOENT), but it never had
the auth-required widening. Today it silently returns `undefined` for
every failure mode — including the auth-required case — so the user
has no signal that login is the cause. This change brings the mmx
side to parity with the codex side without introducing a new
sentinel or a new counter.

This change does not modify the codex sentinel, the
`consecutiveCodexFailures` counter, the ENOENT path for either
provider, or the refresh cadence.

## Goals / Non-Goals

**Goals:**

- Surface a clear `login` label when `mmx` exits non-zero with an
  auth-required message, mirroring the existing codex behavior.
- Make the two-CLI login prerequisite discoverable from the plugin
  file itself (not buried in external docs).
- Reuse the same auth-required keyword table the codex side already
  maintains, so any future provider that follows the same exit-code
  + stderr convention can adopt it without redefining the patterns.

**Non-Goals:**

- Adding a MiniMax-specific failure counter or sentinel (the user did
  not ask for this and the current silent-empty behavior is consistent
  with the plugin's pre-stale-state design).
- Surfacing MiniMax quota fields beyond what the existing read path
  already extracts (the reset timestamps were already added in
  `tui-codex-plan-and-reset`).
- Touching the codex sentinel label or the
  `consecutiveCodexFailures` logic (the prior widening handled that).
- Probing or documenting the exact stderr message format of a live
  `mmx` binary; the dev environment does not have `mmx` installed.

## Decisions

### Extract a shared `messageContainsAuthRequired` helper

**Choice:** keep the existing `AUTH_REQUIRED_PATTERNS` array as the
single source of truth for auth-required phrasings. Add a small
helper that takes a plain string:

```ts
function messageContainsAuthRequired(message: string | undefined): boolean {
  if (!message) return false
  return AUTH_REQUIRED_PATTERNS.some((p) => message.toLowerCase().includes(p))
}
```

`isAuthRequiredError(error)` becomes a thin wrapper that also inspects
`error.data.type` and `error.data.reason` (the JSON-RPC-specific
envelope fields) and ORs the result with
`messageContainsAuthRequired(error.message)`.

**Rationale:** the JSON-RPC envelope inspection is codex-specific
because `error.data` is only meaningful for codex's structured
responses; for `mmx` the only available signal is the plain stderr
text. A single low-level helper that both providers call avoids
duplicating the pattern list or the `.toLowerCase().includes(...)`
plumbing. The wrapper preserves the existing codex scenarios
verbatim (data fields are still consulted) and the new mmx scenarios
hit only the message-only path.

**Alternatives considered:**

- Inline the pattern check directly in the mmx `catch` block.
  Rejected because it would duplicate the keyword table in two
  places and silently drift the next time a pattern is added.
- Unify both providers behind a single `isAuthRequired(signal: ...)`
  abstraction that takes any failure shape. Rejected: codex's
  `error.data` envelope is genuinely different from mmx's plain
  stderr, and abstracting both behind one signature would obscure the
  structural difference without a real benefit.

### mmx auth-required detection in the `catch` block

**Choice:** inside `readMmx`, when the underlying `run()` throws and
the error is not `ENOENT` (and the signal is not aborted), check the
error message with `messageContainsAuthRequired`. If true, return
`"󰧑 MiniMax requiere login"`; otherwise, return `undefined` as today.

```ts
} catch (error) {
  if (signal.aborted) return undefined
  if (!(error instanceof Error)) return undefined
  if (error.message.includes("ENOENT")) {
    onFailure?.("ENOENT: mmx binary not on PATH")
    return null
  }
  if (messageContainsAuthRequired(error.message)) {
    return MMX_LOGIN_REQUIRED_LABEL
  }
  onFailure?.(error.message)
  return undefined
}
```

**Rationale:** the `run()` helper throws an `Error` whose `message` is
the trimmed stderr content (or `"mmx timed out"`). The same auth
phrasings that codex responds with on its structured error envelope
are what CLI tools typically print to stderr. Mirroring the existing
codex detection at this layer keeps the failure surfaces consistent
across providers. The label is a constant alongside the existing
`CODEX_SENTINEL` and the codex login-required string so the copy is
co-located with its peers.

**Alternatives considered:**

- Probe `mmx`'s stdout for the auth-required text in addition to
  stderr. Rejected: stdout on a successful call is a JSON document
  (`--output json --quiet`), and any auth-required text would mean
  the call already failed; the stderr path already covers it.
- Differentiate between "wrong CLI subcommand" and "needs login" with
  distinct labels. Rejected: the user-visible problem and the
  remediation (`mmx login` / reauth) are the same; a single label is
  clearer.

### Codex auth-required label shortened to `󰚩 Codex · login`

**Choice:** replace the current `"󰚩 Codex requiere login"` with the
shorter `"󰚩 Codex · login"`.

**Rationale:** the user asked for "no doubt about what's happening" in
the labels. The verb `requiere` adds length without adding
information; the icon `󰚩` plus the word `login` is sufficient for an
operator who knows the plugin handles the codex account. The shorter
label also visually balances the MiniMax label (`󰧑 MiniMax requiere
login`) so both labels read at similar widths.

**Alternatives considered:**

- Keep the full phrase. Rejected: the verb-form label was introduced
  in the prior commit without an explicit user request; tightening is
  a low-risk improvement and consistent with the user's pattern of
  refining labels through iteration.
- Add a `codex login` hint as a trailing parenthetical.
  Rejected: the footer is the wrong surface for tool-specific
  commands; the docblock at the top of the plugin file lists
  `codex login` and `mmx login` as the prerequisites.

### Docblock at the top of `quota-tui.tsx`

**Choice:** add a JSDoc-style comment block at the very top of the
plugin file (above the imports) documenting:

- The two CLI prerequisites (`codex login`, `mmx login`) and that
  the plugin does not perform the login itself.
- The four footer states the user can see:
  1. A codex + MiniMax data bar (logged in, fresh read).
  2. `󰚩 Codex · login` (codex CLI logged out — `codex login`).
  3. `󰧑 MiniMax requiere login` (mmx CLI logged out — `mmx login`).
  4. `󰚩 Codex · sin datos` (codex CLI failing repeatedly for a
     non-auth reason — see `[quota-footer]` warnings).

**Rationale:** the prerequisites are non-obvious from the code (the
auth-required check is one line buried in `readCodex`) and the only
way to recover from a stale state is to log in to the CLI, not to
edit the plugin. Putting the contract at the top makes the recovery
path obvious the first time someone reads the file with a "why is
this bar missing" question. The four-state enumeration replaces an
implicit mental model with an explicit one and pre-empts the next
"why is X shown?" report.

**Alternatives considered:**

- Create a separate README in the plugin directory. Rejected by the
  user's explicit preference to keep documentation inside the plugin
  file itself.
- Add a `description` field to the `plugin` module export. Rejected:
  module descriptions are not surfaced by OpenCode today and would
  not be discoverable; the docblock is read by anyone opening the
  file.

## Risks / Trade-offs

- **Risk:** the assumed `mmx` exit-code + stderr shape is unverified
  in this dev environment (no `mmx` binary available). The patterns
  are conservative and cover the same wording variants codex uses;
  if `mmx` uses a totally different phrasing, the catch falls through
  to the existing `onFailure` + `return undefined` path. → **Mitigation:**
  the dev box can validate by running `mmx quota show --output json
  --quiet` with and without an active session and comparing the
  stderr text. If the wording is novel, extending `AUTH_REQUIRED_PATTERNS`
  is a one-line change and re-validates the spec scenarios.
- **Risk:** false-positive match (mmx exits non-zero for an unrelated
  reason and the stderr happens to contain a substring like `auth`).
  → **Mitigation:** the patterns are full phrases (`authentication
  required`, `not authenticated`, etc.), not isolated keywords, so
  false positives require an unrelated stderr message that contains
  one of these exact substrings. The cost is a single misleading
  footer for one refresh cycle (≤5 min), recoverable automatically.
- **Risk:** the docblock at the top becomes stale as the plugin
  evolves. → **Mitigation:** the docblock enumerates states by their
  current visible labels (the four strings above); adding a new
  state requires a new label constant and the docblock must be
  updated alongside. The cost is one review comment, not a runtime
  regression.
- **Trade-off:** shortening the codex label from `requiere login` to
  `login` is a small UX regression for non-Spanish readers who relied
  on the verb form. → **Mitigation:** the icon `󰚩` plus `login` is
  unambiguous in any language; the docblock at the top documents the
  exact strings so anyone curious can grep the file.

## Migration Plan

- No data migration. The footer carries the same fields as before;
  the only visible changes are the new MiniMax label when mmx is
  logged out and the shortened codex login label.
- Rollout: ship through the existing `install.sh` symlink. Restart
  OpenCode so the new plugin is loaded (already documented in
  `README.md`).
- Rollback: revert the commit; the footer returns to its previous
  silent-on-mmx-failure state.

## Open Questions

- Whether to add a MiniMax-specific failure counter / sentinel in a
  follow-up. The user explicitly did not request one in this change.
  The current silent-empty behavior on sustained mmx failure is
  consistent with the pre-stale-state codex design; a future change
  could bring them to parity if the gap becomes a problem.