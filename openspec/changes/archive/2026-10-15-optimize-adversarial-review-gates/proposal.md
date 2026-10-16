# Proposal

## Why

The adversarial reviewer can turn a low-risk change into an hours-long completion loop because its invocation and completion boundaries are not sufficiently explicit. The system needs to preserve independent review for material risk while making routine work predictable and bounded.

## What Changes

- Define a risk-based dispatch policy for `adversarial`: do not automatically invoke it for low-risk mechanical work; invoke it once against the final diff for bounded changes with relevant logic; require it for defined high-risk changes.
- Constrain `targeted` reviews to the changed diff and directly affected dependencies, and prohibit redundant full-suite, browser, or broad repository checks unless a documented trigger applies.
- Define a targeted-review closure contract: distinguish introduced findings from pre-existing debt, define which severities block completion, allow one focused re-review after fixes, and require a structured incomplete result when the budget is exhausted.
- Tighten `full` escalation so an external-facing artifact alone is not sufficient; require an explicit request or a concrete documented risk signal.
- Remove conflicting reviewer responsibilities that permit routine convention edits or nested specialist dispatches from a read-only audit.
- Align the refactor compatibility-audit handoff with the revised finding and closure policy.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agent-routing`: change when and how the adversarial reviewer is dispatched, scoped, escalated, and used as a completion gate.
- `context-budget`: add a bounded closure policy for targeted reviews within the existing highest-mode step-budget model.

## Impact

- Agent instructions: `agent/adversarial.md`, `agent/build.md`, and `agent/refactor.md`.
- Routing and resource policy: `agent/routing.md` and potentially the related model/MCP policy only if required to express the reviewed contract.
- Installed configuration and validation: `config/opencode.template.jsonc`, `scripts/validate-config.mjs`, and `scripts/acceptance-harness.mjs` as needed to keep documented policy enforceable.
- Documentation and OpenSpec requirements: the `agent-routing` and `context-budget` specifications, plus any user-facing policy documentation that duplicates the affected behavior.
