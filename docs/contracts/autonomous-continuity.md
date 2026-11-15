# Autonomous execution continuity (AT-186)

`build` and `plan` omit `steps`. OpenCode keeps executing the same user turn
while authorized work remains. Specialists keep finite budgets; an incomplete
specialist returns evidence and pending work to the coordinator. No supervisor
restarts sessions or manufactures user input.

## Progress and stop conditions

Follow `AGENTS.md`: finish acceptance and required verification, checkpoint
bounded units in conversation, and stop on real blockers. The default is three
consecutive unsuccessful attempts at the same blocked action without new
evidence. An operator can specify another finite threshold and elapsed-time or
cost budgets in the task. Use observed values and disclose unavailable
accounting. These are prompt-level controls, not a guaranteed runtime watchdog
or monetary cap. Permission denial, cancellation, planning/scope boundaries,
and review re-dispatch gates remain authoritative.

## Runtime basis and evidence

The [OpenCode documentation](https://opencode.ai/docs/agents/#steps) describes
the final finite-budget step and renewal on new user input. The inspected
[2.2.7 runner](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/session/runner/llm.ts)
restricts tools only when `steps` is defined and reached. An isolated debug
probe resolved both omitted primary values without a steps property. A model
step can contain multiple tool calls.

Run `node scripts/test-autonomous-continuity.mjs` for isolated real-CLI
integration with a loopback scripted provider. It never calls a paid provider.
Use `node scripts/test-autonomous-continuity.mjs --live` for the separately
labeled authenticated read-only observation. Record results and limitations in
the active change's `verification.md`. Structural handoff checks are not
sufficient to prove runtime or model compliance.

## Activation and overrides

1. Run repository validation and the integration test.
2. Run `./install.sh --profile personal` (or the previously selected profile).
3. Start a fresh execution. On OpenCode 2.2.7, inspect effective agents with
   `opencode debug agents --standalone`: build and plan must not have finite
   steps. Do not publish full output, which includes prompts and config details.
4. Check project-local configuration and frontmatter. Omission cannot erase an
   old finite global value. Updating a symlinked prompt alone does not replace
   the installed root. Existing sessions can retain earlier state.

Repository validation installs nothing. Roll back by restoring the prior
template, rendered root, primary frontmatter, and guidance together, validating,
then reinstalling the same profile and starting a new run. Prior primary values
were build 120 and plan 100; restoring them restores finite interruption.
