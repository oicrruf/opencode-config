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
- **OpenSpec workflow.** Durable changes — new features, behaviour changes,
  new profiles, profile edits, schema migrations — go through
  `openspec/changes/<change-name>/`. The workflow is: explore (optional) →
  propose (`/opsx-propose`) → apply (`/opsx-apply`) → archive (`/opsx-archive`).
  The `agent-routing` spec (`openspec/specs/agent-routing/spec.md`) is the
  contract for routing decisions; profile edits that change model
  assignments MUST keep the spec aligned.

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
