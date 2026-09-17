## Context

The OpenCode global config lives at `opencode.jsonc` (loaded once at
startup, no hot-reload). Agents are file-based under `agent/` and
referenced by name. Commands are file-based under `commands/` and linked
into `~/.config/opencode` by `install.sh`. Skills live under `skills/`
and have a frontmatter `description` that contributes to model-invocable
context every turn. MCPs are declared globally and currently all enabled
on startup.

Constraints that shape the approach:

- Per-project overrides may exist; nothing in this design changes the
  load order or the merge semantics defined by OpenCode.
- The user runs the install script and restarts OpenCode to apply any
  config change. We must respect that workflow.
- `subagent_depth` defaults to `1`; we plan around that.
- `tools` is deprecated; `permission` is the supported replacement.
- The current setup already classifies work as `small` / `medium` /
  `spec-required` in `agent/plan.md` and `agent/build.md`. We extend that
  classification into a routing contract.

See `proposal.md` for the motivation.

## Goals / Non-Goals

**Goals:**

- Make session cost predictable from the work classification alone.
- Migrate from global `permission: "allow"` to a deny-by-default baseline
  with explicit per-role grants.
- Keep the agent set stable; do not invent new roles unless the routing
  contract requires it.
- Keep the install/restart contract intact; the user still restarts after
  pulling changes.
- Produce a verifiable policy: a static check confirms that no agent
  declares `tools`, no MCP runs for an agent that does not need it, and
  no two skill descriptions share a duplicated clause.

**Non-Goals:**

- Rewriting OpenCode internals; we only touch config and prompt files in
  this repo.
- Changing the OpenSpec CLI workflow (`/opsx-*`) beyond de-duplicating the
  divergent command copies.
- Introducing project-local overrides beyond what the agent-routing
  contract already permits.
- Replacing any skill wholesale; we adjust frontmatter and disclose deep
  content behind references, but we do not retire skills.

## Decisions

### Decision: depth-1 topology as the default

We adopt `subagent_depth = 1` as the global default. Specialists return
to the dispatcher; they do not dispatch further.

Alternatives considered:

- **depth-0**: only the primary agent runs. Predictable, but the
  existing build/plan/architect contract explicitly relies on specialists
  for stack-specific knowledge. Rejected.
- **depth-2 globally**: matches today's prompt-level expectations but
  multiplies prompt, tool calls, and context per session. Rejected.
- **depth-1 with depth-2 override for `orchestrator` and `refactor`**:
  chosen. The two roles that already manage nested work keep their
  existing nesting budget. `subagent_depth` per agent in OpenCode is per
  agent, not global, but for v1 we set the global baseline and rely on
  the per-agent override on the two special cases.

### Decision: routing matrix lives in `agent/build.md` and a dedicated `agent/routing.md`

The classification-to-routing matrix in `specs/agent-routing/spec.md` is
authoritative. We mirror it in two places:

1. `agent/build.md` — the dispatcher reads it before any tool call.
2. A new `agent/routing.md` referenced by `build.md` for the full matrix.
   This keeps the body of `build.md` short while keeping the matrix
   model-invocable.

Alternatives considered:

- **Inlining the matrix in `build.md`**: bloats the always-loaded prompt.
  Rejected.
- **Pure skill-only**: would require the agent to remember to load the
  skill before classification. Rejected — classification must happen
  before any tool call, so it must live in the agent prompt.

### Decision: deny-by-default permission baseline

We replace the global `permission: "allow"` with a structured baseline:

```jsonc
"permission": {
  "edit": "ask",
  "bash":  { "*": "ask" },
  "task":  "deny",
  "external_directory": "deny",
  "webfetch": "ask",
  "websearch": "ask",
  "lsp": "allow"
}
```

Each agent adds the specific grants it needs in its own `permission`
block. `p5t-installer`, `architect`, and `refactor` carry explicit
justified overrides.

Alternatives considered:

- **`"ask"` everywhere**: too noisy. Many delivery flows need to read,
  edit, and shell freely. Rejected.
- **Allow by default with per-agent deny**: harder to audit, easier to
  leak. Rejected.

### Decision: MCP exposure by `permission`, not by `tools`

We migrate every existing `tools` block in `opencode.jsonc` to a
`permission` rule that gates the corresponding `mcp_*` tool family. We
keep the MCPs declared globally in `opencode.jsonc` so OpenCode still
starts them, and we rely on `permission` to hide them from agents that
should not see them.

Alternatives considered:

- **Disabling MCPs per agent**: OpenCode does not yet expose a stable
  per-MCP enable flag at the agent level. Restricting by `permission` is
  the supported lever. Chosen.
- **Separate OpenCode configs per role**: too invasive; breaks the
  single-install story. Rejected.

### Decision: explicit context budget at the global scope

We set the following defaults once, at the global `opencode.jsonc`:

```jsonc
"tool_output": { "max_lines": 400, "max_bytes": 16384 },
"compaction": {
  "auto": true,
  "prune": true,
  "tail_turns": 6,
  "preserve_recent_tokens": 4000,
  "reserved": 2000
}
```

Per-agent overrides (`steps` and per-agent `tool_output`) follow the
budget matrix in `specs/context-budget/spec.md`.

Alternatives considered:

- **Per-agent compaction config**: OpenCode does not yet support a
  per-agent override of compaction. We document the desired behaviour
  in the spec and revisit when the schema catches up. For v1 we set
  the global defaults and accept the limitation.
