# Checkpoint and interruption handoff fixture

Primary agents normally continue natively without a fixed steps ceiling.
This fixture covers checkpoints and fallback handoffs after a real blocker or
external override. Structural checks are not sufficient to prove runtime or
model behavior; see `autonomous-continuity.md`. The previous static exercise
was not runtime-verified.

## Primary agent handoff

Checkpoint after bounded units using these fields. On real interruption include
the cause and next manual action. If tools were removed, use known evidence;
a final tool call is never required.

```text
status: incomplete — external project override exhausted its allowance
completed
- updated configuration and primary frontmatter
pending (in order)
1. run the isolated integration check
2. run remaining acceptance gates
verification run
- both profile renders omit primary steps
verification not run
- authenticated live observation
risks
- installed global root may retain its prior ceiling
- no exact remaining-step counter was exposed
next manual action
Resolve the external override, then continue pending action 1 and revalidate
only evidence that may have changed.
```

## Specialist handoff

A specialist reports to its coordinator, which manages remaining authorized work
within permissions, depth, and review re-dispatch gates. Exhaustion alone does
not require another user message for the primary.

```text
classification: spec-required
decision: incomplete — specialist allowance exhausted; return pending work
changed files:
  - config/opencode.template.jsonc
verification results:
  - both profile renders checked
  - runtime integration not run
blockers:
  - this specialist has no remaining tool access
OpenSpec task impact:
  - task 2.1 remains pending: run the isolated integration check
  - coordinator may finish the check within its permissions
```

Specialists do not restart themselves or dispatch recursively. Permission denial,
cancellation, persistent provider failure, and the no-progress threshold remain
real stop conditions. A checkpoint does not prove completion or verification.
