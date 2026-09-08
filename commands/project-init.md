---
description: Initialize or refresh project-specific OpenCode agents, coordination, and OpenSpec integration
agent: architect
subtask: true
---

Initialize or refresh this project's OpenCode architecture configuration.

Analyze the repository rooted at the current working directory and execute the
complete bootstrap workflow defined by the `architect` agent. Create or update
the required OpenSpec setup, `AGENTS.md`, and the smallest useful set of local
specialists under `.opencode/agents/`. Preserve existing project configuration
and do not edit product code.

Treat all text after `/project-init` as free-form project context or constraints
(for example, package ownership or deployment boundaries), not as command-line
flags:

$ARGUMENTS

Do not stop after presenting a proposal. Write the justified project files,
verify them, and report what changed. Recommendations that install software,
enable MCPs, add secrets, or expand beyond configuration remain suggestions and
require user approval.

End by asking whether the user wants the optional improvements applied or
prefers to keep the current configuration because it is already correct.
