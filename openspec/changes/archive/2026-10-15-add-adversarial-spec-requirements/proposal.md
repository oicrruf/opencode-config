# Proposal

## Why

The adversarial-review behavior is already implemented and covered by the acceptance harness, but its authoritative `agent-routing` spec omits the dispatch-risk matrix and bounded review-closure requirements. This follow-up restores the missing specification contract so future changes and archives preserve the behavior instead of silently removing it.

## What Changes

- Add the existing risk-proportionate adversarial-dispatch requirement to the `agent-routing` spec.
- Add the existing targeted-review closure requirement, including finding origin, one focused re-review, and an incomplete verdict for material unverified risk.
- Use the existing archived change and current agent instructions as the source text; do not change runtime behavior, configuration, or test implementation.
- Archive through OpenSpec's normal delta application so `ADDED` requirements are retained in the main spec.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agent-routing`: add the two missing adversarial review requirements to the authoritative routing contract.

## Impact

- OpenSpec delta: `openspec/changes/add-adversarial-spec-requirements/specs/agent-routing/spec.md`.
- Main spec after archive: `openspec/specs/agent-routing/spec.md`.
- No runtime code, agent prompt, config, dependency, or API changes are intended.
