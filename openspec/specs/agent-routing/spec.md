## Purpose

Define a single routing contract that maps work classification to model,
delegation depth, and allowed tool surface for every global agent, so
that session cost and capability are predictable from the classification
alone.

## Requirements

### Requirement: Work classification drives model and delegation

The system SHALL classify each implementation request into exactly one of
`small`, `medium`, `spec-required`, or `audit` before any tool call, and
SHALL route it according to the matrix below. A request that does not match
any class defaults to `medium`.

| Class        | Default model            | Subagent depth | Specialist count | Browser MCP |
|--------------|--------------------------|----------------|------------------|-------------|
| `small`      | `ollama-cloud/gpt-oss:20b` | 0              | 0                | deny        |
| `medium`     | `ollama-cloud/gpt-oss:20b` | 1              | 0–1              | deny        |
| `spec-required` | `openai/gpt-5.6-terra` for planning, `minimax/MiniMax-M3` for implementation | 1              | 0–2              | only with explicit risk |
| `audit`      | `openai/gpt-5.6-terra`    | 1              | 0–1              | required    |

The system SHALL classify a request as `audit` **only** when the user
explicitly @-mentions `@cotizador` OR explicitly requests a quote
(cotizar/presupuestar) for the development of an application or a
development effort. A URL on its own, or a request to improve, redesign,
migrate, optimize, audit, or evaluate a site without explicitly requesting
a development quote, SHALL NOT be classified as `audit` and SHALL NOT dispatch
`cotizador`.

The system SHALL refuse to delegate deeper than the configured `subagent_depth`
and SHALL surface a clear blocker when a specialist request would exceed it.

#### Scenario: small request stays inline

- **WHEN** the user asks for a single-line CSS tweak with no schema, dependency,
  or compatibility impact
- **THEN** the primary agent SHALL classify the work as `small`, run on
  `ollama-cloud/gpt-oss:20b`, and SHALL NOT dispatch any subagent or
  enable browser automation

#### Scenario: medium request uses exactly one specialist

- **WHEN** the user asks for a bounded multi-file change with no durable design
  decision
- **THEN** the primary agent SHALL classify the work as `medium`, run on
  `ollama-cloud/gpt-oss:20b`, and MAY dispatch at most one specialist with
  no further nesting

#### Scenario: spec-required uses Terra for the proposal only

- **WHEN** the user asks for a new API or observable behavior change that
  triggers `/opsx-propose`
- **THEN** the planning step SHALL run on `openai/gpt-5.6-terra` and the
  implementation step SHALL run on `minimax/MiniMax-M3`, matching the
  scenario name; the proposal carries the decision weight because it is the
  contract the implementation is held to

#### Scenario: a URL alone does not dispatch cotizador

- **WHEN** the user pastes a URL, or asks to improve, redesign, migrate,
  optimize, audit, or evaluate a site without explicitly requesting a
  development quote and without @-mentioning `@cotizador`
- **THEN** the primary agent SHALL NOT classify the request as `audit` and
  SHALL NOT dispatch the `cotizador` subagent; it SHALL classify the work
  as `spec-required` (or route to `adversarial`/`qa` when the ask is review)

#### Scenario: explicit @cotizador mention dispatches the audit

- **WHEN** the user @-mentions `@cotizador` or explicitly asks to quote
  (cotizar/presupuestar) the development of an application or a
  development effort, with or without a URL
- **THEN** the primary agent SHALL classify the request as `audit` and
  dispatch the `cotizador` subagent

### Requirement: Terra is reserved for irreversible or ambiguous decisions

The system SHALL assign a model to each agent according to the weight of the
role's default output, using only providers the user is authenticated to.
The tiers are:

- **Decision tier — `openai/gpt-5.6-terra`**: roles whose default output is
  an irreversible edit, a high-ambiguity structural decision, or an
  external-facing audit. The roles are `architect`, `orchestrator`,
  `refactor`, `adversarial`, `cotizador`, and the `/opsx-propose` command.
- **Planning tier — `openai/gpt-5.6-luna`**: the `plan` agent, which
  triages, investigates, and classifies scope on every request but produces
  a classification that is cheap to revise.
- **Direct-MiniMax tier — `minimax/MiniMax-M3`** (1 048 576 ctx, $0.3/$1.2):
  the global root `model` and the `spec-required` class implementation step
  only. Reserved for sessions whose context budget genuinely exceeds 131k
  or whose execution depends on the direct-quota isolation guarantee.
- **Value tier — `ollama-cloud/gpt-oss:20b`** (131 072 ctx, $0.07/$0.3):
  `build`, `general`, `frontend`, `backend`, `qa`, `explore`,
  `p5t-installer`, `doctor`, and the global `small_model`. Same model id
  across both install-time profiles.

