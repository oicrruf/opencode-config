## Why

A live consultation of the `jev` subagent returned a broader
dispatcher list than the OpenSpec contract allows. We want the spec
to be the single source of truth and to extend dispatch to the
`opsx-propose` command so proposal planning can use calibrated Jev
recommendations as evidence.

## What Changes

- Make `agent-routing` and `jev-decision-agent` specs explicit that
  only `build`, `plan`, and `adversarial` agents may dispatch `jev`.
- Add the global `opsx-propose` command to the dispatch list, so the
  OpenSpec proposal workflow can use `jev` for triage during planning.
- Confirm in the design that other agents (`general`, `frontend`,
  `backend`, `qa`, `architect`, `orchestrator`, `refactor`, `cotizador`)
  remain denied dispatchers per the strict scope gate.

## Capabilities

### Modified Capabilities

- `agent-routing`: tighten the `jev` dispatcher list to
  `build`, `plan`, `adversarial`, and add the global `opsx-propose`
  command as a dispatcher.
- `jev-decision-agent`: align the host-side dispatch rule with the
  narrower list and mention the `opsx-propose` exception.

## Impact

- `openspec/specs/agent-routing/spec.md`
- `openspec/specs/jev-decision-agent/spec.md`
- `commands/opsx-propose.md` (documentation only — no model change)
- `scripts/acceptance-harness.mjs` (extend the dispatcher check)
