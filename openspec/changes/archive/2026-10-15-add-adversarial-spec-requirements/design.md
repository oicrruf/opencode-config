# Design

## Context

See `proposal.md` for the motivation. Runtime behavior is already implemented; the remaining change is to restore its missing requirements in the authoritative `agent-routing` spec. The previous change's delta incorrectly marked those requirements `REMOVED`, so OpenSpec archive removed them from the main spec.

## Goals / Non-Goals

**Goals:**
- Ensure the two adversarial-review requirements are represented as `ADDED` in the delta and become durable in the main spec through OpenSpec archive.
- Preserve the existing requirement text and scenarios from the archived change.

**Non-Goals:**
- Change agent prompts, configuration, scripts, runtime behavior, or the already-implemented review policy.
- Manually edit the main spec before archive or mark the requirements `REMOVED`.

## Decisions

- Use `## ADDED Requirements` for both requirements because they are absent from the current main spec. OpenSpec archive applies this operation by adding them to the main spec; this avoids the prior failure mode where `REMOVED` deleted them.
- Use the archived delta as the text source and verify the final main spec after archive. Do not manually synchronize the main spec during implementation.
- Keep the implementation limited to delta validation and normal archive application; the existing harness already tests the executable contract.

## Risks / Trade-offs

- [A later archive could again remove or duplicate the requirements if the delta operation is changed] → Validate the delta as `ADDED`, archive using the standard command, then assert both requirement headers exist exactly once in the main spec.
- [The archived source text may differ from the effective current behavior] → Compare the delta with current `agent/routing.md` and `agent/adversarial.md` before archiving.

## Migration Plan

1. Validate the change strictly and confirm both requirements are `ADDED`.
2. Archive the change through OpenSpec.
3. Validate `agent-routing` and verify each added requirement header occurs exactly once in the main spec.
4. If the archive does not add them, stop and investigate the generated diff rather than manually claiming completion.
