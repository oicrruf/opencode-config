# OpenCode configuration

This repository is the canonical, version-controlled global OpenCode setup.
It provides autonomous permissions, global role agents, reusable commands and
skills, and Herdr integration.

## Install on WSL/Linux

```bash
git clone https://github.com/oicrruf/opencode-config.git ~/Projects/opencode-config
~/Projects/opencode-config/install.sh
```

The installer creates symbolic links under `~/.config/opencode`. It refuses to
replace existing non-link paths. The Herdr-managed plugin is left untouched.

Restart OpenCode after installing or pulling changes, because configuration is
loaded only at startup.

## Update

```bash
git -C ~/Projects/opencode-config pull --ff-only
```

The links point to the clone, so no reinstall is needed after a successful
pull. Restart OpenCode to use the update.

## Code intelligence

CodeGraph is the default MCP for daily navigation and impact analysis. Serena
is reserved for behavior-preserving semantic refactors. Install and initialize
both prerequisites before starting OpenCode:

```bash
npm install -g @colbymchenry/codegraph
codegraph telemetry off
uv tool install -p 3.13 serena-agent
serena init
```

`/p5t-init` creates the local `.codegraph/` index with telemetry disabled.
OpenCode must restart before a newly created index is exposed through MCP.
Serena starts without an active project and creates project state only when
`build` activates it for an identified behavior-preserving refactor.

## Initialize a project

Run the global bootstrap command from a project's repository root:

```text
/p5t-init
```

The `architect` agent inspects the stack and existing project configuration,
initializes OpenSpec for OpenCode when needed, updates `AGENTS.md`, and creates
only the project-specific agents justified by the repository. It writes the
configuration automatically, verifies it, and reports optional skill or MCP
improvements separately so dependencies and services are never enabled without
approval.

OpenSpec is available in every initialized project, but artifacts are
proportional to the work. The global `plan` and `build` agents classify each
request as:

- `small`: direct implementation and focused verification.
- `medium`: short plan, implementation, and relevant verification.
- `spec-required`: OpenSpec proposal and apply workflow before implementation.

Features, observable behavior changes, APIs, schemas, migrations, external
integrations, security or compatibility work, architectural refactors, and
materially ambiguous requests are `spec-required`. Existing OpenSpec changes
remain authoritative for their scope. If direct work grows into that category,
the agent stops before expanding it and asks to create or update the change.

Install the dependencies and prepare missing local configuration afterward:

```text
/p5t-install
```

The `p5t-installer` follows project lockfiles and documented setup commands. It
never upgrades dependencies, overwrites existing local configuration, invents
secrets, or runs migrations and services. Its final OpenCode report lists
commands executed, files created, missing values, prerequisites, and overall
readiness.
