## Context

OpenCode ships OpenRouter as a first-class built-in provider
(opencode.ai/docs/providers/#openrouter): `/connect` writes the API
key into OpenCode's per-user auth store at
`~/.local/share/opencode/auth.json`; the `/models` TUI picker shows
pre-loaded OpenRouter model ids; additional model ids can be added
under `provider.openrouter.models` in the project config so they
appear in the picker. Our `config/opencode.template.jsonc` already
declares agents using first-party MiniMax, Ollama Cloud, and the
OpenAI o-series. The Jev integration is the first request to surface
an opt-in model id under a built-in provider that no profile
currently assigns.

The previous attempt (`add-jev-decision-router`, torn out after the
Vercel billing failure) introduced a custom provider block with
`baseURL` + `{env:OPENROUTER_API_KEY}` interpolation, an `install.sh`
env-loading step, a validator env gate, and an rc-append loop. That
plumbing was necessary only because the integration did not use the
built-in provider. This change uses the built-in provider, so most
of that scaffolding is unnecessary.

## Goals / Non-Goals

**Goals:**
- Add one durable model id (`openrouter/typesafe/jev-1.13`) to the
  rendered config so the TUI's `/models` picker lists it.
- Keep Jev opt-in: no profile assigns it; agents opt in by editing
  their own block's `model:` line.
- Leave the installer, validator, harness, and profile manifest
  untouched — the smaller the diff, the lower the review surface,
  and the smaller the risk that a future OpenCode provider upgrade
  silently shifts something.

**Non-Goals:**
- Custom provider blocks with `baseURL` / `apiKey` interpolation.
- Project-side env files, install.sh rc-append, validator env gates.
- Auto-assigning Jev to any default agent or command.
- Caching or batching Jev responses (out of project scope).
- Editing `~/.zshrc` / `~/.bashrc` for any reason.

## Decisions

### D1: Use the built-in openrouter provider, not a custom block

Custom provider blocks are warranted only for endpoints OpenCode does
not ship with (custom deployments, OpenAI-compatible forks, self-
hosted gateways). OpenRouter is shipped, so the only repo-visible
change is one `provider.openrouter.models` entry.

Rationale: minimizes drift surface (no `baseURL` to keep in sync
with OpenRouter's actual deployment), keeps the rendered config
readable, and sidesteps the env-var-leak risk that the failed Vercel
integration ran into.

Alternatives considered:
- A custom `provider.openrouter` block with `baseURL:
  "https://openrouter.ai/api/v1"` and `apiKey:
  "{env:OPENROUTER_API_KEY}"`: redundant with OpenCode's built-in
  knowledge. Rejected.

### D2: Auth lives in OpenCode's auth.json, not in any project env file

The `/connect` flow stores the key in
`~/.local/share/opencode/auth.json`. The repo does not — and should
not — introduce a `.env` file, a sourced env var, or an installer
step. This is what makes the change tiny and is what eliminates the
class of bug the previous integration hit.

Rationale: the recurring failure mode of the previous integration
was that the env var reaching opencode's runtime required rc lines,
process sourcing, and re-launches that OpenCode's auth.json design
absorbs by itself. Following that pattern erases the failure mode.

### D3: No validator or harness edits

The validator already gates on profile coverage and the harness
already covers agents, commands, and skill surfaces. There is nothing
in the new opt-in that benefits from a new check: the
`provider.openrouter.models` entry is purely declarative (OpenCode
reads it at runtime) and the profile manifest does not consume it.

Rationale: the absence of a check is the cheapest possible proof
that the change is below the project's noise floor — every existing
runner (validator, harness, profile tests, doctor, acceptance
harness) keeps the same exit behaviour it had before.

### D4: Opt-in stays opt-in; no profile auto-assigns

`config/model-profiles.json` is unchanged. The new model id appears
in `/models` for the user to pick, but no agent or command silently
gets it on next install.

Rationale: a silent switch would be a behavior change visible to
every existing user; an opt-in is invisible until the user actively
picks the model. The change's review surface — README + one
template line — matches that posture.

## Risks / Trade-offs

- **R1: User forgets to run `/connect` before invoking the model**
  → surfaced at invocation time as HTTP 401 from OpenRouter.
  Acceptable: the failure mode is clear and the fix is one command.
- **R2: `typesafe/jev-1.13` may eventually be replaced by a newer
  Jev version** → future Jev releases require updating the entry
  id; the README subsection names the id explicitly so the diff is
  visible on the next Jev bump. Until then, the entry is stable.
- **R3: OpenRouter billing fails on the user's payment method,
  the same way Vercel did** → out of repo scope. If it does, the
  rollback is one-line: delete the `models` entry and re-render.
- **R4: OpenCode's built-in model list eventually covers `typesafe/jev-1.13`**
  → harmless duplicate declaration; OpenCode's picker is
  de-duplicated by id, so the entry becomes redundant, not
  conflicting. Future cleanup is a one-line remove.

## Migration Plan

Apply in one commit:
1. Edit `config/opencode.template.jsonc` to add the one
   `provider.openrouter.models["typesafe/jev-1.13"]: {}` entry.
2. Edit `README.md` to add the opt-in subsection.
3. Re-render `opencode.jsonc` via `scripts/render-config.mjs`.
4. Run `./install.sh` and the validator + harness + profile tests.
5. (Operator, post-apply) in the opencode TUI, run `/connect` to
   store the OpenRouter API key (already done by the operator in
   this case), then `/models` to verify
   `openrouter/typesafe/jev-1.13` is listed.

Rollback: revert the two tracked-file edits, re-render, re-install.
Net effect: zero — the opt-in disappears, no other state changes.

## Open Questions

- (none)
