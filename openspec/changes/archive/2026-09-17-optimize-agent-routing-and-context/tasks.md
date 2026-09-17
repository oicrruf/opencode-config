## 1. Routing matrix and agent classification

- [x] 1.1 Add `agent/routing.md` with the full small/medium/spec-required/audit
  matrix and verify the file is reachable from `agent/build.md` via a single
  inline pointer
- [x] 1.2 Update `agent/build.md` to require the dispatcher to classify before
  any tool call and to refuse work that needs depth greater than the configured
  `subagent_depth`; verify the new wording replaces the old "delegate to
  specialists" prose
- [x] 1.3 Update `agent/plan.md` so its scope gate references the routing matrix
  and states which model each class uses; verify the gate text matches the
  matrix in `agent/routing.md`
- [x] 1.4 Update `agent/cotizador.md`, `agent/adversarial.md`, and `agent/qa.md`
  to expose the new `targeted`/`full` mode parameter and document the risk
  signals that justify `full`; verify each agent prompt lists the same signals

## 2. Permission baseline and MCP gating

- [x] 2.1 Replace the global `permission: "allow"` in `opencode.jsonc` with the
  deny-by-default baseline and verify the file still validates against
  `https://opencode.ai/config.json`
- [x] 2.2 Migrate every `tools` block in `opencode.jsonc` to a per-agent
  `permission` rule and verify no `tools` declaration remains in any agent
  configuration
- [x] 2.3 Add a per-agent `permission` block to every file under `agent/`
  granting only the MCPs and tool families that the matrix in
  `specs/mcp-profiles/spec.md` allows; verify with the new validator
  (see task 5.1) that no agent exposes an unallowed MCP tool family
- [x] 2.4 Document each broadened permission (`p5t-installer`, `architect`,
  `refactor`) with a one-line inline justification and verify every broadened
  block has the justification comment

## 3. Context budget and compaction defaults

- [x] 3.1 Set `tool_output.max_lines` and `tool_output.max_bytes` in
  `opencode.jsonc` to the values declared in `specs/context-budget/spec.md`
  and verify the file still validates
- [x] 3.2 Set `compaction.auto`, `compaction.prune`, `compaction.tail_turns`,
  `compaction.preserve_recent_tokens`, and `compaction.reserved` to the
  declared values and verify the file still validates
- [x] 3.3 Add the `steps` value declared in the budget matrix to every agent
  that should use it; verify `opencode.jsonc` rejects any agent whose `steps`
  exceeds the class budget without a documented override
- [x] 3.4 Document the per-agent budget override policy in `README.md` under a
  new "Routing, budgets, and MCPs" section and verify the section is reachable
  from the table of contents

## 4. De-duplicate `/opsx-*` and align command model overrides

- [x] 4.1 Delete `.opencode/commands/opsx-*.md` and verify OpenCode still
  resolves the slash commands through the global `commands/` directory
- [x] 4.2 Set the model override for `/opsx-propose` and `/opsx-apply` only in
  the global command file and verify the local copies (now removed) did not
  diverge from the global ones
- [x] 4.3 Trim the OpenSpec store-selection block in every `/opsx-*` command
  to a single short paragraph and verify the trimmed commands still satisfy
  the OpenSpec workflow

## 5. Skill surface and progressive disclosure

- [x] 5.1 Add `scripts/validate-config.mjs` with the four checks described in
  the design (no `tools` declarations, MCP coverage, description character
  budget, duplicate-clause check) and verify it exits non-zero when a
  planted violation is present
- [x] 5.2 Wire `scripts/validate-config.mjs` into `install.sh` before the
  `link` calls and verify a failing validation aborts the install
- [x] 5.3 Move `archify`, `herdr-integration`, `mmx-cli`, `caveman-commit`,
  `git-workflow`, and `writing-great-skills` to
  `disable-model-invocation: true`; rewrite each description as a one-line
  human-facing summary with trigger keywords and verify the validator no
  longer counts them toward the description budget
- [x] 5.4 Add `skills/router/SKILL.md` (user-invoked) that lists the
  operation-specialized skills and when to reach for each, and verify it
  loads only when the user types its name
- [x] 5.5 Disclose the deep content of `skills/interface-design/SKILL.md`
  behind named references in a `references/` folder, keeping the body under
  8000 bytes, and verify the agent can still complete a UI design task by
  following the context pointers

## 6. Metrics and observability

- [x] 6.1 Decide between a dedicated plugin and an assistant-emitted metrics
  block and document the decision in `design.md` "Open Questions" (resolve
  before task 6.2)
- [x] 6.2 Implement the chosen metrics surface (plugin or prompt contract)
  and verify the per-session counters from `specs/context-budget/spec.md`
  appear in the final assistant message of a `build` session

## 7. Verification

- [x] 7.1 Open a `build` session against a backend project and verify no
  Playwright process is started and no `playwright_*` tool is advertised
- [x] 7.2 Open a `qa` session in `targeted` mode and verify it does not run
  coverage or accessibility checks; switch to `full` mode and verify the
  full check set runs
- [x] 7.3 Run `/opsx-propose` against a deliberate `spec-required` request and
  verify the planning step uses `openai/gpt-5.6-terra` while the
  implementation step uses `minimax/MiniMax-M3`
- [x] 7.4 Run `openspec validate --strict` on this change and on
  `openspec/specs/tui-quota-footer` to confirm no regression in existing
  specs; archive this change only after both validations pass
