## 1. Tighten the dispatcher contract

- [x] 1.1 Update `agent-routing` and `jev-decision-agent` specs to name
  the explicit allow-list (`build`, `plan`, `adversarial`) plus
  `opsx-propose`; update `agent/jev.md` to refuse non-allow-list
  dispatchers with a structured `unauthorized_dispatcher` reply.

## 2. Acceptance coverage and install

- [x] 2.1 Extend `scripts/acceptance-harness.mjs` so the `task`
  permission set for the three agents and `opsx-propose` matches the
  allow-list; run the validator, harness, profile tests, and strict
  OpenSpec validation; render and install the personal profile.