The system SHALL NOT assign `openai/gpt-5.6-terra` as the default model for
`plan`, `explore`, `build`, `general`, `frontend`, `backend`, `qa`,
`p5t-installer`, or `doctor`.

OpenCode exposes exactly one static `model` per agent, so a mode-dependent
model is not expressible. The system SHALL therefore assign Terra to
`adversarial` unconditionally rather than only in `full` mode.

A command that produces a durable planning artifact SHALL run on the
decision tier even when the agent that invoked it runs on a cheaper one,
because the artifact's quality sets the ceiling for the implementation that
follows.

#### Scenario: explore never runs on Terra by default

- **WHEN** the global `explore` agent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` (or the
  explicitly user-selected override)

#### Scenario: build runs on the Value tier

- **WHEN** the global `build` agent is dispatched for a bounded multi-file
  edit that does not require a durable planning artifact
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` and
  SHALL NOT be `minimax/MiniMax-M3` or `openai/gpt-5.6-terra`

#### Scenario: spec-required implementation runs on the direct-MiniMax tier

- **WHEN** a `spec-required` session transitions from the planning step on
  Terra to the implementation step
- **THEN** the implementation step SHALL run on `minimax/MiniMax-M3` and
  SHALL NOT be downgraded to `ollama-cloud/gpt-oss:20b`

#### Scenario: adversarial reviews on the decision tier

- **WHEN** the global `adversarial` agent is dispatched in either `targeted`
  or `full` mode
- **THEN** the configured model SHALL be `openai/gpt-5.6-terra`, because
  adversarial review is a pre-commit gate where a missed finding costs more
  than the token delta

#### Scenario: the propose command runs on the decision tier

- **WHEN** `/opsx-propose` is invoked from a session whose agent is `plan`
  (the planning tier)
- **THEN** the command SHALL declare `model: openai/gpt-5.6-terra` and the
  proposal SHALL be generated on Terra, not on the invoking agent's cheaper
  model

#### Scenario: plan does not run on the decision tier

- **WHEN** the `plan` agent is dispatched
- **THEN** the configured model SHALL be `openai/gpt-5.6-luna` and SHALL NOT
  be `openai/gpt-5.6-terra`

#### Scenario: doctor runs on the value tier

- **WHEN** the global `doctor` subagent is dispatched
- **THEN** the configured model SHALL be `ollama-cloud/gpt-oss:20b` and
  SHALL NOT be `openai/gpt-5.6-terra`, because the doctor's role is
  read-only inspection and safe repair, not irreversible decisions

### Requirement: Subagent depth is bounded and auditable

The system SHALL set `subagent_depth` to `1` by default and SHALL allow a
value of `2` only for the `orchestrator` and `refactor` agents. When a
subagent, including `doctor`, attempts to delegate, the system SHALL refuse
and return a structured error that names the offending call.

#### Scenario: nested delegation is rejected

- **WHEN** a subagent invokes the `task` tool to dispatch another agent while
  `subagent_depth` is `1`
- **THEN** the system SHALL refuse the delegation and SHALL return an error
  whose message names the depth limit and the agent that would have been
  dispatched

#### Scenario: doctor refuses to dispatch nested specialists

- **WHEN** the `doctor` subagent invokes the `task` tool to dispatch another
  agent while `subagent_depth` is `1`
- **THEN** the system SHALL refuse the delegation and SHALL return an error
  whose message names the depth limit and the agent that would have been
  dispatched

### Requirement: Audit roles expose targeted and full modes
The `qa`, `adversarial`, and `cotizador` agents SHALL each support a
`mode` parameter with values `targeted` (default) and `full`. In `targeted`
mode the agent runs only the minimal verification or audit required for
the declared scope. In `full` mode the agent expands surface to lint,
types, tests, coverage, accessibility, security, performance, and
Playwright crawl where applicable.

The system SHALL require an explicit user request or a concrete
documented risk signal before switching an audit role to `full`. A
concrete risk signal is a security change, a schema or data migration,
a public compatibility change, or an open incident; an external-facing
artifact alone SHALL NOT trigger `full` mode.

#### Scenario: adversarial stays targeted unless asked

- **WHEN** the user requests "revisa estos cambios" without specifying an
  audit depth and no concrete full-review risk signal is documented
- **THEN** the `adversarial` agent SHALL default to `targeted` mode and SHALL
  scan only the final diff, directly affected dependencies, and axes
  relevant to the changed files

#### Scenario: external-facing artifact alone remains targeted

- **WHEN** the changed output is external-facing but has no documented
  security, schema, compatibility, or incident risk and the user did not
  request a full review
- **THEN** the audit role SHALL remain in `targeted` mode

#### Scenario: documented security change upgrades to full

