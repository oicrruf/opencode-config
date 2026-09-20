## 1. Fix the phantom planning model

- [x] 1.1 Replace `openai/gpt-5.6-terra-fast` with `openai/gpt-5.6-luna` in `agent/plan.md` frontmatter and in the body sentence that names the model ("You run on ..."); verify no occurrence of `terra-fast` remains in the repo
- [x] 1.2 Replace `"model": "openai/gpt-5.6-terra-fast"` with `"model": "openai/gpt-5.6-luna"` in the `plan` block of `opencode.jsonc`; verify the JSONC still parses and the value matches the frontmatter
- [x] 1.3 Retarget the `model:` in `commands/opsx-propose.md` from `openai/gpt-5.6-terra` to `openai/gpt-5.6-luna`; verify `/opsx-propose` still runs the planning step on the planning tier

## 2. Move the value-tier roles to Ollama Cloud

- [x] 2.1 Set `explore` to `ollama-cloud/gpt-oss:20b` in `opencode.jsonc` and add a matching `agent/explore.md` only if the built-in override requires a file; verify the id resolves via the catalog check from task 4.1
- [x] 2.2 Set `p5t-installer` to `ollama-cloud/gpt-oss:20b` in `agent/p5t-installer.md` frontmatter and in the `opencode.jsonc` block; verify both agree
- [x] 2.3 Set the global `small_model` in `opencode.jsonc` from `minimax/MiniMax-M2.7-highspeed` to `ollama-cloud/gpt-oss:20b`; verify the id resolves and the field still validates against `https://opencode.ai/config.json`
- [x] 2.4 Confirm no model assignment names the excluded `ollama-cloud/nemotron-3-nano:30b`, which failed the tool-calling probe; verify by grep over `agent/*.md`, `commands/*.md`, and `opencode.jsonc`

## 3. Reconcile the agent-routing spec with the effective config

- [x] 3.1 Apply the change's `specs/agent-routing/spec.md` delta to `openspec/specs/agent-routing/spec.md`: the class matrix (`small` → `gpt-oss:20b`, `spec-required` planning → `luna`), the tier table, the explicit `p5t-installer` entry, and the unconditional-Terra clause for `adversarial`
- [x] 3.2 Verify no requirement in `openspec/specs/agent-routing/spec.md` still names `openai/gpt-5.6-terra-fast` or claims a mode-dependent model; verify `openspec validate --specs --strict` passes
- [x] 3.3 Update `agent/routing.md` so its class table, per-agent table, and model ids match the reconciled spec exactly; verify with the cross-check from task 5.2

## 4. Validate model ids at install time

- [x] 4.1 Add a catalog check to `scripts/validate-config.mjs` that collects every `model:` value from `agent/*.md`, `commands/*.md`, and `opencode.jsonc` (`agent.*.model` plus `small_model`), loads `~/.cache/opencode/models.json` when present, and fails with the file and id for any unresolved pair; skip with a printed notice when the catalog is absent or unparseable
- [x] 4.2 Verify the check catches a planted violation: temporarily set one agent to `openai/gpt-5.6-terra-fast` and confirm the script exits non-zero naming that id, then restore the file
- [x] 4.3 Verify the check skips cleanly by pointing it at a non-existent catalog path (or renaming the cache) and confirming it prints the skip notice and exits zero

## 5. Verification

- [x] 5.1 Run `node scripts/validate-config.mjs` and confirm `validate-config: OK` with the real catalog present
- [x] 5.2 Cross-check that `agent/*.md` frontmatter `model` and `opencode.jsonc` `agent.*.model` agree for every agent, and that `plan` is `luna` in both; report any mismatch
- [x] 5.3 Run `openspec validate model-tiering-and-plan-fix --strict` and `openspec validate --specs --strict`; both must pass
- [x] 5.4 Confirm the tier assignment end to end: Terra for `architect`/`orchestrator`/`refactor`/`adversarial`/`cotizador`, `luna` for `plan`, M3 for `build`/`general`/`frontend`/`backend`/`qa`, `gpt-oss:20b` for `explore`/`p5t-installer`/`small_model`; verify against `agent/routing.md`
