---
description: Initialize coordination for two or more related projects from their parent directory
agent: p5t-orchestrator
subtask: true
---

Initialize or refresh multi-project coordination in the current working
directory using the complete workflow defined by the `p5t-orchestrator` agent.

Require at least two related child projects. Create only the parent `AGENTS.md`,
the parent workspace orchestration agents, and a minimal parent OpenCode config
when needed. Preserve every child project's `AGENTS.md`, `.opencode/`, OpenSpec
artifacts, source, dependencies, and Git state.

Treat all text after `/p5t-orchestrate` as free-form context about project
membership, relationships, contracts, or constraints, not shell flags:

$ARGUMENTS

Do not stop after proposing a layout. Write and validate the justified parent
coordination files, then report the projects, relationships, generated agents,
validation status, and any child that still needs `/p5t-init`.
