# Design

## Context

The refactor prompt and wrapper impose a worktree independently of scope. Sandbox control verifies runtime tests; it is distinct from checkout selection and routine Git operations.

## Goals / Non-Goals

Apply the same selection rule in repository instructions, routing, build, refactor and command entry points. Preserve existing test baseline, permissions, sandbox and worktree lifecycle mechanisms.

## Decisions

Use the active checkout by default. Consider overall change size and real concurrent development, including whether the active checkout already isolates the task. Continue independent work after a sandbox test is blocked and report the missing evidence. Keep mandatory runtime evidence explicit where release or acceptance requires it.

## Risks / Trade-offs

Workspace selection is a prompt-level control. Sandbox loading is enforced at the registered V2 entry points. Independently imposed project instructions and tool permissions can still affect execution. Static validation checks consistency but does not prove model compliance.

The native command retains the existing session and permission checks. The agent tool names and argument schemas remain available for compatibility, but start, build, rebuild, and transfer return the appropriate operator command instead of entering the lifecycle. Transfer uses this rule because it can start a replacement sandbox. Cleanup, evidence and probes retain their existing entry points.

Build and rebuild accept an omitted path and reuse the project configuration resolver. Rebuild pins the selected path before closing the old execution. Explicit paths retain their existing validation and never fall back. Transfer still requires its destination path.

This repository declares its sandbox in .opencode/sandbox.json. Dockerfile.sandbox uses the already pinned OpenCode fixture image and copies the sandbox and worktree plugins from the captured checkout. The declaration uses the local isolated-fixture-inputs capability to list only runtime sources, since a full capture hits test credential markers and store-local links. Preparation is an explicit source change, separate from runtime. No secrets, published ports, or fixture services are needed for the plugin loading environment.
