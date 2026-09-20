## 1. Move `/opsx-propose` to the decision tier

- [x] 1.1 Change `model: openai/gpt-5.6-luna` to `model: openai/gpt-5.6-terra` in `commands/opsx-propose.md`; verify the file still has a single `model:` key and its body is untouched
- [x] 1.2 Confirm `commands/opsx-propose.md` has no `subtask: true` (a subtask child would inherit the invoking agent's model and discard the declared tier, as established by the `skill-model-tiers-and-visibility` probe)

## 2. Keep the `plan` agent on the planning tier

- [x] 2.1 Verify `agent/plan.md` and the `plan` block in `opencode.jsonc` both still read `openai/gpt-5.6-luna`; make no edit
- [x] 2.2 Verify the planning tier still names exactly `plan` in the reconciled spec, so the tier is not left empty

## 3. Reconcile the specs

- [x] 3.1 Apply this change's `specs/agent-routing/spec.md` delta to `openspec/specs/agent-routing/spec.md`: the class matrix row for `spec-required`, the decision-tier role list (adding `/opsx-propose`), the planning-tier description (restricted to `plan`), and the new scenario for the propose command
- [x] 3.2 Verify the `spec-required` scenario named "uses Terra for the proposal only" now actually asserts Terra, so the name and body agree
- [x] 3.3 Update the model-tier table in `agent/routing.md` so `/opsx-propose` appears under the decision tier and the planning tier lists only `plan`

## 4. Verification

- [x] 4.1 Run `node scripts/validate-config.mjs`; confirm `validate-config: OK` and that `openai/gpt-5.6-terra` resolves
- [x] 4.2 Extend `scripts/acceptance-harness.mjs` with two checks: command model tiers match the routing decision (`/opsx-propose` = terra), and the planning tier still has a member (`plan` = luna)
- [x] 4.5 Harden the live deny assertion to read structured tool state instead of model prose: a weaker model may refuse in unpredictable wording, and the earlier prose regex produced a false failure while the rule worked
- [x] 4.3 Run `openspec validate opsx-propose-decision-tier --strict` and `openspec validate --specs --strict`; both must pass
- [x] 4.4 Confirm no other command or agent changed tier, and that `plan` remains the sole planning-tier member
