# Proposal

## Why

Agents sometimes exhaust their configured model-step allowance before finishing useful work. Higher selective ceilings, fewer redundant iterations, and a recoverable handoff can reduce interruptions without introducing unlimited execution.

## What Changes

- Raise `build` from 60 to 120 steps and `general`, `frontend`, and `backend` from 40 to 80; leave other ceilings unchanged.
- Require agents to batch independent discovery, reuse evidence, work in bounded verifiable units, and stop once acceptance conditions pass.
- Define a compact interruption handoff containing completed work, pending work, verification evidence, blockers, and the next action for manual continuation.
- Add regression checks for ceiling consistency and policy presence, plus explicit manual behavioral checks.
- Do not implement automatic continuation or claim reliable remaining-step telemetry that the runtime does not expose.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-routing`: Define selective step ceilings, efficient execution expectations, and recoverable budget-exhaustion reporting alongside existing routing and specialist contracts.

## Impact

Implementation affects `config/opencode.template.jsonc`, `agent/routing.md`, relevant agent prompts, shared `AGENTS.md` guidance, documentation, and focused acceptance tests. Model assignments, permissions, delegation depth, installation architecture, and compaction settings remain unchanged. Installation of updated ceilings is a separate operator action; this proposal changes planning artifacts only.
