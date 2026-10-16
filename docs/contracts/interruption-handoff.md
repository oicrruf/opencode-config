# Interruption handoff fixture

This fixture documents the expected shape of a recoverable handoff when
a primary or specialist agent reaches the step ceiling. It exists to
make the policy in `AGENTS.md` testable in isolation; live runtime
exhaustion cannot be exercised deterministically in CI, so this
document is the contract that any future automated check must
implement.

The fixture is exercised by reading the file and confirming the five
required sections appear, that a specialist variant keeps the
structured return fields, and that the policy block exists in
`AGENTS.md`. The behavioral observation in `tasks.md` 2.3 records
that this is structural, not runtime-verified.

## Exercise log (structural only)

`scripts/exercise-handoff-fixture.mjs` reads the policy in `AGENTS.md`
and the fixture itself, and asserts that the policy's required
sections match the fixture's headings, the specialist variant stays
within the existing structured return fields, and the runtime-exhaustion
caveats are present. A pass here is necessary but not sufficient: a
live session with an authenticated provider would still be required to
prove that a real model produces a handoff of this shape when the
runtime actually removes tools at the final step. No such session is
available in this implementation, so the live observation is recorded
as a follow-up and not as a verification result.


## Primary agent handoff

```
interrupted at step N of 120 — accepting manual continuation

completed
- docs/contracts/_metrics-contract.md: clarified token-estimation rules
- scripts/acceptance-harness.mjs: pinned ceiling assertions

pending (in order)
1. update agent/routing.md narrative to reference the new ceilings
2. re-render the work profile and confirm opencode.jsonc carries 120/80/80/80
3. run scripts/test-model-profiles.mjs and scripts/acceptance-harness.mjs

verification run
- node scripts/validate-config.mjs --profile personal  → OK
- node scripts/acceptance-harness.mjs                 → 28/29, 1 pre-existing FAIL

verification not run
- node scripts/test-model-profiles.mjs (re-render before running)
- live --live runtime group (requires an authenticated provider)

risks
- pre-existing `work baseline` and `cosmetic re-dispatches` failures
  are unrelated to this change; do not treat as blockers.
- the new ceilings only take effect after the operator runs
  ./install.sh; this session keeps the prior ceilings.

next manual action
"Continuá desde el paso 1 del bloque pending, sin repetir la validación
estructural ya ejecutada." — reuse the three acceptance gates
(validate-config, test-model-profiles, acceptance-harness) before
declaring the change done.
```

## Specialist handoff (preserve structured fields)

```
classification: spec-required
decision: pause — interruption at step N of 80, accepting manual continuation
changed files:
  - scripts/acceptance-harness.mjs
verification results:
  - node scripts/validate-config.mjs --profile personal → OK
  - acceptance-harness static group                    → 28/29
blockers:
  - pre-existing cosmetic re-dispatches failure (unrelated)
  - new ceilings require ./install.sh to take effect
OpenSpec task impact:
  - improve-agent-step-budgets/2.1, 2.2 in progress
  - no other change task affected
```

The specialist must NOT add a free-form "pending" field; the
OpenSpec task impact and blockers fields already carry that
information for the coordinator.
