## 1. Shared auth-required helper

- [x] 1.1 Add a module-level `messageContainsAuthRequired(message: string | undefined): boolean` helper in `quota-tui.tsx` that returns `true` iff the lowercased message contains any entry of the existing `AUTH_REQUIRED_PATTERNS` table; verify by tracing the 10 existing patterns against a representative positive and negative input each
- [x] 1.2 Refactor the existing `isAuthRequiredError(error?: CodexResponseError)` to call `messageContainsAuthRequired(error.message)` AND still inspect `error.data.type` / `error.data.reason` as before (the JSON-RPC envelope fields are codex-specific and must keep working); verify the four prior codex auth-required scenarios from the spec still pass and the `error.data` path is reachable when `error.message` is empty

## 2. MiniMax auth-required detection

- [x] 2.1 Add a `MMX_LOGIN_REQUIRED_LABEL = "󰧑 MiniMax requiere login"` constant near the existing `CODEX_LOG_PREFIX` / `CODEX_PLAN_*` constants; verify the Nerd Font icon is the same `󰧑` already used for the MiniMax data label in `readMmx`
- [x] 2.2 Inside `readMmx`'s `catch` block, before the existing `onFailure?.(message); return undefined` fallthrough, branch on `messageContainsAuthRequired(error.message)` and return `MMX_LOGIN_REQUIRED_LABEL`; ensure the ENOENT branch (`message.includes("ENOENT")`) runs first and the `signal.aborted` early return runs first; verify by tracing the four new MiniMax scenarios from the spec delta
- [x] 2.3 Update the existing `onFailure` ENOENT message from `"ENOENT: mmx binary not on PATH"` (it currently says `"ENOENT: codex binary not on PATH"` is not present, but the mmx side has no dedicated ENOENT message — confirm the current mmx catch path emits `error.message` directly) — verify the existing mmx ENOENT scenario is unchanged

## 3. Codex auth-required label shortened

- [x] 3.1 Replace the literal `"󰚩 Codex requiere login"` in `readCodex` with `"󰚩 Codex · login"` (single space, single middle dot, the verb removed); verify the new label is the only string returned from the auth-required branch and the spec scenario for the shortened label passes

## 4. Prerequisites docblock

- [x] 4.1 Add a leading JSDoc-style comment block at the very top of `quota-tui.tsx` (above `/** @jsxImportSource ... */`) documenting: (a) the two CLI prerequisites (`codex login`, `mmx login`), (b) the four footer states the user can see with their exact label strings, and (c) where to look in the `[quota-footer]` warning stream when a bar is missing; verify the docblock references every visible state label and the four states match what the implementation actually emits

## 5. Spec verification

- [x] 5.1 Walk every scenario in the new spec delta (`specs/tui-quota-footer/spec.md` in this change) against the implementation; confirm (a) the four mmx scenarios (login shown / login not shown / ENOENT preserved / successful read clears) pass, (b) the two codex label scenarios (shortened label / data path unaffected) pass, and (c) the existing four codex auth-required scenarios from `fix-quota-stale-state` + the prior widening still pass after the `isAuthRequiredError` refactor