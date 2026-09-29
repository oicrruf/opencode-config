## Decision

Add task-dispatch permission only to `architect`, `orchestrator`, and
`refactor`, and extend the explicit allowlist. Keep execution agents such as
`doctor`, `qa`, `frontend`, and `backend` excluded because they should use
local evidence or execute established decisions.

Triage remains advisory and optional; no caller may make its availability a
precondition for completing work.
