# minimax-tier-split Specification

## Purpose

Declares the two execution-tier sub-tiers introduced to split the MiniMax
workload between the direct MiniMax API and the Ollama Cloud-served
MiniMax, names the agents that resolve to each tier, and requires the new
model id to resolve against the authenticated provider catalog.

## Requirements

### Requirement: Direct-MiniMax tier is reserved for spec-required implementation

The system SHALL assign `minimax/MiniMax-M3` to the global root `model`
and to the implementation step of the `spec-required` class only.

The system SHALL NOT assign `minimax/MiniMax-M3` to `build`, `general`,
`frontend`, `backend`, `qa`, `explore`, `p5t-installer`, `doctor`, or to
any agent outside `spec-required` implementation once the Ollama-MiniMax
tier is in place.

#### Scenario: root default stays on direct MiniMax

- **WHEN** OpenCode is started without an agent-specific override and
  without a `--model` flag
- **THEN** the root default model SHALL resolve to `minimax/MiniMax-M3`,
  served by the `minimax` provider

#### Scenario: spec-required implementation uses direct MiniMax

- **WHEN** the `spec-required` class transitions from the planning step
  (`openai/gpt-5.6-terra`) to the implementation step
- **THEN** the implementation step SHALL resolve to `minimax/MiniMax-M3`
  and SHALL NOT resolve to `ollama-cloud/minimax-m3`

### Requirement: Ollama-MiniMax tier carries the bounded execution agents

The system SHALL assign `ollama-cloud/minimax-m3` to `build`, `general`,
`frontend`, `backend`, and `qa`.

The system SHALL NOT assign `ollama-cloud/minimax-m3` to `architect`,
`orchestrator`, `refactor`, `adversarial`, `cotizador`, `plan`,
`explore`, `p5t-installer`, or `doctor`.

#### Scenario: build runs on Ollama-MiniMax

- **WHEN** the `build` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/minimax-m3`, served
  by the `ollama-cloud` provider, and SHALL NOT be `minimax/MiniMax-M3`

#### Scenario: qa runs on Ollama-MiniMax

- **WHEN** the `qa` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/minimax-m3` and
  SHALL NOT be `minimax/MiniMax-M3`

#### Scenario: frontend and backend run on Ollama-MiniMax

- **WHEN** the `frontend` or `backend` specialist is dispatched by `build`
- **THEN** the specialist model SHALL be `ollama-cloud/minimax-m3`

### Requirement: Ollama-MiniMax id must resolve against the catalog

The system SHALL declare only model ids that an authenticated provider
serves. `scripts/validate-config.mjs` SHALL treat `ollama-cloud/minimax-m3`
the same way it treats every other execution-tier id: verify the id
against the OpenCode models catalog when the catalog exists, and treat a
missing catalog as a skip with a printed notice that names
`ollama-cloud/minimax-m3` alongside the other Ollama Cloud ids.

#### Scenario: a present catalog validates the new id

- **WHEN** `~/.cache/opencode/models.json` exists and includes
  `ollama-cloud/minimax-m3`
- **THEN** the validator SHALL report `validate-config: OK` and exit zero

#### Scenario: a present catalog rejects a phantom id

- **WHEN** `~/.cache/opencode/models.json` exists but does not include
  `ollama-cloud/minimax-m3`
- **THEN** the validator SHALL exit non-zero and SHALL name the file
  (`opencode.jsonc` or the affected agent) and the unresolved id
  `ollama-cloud/minimax-m3`

#### Scenario: a missing catalog skips the check without failing install

- **WHEN** `~/.cache/opencode/models.json` does not exist
- **THEN** the validator SHALL print a skip notice that names
  `ollama-cloud/minimax-m3` and SHALL NOT fail the install
