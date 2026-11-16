# Proposal

## Why

Managed worktree creation currently records the directory and branch but does not verify that the effective MCP configuration is usable from that actual directory or prepare any required local credential files. Global configuration alone is not evidence of a connected provider, while indiscriminate copying can expose unrelated secrets or alter disabled-server policy.

## What Changes

- Add a worktree preparation capability that inspects effective MCP configuration from the created or reused worktree and reports configuration presence separately from provider connectivity.
- Resolve which enabled servers require local files without enabling disabled servers or imposing a fixed provider allowlist.
- Reuse authorized global credentials; when local materialization is necessary, copy only a minimal allowlist with restrictive permissions and safe regular-file/path checks.
- Record ownership of files created by preparation and refuse worktree retirement until those credential files are explicitly moved or deleted, because the removal API cannot atomically protect them from concurrent changes.
- Make incomplete preparation blocked and resumable, and never copy `.env`, whole ignored directories, unrelated secrets, or credential values into reports.
- Use a descriptor-relative helper only when local materialization or owned-file verification is required; if Python 3 or the platform's required `dir_fd`/no-follow capabilities are unavailable, fail closed without installing or provisioning anything.

## Capabilities

### New Capabilities

- `worktree-mcp-preparation`: inspection and safe preparation of MCP configuration and minimal local credentials for managed worktrees, including ownership and cleanup.

### Modified Capabilities

- None. Existing MCP profile policy remains authoritative; this change adds worktree-local readiness behavior without changing agent MCP permissions or server activation rules.

## Impact

- `plugins/worktree-control/creation.mjs` and retirement flow/checks; new focused MCP configuration and credential preparation modules under `plugins/worktree-control/`.
- `config/opencode.template.jsonc` only if the managed control tool surface requires a narrowly scoped addition.
- Worktree-control tests, static validation/acceptance coverage, and operator documentation.
- Local filesystem paths and OpenCode effective configuration; conditionally uses the host's existing Python 3 standard library for descriptor-relative file operations, without installing dependencies or storing credentials in repository state.
