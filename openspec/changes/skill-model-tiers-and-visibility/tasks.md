## 1. Hide the operation-specialized skills with the mechanism opencode implements

- [x] 1.1 Add a `skill` block to the global `permission` in `opencode.jsonc` with `"*": "allow"` plus a `deny` entry for each of `archify`, `caveman-commit`, `git-workflow`, `herdr-integration`, `mmx-cli`, `mmx-h3-video`, `router`, and `writing-great-skills`; verify the JSONC still parses
- [x] 1.2 Verify the deny patterns are exact skill names (not wildcards that would also hide a delivery skill) and that the eight names match `name:` in each `SKILL.md`
- [x] 1.3 Confirm no delivery skill named in the spec's model-invocable list (`debugging`, `surgical-patch`, `verify-and-stop`, `lean-build`, `code-review`, `dedupe`, `investigate-first`, `safe-refactor`, `frontend-design`, `interface-design`, `refactoring`) is denied

## 2. Command wrappers that inject the canonical skill

- [x] 2.1 Create `commands/archify.md`, `commands/caveman-commit.md`, `commands/git-workflow.md`, `commands/herdr-integration.md`, `commands/router.md`, `commands/writing-great-skills.md` — each with `description`, `agent: build`, `subtask: true`, and a body that injects `~/.config/opencode/skills/<name>/SKILL.md` via a shell expansion, plus a one-line instruction to follow it
- [x] 2.2 Create `commands/mmx.md` injecting the `mmx-cli` skill, and `commands/mmx-h3-video.md` injecting the `mmx-h3-video` skill (note the nested path `skills/mmx-cli/h3-video/SKILL.md`)
- [x] 2.3 Verify none of the wrappers embeds a copy of the skill body; each SHALL contain only the injection line and a pointer

## 3. Model tiers on the wrappers

- [x] 3.1 Set `model: ollama-cloud/gpt-oss:20b` on `/archify`, `/mmx`, and `/mmx-h3-video` (mechanical, read-only) and on the new `/dedupe`
- [x] 3.2 Create `commands/dedupe.md` with `model: ollama-cloud/gpt-oss:20b`, `agent: build`, `subtask: true`, injecting the canonical `dedupe` skill
- [x] 3.3 Verify the refactor/debug/review skills are NOT given a wrapper on a cheaper tier; confirm no `model:` was added to any `SKILL.md`

## 4. Keep the validator honest

- [x] 4.1 Change the description-budget computation in `scripts/validate-config.mjs` so it derives the hidden set from the `deny` patterns under `permission.skill` in `opencode.jsonc` instead of from the `disable-model-invocation` frontmatter flag
- [x] 4.2 Verify the computed visible total is under 3000 with the real config (expected ≈2653) and that adding a `deny` for a visible skill lowers it
- [x] 4.3 Add a check that every skill path referenced by a wrapper command in `commands/*.md` exists on disk; verify it fails when a referenced path is renamed away, then passes again
- [x] 4.4 Keep the existing checks (deprecated `tools`, broad `allow`, MCP coverage, model-id resolution, install ordering) passing

## 5. Verification

- [x] 5.1 Run `node scripts/validate-config.mjs` and confirm `validate-config: OK`, with the budget reported from the real hidden set
- [x] 5.2 Run `openspec validate skill-model-tiers-and-visibility --strict` and `openspec validate --specs --strict`; both must pass
- [x] 5.3 Confirm the eight hidden skills are exactly the ones the spec names as user-invoked, and that every one of them has a working wrapper
- [x] 5.4 Report the before/after budget numbers (3620 → ≈2653) as evidence the visibility fix is real, not flag-dependent

## 6. Runtime acceptance harness

- [x] 6.1 Add `scripts/acceptance-harness.mjs` that exercises a running opencode process (`opencode run --format json`, `opencode export`, `opencode debug agent`) instead of only reading config files, with groups `static`, `routing`, `skills`, `wrappers` and a `--live` flag for the runtime assertions
- [x] 6.2 Probe a live command and record the defect: a `subtask: true` child inherits the invoking agent's model and discards the command's `model:`; capture the `task` metadata as evidence
- [x] 6.3 Remove `subtask: true` from the nine skill wrappers and verify `/dedupe` then runs on `ollama-cloud/gpt-oss:20b` with the canonical skill injected
- [x] 6.4 Assert the denied skill cannot be loaded at runtime, accepting either a rejected tool call or removal from the advertised skill list, and assert the skill body never leaks into the session
- [x] 6.5 Run the harness in both modes and confirm 11/11 live and exit 0
