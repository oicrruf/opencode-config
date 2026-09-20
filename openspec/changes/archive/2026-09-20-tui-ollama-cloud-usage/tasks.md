## 1. Reading the Ollama Cloud credential

- [x] 1.1 Add a helper that resolves the state directory from the plugin API (`api.state.path.state`), reads `auth.json` from it, and returns the `ollama-cloud` entry's key; verify by comparing the resolved path and key length against `jq -r '.[\"ollama-cloud\"].key' ~/.local/share/opencode/auth.json` and confirming the helper returns the same value for the live file
- [x] 1.2 Make the helper return a missing-key signal (not a throw) when the file is absent, the `ollama-cloud` entry is absent, or the entry carries no string key; verify by running the helper against a temp copy of `auth.json` with the entry removed and confirming it yields the missing-key case rather than raising
- [x] 1.3 Confirm the helper never returns, logs, or embeds the credential in an error message: verify by inspecting every return path and confirming no `console.*` call receives the key or the full entry object

## 2. Reading monthly consumption

- [x] 2.1 Add a read helper that issues `GET https://ollama.com/api/usage` with the credential in an `Authorization: Bearer` header, honours the passed `AbortSignal`, and applies the existing `COMMAND_TIMEOUT_MS` bound; verify with `curl -s https://ollama.com/api/usage -H "Authorization: Bearer $KEY"` that the request shape matches and returns HTTP 200
- [x] 2.2 Parse `limits.monthly.usage` as the consumed dollar amount and sum `request_count` across `limits.monthly.models`, and return the fresh label string; verify against the live payload that `usage: 0.029` renders as `$0.03` and that the summed count equals the arithmetic total of the `models[]` entries
- [x] 2.3 Return the missing-value case when `limits.monthly.usage` is absent or is not a finite number, or when `limits.monthly.models` is absent; verify by feeding a fixture body `{"limits":{"monthly":{"models":[]}}}` and one with `"usage":"x"` and confirming neither produces a segment
- [x] 2.4 Return the login label when the endpoint rejects the credential as unauthorized, without invoking the failure callback; verify by issuing the request with a deliberately invalid key and confirming the footer shows the login label and no warning is emitted
- [x] 2.5 Return the transient-failure case for every other error (timeout, transport error, malformed JSON, non-success status) and invoke the failure callback exactly once with a reason that never contains the credential; verify with an unreachable host and a malformed body fixture that exactly one `[quota-footer]` warning is emitted per cycle
- [x] 2.6 Confirm the rendered label contains neither a 5-segment Unicode bar nor a `%` character nor a day/hour reset suffix; verify by rendering the live response and grepping the output for `█`, `░`, `%`, and the reset pattern

## 3. Wiring the segment into the footer

- [x] 3.1 Extend the `FooterState` type and the `api.kv` write so the Ollama Cloud segment is cached alongside `codex` and `minimax`, and so a transient failure preserves the previously cached Ollama value; verify that a forced failure cycle leaves the previous value rendered and a success cycle replaces it
- [x] 3.2 Add the third read to the existing refresh cycle's concurrent reads and join it into the rendered line; verify the footer shows all three segments in a stable order separated by the existing ` | ` separator
- [x] 3.3 Confirm the credential is absent from any rendered footer text; verify by searching the rendered label and the surrounding slot output for the key's first eight characters
- [x] 3.4 Confirm the existing codex and MiniMax behavior is unchanged by comparing the rendered labels for both against the pre-change output; verify that neither segment's format, sentinel, or reset indicator moved

## 4. Documentation and repository surfaces

- [x] 4.1 Extend the plugin docblock with the third prerequisite (authenticating Ollama Cloud in OpenCode, with no separate login step) and the new visible segment; verify the docblock lists every visible footer state the implementation can emit and that the state strings match the constants in the file
- [x] 4.2 Add the new cloud icon to the README's Nerd Font icon list and mention the third provider; verify the listed icon codepoint matches the constant in `quota-tui.tsx` and that the README no longer describes the footer as two-provider
- [x] 4.3 Run `node scripts/validate-config.mjs` and confirm it exits zero; verify by checking the exit code and that no new error line names `quota-tui.tsx` or `README.md`

## 5. End-to-end verification

- [x] 5.1 Walk every scenario in `specs/tui-quota-footer/spec.md` in this change and confirm each `WHEN`/`THEN` holds against the implementation; record the trace for the scenarios that depend on a network path or a credential state that cannot be reproduced locally
- [x] 5.2 Confirm no scenario in the existing `tui-quota-footer` spec regressed by tracing the codex and MiniMax requirements against the post-change implementation, including the sentinel-after-sustained-failure and auth-required paths
- [x] 5.3 Run `openspec validate tui-ollama-cloud-usage --strict` and confirm the change validates clean; verify by checking the exit code
