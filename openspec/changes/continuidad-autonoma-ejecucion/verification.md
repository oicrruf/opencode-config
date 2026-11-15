# AT-186 verification

## Implementation

Branch: `feat/at-186-autonomous-continuity`, based on the squash-integrated `main`.
Its baseline tree is identical to the inspected `f8d5d3e650a4ed38389e67e74a16ff956c647586` baseline.
The primary `build` and `plan` omit steps in template, rendered repository root,
and frontmatter. Thirteen specialist budgets are preserved. Shared guidance and
both specs define native continuation, checkpoints, bounded no-progress handling,
and interruption recovery. No restart plugin or synthetic user message exists.

## Runtime basis

Observed CLI: OpenCode 2.2.7, macOS. The tagged upstream runner's
`stepLimitReached` condition requires a defined steps value. Real-CLI resolution
confirmed omission and merge behavior. Global finite values persist under a
project omission; project frontmatter can introduce another finite limit.

## Passed checks

- `node scripts/validate-config.mjs --profile personal`: OK.
- `node scripts/validate-config.mjs --profile work`: OK.
- `node scripts/test-model-profiles.mjs`: 7/7.
- `node scripts/acceptance-harness.mjs`: 39/39, without legacy `--live` wrapper checks.
- `node scripts/exercise-handoff-fixture.mjs`: 6/6 structural checks.
- `openspec validate continuidad-autonoma-ejecucion --strict`: valid.
- `git diff --check`: clean.
- `node scripts/test-autonomous-continuity.mjs`: 8/8 real-CLI integration checks
  against a scripted loopback OpenAI-compatible provider: omitted limits and
  source precedence; effective continuity controls from the actual renderer and primary Markdown files in an unrelated temporary project; 6 completed sequential reads plus final response in one
  turn; one-read early completion; a 3-step comparison stops after 2 reads
  with tool_choice none on step 3; read permission denial; non-retryable HTTP
  400 reported after one request; cancellation stops an in-flight run.
- `CONTINUITY_LIVE_MODEL=minimax/MiniMax-M3 node scripts/test-autonomous-continuity.mjs --live`:
  2/2 authenticated observations. Six completed sequential reads and final
  marker without user renewal; missing-input task stopped after one failed
  read and reported the blocker. Both used the actual installed primary prompt body in an isolated read-only
  primary. The long-task assertions require six distinct read message IDs,
  chain order, and at least seven step_start events.

## Limits and unsuccessful observations

The initial live observation using `ollama-cloud/gpt-oss:20b` failed with HTTP
402 (quota/credits). MiniMax is already the configured personal root provider;
using it for the explicit test did not change profile models. The native loop
was proven with a finite comparison budget of 3, not a 120-step paid session.

The finite-budget integration uses an isolated primary with a specialist-style
allowance to prove runtime restriction; the specialist handoff and coordinator
recovery contract is checked structurally, not via a full live delegation
workflow. No model-compliance guarantee across providers is claimed.

No supervisor is introduced, so supervisor concurrency, automatic restart
recovery, and duplicate external-operation tests do not apply. Prompt-level
no-progress and observed budget instructions are not hard runtime watchdogs.
No exact remaining-step counter or guaranteed monetary limit is claimed.
The legacy acceptance-harness --live wrapper tests are unrelated to this change
and were not run; the new continuity integration and live observations were.

The existing cosmetic re-dispatch assertion rejected a valid line break between
SHALL and NOT. Its regex now accepts whitespace; the underlying review policy
has not been weakened.

## Activation and review

The installed global configuration was not replaced. Run the installer for the
selected profile and start a fresh execution, then inspect effective agents and
project overrides as documented in `docs/contracts/autonomous-continuity.md`.
The active OpenSpec change is retained for review; it has not been archived.

Initial targeted review identified two introduced MAJOR findings: shared rules
were not delivered through installed primary prompts, and the live assertions
counted calls without proving distinct model steps. Both fixes are implemented:
build/plan now carry the essential controls, a real effective-prompt probe checks
the rendered root plus unmodified Markdown files in an unrelated project, and
live tests verify distinct messages, file order, and a final response step.
Focused re-review: PASS. Both introduced MAJOR findings are resolved with no
material residual findings in the focused scope. The reviewer independently
reran the real-CLI integration (8/8 PASS), inspected installation delivery and
live assertions, and did not repeat paid calls. Cross-platform cleanup remains
unverified beyond macOS. No remaining review blocker.
