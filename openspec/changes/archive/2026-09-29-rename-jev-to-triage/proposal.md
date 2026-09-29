## Why

The local decision specialist is currently exposed as `jev`, which names the
upstream provider rather than the role it performs. The operator-facing agent
name should communicate that it performs bounded triage and decision support.

## What Changes

- Rename the OpenCode subagent from `jev` to `triage`.
- Update model-profile coverage, dispatch permissions, acceptance checks,
  documentation, tests, and OpenSpec contracts to use `triage`.
- Keep the external SystemOne model id `typesafe/jev-1.13` unchanged.
- Move the audit log namespace from `.opencode/state/jev/` to
  `.opencode/state/triage/`.

## Impact

This is a breaking configuration rename for callers that explicitly dispatch
`agent: "jev"`; they must use `agent: "triage"`. The client source filename
and upstream model id remain Jev-named for implementation and provider
traceability.
