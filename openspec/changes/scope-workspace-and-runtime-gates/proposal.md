# Proposal

## Why

OpenCode can conflate test environment readiness with development readiness. The refactor workflow also requires a separate worktree for every change.

## What Changes

- Continue ordinary development in the current checkout when size and concurrent work do not call for isolation.
- Load or replace a sandbox only through the user-invoked native command. Continue ordinary work without a sandbox.
- Let build and rebuild discover the checkout configuration by default.
- Commit-ready project configuration and a Docker recipe let this repository declare its own plugin runtime.

## Capabilities

### Modified Capabilities

- `agent-routing`: choose the workspace independently from runtime verification.
- `docker-test-sandbox`: require user command invocation for loading or replacement.

## Impact

Repository instructions, installed agent prompts and the sandbox plugin entry points.
