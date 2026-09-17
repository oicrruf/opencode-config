## Purpose

Make context consumption explicit and bounded: define default limits on
tool output, compaction behaviour, and per-agent step budgets so each
session has predictable cost without losing the trace required for
verification.

## ADDED Requirements

### Requirement: Tool output has explicit caps

The system SHALL set `tool_output.max_lines` to `400` and
`tool_output.max_bytes` to `16384` at the global scope. When a tool result
exceeds either cap the system SHALL truncate the response and write the
full output to the truncation directory, returning only a preview plus a
pointer to the truncated file.

The system SHALL allow per-agent overrides only to relax the caps for
agents whose primary work is high-volume inspection (for example
`explore`), and SHALL document each override with a one-line justification.

#### Scenario: large file read is truncated

- **WHEN** a `read` call returns a file with more than 400 lines
- **THEN** the response SHALL contain the first 400 lines, a footer naming
  the truncation path, and exactly one line describing why the rest was
  truncated

#### Scenario: explore can override the cap

- **WHEN** the user is searching across a large monorepo and the global
  `explore` agent dispatches a wide `grep`
- **THEN** the system MAY use a per-agent cap higher than 400 lines but
  SHALL log the override and the rationale

### Requirement: Compaction prunes old tool outputs by default

The system SHALL set `compaction.auto` to `true` and `compaction.prune` to
`true`. The system SHALL set `compaction.tail_turns` to `6` and
`compaction.preserve_recent_tokens` to `4000`. The system SHALL set
`compaction.reserved` to `2000` to leave a buffer for compaction overhead.

#### Scenario: long session auto-compacts

- **WHEN** the session approaches the model's context limit
- **THEN** the system SHALL compact older turns, prune stale tool outputs
  first, keep the most recent 6 user turns verbatim, and reserve at least
  2000 tokens of working room

### Requirement: Each agent declares a step budget

The system SHALL set an explicit `steps` value for every agent defined in
`opencode.jsonc`. The default budget per class is:

| Class                          | Default `steps` |
|--------------------------------|-----------------|
| `explore`, `qa` (targeted)     | 25              |
| `general`, `frontend`, `backend` | 40            |
| `build`, `cotizador`, `adversarial` (targeted) | 60 |
| `plan`, `architect`, `refactor`, `orchestrator`, `adversarial` (full), `cotizador` (full) | 100 |

When a session reaches its step limit the agent SHALL emit a structured
completion summary instead of looping.

#### Scenario: explore stops at its budget

- **WHEN** the `explore` agent has not produced a complete answer after 25
  iterations
- **THEN** it SHALL return a summary listing what was found, what was not,
  and the next recommended action

### Requirement: Operational metrics are observable

The system SHALL expose, through the existing OpenCode event bus or a
dedicated plugin, the following per-session counters: total input tokens,
total output tokens, tool-call count, subagent-dispatch count, class
distribution (`small` / `medium` / `spec-required` / `audit`), and
compaction events. The counters SHALL be queryable by the user with a single
command or slash invocation.

#### Scenario: build reports session metrics

- **WHEN** a `build` session ends
- **THEN** the final assistant message SHALL include the metrics block from
  the previous scenario in a single fenced code block
