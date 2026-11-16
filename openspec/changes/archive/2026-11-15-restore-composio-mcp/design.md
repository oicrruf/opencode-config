# Design

## Context

The installation renderer owns the installed root OpenCode configuration. Its template currently declares the local and remote MCP servers, so any server absent from that template is removed on the next install. See proposal.md for the incident and requirements.

## Goals / Non-Goals

**Goals:**
- Keep the Composio endpoint in every generated profile configuration.
- Allow agents to request Composio tools with interactive approval.
- Keep OAuth material in OpenCode's own credential store.

**Non-Goals:**
- Store or migrate OAuth credentials in the repository.
- Automatically approve external actions or infer provider-level access from MCP connectivity.
- Change model assignments.

## Decisions

- Declare the public Composio endpoint in the shared OpenCode template so all profiles inherit it.
- Grant the `composio_*` tool pattern with `ask` in agent permissions. This makes Composio usable across agents and subagents while preserving per-call operator approval for external actions.
- Extend structural validation to require the exact server name, remote type, and URL, but do not require live OAuth during install. Authentication is operator state and installation must remain usable before login.
- Restore the active runtime configuration through the supported installer/CLI path, then use `opencode mcp list` to verify connection state. If OAuth is still required, initiate the supported `opencode mcp auth composio` flow.

## Risks / Trade-offs

- [Composio tools can affect connected external services] → Use `ask` permission for every Composio tool invocation.
- [The existing OAuth token may have expired or been cleared] → Check live MCP status after installation and complete the supported OAuth flow if required; do not place tokens in configuration files.

## Migration Plan

1. Update the managed template, agent permissions, validation, and documentation.
2. Run required repository checks and install the personal profile.
3. Confirm `opencode mcp list` reports Composio connected; if it requests authentication, run the OAuth flow and recheck.
4. Roll back repository changes and reinstall the previous version if the template fails validation. The existing timestamped backup remains available for manual recovery.
