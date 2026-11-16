# Spec Delta

## MODIFIED Requirements

### Requirement: MCPs are scoped by agent

The system SHALL declare MCP availability per agent using the `permission`
field. The matrix below is the only allowed default. Per-project overrides
MAY add an MCP for one agent but SHALL NOT remove the global minimum for any
agent listed below. The Composio server SHALL be declared in every installed
profile and its tools SHALL use interactive approval for all agents other than
the MCP-denied `triage` decision agent. OAuth credentials SHALL remain in
OpenCode's credential store and SHALL NOT be written to repository-managed
configuration.

| Agent | codegraph | context7 | serena | playwright | composio |
|---|---|---|---|---|---|
| `build`, `plan` | allow | allow | deny | deny | ask |
| `general`, `architect`, `refactor`, `orchestrator` | allow | allow | deny | deny | ask |
| `explore` | allow | deny | deny | deny | ask |
| `frontend`, `qa` | allow | deny | deny | allow | ask |
| `backend` | allow | allow | deny | deny | ask |
| `adversarial` (full) | allow | allow | deny | allow | ask |
| `cotizador` | allow | deny | deny | allow | ask |
| `p5t-installer`, `doctor` | allow | allow | deny | deny | ask |
| `triage` | deny | deny | deny | deny | deny |

#### Scenario: serena is denied to non-refactor agents
- **WHEN** the `build` agent runs
- **THEN** the system SHALL NOT expose `serena_*` tools to the agent even if
  the MCP server is started

#### Scenario: playwright is only allowed for visual specialists
- **WHEN** the `qa` agent runs in `targeted` mode
- **THEN** the system SHALL allow `playwright_*` tools; when the same agent
  runs in `targeted` mode without visual checks the system SHALL still allow
  the tools so the agent can self-decide

#### Scenario: Triage is available only to decision-capable agents
- **WHEN** any configured agent is active
- **THEN** the system SHALL NOT advertise any `mcp__jev__*` tool because Triage
  is consulted as a bounded subagent rather than an MCP server

#### Scenario: Composio is preserved in installed profiles
- **WHEN** the operator installs the `personal` or `work` profile
- **THEN** the generated configuration SHALL contain the enabled remote MCP
  named `composio` at `https://connect.composio.dev/mcp`

#### Scenario: Agents can request Composio tools safely
- **WHEN** any configured agent except `triage` invokes a Composio tool
- **THEN** OpenCode SHALL request interactive approval before executing it

#### Scenario: Rendered configuration excludes OAuth credentials
- **WHEN** the installer renders the managed configuration
- **THEN** the generated file SHALL contain the public Composio URL but SHALL
  NOT contain OAuth tokens or client secrets
