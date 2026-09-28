## Why

The Jev local MCP continues to time out in OpenCode despite protocol fixes,
while its underlying SystemOne endpoint succeeds when called directly. A
bounded decision agent can use that endpoint without participating in MCP
startup and provide calibrated recommendations without spending a general
agent's context on routine triage.

## What Changes

- Add a read-only `jev` subagent that submits strict typed decision requests
  to OpenRouter SystemOne through a local client, not an MCP server.
- Support effort, risk, priority, change classification, proposal review,
  and architecture-option evaluation with a recommendation and confidence.
- Require the agent to select the best available option when evidence is
  sufficient; otherwise report uncertainty and the missing decision-critical
  information.
- Remove the Jev MCP server, its agent permissions, and its generated-config
  wiring so OpenCode no longer waits for its startup timeout.
- **BREAKING**: `mcp__jev__jev_evaluate` will no longer be available; callers
  consult the `jev` subagent through the bounded dispatch contract instead.

## Capabilities

### New Capabilities

- `jev-decision-agent`: Calibrated, read-only SystemOne consultation for
  structured engineering decisions and explicit recommendations.

### Modified Capabilities

- `agent-routing`: Add Jev to the routing and cost-tier policy as a bounded,
  non-delegating decision specialist.
- `mcp-profiles`: Retire Jev's MCP exposure and startup contract while keeping
  the remaining MCP policy unchanged.

## Impact

- New global agent definition and local SystemOne client.
- `config/model-profiles.json`, `config/opencode.template.jsonc`, rendering
  and validation scripts, plus configuration documentation.
- Removal of `.opencode/mcp/jev/` and `mcp.jev` permissions/configuration.
