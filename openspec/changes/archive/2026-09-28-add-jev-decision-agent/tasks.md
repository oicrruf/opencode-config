## 1. Retire the unreliable MCP path

- [x] 1.1 Remove Jev MCP server files, rendered `mcp.jev` configuration, and
  Jev MCP permissions; verify the rendered config contains no Jev MCP entry
  and retains unrelated MCP servers.

## 2. Build bounded Jev consultation

- [x] 2.1 Implement a local direct SystemOne client that accepts only the
  documented decision envelope, resolves OpenRouter credentials without
  emitting them, and returns structured recommendation or uncertainty output;
  verify fixture success, invalid input, unavailable upstream, and no-key
  paths without network access.
- [x] 2.2 Add the read-only value-tier `jev` subagent with a strict prompt and
  least-privilege permissions; verify it permits only its direct client and
  cannot edit, delegate, or access MCP tools.
- [x] 2.3 Extend model-profile rendering, configuration validation, acceptance
  checks, and documentation for Jev's bounded dispatch contract; verify both
  profiles remain complete and static-policy tests cover the new agent.

## 3. Verify and install

- [x] 3.1 Run focused client tests, syntax checks, `validate-config`,
  model-profile tests, acceptance harness, and strict OpenSpec validation;
  verify all pass before installation.
- [x] 3.2 Render and install the personal profile, restart OpenCode, and
  verify Jev is available as a subagent while the MCP status no longer lists
  Jev or reports its 30-second timeout.
