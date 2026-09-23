# model-providers Specification

## Purpose

Lets the opencode-config repo surface opt-in model ids under
OpenCode's built-in providers (notably OpenRouter) and document the
runtime flow that turns those ids into live model calls, so any
agent can opt in by editing its own `model:` line, without the repo
shipping secrets or bespoke auth plumbing.

## Requirements

### Requirement: Template may declare opt-in model ids under built-in providers

The `config/opencode.template.jsonc` template MAY declare opt-in
model ids by adding entries of the shape
`provider.<provider-name>.models.<model-id>: {}` for any
`<provider-name>` that OpenCode ships as a built-in provider. The
renderer MUST emit those entries unchanged in the installed
`opencode.jsonc`. The template MUST NOT add `baseURL`, `apiKey`,
or env-interpolated credentials for built-in providers — OpenCode
already knows them.

#### Scenario: An opt-in model id is declared under openrouter

- **WHEN** `config/opencode.template.jsonc` declares
  `provider.openrouter.models["typesafe/jev-1.13"]: {}`
- **THEN** the rendered `opencode.jsonc` MUST contain the same
  entry, and `/models` in the opencode TUI MUST list
  `openrouter/typesafe/jev-1.13` for selection

### Requirement: Built-in providers require no repo-side auth plumbing

OpenCode stores per-provider API keys in
`~/.local/share/opencode/auth.json` after `/connect`. The repo MUST
NOT introduce a project-level env var, `.env` file, `install.sh`
rc-append, or validator gate for those keys. A user who has not
run `/connect` MUST see the model in `/models` and only fail when
they actually invoke it — never at install time, never at template
render, never at validator run.

#### Scenario: User has not run /connect yet

- **WHEN** the user runs `/models` without having completed
  `/connect` for OpenRouter
- **THEN** `openrouter/typesafe/jev-1.13` STILL appears in the
  picker, and selection + invocation is what surfaces the
  credential error (HTTP 401 from OpenRouter), NOT a pre-flight
  validator or install-time failure

#### Scenario: User has completed /connect

- **WHEN** the user completes `/connect` for OpenRouter and then
  sets `model: "openrouter/typesafe/jev-1.13"` on an agent block
- **THEN** invocation succeeds through OpenRouter's gateway without
  any repo-side env var being set, sourced, or appended to a shell
  rc file

### Requirement: Opt-in model ids stay opt-in across all profiles

No entry in `config/model-profiles.json` MAY auto-assign an opt-in
model id (declared under `provider.<name>.models`) to any agent
or command. Agents opt in by editing their own block. The
`personal` profile MUST render the same baseline after this change
as it did before, plus the new opt-in declaration under the
provider's `models` map — no default agent or command model
assignment moves.

#### Scenario: Personal profile baseline is preserved

- **WHEN** `./install.sh` runs after the change is applied
- **THEN** `node scripts/test-model-profiles.mjs` MUST still report
  the `personal` baseline as matching the documented current
  assignment, and every agent/command model assignment MUST equal
  its documented pre-change value

### Requirement: README documents the opt-in model flow

The README MUST contain an "External / opt-in model ids" subsection
that explains: (1) `/connect` is what stores the API key in
OpenCode's auth store, with no repo-side env file involved; (2)
`/models` is how the user picks the opt-in id; (3) the sample
id `openrouter/typesafe/jev-1.13` is opt-in by editing an
agent's `model:` line to `"openrouter/typesafe/jev-1.13"`; (4)
model output is signal-not-authorization for irreversible actions.

#### Scenario: A user navigates to the opt-in subsection

- **WHEN** the user opens the README and reaches "External /
  opt-in model ids"
- **THEN** the subsection MUST be present and MUST cover the four
  points above, naming `openrouter/typesafe/jev-1.13` as the
  example opt-in
