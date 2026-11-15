# Tasks

- [x] 1.1 Assign OpenAI models to root, `small_model`, all agents, and all
  commands in both profiles; keep the two profiles distinct using only
  OpenAI models.
- [x] 1.2 Update static command model frontmatter and agent prompts to match
  the lightweight, execution, and decision tiers.
- [x] 1.3 Update `agent/routing.md`, `AGENTS.md`, and README model access and
  profile guidance, including ChatGPT Plus/Pro OAuth usage and separate API
  billing.
- [x] 2.1 Extend `scripts/validate-config.mjs` to reject non-OpenAI IDs across
  all profiles and every command model override.
- [x] 2.2 Update profile tests and the acceptance harness to cover OpenAI-only
  assignments, new tier IDs, and rendered profiles.
- [x] 3.1 Validate OpenSpec deltas and both model profiles; render and validate
  both configurations; run focused profile and acceptance checks.
- [x] 3.2 Close GitHub issue #4 as a duplicate of Linear AT-202 after verifying
  the completed implementation and retain the Linear issue as the tracker.
