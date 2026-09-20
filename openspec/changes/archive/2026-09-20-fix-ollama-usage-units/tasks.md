## 1. Allowance resolution

- [x] 1.1 Add a module-level allowance table mapping the plan identifier to the included monthly credit (`pro → 60`, `max → 300`, `team → 1000`) with a comment naming the pricing page as its source; verify the table contains exactly the three plans the delta spec maps and that an unlisted plan resolves to no entry
- [x] 1.2 Add a per-session allowance record in the `tui` closure shaped `{ resolved: boolean; allowance?: number; warned: boolean }`, so `resolved` separates "not yet attempted" from "attempted and unknown" and `allowance` absent means unknown; verify by reading the closure and confirming no module-scope mutable state is introduced
- [x] 1.3 Add a plan-read helper that issues `POST https://ollama.com/api/me` with the credential in an `Authorization: Bearer` header, honours the passed `AbortSignal`, applies `COMMAND_TIMEOUT_MS`, and returns the top-level `Plan` string or `undefined`; verify with `curl -s -X POST -H "Authorization: Bearer $KEY" https://ollama.com/api/me` that the live response carries `Plan` and that the helper's request shape matches
- [x] 1.4 Map the resolved `Plan` through the allowance table and store the result in the session record, marking `resolved` so no later cycle re-issues the request; verify against the live account that `Plan: "pro"` resolves to `60` and that a second refresh cycle issues no additional plan request
- [x] 1.5 On a plan-request failure, an absent `Plan`, or a `Plan` not in the table, leave `allowance` unset, mark `resolved`, and emit at most one `[quota-footer]` warning naming the failure for the whole session; verify with an unreachable host and with a fixture body omitting `Plan` that each emits exactly one warning and that a subsequent cycle emits none
- [x] 1.6 Confirm the plan request never places the credential in any warning, error message, or rendered label: verify by inspecting every failure path and confirming no `console.*` call receives the key

## 2. Consumption rendering

- [x] 2.1 Change `formatOllamaUsage` to take the fraction plus the optional allowance and emit dollars when the allowance is present, computed as `usage × allowance` formatted to two decimals; verify against the live payload that `usage: 0.04` with allowance `60` renders `$2.40`
- [x] 2.2 Add the percentage fallback to `formatOllamaUsage` for an absent allowance, formatted to one decimal place with a trailing `.0` omitted; verify that `usage: 0.031` with no allowance renders `3.1%` and that `usage: 0.03` renders `3%`
- [x] 2.3 Thread the session allowance record into `readOllamaCloud` as an added parameter, resolving the plan on the first cycle that has a credential and before the usage request; verify that a cycle with no credential issues neither request and still returns the login label
- [x] 2.4 Keep the request-count sum, the `nf-md-assistant` icon, and the `Ollama` label unchanged; verify the rendered segment still contains the summed `request_count` and that the icon codepoint matches `OLLAMA_CLOUD_ICON`
- [x] 2.5 Confirm the rendered segment contains no 5-segment Unicode bar and no reset indicator in either the dollar or the percentage form; verify by rendering both forms and grepping the output for `█`, `░`, and the day/hour reset pattern

## 3. Failure semantics preserved

- [x] 3.1 Confirm the missing-or-rejected credential path is unchanged: absent credential returns the login label and issues no request, and a 401/403 returns the login label as fresh content rather than a transient failure; verify with an invalid key that the footer shows the login label and no warning is emitted
- [x] 3.2 Confirm a transient usage failure still emits exactly one `[quota-footer]` warning and preserves the previously cached segment; verify with an unreachable host that one warning is emitted per cycle and the prior value stays rendered
- [x] 3.3 Confirm a fresh usage string still replaces the cached login label; verify that a success cycle after a displayed login label renders the consumption segment

## 4. Documentation and repository surfaces

- [x] 4.1 Update the plugin docblock to describe the corrected semantics: the fraction-of-credit reading, the dollar form with a resolved plan, and the percentage form when the allowance is unknown; verify the docblock lists every visible Ollama Cloud state the implementation can emit and that the state strings match the constants in the file
- [x] 4.2 Update the README if it quotes the Ollama Cloud segment example, so the quoted value reflects the dollar form; verify the README no longer shows the raw fraction as a dollar amount
- [x] 4.3 Run `node scripts/validate-config.mjs` and confirm it exits zero; verify by checking the exit code and that no new error line names `quota-tui.tsx` or `README.md`

## 5. End-to-end verification

- [x] 5.1 Walk every scenario in `specs/tui-quota-footer/spec.md` in this change and confirm each `WHEN`/`THEN` holds against the implementation, including the dollar render, the not-raw-fraction assertion, the unknown-plan percentage fallback, and the zero-consumption case
- [x] 5.2 Trace the codex and MiniMax requirements of the main `tui-quota-footer` spec against the post-change implementation and confirm no scenario regressed, including the sentinel-after-sustained-failure and auth-required paths
- [x] 5.3 Run `openspec validate fix-ollama-usage-units --strict` and confirm the change validates clean; verify by checking the exit code
