## 1. Update the root config for the new tier split

- [x] 1.1 Change `"model": "minimax/MiniMax-M3"` for `agent.build` to `"model": "ollama-cloud/minimax-m3"` in `opencode.jsonc`; verify the JSONC still parses and the field agrees with `agent/routing.md`'s per-agent defaults
- [x] 1.2 Change `"model": "minimax/MiniMax-M3"` for `agent.general` to `"model": "ollama-cloud/minimax-m3"`; verify the JSONC still parses
- [x] 1.3 Change `"model": "minimax/MiniMax-M3"` for `agent.frontend` to `"model": "ollama-cloud/minimax-m3"`; verify the JSONC still parses
- [x] 1.4 Change `"model": "minimax/MiniMax-M3"` for `agent.backend` to `"model": "ollama-cloud/minimax-m3"`; verify the JSONC still parses
- [x] 1.5 Change `"model": "minimax/MiniMax-M3"` for `agent.qa` to `"model": "ollama-cloud/minimax-m3"`; verify the JSONC still parses
- [x] 1.6 Confirm the root `"model"` value stays `minimax/MiniMax-M3`; verify by reading the file and confirming the line is unchanged
- [x] 1.7 Confirm no other agent block in `opencode.jsonc` is renamed or has its permission, `steps`, or tool surface modified; verify by grep over `agent\.[a-z-]+\.model` lines and a manual diff of the surrounding JSON
- [x] 1.8 Update frontmatter `model:` in `agent/build.md`, `agent/frontend.md`, `agent/backend.md`, and `agent/qa.md` from `minimax/MiniMax-M3` to `ollama-cloud/minimax-m3`; verify each file's frontmatter line matches the `opencode.jsonc` block and the acceptance harness `frontmatter and opencode.jsonc agree` check passes
- [x] 1.9 Update `EXPECTED_AGENT_MODELS` in `scripts/acceptance-harness.mjs` so `build`, `general`, `frontend`, `backend`, and `qa` expect `ollama-cloud/minimax-m3`; verify the harness `resolved config matches the routing matrix for every agent` check passes

## 2. Update the routing matrix documentation

- [x] 2.1 Update the class-vs-model matrix in `agent/routing.md` so the `medium` row shows `ollama-cloud/minimax-m3` instead of `minimax/MiniMax-M3`; verify the table still has exactly four rows
- [x] 2.2 Update the `Model tiers` table in `agent/routing.md` so it lists both a **Direct-MiniMax** row (`minimax/MiniMax-M3`, $0.3/$1.2, 1M context, used for `spec-required` implementation and the root default) and an **Ollama-MiniMax** row (`ollama-cloud/minimax-m3`, $0.6/$2.4, 512k context, used for `build`, `general`, `frontend`, `backend`, `qa`); verify both rows are present and the existing Decision, Planning, and Value rows are unchanged
- [x] 2.3 Update the `Per-agent defaults` table so `build`, `general`, `frontend`, `backend`, and `qa` show `ollama-cloud/minimax-m3`; verify the table still has one row per agent and the other rows are unchanged
- [x] 2.4 Confirm `agent/routing.md` no longer mentions `minimax/MiniMax-M3` for any agent other than `spec-required` implementation and the root default; verify by grep over the file

## 3. Extend the catalog check for the new id

- [x] 3.1 Add `ollama-cloud/minimax-m3` to the execution-tier id enumeration in `scripts/validate-config.mjs`; verify the new id is collected alongside `minimax/MiniMax-M3`, `ollama-cloud/gpt-oss:20b`, `openai/gpt-5.6-terra`, and `openai/gpt-5.6-luna`
- [x] 3.2 Add `ollama-cloud/minimax-m3` to the missing-catalog skip notice printed by `scripts/validate-config.mjs`; verify the notice names the new id and the exit code stays zero when the catalog is absent
- [x] 3.3 Regression check: confirm the validator collects `ollama-cloud/minimax-m3` from `agent.build` and accepts it against the catalog; verify by running `node scripts/validate-config.mjs` with the catalog present and confirming no errors mention the new id
- [x] 3.4 Run the validator with a planted phantom id: temporarily set `agent.build` to `ollama-cloud/minimax-m3-fake`, run `node scripts/validate-config.mjs`, confirm it exits non-zero and names the planted id; restore the file

## 4. Verification

- [x] 4.1 Run `node scripts/validate-config.mjs` with the real catalog present and confirm `validate-config: OK` with exit zero; verify by capturing the script output
- [x] 4.2 Run `node scripts/acceptance-harness.mjs` and confirm all routing and skill-surface assertions still hold; verify by capturing the harness output
- [x] 4.3 Run `openspec validate split-minimax-direct-vs-ollama --strict` and confirm the change is internally consistent; verify the validator exits zero
- [x] 4.4 Run `openspec validate --specs --strict` and confirm the post-archive spec would still parse; verify the validator exits zero
- [x] 4.5 Cross-check end-to-end: every agent in `opencode.jsonc` agrees with `agent/routing.md`'s per-agent table; `spec-required` planning is still Terra and implementation is still direct MiniMax; `audit` is still Terra; report any mismatch
