# mcp-profiles Specification

## Purpose

Replace the current "all MCPs enabled for every session" stance with an
explicit, agent-scoped policy: each agent exposes only the MCPs it needs,
and the migration from the deprecated `tools` field to `permission` makes
that exposure verifiable.

## Requirements

### Requirement: MCPs are scoped by agent

The system SHALL declare MCP availability per agent using the `permission`
field. The matrix below is the only allowed default. Per-project overrides
MAY add an MCP for one agent but SHALL NOT remove the global minimum for any
agent listed below.

| Agent                | codegraph | context7 | serena | playwright |
|----------------------|-----------|----------|--------|------------|
| `build`, `plan`      | allow     | allow    | deny   | deny |
| `general`, `architect`, `refactor`, `orchestrator` | allow | allow | deny | deny |
| `explore`            | allow     | deny     | deny | deny |
| `frontend`, `qa`     | allow     | deny     | deny | allow |
| `backend`            | allow     | allow | deny | deny |
| `adversarial` (full) | allow     | allow | deny | allow |
| `cotizador`          | allow     | deny | deny | allow |
| `triage`                | deny | deny | deny | deny |

#### Scenario: serena is denied to non-refactor agents

- **WHEN** the `build` agent runs
- **THEN** the system SHALL NOT expose `serena_*` tools to the agent even if
  the MCP server is started

#### Scenario: playwright is only allowed for visual specialists

- **WHEN** the `qa` agent runs in `targeted` mode
- **THEN** the system SHALL allow `playwright_*` tools; when the same agent
  runs in `targeted` mode without visual checks the system SHALL still allow
  the tools so the agent can self-decide

#### Scenario: Triage is available only to decision-capable agents

- **WHEN** any configured agent is active
- **THEN** the system SHALL NOT advertise any `mcp__jev__*` tool because Triage
  is consulted as a bounded subagent rather than an MCP server

### Requirement: Global permission baseline is deny by default

The system SHALL replace `permission: "allow"` with a baseline that denies
high-risk tools (`bash`, `task`, `external_directory`, `webfetch`,
`websearch`, and editing tools) and grants only the minimum needed for
each role. The `p5t-installer`, `architect`, and `refactor` agents MAY
receive broader permissions, and each override SHALL be documented inline.

#### Scenario: plan cannot edit files

- **WHEN** the `plan` agent is active
- **THEN** any `edit` or `write` call SHALL be refused with a structured
  error and the system SHALL suggest the user switch to `build`

#### Scenario: install script needs explicit shell allowance

- **WHEN** the `p5t-installer` agent runs and the user has approved its plan
- **THEN** the system SHALL allow `bash` only for the install command
  categories declared in `agent/p5t-installer.md`

### Requirement: Deprecated `tools` field is migrated

The system SHALL migrate every agent that currently declares `tools` (in
either `opencode.jsonc` or the agent's frontmatter) to the equivalent
`permission` rule. The `tools` field SHALL be removed once the migration
is complete and the OpenCode version in use supports per-agent `permission`
for MCP-gated tools.

#### Scenario: frontmatter migration is verified

- **WHEN** a project upgrades to a build that supports per-agent MCP
  permissions
- **THEN** the system SHALL validate that no agent declares `tools` and
  SHALL refuse to start if any declaration remains

### Requirement: MCP startup respects the policy

The system SHALL start only the MCP servers required by the union of
enabled agents in the current session. If a session activates no agent
that needs Playwright, the Playwright MCP SHALL NOT be started.

#### Scenario: pure build session skips Playwright

- **WHEN** the user starts a session that only invokes `build` against a
  backend project
- **THEN** the Playwright MCP process SHALL NOT appear in the process list
  and the `playwright_*` tools SHALL NOT be advertised to the agent

### Requirement: Successful install implies every required gate passed

The `install.sh` script SHALL run, immediately after the symlink
phase, a post-install verification block that exercises the project's
required gates. When `./install.sh` returns zero, every required gate
SHALL have passed against the just-installed configuration. When any
required gate fails, `install.sh` SHALL return non-zero and SHALL
print the failing gate's name and a remediation hint.

#### Scenario: Clean install

- **WHEN** the operator runs `./install.sh` from a healthy checkout
  with no opt-out env vars set
- **THEN** the script exits zero, prints a "X/Y gates passed"
  summary, and the installed `~/.config/opencode` is unchanged by any
  subsequent gate failure

#### Scenario: A required gate fails

- **WHEN** the static `acceptance-harness.mjs` reports any failure
- **THEN** `install.sh` SHALL exit non-zero, name the failing gate,
  and leave the previously installed config (if any) intact

### Requirement: Each gate is independently opt-out

The post-install block SHALL honor `OPENCODE_SKIP_ACCEPTANCE`,
`OPENCODE_SKIP_PROFILE_TESTS`, `OPENCODE_SKIP_JEV_CLIENT_TESTS`, and
`OPENCODE_SKIP_OPENSPEC_VALIDATE` so the operator can run a partial
install. A skipped gate SHALL be printed in the summary, counted as
"skipped" instead of "passed", and SHALL NOT cause a non-zero exit.

#### Scenario: Skip the runtime acceptance harness

- **WHEN** `OPENCODE_SKIP_ACCEPTANCE=1 ./install.sh` runs on a
  checkout where the static harness would fail
- **THEN** the script exits zero, prints `acceptance-harness:
  skipped`, and does not run that gate

### Requirement: Summary line is the last line on success

`install.sh` SHALL print, on success, a single trailing line of the
form `install.sh: OK — <passed>/<required> gates passed (<skipped>
skipped)` so the operator can grep for it in CI logs.

#### Scenario: CI consumes the summary

- **WHEN** CI runs `./install.sh` and captures stdout
- **THEN** the last line matches the documented `OK — ...` format
  when the install is healthy, and is absent (or replaced with an
  error line) when the install fails
