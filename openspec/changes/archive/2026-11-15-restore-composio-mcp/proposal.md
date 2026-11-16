# Proposal

## Why

The personal profile installation replaced the previous global OpenCode configuration without preserving Composio, removing a remote MCP required by the user's workflow. The repository must manage this server as part of the installed configuration so future profile installs do not disconnect it again.

## What Changes

- Include the Composio remote MCP endpoint in the managed OpenCode configuration.
- Preserve user-held OAuth credentials outside the repository and make the server available after profile installation.
- Document and validate the Composio MCP contract alongside existing MCP profile rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-profiles`: Require the Composio remote server in the installed configuration and make it available to configured agents.
- `installation-model-profiles`: Require generated configurations for every model profile to retain Composio.

## Impact

Affected files include the OpenCode template, agent permission declarations, MCP validation and tests, and operator documentation. Runtime OAuth remains in OpenCode's credential store; the repository stores only the public server URL.