- **WHEN** the review scope includes a documented security change
- **THEN** the audit role SHALL run in `full` mode

#### Scenario: cotizador upgrades to full on confirmed scope

- **WHEN** the user has confirmed the URL, client, final client, scope, rate,
  currency, validity, payment terms, exclusions, and access details
- **THEN** `cotizador` MAY switch to `full` mode and crawl up to the documented
  page budget

### Requirement: Specialist dispatch contract

When a primary agent dispatches a specialist via the `task` tool, the
dispatch payload SHALL include: the work classification, the relevant files
or symbols, the expected outcome, any user constraints, and the verification
criteria. The specialist SHALL return only: classification, decision,
changed files, verification results, blockers, and any OpenSpec task impact.

#### Scenario: build dispatches frontend with full contract

- **WHEN** the `build` agent decides a frontend specialist is needed for a
  bounded UI change
- **THEN** the dispatch payload SHALL include the classification (`small`,
  `medium`, or `spec-required`), the affected files, the expected output, and
  the verification criteria, and SHALL NOT include the full conversation
  history

### Requirement: Configured model ids resolve against authenticated providers

The system SHALL declare only model ids that an authenticated provider serves.
The version-controlled model-profile manifest SHALL provide every model
assignment for the root default, `small_model`, global agents, and command
overrides. `scripts/validate-config.mjs` SHALL validate the manifest structure,
ensure the selected profile covers every configured model consumer, and verify
its selected IDs against the OpenCode models catalog.

The check SHALL treat a missing catalog as a skip with a printed notice and
SHALL NOT fail the install, so a machine that has never started OpenCode still
installs. The check SHALL fail with the profile, consumer, and unresolved ID
when the catalog is present and an ID is absent. The installer SHALL validate
the selected profile before generating or replacing installed configuration.

When the catalog lookup was performed by a Windows node, the skip notice
SHALL additionally name that node resolved the catalog under the Windows user
profile rather than the POSIX home, and SHALL name a native Node.js as the
remedy. The extra line SHALL NOT be printed when the lookup ran under a
native POSIX node.

#### Scenario: a phantom model id fails the validator

- **WHEN** `scripts/validate-config.mjs` runs for a profile that assigns
  `openai/gpt-5.6-terra-fast` to an agent
- **THEN** the script SHALL exit non-zero and name the profile, agent, and
  unresolved id

#### Scenario: a valid model id passes the validator

- **WHEN** every model assignment in the selected profile is present in the
  catalog for its provider
- **THEN** the script SHALL report `validate-config: OK` and exit zero

#### Scenario: a missing catalog skips the check

- **WHEN** `~/.cache/opencode/models.json` does not exist
- **THEN** the script SHALL print a skip notice for the catalog check and SHALL
  NOT fail on it

#### Scenario: a missing catalog under a Windows node explains itself

- **WHEN** `scripts/validate-config.mjs` runs under `node.exe` (so
  `process.platform` is `win32`) and no catalog exists at the resolved home
- **THEN** the skip notice SHALL name the Windows user profile it searched,
  SHALL state that the model ids were not checked, and SHALL name a native
  Node.js as the way to have them checked

### Requirement: Triage is a value-tier decision specialist

The system SHALL configure `triage` as a non-delegating, read-only subagent on
the value tier. Primary agents MAY dispatch it only for bounded structured
consultation whose outcome is an effort, risk, priority, classification,
proposal-review, or architecture-option decision. The dispatch SHALL include
the alternatives when a selection is required and SHALL treat Triage's output as
advisory evidence, not authority to bypass scope gates or OpenSpec workflow.

#### Scenario: Bounded option selection uses Triage

- **WHEN** a primary agent needs a recommendation among documented technical
  options and the decision does not itself require a durable plan
- **THEN** it MAY dispatch `triage` with a bounded brief and use the returned
  recommendation and confidence in its own decision

#### Scenario: Triage cannot recursively delegate

- **WHEN** the `triage` subagent attempts to dispatch another specialist
- **THEN** the system SHALL refuse the nested dispatch under the configured
  subagent-depth limit

### Requirement: Triage dispatcher list is explicit and narrow

The system SHALL restrict `triage` dispatch to exactly the `build`,
`plan`, `adversarial`, `architect`, `orchestrator`, and `refactor` agents,
and SHALL additionally allow the
global `opsx-propose` OpenSpec command to dispatch `triage` during
proposal planning. Every other agent and every other command SHALL
NOT dispatch `triage`. The acceptance harness SHALL fail if the
dispatcher list drifts from this rule.

#### Scenario: build dispatches triage

- **WHEN** the `build` agent calls the `task` tool with `agent: "triage"`
- **THEN** the dispatch is allowed by the routing matrix and the
  harness agrees

#### Scenario: general agent does NOT dispatch triage

