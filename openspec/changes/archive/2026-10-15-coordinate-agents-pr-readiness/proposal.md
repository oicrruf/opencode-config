# Proposal

## Why

The delivery workflow currently treats an adversarial review's unresolved operator decision as a stop before delivery. Human approval is intended to happen during PR review, so agents should coordinate the necessary implementation and verification, communicate residual uncertainty, and announce when the PR is ready for human review.

## What Changes

- Define autonomous agent coordination through a clear PR-ready handoff, including transparent reporting of unresolved risks.
- Keep human review and approval at the PR stage; do not imply that unverified risks were verified or silently waive them.
- Clarify how adversarial findings and verification limits affect reaching the PR-ready state.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-routing`: Define coordination through PR readiness and treat the PR as the human review handoff rather than requiring a separate pre-PR human approval.

## Impact

Potentially affects `agent/adversarial.md`, `agent/build.md`, `agent/qa.md`, `agent/routing.md`, the `agent-routing` spec, and its acceptance coverage. Existing uncommitted changes in these files must be preserved and reconciled rather than overwritten.
