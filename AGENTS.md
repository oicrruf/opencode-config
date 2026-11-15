# AGENTS

OpenCode-specific operator notes for working in this repository. This file is
the canonical home for cross-agent conventions, profile behaviour, and the
durable-change workflow; do not parse it from installer scripts or
validators.

## Conventions

- **Primary dispatch language.** The dispatcher is bilingual (English /
  Spanish) and chooses the language that matches the user's last message.
  Default fallback is English when the message is ambiguous.
- **Subagent depth.** `subagent_depth` is `1` by default; only `orchestrator`
  and `refactor` may raise it to `2`. Specialists do not dispatch further.
- **Routing matrix.** Every agent MUST consult `agent/routing.md` before any
  tool call and state the work class with one sentence of evidence.
- **Step budgets.** The primary agents `build` and `plan` omit `steps` so
  authorized work can continue without a fixed model-step ceiling. Specialists
  retain finite ceilings: `general`, `frontend`, `backend` 80; `qa` 60;
  `explore`, `triage` 25; all other configured specialists 100. Ceilings are
  not quotas: stop after acceptance and required verification pass. Template,
  rendered config, frontmatter, and `agent/routing.md` must agree; the
  acceptance harness checks omission as well as finite values. Run
  `./install.sh --profile <selected>` and start a fresh execution to activate
  the root config; an old installed global value or project override can
  still impose a limit. See `docs/contracts/autonomous-continuity.md` for
  evidence, effective-config checks, and rollback.
- **Autonomous continuity.** Continue pending authorized work while making
  progress. After each bounded unit, checkpoint completed work/files, ordered
  pending actions, verification run/not run, and blockers in conversation.
  On specialist exhaustion, use its evidence to finish pending work directly
  within your permissions or delegate a narrower unit within the existing
  routing, depth, and review re-dispatch gates. Specialists never restart
  themselves. Stop after three consecutive unsuccessful attempts at the same
  blocked action without new evidence, unless the operator supplies another
  finite threshold. Honor explicit operator elapsed-time/cost budgets using
  observed values; disclose unavailable accounting. These are prompt-level
  controls, not guaranteed runtime watchdogs or hard monetary caps. Stop on
  cancellation, denied permission, persistent provider failure, or a real
  scope/authorization blocker; never fabricate user input or bypass a gate.
- **Step efficiency.** Reuse relevant evidence already obtained instead of
  re-running a successful discovery without a concrete reason. Group
  independent reads or queries when tool capabilities and dependency
  ordering permit; do not parallelize dependent edits or checks.
  Coordinators divide long work into bounded verifiable units within the
  existing scope and delegation gates. Efficiency MUST NOT bypass
  required verification, permissions, planning boundaries, or review.
- **Interruption handoff.** If an external runtime limit or real blocker
  interrupts unfinished work, provide a compact text handoff: (1) completed
  work/files, (2) pending work in order, (3) verification run and not run,
  (4) blockers or risks, and (5) next action (next manual action when human
  input is required). If tools have been removed, make no further tool call
  and do not claim a final checkpoint write or verification. Do not claim an
  exact remaining-step counter unless the runtime exposes one; do not
  restart automatically or simulate user input. Manual continuation is a
  fallback for a genuinely interrupted primary, not the normal lifecycle of
  a long task. Specialists preserve their structured fields: classification,
  decision, changed files, verification results, blockers, OpenSpec task impact.
  Put pending work and next actions inside those fields. See
  `docs/contracts/interruption-handoff.md` for both variants.
- **OpenSpec workflow.** Durable changes — new features, behaviour changes,
  new profiles, profile edits, schema migrations — go through
  `openspec/changes/<change-name>/`. The workflow is: explore (optional) →
  propose (`/opsx-propose`) → apply (`/opsx-apply`) → archive (`/opsx-archive`).
  The `agent-routing` spec (`openspec/specs/agent-routing/spec.md`) is the
  contract for routing decisions; profile edits that change model
  assignments MUST keep the spec aligned.
- **Runtime verification sandbox.** A change that can only be verified at
  runtime is verified through the sandbox control
  (`plugins/sandbox-control/`) instead of on the host. The sandbox takes
  an independent capture of the work under test, runs it inside a local
  Docker engine with no host network, no added privileges, no mount of
  the original source, and loopback-only port publications, and writes
  the report outside the environment before it removes anything. Two
  rules bound its use: **one local application per project**, so a
  second session is refused before anything launches, and **a missing
  dependency blocks the test** rather than being provisioned by the
  agent. Starting the environment never approves a product, and the
  sandbox never modifies the host's branches or publishes code. The
  operator guide is `plugins/sandbox-control/GUIDE.md`.
