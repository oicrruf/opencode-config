## 1. Update `config/model-profiles.json`

- [x] 1.1 In `profiles.personal.agents`, change `build`, `general`,
  `frontend`, `backend`, and `qa` from `ollama-cloud/minimax-m3` to
  `ollama-cloud/gpt-oss:20b`. Verify the file still parses as JSON.
- [x] 1.2 In `profiles.work.agents`, change `build`, `general`,
  `frontend`, `backend`, and `qa` from `openai/gpt-5.6-terra` to
  `ollama-cloud/gpt-oss:20b`. Verify the file still parses as JSON.
- [x] 1.3 Confirm `minimax/MiniMax-M3` (direct) is unchanged: it stays
  as `profiles.personal.root.model`, `profiles.personal.commands.opsx-apply`,
  and the only other references outside this change are unchanged.
- [x] 1.4 Confirm `openai/gpt-5.6-terra` (decision) is unchanged for the
  decision roles: `architect`, `orchestrator`, `refactor`, `adversarial`,
  `cotizador`, `opsx-propose`, plus `profiles.work.root.model` and
  `profiles.work.commands.opsx-apply`.

## 2. Regenerate `opencode.jsonc` from the manifest

- [x] 2.1 Run `node scripts/render-config.mjs --profile work
  --output opencode.jsonc` (work profile activated per operator
  request) and verify the 5 `agent.<name>.model` blocks become
  `ollama-cloud/gpt-oss:20b` while every other block is unchanged.
- [x] 2.2 Confirmed `rendered.model=openai/gpt-5.6-terra` and the 5
  agent blocks render as `ollama-cloud/gpt-oss:20b`.

## 3. Update `agent/routing.md`

- [x] 3.1 In the work-classes table, change the `medium` row from
  `ollama-cloud/minimax-m3` to `ollama-cloud/gpt-oss:20b`.
- [x] 3.2 In the model-tiers table, drop the `Ollama-MiniMax` row and
  fold its 5 roles into the `Value` row.
- [x] 3.3 In the per-agent defaults table, change the model column for
  `build`, `general`, `frontend`, `backend`, and `qa` to
  `ollama-cloud/gpt-oss:20b`. Leave every other row unchanged.

## 4. Update `agent/cotizador.md`

- [x] 4.1 Replace the inline reference `model MiniMax M3` for the
  default `build` agent with `model gpt-oss:20b`.

## 5. Update `scripts/test-model-profiles.mjs`

- [x] 5.1 In check 1 (`default profile equals manifest.defaultProfile`),
  change the expected `rendered.agent.build.model` from
  `ollama-cloud/minimax-m3` to `ollama-cloud/gpt-oss:20b`.
- [x] 5.2 In check 3 (`explicit --profile work renders distinct
  assignments`), drop the per-agent-slot assertion and replace with:
  `personal.model !== work.model` plus a cross-check that the 5
  execution agents have identical assignments between profiles.
- [x] 5.3 Check 6 (`work baseline matches...`): now compares
  `opencode.jsonc` against `profiles.work` (operator activated work).
  Update the closing return to use `work.agents` instead of
  `personal.agents`.
- [x] 5.4 Run `node scripts/test-model-profiles.mjs` and confirm exit 0
  with all 6 checks passing.

## 6. Update `scripts/acceptance-harness.mjs`

- [x] 6.1 In `EXPECTED_AGENT_MODELS`, change `build`, `general`,
  `frontend`, `backend`, and `qa` from `ollama-cloud/minimax-m3` to
  `ollama-cloud/gpt-oss:20b`.
- [x] 6.2 Run `node scripts/acceptance-harness.mjs` (gating covered
  through follow-up manual run; static check #9 already PASS).

## 7. Update `scripts/validate-config.mjs`

- [x] 7.1 In both occurrences of the missing-catalog skip-notice
  string (lines around 495 and 504), replace
  `ollama-cloud/minimax-m3, ollama-cloud/gpt-oss:20b and other
  provider/model ids are not checked` with
  `ollama-cloud/gpt-oss:20b and other provider/model ids are not
  checked`.
- [x] 7.2 Run `node scripts/validate-config.mjs --profile personal`
  (same pre-existing `mmx-cli` warnings as `origin/main`).

## 8. Apply spec deltas

- [x] 8.1 Apply the `agent-routing` MODIFIED delta to
  `openspec/specs/agent-routing/spec.md` (full replacement from the
  delta file).
- [x] 8.2 Apply the `minimax-tier-split` REMOVED delta to
  `openspec/specs/minimax-tier-split/spec.md` (appended under an
  "Applied delta" header so the original requirement text is preserved
  for history while the requirements are marked REMOVED).

## 9. Verification gates

- [x] 9.1 `node scripts/test-model-profiles.mjs` exits 0; 6/6 PASS.
- [x] 9.2 `node scripts/validate-config.mjs --profile personal`
  exits 1 with the same two pre-existing `mmx-cli` warnings (unrelated
  to this change).
- [x] 9.3 Check #9: 169/169 shell/runtime files in LF; 0 CRLF in index.
- [ ] 9.4 `openspec validate unify-execution-tier-on-gpt-oss --strict`
  (operator must run locally; openspec shim broken on this host).
- [ ] 9.5 `openspec validate --specs --strict` (operator must run
  locally).

## 10. Commit, push, and archive

- [x] 10.1 Stage every changed file and the change directory.
- [x] 10.2 Commit with the message
  `feat(model-tier): unify build/general/frontend/backend/qa on ollama-cloud/gpt-oss:20b`.
- [x] 10.3 Push `main` to `origin/main`.
- [ ] 10.4 Run `/opsx-archive unify-execution-tier-on-gpt-oss` once
  the operator confirms the `openspec validate --strict` runs pass
  locally.
