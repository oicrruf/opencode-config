## MODIFIED Requirements

### Requirement: MCPs are scoped by agent

The system SHALL declare MCP availability per agent using the `permission`
field. The matrix below is the only allowed default. Per-project overrides
MAY add an MCP for one agent but SHALL NOT remove the global minimum for
any agent listed below.

| Agent                | codegraph | context7 | serena | playwright | jev |
|----------------------|-----------|----------|--------|------------|-----|
| `build`, `plan`      | allow     | allow    | deny   | deny       | allow |
| `general`, `architect`, `refactor`, `orchestrator` | allow | allow | deny | deny | deny |
| `explore`            | allow     | deny     | deny   | deny       | deny |
| `frontend`, `qa`     | allow     | deny     | deny   | allow      | deny |
| `backend`            | allow     | allow    | deny   | deny       | deny |
| `adversarial` (full) | allow     | allow    | deny   | allow      | allow |
| `cotizador`          | allow     | deny     | deny   | allow      | deny |

#### Scenario: serena is denied to non-refactor agents

- **WHEN** the `build` agent runs
- **THEN** the system SHALL NOT expose `serena_*` tools to the agent even if
  the MCP server is started

#### Scenario: playwright is only allowed for visual specialists

- **WHEN** the `qa` agent runs in `targeted` mode
- **THEN** the system SHALL allow `playwright_*` tools; when the same agent
  runs in `targeted` mode without visual checks the system SHALL still allow
  the tools so the agent can self-decide

#### Scenario: Jev is available only to decision-capable agents

- **WHEN** `build`, `plan`, or `adversarial` is active
- **THEN** `mcp__jev__jev_evaluate` SHALL be advertised; every other agent
  in the matrix SHALL NOT see any `mcp__jev__*` tool

## ADDED Requirements

### Requirement: Typed decision endpoints use a local MCP adapter

The system SHALL expose a typed decision endpoint that does not implement
OpenAI chat completions through a local MCP tool rather than through
`provider.<name>.models` or OpenRouter's hosted discovery MCP. The adapter
SHALL preserve the endpoint's typed request and response contracts.

For Jev, the only exposed tool SHALL be `jev_evaluate`; it SHALL forward a
`state` and named typed `questions` to OpenRouter SystemOne and return the
structured `{model, answers, usage}` result. OpenRouter's hosted MCP MAY
be configured separately for catalog or billing discovery, but it SHALL
NOT be treated as a substitute for Jev evaluation because its tool list
does not include generic SystemOne requests.

#### Scenario: Jev is a tool rather than a chat model

- **WHEN** an allowed agent needs a calibrated decision such as classifying
  a proposed change as `fix`, `feat`, or `chore`
- **THEN** the agent SHALL call `mcp__jev__jev_evaluate` with a `choice`
  question and SHALL NOT select `typesafe/jev-1.13` as its own chat model

#### Scenario: Supported primitives retain their response shapes

- **WHEN** the tool receives a valid `noul`, `choice`, or `score` question
- **THEN** it SHALL return the upstream answer unchanged, including `noul`,
  or `choice`/`score` probabilities and confidence where supplied

### Requirement: Jev MCP startup, authentication, and failure paths are bounded

The rendered `mcp.jev` command SHALL resolve the local server through an
absolute path derived from the installed repository root, so launching
OpenCode from an unrelated project directory SHALL still start the server.
The server SHALL resolve its API key from `OPENROUTER_API_KEY` first and
then from the existing per-user OpenCode `openrouter` auth entry when the
environment value is absent. It MUST NOT write the key to stdout, stderr,
the rendered config, or any tracked file.

The server SHALL answer MCP initialization and `tools/list` requests
without contacting OpenRouter. For an evaluation request, it SHALL impose
an upstream deadline shorter than OpenCode's 30-second tool timeout and
return a structured tool error (including a remediation hint for missing
credentials) instead of leaving the caller to time out.

#### Scenario: OpenCode starts from another project directory

- **WHEN** OpenCode is launched with a current working directory outside
  this configuration repository
- **THEN** the local Jev server SHALL start and respond to `tools/list`
  without the prior 30-second startup timeout

#### Scenario: No credential is available

- **WHEN** neither `OPENROUTER_API_KEY` nor a valid OpenCode `openrouter`
  auth entry is available
- **THEN** `jev_evaluate` SHALL return a structured tool error that directs
  the operator to `/connect` for OpenRouter, without issuing an upstream
  request or terminating the MCP process

#### Scenario: OpenRouter is slow or unreachable

- **WHEN** the upstream SystemOne request cannot complete before the
  wrapper's internal deadline
- **THEN** `jev_evaluate` SHALL return a structured tool error before
  OpenCode's 30-second operation timeout, and the MCP process SHALL remain
  usable for the next request
