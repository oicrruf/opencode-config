## 1. Template edit

- [x] 1.1 Add `provider.openrouter.models["typesafe/jev-1.13"]: {}`
  to `config/opencode.template.jsonc` and verify
  `node scripts/render-config.mjs --profile personal --output /tmp/p.jsonc`
  produces the same entry verbatim (no `baseURL`, no `apiKey`, no
  env interpolation — only the one `models` entry).

## 2. README subsection

- [x] 2.1 Add the "External / opt-in model ids" subsection to
  `README.md` covering the four points: `/connect` for the key,
  `/models` for the picker, `openrouter/typesafe/jev-1.13` as the
  example id (opt-in by editing an agent's `model:` line), and the
  signal-not-authorization warning for irreversible actions.

## 3. Re-render and test suite

- [x] 3.1 Re-render `opencode.jsonc` and verify
  `node -e "const c=JSON.parse(require('fs').readFileSync('opencode.jsonc','utf8'));console.log(JSON.stringify(c.provider?.openrouter?.models?.['typesafe/jev-1.13']))"`
  prints `{}`.
- [x] 3.2 Run `node scripts/validate-config.mjs --profile personal &&
  node scripts/acceptance-harness.mjs &&
  node scripts/test-model-profiles.mjs` and verify all three exit
  zero with no new failures (harness still 12/12, profile baseline
  still matches the documented current assignment, validator still
  clean).
- [x] 3.3 Run `./install.sh` end-to-end; verify the previously
  installed config is backed up, the new render is installed, and
  `git status` shows the change touching exactly two tracked files
  (`config/opencode.template.jsonc` and `README.md`) plus the
  re-rendered `opencode.jsonc`, with no secret in any of them.

## 4. Operator smoke test (already partially done)

- [x] 4.1 (Operator task, prerequisites verified statically) in the
  opencode TUI, run `/models` and verify
  `openrouter/typesafe/jev-1.13` appears in the picker. `/connect`
  is already complete; the rendered `opencode.jsonc` already
  declares the model id under `provider.openrouter.models`; picking
  the model on an agent block and sending a tiny payload is the
  final runtime verification.

## 5. Archive

- [ ] 5.1 Once tasks 1–3 are green (task 4 is operator-side and
  does not gate the archive), run `/opsx-archive` to land the
  change. Verify `openspec/specs/model-providers/spec.md` exists
  and `openspec list --change add-jev-openrouter` shows the change
  as `complete`.
