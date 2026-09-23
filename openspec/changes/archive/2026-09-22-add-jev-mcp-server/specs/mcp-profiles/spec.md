## MODIFIED Requirements

### Requirement: MCPs are scoped by agent

The system SHALL declare MCP availability per agent using the
`permission` field. The matrix below is the only allowed default.
Per-project overrides MAY add an MCP for one agent but SHALL NOT
remove the global minimum for any agent listed below.

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

#### Scenario: jev is only allowed to decision-capable agents

- **WHEN** the `plan` agent is active
- **THEN** `mcp__jev__jev_evaluate` IS advertised to the agent; when
  the same Jev MCP server is enabled, agents in the second row
  (`general`, `architect`, `refactor`, `orchestrator`) and below
  SHALL NOT see any `mcp__jev__*` tools

## ADDED Requirements

### Requirement: Decision-shaped models are exposed as MCP tools, never as chat-completion models

The system SHALL surface any model whose API is not a vanilla
OpenAI-compatible `/v1/chat/completions` (typed `{state, questions}`
request bodies, typed JSON answers, non-text outputs) as an MCP
server exposing one tool per model. The system MUST NOT attempt to
force such a model into a `provider.<name>.models` entry, because
the AI SDK's chat-completions pipeline cannot produce the model's
expected request shape and cannot parse its expected response shape.

The first concrete driver is the Jev decision model served by
OpenRouter at `POST /v1/systemone`; the rule generalizes to any
future System One model or any custom-decision endpoint that does
not speak the OpenAI shape.

#### Scenario: Jev appears as a tool, not in /models

- **WHEN** the user runs `/models` after the Jev MCP integration
  is applied
- **THEN** `openrouter/typesafe/jev-1.13` MUST NOT appear in the
  picker (the entry was removed in the same change's rollback),
  but `mcp__jev__jev_evaluate` MUST be advertised to the agents
  that are allowed to see Jev (`build`, `plan`, `adversarial`)

#### Scenario: A future decision-shaped model follows the same rule

- **WHEN** the project considers adding any model whose endpoint
  is not `/v1/chat/completions` (another System One model, a custom
  REST endpoint that returns typed JSON)
- **THEN** the integration MUST be wrapped as an MCP server
  exposing one tool per model, MUST be added to the per-agent
  matrix in this spec, and MUST NOT be added under
  `provider.<name>.models`

### Requirement: jev MCP server delegates to OpenRouter /v1/systemone

The local MCP server at `.opencode/mcp/jev/server.mjs` SHALL expose
exactly one tool, `jev_evaluate`. The tool SHALL accept a JSON
object with `state` (string | object | array) and `questions` (a
map of typed primitives named `noul`, `choice`, `score`) as input,
SHALL POST the request to
`https://openrouter.ai/api/v1/systemone` with
`Authorization: Bearer ${OPENROUTER_API_KEY}`, and SHALL return the
upstream `{model, answers, usage}` payload verbatim. The API key
SHALL be sourced from the opencode auth store via the MCP block's
`environment` field (`OPENROUTER_API_KEY: "{env:OPENROUTER_API_KEY}"`);
the server MUST NOT call any other endpoint, MUST NOT cache answers
across calls, and MUST NOT synthesize or transform the upstream
payload — every answer field the upstream omits MUST also be absent
in the tool output.

#### Scenario: A noul call round-trips

- **WHEN** an agent calls `mcp__jev__jev_evaluate` with
  `state: "Help! My payouts have been failing for 3 days."` and a
  single `noul` question whose id is `is_urgent` and
  `instructions: "Does this convey urgency?"`
- **THEN** the tool returns a JSON object whose `answers.is_urgent`
  is `{type: "noul", noul: <float in [0, 1]>}` matching the
  upstream `https://openrouter.ai/api/v1/systemone` response

#### Scenario: A choice call returns the full distribution

- **WHEN** an agent calls `mcp__jev__jev_evaluate` with a choice
  question `department` whose criteria map has three options
  (`billing`, `technical`, `sales`)
- **THEN** the tool returns a JSON object whose `answers.department`
  carries `{type: "choice", choice: <string>, probabilities: {billing,
  technical, sales}, confidence: <float>}`, where every probability
  is between 0 and 1 and the probabilities sum to 1 within
  floating-point tolerance

#### Scenario: Missing API key surfaces as a tool error

- **WHEN** the MCP server starts without `OPENROUTER_API_KEY` in
  its environment (no `/connect` for OpenRouter has been run)
- **THEN** any `mcp__jev__jev_evaluate` call returns a structured
  MCP error (code `-32000`) with a remediation hint naming
  `/connect` and the OpenRouter provider; the tool MUST NOT
  crash the server process, MUST NOT return a partial payload, and
  MUST NOT retry the request automatically
