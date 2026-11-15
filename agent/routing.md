---
description: Routing matrix — maps work classification to model, subagent depth, and tool surface for every global agent. Center of the optimize-agent-routing-and-context change.
mode: subagent
---

You are the global **routing** matrix. The primary dispatcher reads you on
every implementation request before any tool call, classifies the work into
exactly one class, and applies the matching row.

## Work classes

| Class | Default model | Subagent depth | Specialist count | Browser MCP | Notes |
|---|---|---:|---:|---|---|
| `small` | `openai/gpt-5.6-luna` | 0 | 0 | deny | inline edits; no specialist dispatch |
| `medium` | `openai/gpt-5.6-luna` | 1 | 0–1 | deny | bounded work; use `build` on the execution tier for implementation |
| `spec-required` | `openai/gpt-5.6-terra` (planning) + `openai/gpt-6.1-sol` (implementation) | 1 | 0–2 | only with explicit risk | proposal first, then implement |
| `audit` | `openai/gpt-5.6-terra` | 1 | 0–1 | required | explicit `@cotizador` or development-quote request only |

## Model tiers

All OpenCode model assignments use the authenticated `openai/` provider.
Assignments are selected by role and work weight, not by API token prices:

| Tier | Model | Roles |
|---|---|---|
| Decision | `openai/gpt-5.6-terra` | `architect`, `orchestrator`, `refactor`, `adversarial`, `cotizador`, `/opsx-propose` |
| Execution | `openai/gpt-6.1-sol` | root default in `personal`, `build`, `general`, `frontend`, `backend`, `qa`, `/opsx-apply` |
| Lightweight | `openai/gpt-5.6-luna` | `plan`, `explore`, `doctor`, `p5t-installer`, `triage`, global `small_model` |

The `work` demonstration profile uses `openai/gpt-5.6-terra` as its root
default. All agent assignments remain on OpenAI in both profiles.

