## Why

OpenCode already ships OpenRouter as a first-class built-in provider
(per opencode.ai/docs/providers): `/connect` writes the API key into
OpenCode's per-user auth store at `~/.local/share/opencode/auth.json`,
the `/models` TUI picker enumerates pre-listed OpenRouter model ids,
and additional model ids are surfaced by declaring them under
`provider.openrouter.models` in the project config. The repo currently
exposes no Jev model id even though Jev 1.13 lives in OpenRouter's
catalog under the slug `typesafe/jev-1.13`.

We want the repo to ship that one durable declaration, alongside a
short README subsection explaining the runtime flow, and to keep Jev
as opt-in — no profile auto-assigns it; agents opt in by editing
their own `model:` line.

The previous attempt (`add-jev-decision-router` — torn out after
Vercel's billing blocked the project's payment method) was
over-engineered: it introduced a custom provider block with `baseURL`
+ env-interpolated `apiKey`, `install.sh` env-loading, a validator
env gate, and an rc-append loop. All of that became unnecessary once
the integration uses OpenCode's built-in OpenRouter support. This
change is deliberately small.

## What Changes

- Add a single `provider.openrouter.models["typesafe/jev-1.13"]: {}`
  entry to `config/opencode.template.jsonc`. No `baseURL`, no
  `apiKey`, no env interpolation — OpenCode already knows them.
- Add a brief "External / opt-in model ids" subsection to `README.md`
  that points the reader at `/connect` (key) and `/models` (picker),
  names `openrouter/typesafe/jev-1.13` as the example opt-in id, and
  carries the signal-not-authorization warning.
- No profile additions: `config/model-profiles.json` is unchanged.
- No installer edits: `install.sh` is unchanged.
- No validator or harness edits: `scripts/validate-config.mjs` and
  `scripts/acceptance-harness.mjs` are unchanged.
- No env files, no `.env.example`, no `install.sh` rc-append — the
  project does not own OpenRouter credentials; OpenCode's auth store
  does.

## Capabilities

### New Capabilities

- `model-providers`: how the repo surfaces opt-in model ids (entries
  under a built-in provider's `models` map) and how the README
  documents the runtime flow. Generic enough that future opt-ins
  (other built-in providers, additional model ids) fit without a new
  change.

### Modified Capabilities

<!-- none. `agent-routing` is the agent-to-model matrix; no model
     assignment moves. `installation-model-profiles` is the profile
     manifest; no profile references `openrouter/*` after this
     change. -->

## Impact

- `config/opencode.template.jsonc` — gains one line under
  `provider.openrouter.models`.
- `opencode.jsonc` (re-rendered) — picks up that one line on next
  `install.sh`.
- `README.md` — gains one subsection.
- No env files. No `.env.example`. No installer, validator, or
  harness changes. No profile manifest changes.
- Sensitive surface: zero. The OpenRouter API key lives in
  `~/.local/share/opencode/auth.json` (managed by OpenCode's
  `/connect` flow), not in any repo-tracked file. `git status`
  after the change shows no diff to tracked secrets.
- No new packages. No new MCP servers. No new subagents. No new
  commands. Jev remains a regular model: `model:
  "openrouter/typesafe/jev-1.13"` on whichever agent block opts in.
