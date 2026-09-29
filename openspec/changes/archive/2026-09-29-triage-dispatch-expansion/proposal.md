## Why

Architectural, orchestration, and behavior-preserving refactor work also
contains bounded decisions about scope, risk, and alternatives. Triage can
provide useful advisory input for those agents without becoming mandatory.

## What Changes

Authorize `architect`, `orchestrator`, and `refactor` to dispatch `triage`.
Update permissions, prompts, acceptance checks, and routing specifications.
The non-blocking behavior remains in force when Triage is unavailable.
