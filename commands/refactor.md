---
description: Run a behavior-preserving refactor end-to-end - opens an OpenSpec change, creates a git worktree at `.opencode/worktree/<refactor-name>`, applies structural edits, and validates via the test suite. Refuses to start without a verifiable objective.
agent: refactor
subtask: true
---

The user invoked `/refactor` with the following objective:

$ARGUMENTS

If `$ARGUMENTS` is empty or vague, ask:

> "What do you want to refactor, and what behavior must be preserved?"

Do not invent an objective. A verifiable refactor target requires both a
structural change (what to extract, rename, move, split, or consolidate) AND
a preserved-behavior statement (which public surfaces or observable outputs
must remain unchanged). Reject pure stylistic edits with no acceptance
condition.

Execute the complete workflow defined by the global `refactor` agent: open
the OpenSpec change with `/opsx-propose` (minimum `proposal.md`
and `tasks.md` for a strict behavior-preserving refactor; add `design.md`
and a `specs/<capability>/spec.md` delta only when public interfaces shift),
pause for `/opsx-apply` or explicit user approval, capture the test
baseline, create the worktree at `.opencode/worktree/<refactor-name>/` on
branch `refactor/<refactor-name>`, apply atomic commits with focused tests
after each step and the full baseline suite after each commit (revert on any
new failure), dispatch to `adversarial` for a compatibility audit of the
worktree diff, and report per the agent's reporting format. If a
pre-existing OpenSpec change already covers this refactor, resume from where
the change left off instead of opening a new one.