- **Managed worktrees.** A change that needs an isolated workspace gets
  it through the managed worktree control (`plugins/worktree-control/`),
  never through a raw `git worktree add`. The control creates the worktree
  outside the canonical checkout and records it in the project's inventory.
  Retirement requires an explicit request with the worktree, branch, base,
  expected head, and evidence; it is blocked by local changes, unpublished
  commits, process access, unrecognized ignored files, unsafe paths, or
  unverifiable checks. Evidence is preserved before removal, the remote
  branch and published commits are never removed, and age/capacity never
  retire a worktree. The legacy `.opencode/worktree/` path remains ignored
  for compatibility only.
- **Line endings.** The repository declares `* text=auto eol=lf` in
  `.gitattributes` so every shell and runtime file (`*.sh`, `*.ps1`,
  `*.mjs`, `*.js`, `*.ts`, `*.tsx`, `*.cjs`, `*.mts`, `*.cts`) is LF
  on every checkout, regardless of `core.autocrlf` on the contributor's
  machine. `scripts/validate-config.mjs` enforces the contract on the
  Git index (check #9): a CRLF blob in any of those extensions fails
  validation. If you need to re-normalize a single file, run
  `git add --renormalize <path>`; for the whole tree, run
  `git add --renormalize .`.

## Installation model profiles

This repository uses a JSON manifest under `config/model-profiles.json` as the
single source of model assignments for the root configuration, every global
agent, and every command that overrides an agent model. The installer reads
the manifest at install time, picks the profile named by `--profile` (or the
manifest's `defaultProfile`), and renders the installed
`~/.config/opencode/opencode.jsonc` from `config/opencode.template.jsonc`
combined with the selected profile.

### Selecting a profile

```
./install.sh                 # uses the manifest default (currently "personal")
./install.sh --profile personal
./install.sh --profile work
./install.sh --help
```

The selected profile persists in the installed configuration; ordinary
`opencode` invocations do NOT need a `--profile` flag or environment variables.
A subsequent `./install.sh --profile <other>` re-runs the renderer, validates
the new output, and atomically replaces the installed root config (backing
up the previous one to `opencode.jsonc.bak.<timestamp>`).

### Default: `personal`

The `personal` profile mirrors the documented current assignment: direct
MiniMax for `spec-required` implementation and the root default, Ollama
Cloud MiniMax for bounded execution (`build`, `general`, `frontend`,
`backend`, `qa`), the planning tier for `plan`, the decision tier for the
irreversible agents (`architect`, `orchestrator`, `refactor`, `adversarial`,
`cotizador`), and the value tier (`ollama-cloud/gpt-oss:20b`) for the cheap
reads (`explore`, `doctor`, `p5t-installer`, the global `small_model`).

`commands/*.md` keep their `model:` frontmatter — the install flow symlinks
the whole `commands/` directory as a unit, and per-file rendering is out of
scope for the install flow. The manifest's `commands` section is
informational; the validator confirms every command with a frontmatter
model is covered by the selected profile.

### `work` is a demonstration profile

The `work` profile in `config/model-profiles.json` is a documented example
that flips the heavy execution tier to `openai/gpt-5.6-terra` so the install
flow can be smoke-tested without changing personal defaults. It is NOT a
recommendation. Replace its values with your real work assignment through
the OpenSpec workflow before relying on it.

### Adding a new profile

1. Open a new change under `openspec/changes/<name>/` via `/opsx-propose`
   and explain the new profile.
2. Add the new profile to `config/model-profiles.json` covering every
   consumer: `root.model`, `root.small_model`, every agent block in the
   template, and every command whose `model:` frontmatter you want to keep
   (currently `opsx-propose`, `opsx-apply`, `archify`, `dedupe`, `mmx`,
   `mmx-h3-video`).
3. Validate with `node scripts/validate-config.mjs --profile <name>` and
   `node scripts/test-model-profiles.mjs`.
4. Run `/opsx-apply` to implement and `/opsx-archive` to land the change
   into the main specs.

The validator rejects profiles with missing consumers or phantom IDs before
any installed configuration is touched.

## Validation gates

Three checks gate every change:

- `node scripts/validate-config.mjs --profile <name>` — structural,
  permission, MCP, skill-budget, install-script, and profile-aware catalog
  checks.
- `node scripts/test-model-profiles.mjs` — focused checks for default /
  explicit / unknown / atomic-failure / personal-baseline equivalence.
- `node scripts/acceptance-harness.mjs` — end-to-end routing matrix,
  skill surface, and CLI guarantees. Expect 11/11 to pass on a healthy
  checkout.

## Doctor

`/doctor` (or `node scripts/doctor.mjs --check-only`) reports the
environment state. `--apply-safe` repairs the safe subset; everything that
touches a disabled MCP, credentials, or a pending OpenSpec proposal is left
to the operator.
