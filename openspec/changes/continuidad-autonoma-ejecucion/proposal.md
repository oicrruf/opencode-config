# Proposal

## Why

AT-186 reports that authorized work stops solely because the configured model-step allowance expires. The previous increase to 120/80 steps postponed that interruption while explicitly requiring manual continuation.

## What Changes

- Omit `steps` for the primary agents `build` and `plan`; retain bounded specialist allowances and existing models, permissions, and delegation gates.
- Continue authorized pending work while making progress, stop on verified completion or real blockers, and preserve checkpoints without inventing step telemetry.
- Let the coordinator handle incomplete specialist work without recursive self-restarts or synthetic user messages.
- Define prompt-level controls for repeated lack of progress and operator-specified time/cost budgets, with explicit limits on what these controls enforce.
- Align configuration, shared instructions, fixtures, and specs; replace structural-only exhaustion evidence with an isolated real-runtime integration test and a live-provider observation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-routing`: Primary continuity, bounded specialist recovery, interruption handoffs, and consistent policy across configuration surfaces.
- `context-budget`: Distinguish uncapped primary execution from bounded specialists, replacing the stale 60/40 table.

## Impact

Template, rendered repository configuration, primary frontmatter, routing, AGENTS, operator documentation, acceptance/profile tests, and a new isolated runtime check. No session supervisor, credential changes, model reassignment, deployment, or automatic installation. Installation remains an operator action. Runtime probes use temporary directories and never edit production defaults.
