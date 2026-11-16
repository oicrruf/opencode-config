# Spec Delta

## ADDED Requirements

### Requirement: Profile installation preserves the required Composio MCP

The installer SHALL include the required Composio remote MCP server in every generated model-profile configuration and SHALL validate its server name and endpoint before replacing the installed configuration.

#### Scenario: Render a supported profile
- **WHEN** installation renders any supported model profile
- **THEN** the validated generated configuration SHALL include `composio` at `https://connect.composio.dev/mcp`

#### Scenario: The required Composio configuration is missing or invalid
- **WHEN** validation finds that the Composio server is absent or has a different endpoint
- **THEN** installation SHALL fail before replacing the installed root configuration and SHALL identify the Composio configuration error
