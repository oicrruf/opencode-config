# Tasks

## 1. Define and enforce the routing contract

- [x] 1.1 Update `agent/routing.md` and `agent/build.md` with the risk-proportionate omit/targeted/required adversarial dispatch matrix, final-diff timing, and full-mode triggers; verify each delta scenario in `specs/agent-routing/spec.md` is represented.
- [x] 1.2 Update `agent/adversarial.md` to constrain targeted scope, classify introduced/pre-existing/unverifiable findings, allow one focused re-review, emit incomplete verdicts, and remove nested-dispatch or direct-edit instructions; verify the agent remains read-only and internally consistent.
- [x] 1.3 Update `agent/refactor.md` to retain its compatibility audit while using the shared scope, severity, and re-review closure contract; verify refactor still requires an independent review before completion.
- [x] 1.4 Update duplicated policy documentation or configuration comments only where they describe the changed contract; verify no documentation retains an unconditional adversarial gate or external-facing-only full-mode trigger.

## 2. Keep static configuration and validation aligned

- [x] 2.1 Inspect `config/opencode.template.jsonc` and generated configuration inputs for conflicts with the revised read-only, non-nested-dispatch contract; make only necessary configuration changes and verify `node scripts/validate-config.mjs --profile personal` passes.
- [x] 2.2 Extend `scripts/acceptance-harness.mjs` and/or `scripts/validate-config.mjs` with static assertions for enforceable policy boundaries (no conflicting nested-dispatch/edit allowance and documented targeted/full contract); verify the affected assertion fails against a deliberately incompatible fixture or equivalent focused test and passes with the updated policy.
- [x] 2.3 Update the `agent-routing` and `context-budget` main specs from the approved deltas through the repository's OpenSpec synchronization workflow; verify `openspec validate optimize-adversarial-review-gates --strict` passes.

## 3. Verify integration

- [x] 3.1 Run `node scripts/test-model-profiles.mjs` and verify all profile tests pass without changing model assignments. The active `personal` profile and the renderer checks pass; the `work baseline matches the documented current assignment` check fails pre-existingly because the installed `opencode.jsonc` is the `personal` render and was not regenerated against the `work` profile as part of this change.
- [x] 3.2 Run `node scripts/acceptance-harness.mjs` and verify the full routing, skill-surface, and CLI acceptance harness passes. Last run: 26/26 passed (static only; add --live for runtime tests).
- [x] 3.3 Run `node scripts/validate-config.mjs --profile personal` and `openspec validate optimize-adversarial-review-gates --strict`; verify both exit successfully and record any pre-existing failures separately. Last run: `validate-config: OK`; `openspec validate optimize-adversarial-review-gates --strict` reports `Change 'optimize-adversarial-review-gates' is valid`; the related specs `agent-routing` and `context-budget` also validate. The pre-existing failure of `scripts/test-model-profiles.mjs` for the `work` profile is recorded as a follow-up, not introduced by this change.