- **Tighter caps**: would force agents to re-fetch frequently. Rejected
  at v1; the metric counters from the spec drive any later tightening.

### Decision: skill surface is split by invocation mode

We move `archify`, `herdr-integration`, `mmx-cli`, `caveman-commit`,
`git-workflow`, and `writing-great-skills` to
`disable-model-invocation: true`. We add a new user-invoked
`skills/router.md` (or repurpose an existing one) that lists the
user-invoked skills and when to reach for each.

We extend `interface-design` with a `references/` folder and shrink
`SKILL.md` to the router plus context pointers. `archify` already uses
this pattern; we formalize it.

Alternatives considered:

- **Deleting rarely-used skills**: risks losing tacit knowledge. The
  router pattern preserves them at zero model-invocable cost. Chosen.
- **Single skill with many triggers**: duplicates `description` clauses
  and trips the description-pruning check from the spec. Rejected.

### Decision: de-duplicate `/opsx-*` by linking, not copying

We delete the copies under `.opencode/commands/` and rely on the global
`commands/` (linked by `install.sh` to `~/.config/opencode/commands`).
For each `/opsx-*` command, the canonical version lives once at the
repo root.

Alternatives considered:

- **Generating the local copies from the global ones at install time**:
  adds complexity to `install.sh`. Rejected.
- **Keeping the local copies in sync manually**: today's failure mode.
  Rejected.

### Decision: a static validator script

We add `scripts/validate-config.mjs` that checks:

- No agent declares `tools`.
- The union of `permission` rules across agents covers every MCP tool
  family referenced in `mcp`.
- The union of model-invoked skill descriptions is under 3000 characters.
- No two model-invoked skill descriptions share a clause longer than 12
  words.
- The routing matrix in `agent/build.md` references an existing
  `agent/routing.md`.

`install.sh` calls the validator before linking and refuses to proceed
on failure. CI (out of scope here) would call the same validator.

Alternatives considered:

- **JSON Schema validation only**: catches shape but not policy. We
  keep the schema check via OpenCode's `$schema` and add the static
  policy check on top.
- **Lint via existing formatters**: formatters do not enforce this
  policy. Rejected.

## Risks / Trade-offs

- **[Risk]** Per-agent `compaction` overrides are not yet first-class in
  OpenCode. → **Mitigation**: set global defaults; document the
  desired per-agent behaviour in the spec; revisit when the schema
  supports it. The metric counters flag sessions that need tighter
  budgets.
- **[Risk]** Permission-based MCP gating depends on OpenCode's stable
  interpretation of `permission` for `mcp_*` tool families. → **Mitigation**:
  add the static validator and a smoke test that opens an agent and
  confirms the expected tools are visible.
- **[Risk]** Users may notice slower discovery of operation-specialized
  skills (no longer in the system prompt). → **Mitigation**: ship the
  router skill and document the trade-off in `README.md`.
- **[Risk]** Tightening `tool_output` truncates some long `grep` or
  `read` results mid-analysis. → **Mitigation**: keep truncation paths
  discoverable in the truncated footer; document that agents should
  follow the pointer when context allows.
- **[Risk]** Moving skills to user-invocation may break workflows that
  currently rely on the agent auto-loading them. → **Mitigation**:
  audit each affected skill with the project workflow before flipping
  the flag; keep `archify` and `mmx-cli` reachable via explicit `/skill`
  invocation.
- **[Trade-off]** The deny-by-default permission baseline produces more
  confirmation prompts in delivery work. We accept the friction in
  exchange for a verifiable audit surface.
- **[Trade-off]** Removing divergent `/opsx-*` copies simplifies
  maintenance but temporarily breaks any local edits the user had on
  the deleted files. We surface this in the migration plan.

## Migration Plan

1. Land the change behind a feature branch (`refactor/agent-routing`).
2. Update `opencode.jsonc` with the new global defaults (`tool_output`,
   `compaction`, `permission` baseline, removed `tools` field).
3. Update each agent file under `agent/` with its own `permission`
   block and any `steps` override.
4. Delete `.opencode/commands/opsx-*.md`; rely on the global ones.
5. Move large skill content into `references/`; flip
   `disable-model-invocation` on the operation-specialized skills; add
   `skills/router/SKILL.md`.
6. Add `scripts/validate-config.mjs` and wire it into `install.sh`
   before the `link` calls.
7. Smoke test: open an agent session, confirm tool surface, confirm
   routing, confirm metrics.
8. Document the change in `README.md` under a new "Routing, budgets,
   and MCPs" section.

**Rollback strategy**: revert the merge commit. The install script and
validator are additive; the worst rollback side effect is that an old
`opencode.jsonc` is restored to the previous `permission: "allow"`
state, which is a known-good configuration.

## Open Questions

- Whether `subagent_depth` should be declared globally or per-agent in
  this OpenCode version. We set the global baseline for v1 and treat
  per-agent depth as an OpenCode enhancement to track.
- Whether the metrics block should be rendered by a dedicated plugin or
  by the agents themselves. **Decision: prompt contract for v1.** A
  plugin is heavier than the benefit and would add another moving part
  to the OpenCode restart loop. The `build`, `qa`, and `adversarial`
  agents emit a fenced metrics block in their final assistant message
  using a stable shape (input tokens, output tokens, tool-call count,
  subagent-dispatch count, class distribution, compaction events). A
  future plugin can harvest that block without changing the contract.
