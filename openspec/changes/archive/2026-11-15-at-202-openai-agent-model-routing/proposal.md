# Proposal

## Why

The repository currently routes different agents and commands to OpenAI, MiniMax, and Ollama Cloud. The operator has a ChatGPT Pro subscription and wants agent work to use OpenAI models consistently, with assignments that fit each role and no implicit switch to API billing.

## What Changes

- Assign only authenticated OpenAI model IDs to the root, `small_model`, every global agent, and every command with a model override in both install profiles.
- Use lighter OpenAI models for routine work, balanced OpenAI models for implementation, and higher-capability OpenAI models for durable or high-risk decisions.
- Update the routing matrix, agent guidance, commands, validator, profile tests, acceptance harness, and OpenSpec contracts to enforce OpenAI-only model assignments.
- Document ChatGPT Plus/Pro OAuth as the intended access path and distinguish plan usage from separate API billing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-routing`: require OpenAI-only model assignments and update routing tiers for agents, work classes, and commands.
- `installation-model-profiles`: require every model consumer in every profile and command override to use an authenticated OpenAI model ID.

## Impact

Affected files include `config/model-profiles.json`, `agent/routing.md`, agent and command frontmatter, `scripts/validate-config.mjs`, profile and acceptance tests, README/operator documentation, and the two capability specifications. No new dependencies or credentials are introduced; OpenCode's existing ChatGPT OAuth connection is used.
