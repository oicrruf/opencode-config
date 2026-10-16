# Design

## Context

See `proposal.md` for motivation. The existing routing contract bounds adversarial review and permits a focused re-review, but an incomplete verdict currently asks for an operator decision. The desired human decision point is the PR review, after agents finish their coordinated work.

## Goals / Non-Goals

**Goals:**
- Establish a clear PR-ready handoff after required agent work and verification.
- Preserve accurate reporting of incomplete verification and unresolved findings for human review.

**Non-Goals:**
- Automatically approve, merge, or publish a PR.
- Relax the required implementation checks or conceal a material risk.
- Change the existing risk-based criteria for when adversarial review is required.

## Decisions

- Treat PR readiness as the agent workflow's completion boundary, distinct from human approval or merge. This aligns autonomy with the stated human-in-PR review process.
- Carry unresolved material risks into the PR-ready summary rather than prompting for a separate pre-PR human decision. Alternatives that block or silently dismiss risk contradict the intended handoff or weaken review integrity.
- Keep existing focused review limits and verification requirements; adjust coordinator/reviewer instructions only as needed to make the handoff actionable.
- Reconcile implementation with the existing dirty worktree before editing affected files; do not replace or discard unrelated pending changes.

## Risks / Trade-offs

- Surfacing a serious unresolved risk without blocking PR readiness could be misread as endorsement. Mitigation: state explicitly that the PR is ready for human review, not approved, and prominently list unresolved risks.
- Existing local edits overlap likely implementation files. Mitigation: inspect and preserve their diffs during apply; do not overwrite them.
