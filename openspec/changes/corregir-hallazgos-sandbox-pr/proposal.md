# Proposal

## Why

PR #3 exposed security and lifecycle defects in sandbox capture, reservation recovery, deadline enforcement, and cleanup. Most contradict existing contracts; secret-path re-inclusion was underspecified and needs an explicit non-overridable rule.

## What Changes

- Make sensitive capture exclusions mandatory even when project configuration requests an explicit include, including symlink targets.
- Correct managed-worktree V2 routing, conservative reservation recovery, detached deadline closure, recoverable failed-start responses, internal symlink capture, report screening, capture cleanup, and capture fingerprints.
- Add regressions for every review finding.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `docker-test-sandbox`: sensitive paths cannot be re-included through project-controlled configuration.

## Impact

Sandbox-control capture, lifecycle, reservation, V2 registration, worktree inventory integration, tests, and the sandbox contract. No new dependency or global configuration activation.
