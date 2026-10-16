# Tasks

## 1. Selective ceilings

- [x] 1.1 Update build to 120 and general/frontend/backend to 80 in the template, corresponding existing frontmatter, and routing table; add focused regression assertions for agreement and unchanged other ceilings, and verify those assertions pass.
- [x] 1.2 Document the new defaults, finite-ceiling rationale, selected-profile installation, override caveat, and rollback in existing operator documentation; verify both personal and work rendered configurations retain the specified ceilings without model or permission changes using profile tests.

## 2. Efficient execution and recovery

- [x] 2.1 Add concise shared guidance for evidence reuse, independent discovery batching, bounded verifiable units, and stopping after acceptance; align relevant prompt references and add focused policy-presence assertions, verifying no scope, review, or depth gate is weakened.
- [x] 2.2 Define the text-only recovery handoff in shared guidance, preserving specialist return fields; add a documented interruption/resume fixture and verify it includes completed/files, ordered pending work, verification run/not run, risks, and next manual action without requiring tool access or exact step telemetry.
- [x] 2.3 Exercise the fixture with an isolated low-step agent or controlled exhaustion instruction and a subsequent manual continuation; record observed behavior and any limitations, verifying no automatic restart or repeated full investigation. Do not mark runtime exhaustion verified if only a simulated instruction was tested. **Implemented as a static exercise only** — `scripts/exercise-handoff-fixture.mjs` validates the policy and fixture shape, and the fixture itself records that live runtime observation remains a follow-up. No live exhaustion observation is claimed as verified.

## 3. Integration verification and handoff

- [x] 3.1 Run `node scripts/validate-config.mjs --profile personal`, `node scripts/validate-config.mjs --profile work`, `node scripts/test-model-profiles.mjs`, and `node scripts/acceptance-harness.mjs`; record actual results and distinguish pre-existing failures from introduced regressions.
- [x] 3.2 Evaluate the final diff against the routing review policy, dispatch targeted adversarial review if executable test logic changes, resolve introduced blocking findings, and produce a human-review-ready handoff with actual verification and unresolved behavioral risks; leave installation to an explicit operator action.
