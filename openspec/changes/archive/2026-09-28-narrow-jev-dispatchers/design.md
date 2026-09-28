## Context

See `proposal.md`. The current `agent-routing` spec says `jev` is
dispatchable by decision-tier specialists but is silent on the exact
list. A live consultation asked the question and returned a broader
list than the spec intended. We want the spec to name the dispatchers
explicitly so the harness can enforce them.

## Goals / Non-Goals

**Goals:**
- Make `jev` dispatch allow-list explicit (`build`, `plan`,
  `adversarial`).
- Add `opsx-propose` as an OpenSpec command that may also dispatch
  `jev` for triage.
- Surface unauthorized dispatch as a structured refusal in the host.

**Non-Goals:**
- Change the model tier of `jev` or its permission block.
- Allow the broader list the live consultation returned
  (`general`, `frontend`, `backend`, `qa`, `architect`, `orchestrator`,
  `refactor`, `cotizador`).
- Add new agents or commands outside the listed set.

## Decisions

### Single source of truth in the spec

Both `agent-routing` and `jev-decision-agent` will state the
allow-list explicitly. The acceptance harness will encode the list and
fail if a new agent/command is added without updating the spec.

### opsx-propose is the only command-level dispatcher

The decision is to let the proposal workflow consult Jev while keeping
`opsx-apply` (which actually edits files) without it. `opsx-apply`
inherits the existing deny-by-default command permission and does not
need a `task` allow for `jev`.

### Host prompt gain

The `agent/jev.md` prompt will list the allow-list and return a
structured `unauthorized_dispatcher` error for anything outside it.

## Risks / Trade-offs

- [Other agents silently used Jev through their `task: allow`
  permission] → the harness assertion catches the regression on every
  install.
- [opsx-propose misuses Jev] → the bounded-brief contract already
  caps the cost to a single SystemOne call per proposal.

## Migration Plan

1. Update both spec deltas with the allow-list.
2. Extend the acceptance harness to assert exactly those dispatchers
   exist with `task: allow` permission.
3. Tighten the host prompt to refuse non-allow-list dispatchers.
4. Validate, render, install, and restart OpenCode.