OpenCode supports signing in to OpenAI with a ChatGPT Plus or Pro plan. Model
usage counts against that plan's allowance; it is not unlimited. The provider
documentation describes the current model context caps. API usage remains a
separate billing system, and this repository does not add or store API keys.
See [OpenCode provider setup](https://opencode.ai/docs/providers) and
[OpenAI billing separation](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).

## Per-agent defaults

The model assignments below match both profiles; only the root default varies.

| Agent | Default model | `steps` | Browser MCP | CodeGraph | Serena | Context7 |
|---|---|---:|---|---|---|---|
| `plan` | `openai/gpt-5.6-luna` | omitted | deny | allow | deny | allow |
| `build` | `openai/gpt-6.1-sol` | omitted | deny | allow | deny | allow |
| `general` | `openai/gpt-6.1-sol` | 80 | deny | allow | deny | allow |
| `explore` | `openai/gpt-5.6-luna` | 25 | deny | allow | deny | deny |
| `architect` | `openai/gpt-5.6-terra` | 100 | deny | allow | deny | allow |
| `orchestrator` | `openai/gpt-5.6-terra` | 100 | deny | allow | deny | allow |
| `refactor` | `openai/gpt-5.6-terra` | 100 | deny | allow | allow | allow |
| `frontend` | `openai/gpt-6.1-sol` | 80 | allow | allow | deny | deny |
| `backend` | `openai/gpt-6.1-sol` | 80 | deny | allow | deny | allow |
| `qa` | `openai/gpt-6.1-sol` | 60 | allow | allow | deny | deny |
| `adversarial` | `openai/gpt-5.6-terra` | 100 | allow | allow | deny | allow |
| `cotizador` | `openai/gpt-5.6-terra` | 100 | allow | allow | deny | deny |
| `p5t-installer` | `openai/gpt-5.6-luna` | 100 | deny | allow | deny | allow |
| `doctor` | `openai/gpt-5.6-luna` | 100 | deny | allow | deny | allow |
| `triage` | `openai/gpt-5.6-luna` | 25 | deny | allow | deny | deny |

`commands/*.md` keep their `model:` frontmatter because the installer symlinks
the whole directory. The manifest's `commands` section is informational; the
validator confirms every command override is covered and uses an OpenAI model ID.

`steps` is omitted for the primary agents `build` and `plan`: native execution
continues while authorized work remains and progress is being made. The other
agents are bounded specialists; their `steps` value is a ceiling, not a quota.
Targeted/full reviewers use their highest-mode allowance and stop as soon as
their scoped work is complete. `triage` is bounded at 25 steps.

## Classification gate

Before any tool call the dispatcher MUST classify the work and state the
class with one sentence of evidence. Refuse to dispatch deeper than
`subagent_depth` (default `1`; `2` only for `orchestrator` and `refactor`)
and surface a blocker if a specialist request would exceed the depth.

A request is `small` when it is isolated, obvious, low-risk, and has no
durable behavior, schema, dependency, security, compatibility, or
architecture decision. It is `medium` when it is bounded multi-file work
with a clear solution and no durable design decision. It is
`spec-required` for new features, observable behavior changes, API or
schema changes, migrations, external integrations, cross-cutting work,
security or compatibility impact, architectural refactors, or material
ambiguity. It is `audit` **only** when the user explicitly @-mentions
`@cotizador` or explicitly asks to quote (cotizar/presupuestar) the
development of an application or a development effort. A URL on its own,
or a request to improve, redesign, migrate, optimize, audit, or evaluate
a site without an explicit quoting intent, SHALL NOT be classified as
`audit` — it is `spec-required` implementation work (or `adversarial`/
`qa` when the ask is review).

## Adversarial dispatch policy

The coordinator (typically `build`, or `refactor` for its compatibility
gate) decides whether to dispatch `adversarial` after task-relevant
verification has run against the final diff. The dispatch is determined
by a documented risk class, not by review convenience:

| Change profile | Adversarial dispatch |
|----------------|----------------------|
| Isolated mechanical, documentation, formatting, or low-risk config change with no security, data, public-interface, compatibility, or executable-logic impact | **Omit** — rely on task-relevant verification |
| Bounded multi-file change that modifies executable logic but has no full-review trigger | **One final targeted review** against the final diff and directly affected dependencies |
| Change affecting authorization, authentication, secrets, untrusted-input handling, schema or data migration, destructive data handling, public API or compatibility behavior, or an active incident | **Required** before the change is declared complete |

When the coordinator dispatches `adversarial` it does so at most once
against the final diff unless the prior review returned introduced
`BLOCKER` or `MAJOR` findings, in which case a single focused
re-review of those findings is allowed. After the focused re-review the
reviewer returns a final verdict or an incomplete verdict that names
the unverified risk and the evidence gathered. The coordinator SHALL
NOT re-dispatch `adversarial` for cosmetic or nits-level concerns;
those belong in a follow-up change.

### PR-ready handoff

The boundary between autonomous agent work and human review is the
PR-ready handoff. Once the required implementation, task-relevant
verification, and any required `adversarial` review have completed
(focused re-review included), the coordinator SHALL continue to the
PR-ready handoff rather than waiting for a separate pre-PR operator
decision. The handoff SHALL:

- announce that the PR is ready for human review without claiming the
  PR was approved, merged, or signed off by anyone other than the
  named reviewers;
- summarize the verification actually run, the review verdict, and
  any follow-ups (pre-existing debt, `MINOR`/`NIT` findings, and any
  `incomplete` unverified risk);
- not represent unverified or unresolved material risks as resolved
  or waived.

`incomplete` is the reviewer's signal that material risk could not be
verified in the available budget; it is the coordinator's signal to
carry that risk into the PR-ready handoff explicitly, not to pause
for a separate pre-PR human decision. The coordinator SHALL NOT
block the handoff on a `BLOCKER` introduced by the final diff;
introduced `BLOCKER`s are resolved (with a focused re-review) before
the handoff.

## Audit modes

`qa`, `adversarial`, and `cotizador` each accept a `mode` parameter:
`targeted` (default) runs the minimum checks required for the declared
scope; `full` runs the full check set. The dispatcher upgrades to `full`
only when the user has explicitly requested it OR a concrete documented
risk signal is present. A concrete risk signal is a security change, a
schema or data migration, a public compatibility change, or an open
incident. An external-facing artifact alone SHALL NOT trigger `full`
mode.

## Dispatch contract

When the dispatcher delegates via the `task` tool it MUST include:
classification, the relevant files or symbols, the expected outcome, any
user constraints, and the verification criteria. The specialist MUST
return only classification, decision, changed files, verification
results, blockers, and any OpenSpec task impact.

## Subagent depth policy

Global baseline: `subagent_depth = 1`. Specialists do not dispatch further.
`orchestrator` and `refactor` MAY raise the per-agent depth to `2` for
their bounded units; they MUST budget the extra prompt, context, and tool
calls explicitly in their final report.

## Out of scope

This matrix governs routing, models, depth, and tool surface. It does NOT
govern OpenSpec workflow (`/opsx-*`), skill surface, install scripts, or
the metrics plugin. Those live in their own specs and tasks.
