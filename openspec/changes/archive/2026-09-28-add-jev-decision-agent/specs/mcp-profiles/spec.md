## MODIFIED Requirements

### Requirement: MCPs are scoped by agent

The system SHALL declare MCP availability per agent using the `permission`
field. The matrix below is the only allowed default. Per-project overrides
MAY add an MCP for one agent but SHALL NOT remove the global minimum for any
agent listed below.

| Agent                | codegraph | context7 | serena | playwright |
|----------------------|-----------|----------|--------|------------|
| `build`, `plan`      | allow     | allow    | deny   | deny |
| `general`, `architect`, `refactor`, `orchestrator` | allow | allow | deny | deny |
| `explore`            | allow     | deny     | deny | deny |
| `frontend`, `qa`     | allow     | deny     | deny | allow |
| `backend`            | allow     | allow | deny | deny |
| `adversarial` (full) | allow     | allow | deny | allow |
| `cotizador`          | allow     | deny | deny | allow |
| `jev`                | deny | deny | deny | deny |

#### Scenario: serena is denied to non-refactor agents

- **WHEN** the `build` agent runs
- **THEN** the system SHALL NOT expose `serena_*` tools to the agent even if
  the MCP server is started

#### Scenario: playwright is only allowed for visual specialists

- **WHEN** the `qa` agent runs in `targeted` mode
- **THEN** the system SHALL allow `playwright_*` tools; when the same agent
  runs in `targeted` mode without visual checks the system SHALL still allow
  the tools so the agent can self-decide

#### Scenario: Jev is available only to decision-capable agents

- **WHEN** any configured agent is active
- **THEN** the system SHALL NOT advertise any `mcp__jev__*` tool because Jev
  is consulted as a bounded subagent rather than an MCP server

## REMOVED Requirements

### Requirement: Typed decision endpoints use a local MCP adapter

**Reason**: The local Jev MCP fails OpenCode startup despite direct SystemOne
requests succeeding, so the transport is not a reliable consultation path.

**Migration**: Dispatch the read-only `jev` subagent with a bounded decision
brief instead of calling `mcp__jev__jev_evaluate`.

### Requirement: Jev MCP startup, authentication, and failure paths are bounded

**Reason**: Jev is no longer an MCP server and its startup, authentication,
and tool-timeout behavior no longer applies to OpenCode's MCP lifecycle.

**Migration**: Use the local direct SystemOne client owned by the `jev`
subagent; it retains environment-first authentication and never exposes keys.
