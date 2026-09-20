---
description: Diagnose and repair the OpenCode environment via the doctor agent
agent: doctor
subtask: true
---

Diagnose and repair the OpenCode environment on the current host by
delegating to the `doctor` agent. Treat all text after `/doctor` as
free-form context (for example, "only check, do not install" or
"install the missing tools"), not as flags.

The agent always starts by running `node scripts/doctor.mjs
--check-only` and reporting the findings. If the request implies a
repair, the agent will prompt for explicit confirmation before
running `node scripts/doctor.mjs --apply-safe`. Anything that touches
a disabled MCP, credentials, or a pending OpenSpec proposal is left
to the operator to apply by hand.

End with the final tally and the doctor agent's overall status
(`healthy`, `repaired`, `manual-actions-required`, or `blocked`).

$ARGUMENTS
