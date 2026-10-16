# Tasks

## 1. Restore authoritative requirements

- [x] 1.1 Compare both `ADDED` requirements and scenarios with the archived source and current agent policy; verify `openspec validate add-adversarial-spec-requirements --strict` succeeds before archive. The two `ADDED` requirements match `agent/routing.md` (Adversarial dispatch policy, lines 88-108) and `agent/adversarial.md` (origin enum, focused re-review, incomplete verdict). `openspec validate add-adversarial-spec-requirements --strict` returned `valid`.
- [x] 1.2 Archive the change through OpenSpec's normal archive command and verify both requirement headers occur exactly once in `openspec/specs/agent-routing/spec.md`. Archive reported `+ 2 added`. Post-archive check: each new `### Requirement:` header appears exactly once in `openspec/specs/agent-routing/spec.md`; the rest of the requirement headers are unchanged.

## 2. Verify specification integrity

- [x] 2.1 Run `openspec validate agent-routing --strict` and verify the main spec is valid with both adversarial requirements present. `openspec validate agent-routing --strict` reports `Specification 'agent-routing' is valid`. The new `Adversarial review dispatch is risk-proportionate` and `Targeted adversarial reviews have a bounded closure` headers are present, each with its three/four `#### Scenario:` blocks.
