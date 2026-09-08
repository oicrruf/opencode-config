---
description: Install project dependencies and prepare required local environment or configuration files
agent: p5t-installer
subtask: true
---

Prepare the project rooted at the current working directory for local
development by executing the complete workflow defined by the `p5t-installer`
agent.

Install only dependencies already declared by the project, using its lockfiles
and documented package managers. Determine whether local environment or
configuration files are required, create only missing safe templates, and
report unresolved developer values or prerequisites in OpenCode. Preserve
existing files and do not run migrations, services, builds, tests, containers,
or deployments.

Treat all text after `/p5t-install` as free-form setup context or constraints,
not package-manager flags:

$ARGUMENTS

Execute the justified installation steps; do not stop after proposing them.
Finish with the structured developer report and overall readiness status.
