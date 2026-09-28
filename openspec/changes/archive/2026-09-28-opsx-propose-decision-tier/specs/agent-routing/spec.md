# Spec Delta

## ADDED Requirements

### Requirement: /opsx-propose runs on the decision tier regardless of the invoking agent

The `/opsx-propose` global command SHALL declare `model:
openai/gpt-5.6-terra` in its frontmatter so the proposal is generated
on the decision tier even when the agent that invoked it runs on a
cheaper tier (typically `plan` on `gpt-5.6-luna`). The proposal
quality sets the ceiling for the implementation that follows, so
running it on a cheaper tier would let a weaker model anchor the
decision the implementation is held to.

#### Scenario: /opsx-propose runs on Terra from a planning-tier session

- **WHEN** the operator invokes `/opsx-propose <name>` from a session
  whose agent is `plan` (the planning tier)
- **THEN** the command SHALL run on `openai/gpt-5.6-terra` and the
  proposal SHALL be generated on Terra, not on the invoking agent's
  cheaper model
