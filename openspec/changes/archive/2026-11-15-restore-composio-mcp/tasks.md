# Tasks

## 1. Configuration and permissions

- [x] 1.1 Add the Composio remote MCP to the shared template and grant `composio_*: ask` to every agent except Triage; verify rendered output and agent frontmatter match `agent/routing.md`.
- [x] 1.2 Extend configuration validation and profile tests to reject a missing, disabled, or wrong-URL Composio entry; verify the tests fail for altered fixtures and pass for valid profiles.
- [x] 1.3 Document Composio's managed endpoint and OAuth credential boundary; verify the install documentation describes how to authenticate without storing tokens in the repository.

## 2. Integration verification

- [x] 2.1 Run the required validation gates and install check; verify both profiles render Composio and the installed state is synchronized.
- [x] 2.2 Verify live Composio status with `opencode mcp list`; if authentication is requested, complete `opencode mcp auth composio` and verify the server reports connected.
