# Spec Delta

## ADDED Requirements

### Requirement: Agents opt in to the value tier when no implementation work is required

The system SHALL assign `ollama-cloud/gpt-oss:20b` to `explore`,
`p5t-installer`, and `doctor` regardless of the work classification
because none of those roles perform implementation. The value tier is
the cheapest tier and the routing matrix SHALL treat these agents as
default-value consumers.

#### Scenario: explore runs on the value tier

- **WHEN** the global `explore` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` (or
  the explicitly user-selected override) and SHALL NOT be
  `openai/gpt-5.6-terra`

#### Scenario: doctor runs on the value tier

- **WHEN** the global `doctor` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` and
  SHALL NOT be `openai/gpt-5.6-terra`

#### Scenario: p5t-installer runs on the value tier

- **WHEN** the global `p5t-installer` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` and
  SHALL NOT be `openai/gpt-5.6-terra`