- **WHEN** the `general` agent calls the `task` tool with `agent: "triage"`
- **THEN** the routing matrix denies the dispatch under the strict
  scope gate

#### Scenario: opsx-propose may use triage

- **WHEN** the global `opsx-propose` command runs and needs a
  calibrated triage during proposal planning
- **THEN** the command MAY dispatch `triage` with a bounded brief, and
  the proposal that follows MAY cite the Triage recommendation as
  supporting evidence

#### Scenario: opsx-apply does NOT dispatch triage

- **WHEN** the global `opsx-apply` command runs
- **THEN** it SHALL NOT dispatch `triage` because implementation is not
  a triage activity; Triage's role is advisory

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

### Requirement: Adversarial review dispatch is risk-proportionate

The system SHALL dispatch `adversarial` at most once against the final diff
of a completed bounded change unless a prior review returned blocking
findings that were fixed. The system SHALL NOT automatically dispatch
`adversarial` for isolated mechanical, documentation, formatting, or
low-risk configuration changes that have no security, data, public-interface,
compatibility, or executable-logic impact. The system SHALL require an
adversarial review before completion when the change affects authorization,
authentication, secrets, untrusted-input handling, schema or data migration,
destructive data handling, public API or compatibility behavior, or an active
incident.

#### Scenario: Low-risk mechanical change completes without adversarial review

- **WHEN** a completed change is isolated, mechanical, and has no defined
  high-risk impact
- **THEN** the coordinator SHALL rely on task-relevant verification and
  SHALL NOT automatically dispatch `adversarial`

#### Scenario: Bounded logic change receives one final targeted review

- **WHEN** a completed bounded change modifies executable logic without a
  full-review trigger
- **THEN** the coordinator SHALL dispatch `adversarial` once in `targeted`
  mode against the final diff and its directly affected dependencies

#### Scenario: High-risk change requires adversarial review

- **WHEN** a completed change affects authorization, untrusted-input
  handling, a schema migration, destructive data handling, public
  compatibility behavior, secrets, or an active incident
- **THEN** the coordinator SHALL dispatch `adversarial` before declaring
  the change complete

### Requirement: Targeted adversarial reviews have a bounded closure

In `targeted` mode, `adversarial` SHALL inspect only the final diff,
directly affected call paths, and axes relevant to the changed behavior.
It SHALL NOT run a broad repository scan, a full verification suite,
dependency-wide CVE scan, or browser automation unless the changed diff
supplies concrete evidence that the check is required. It SHALL label
findings as introduced by the change, pre-existing debt, or unverifiable,
and SHALL not block completion on pre-existing debt, `MINOR`, or `NIT`
findings. The coordinator SHALL permit one focused re-review limited to
resolved `BLOCKER` or `MAJOR` findings. After that re-review, the reviewer
SHALL return a final structured verdict or an incomplete verdict that
identifies any unverified risk and evidence gathered. The coordinator
SHALL continue agent coordination through the PR-ready handoff rather than
requiring a separate human approval before that handoff. It SHALL clearly
include unresolved material risks and unverified items in the handoff so
the human can assess them during PR review, and SHALL NOT represent them as
verified or resolved.

#### Scenario: Targeted review excludes irrelevant audit axes

- **WHEN** a targeted review concerns a non-UI change with no dependency or
  security evidence
- **THEN** the reviewer SHALL inspect the diff and relevant call paths
  without running browser automation, a dependency-wide scan, or unrelated
  full-suite checks

#### Scenario: Pre-existing debt does not reopen the change

- **WHEN** a targeted review identifies a defect that predates the final
  diff
- **THEN** the reviewer SHALL report it as pre-existing debt and the
  coordinator SHALL NOT treat it as a release blocker for the reviewed
  change

#### Scenario: Blocking fixes receive one focused re-review

- **WHEN** the reviewer reports introduced `BLOCKER` or `MAJOR` findings
  and the implementing agent supplies fixes
- **THEN** the coordinator SHALL request at most one focused re-review of
  those fixes before closing the review

#### Scenario: Targeted review cannot complete within its budget

- **WHEN** the reviewer cannot verify a material risk before its applicable
  step budget is exhausted
- **THEN** it SHALL return an incomplete verdict that identifies the
  unverified risk and evidence gathered, and the coordinator SHALL continue
  to the PR-ready handoff with that risk explicitly surfaced for human PR
  review rather than requiring a separate pre-PR operator decision

#### Scenario: Coordinated work reaches PR-ready handoff

- **WHEN** the required implementation and task-relevant verification are
  complete and the required adversarial review has returned its final
  verdict
- **THEN** the coordinating agent SHALL announce that the PR is ready for
  human review, summarize verification and findings, and identify any
  unresolved risks without claiming the PR was approved or merged
