## Context

`specs/skill-surface/spec.md` assumed two things about opencode that are
false, and the config was built on them.

**The flag does not exist.** The spec required six skills to carry
`disable-model-invocation: true` so they would not consume the description
budget. opencode's skill frontmatter recognizes only `name`, `description`,
`license`, `compatibility`, and `metadata`; the docs state that unknown
fields are ignored. The config schema confirms there is nowhere to put the
flag: `Config.skills` accepts only `paths` and `urls` with
`additionalProperties: false`.

**The measurements disagreed with reality.**

| Measurement | Chars | Budget 3000 |
|---|---|---|
| Union of all skill descriptions (real prompt surface) | 3620 | over |
| Union excluding the flagged skills (what the validator computed) | 2947 | under |

`scripts/validate-config.mjs` honoured the flag, so `install.sh` reported
`validate-config: OK` while the prompt surface was 620 characters over
budget. This is the failure mode the spec's own budget requirement exists to
prevent, and the validator was manufacturing a false negative.

**The visibility mechanism that does work.** `permission.skill` accepts
`allow`, `deny`, and `ask` with wildcard patterns. `deny` has a specific
meaning: the skill is *hidden from the agent* **and** *access is rejected*.
That second half is what makes a bare `deny` insufficient on its own — it
would make the skill unreachable for the user too — and it is why this
change pairs every `deny` with a command wrapper.

## Goals / Non-Goals

**Goals**

- The description budget reflects the real prompt surface.
- Hidden skills are genuinely hidden, and still reachable by the user.
- A skill can run on a cheaper model tier without forking its content, so
  upstream updates keep propagating.
- The validator catches the two failure modes that produced this change: a
  budget computed from a flag that does nothing, and a wrapper pointing at a
  skill that no longer exists.

**Non-Goals**

- Assigning a model inside `SKILL.md`. opencode does not support it.
- Forking any skill per tier.
- Changing agent models, `steps`, depth, or MCP gating.

## Decisions

### Decision: hide the skills with `permission.skill`, not a frontmatter flag

`permission.skill` is the documented, implemented mechanism. The inert flag
is removed from the six skill files rather than left as dead metadata,
because leaving it invites the same false assumption to be reintroduced —
the previous change already had to correct a spec that relied on it.

Alternatives considered:

- **Keep the flag as documentation** — rejected: an inert field that looks
  load-bearing is exactly what made the validator lie.
- **`ask` instead of `deny`** — rejected: `ask` still advertises the skill
  and prompts on use; it does not remove the description from the prompt.

### Decision: every denied skill gets a command wrapper that injects, not copies

Because `deny` also rejects the `skill` tool call, each hidden skill needs a
path back. A wrapper with `` !`cat ~/.config/opencode/skills/<name>/SKILL.md` ``
injects the file at command-expansion time. The skill folder stays the
single source of truth: `install.sh` links `skills/` as a directory, so an
updated skill flows through with no wrapper edit.

Alternatives considered:

- **Copy the skill body into the wrapper** — rejected: that is a fork. Two
  copies drift, and the whole premise of the question was preserving
  updatability.
- **Symlink the skill into `commands/`** — rejected: a command expects
  frontmatter and a template; a raw `SKILL.md` symlink would not parse as a
  command.

### Decision: the value tier covers only mechanical, read-only skills

`/archify`, `/mmx`, `/mmx-h3-video`, and `/dedupe` are mechanical and
read-only, so they run on `ollama-cloud/gpt-oss:20b` (verified: it emits
well-formed tool calls). The `refactoring`, `safe-refactor`,
`surgical-patch`, `debugging`, `investigate-first`, and `code-review` skills
edit code or drive diagnosis and stay on the tiers of the agents that own
them. `dedupe` is the exception worth naming: it is model-invocable *and*
has a value-tier wrapper, because its 444-character description is the
largest auto-invoked one and its output is a proposal, never an edit.

Alternatives considered:

- **Move `debugging`/`investigate-first` to the value tier** — rejected: a
  weaker diagnosis costs more in repair than it saves in tokens.
- **No wrappers, only tiers** — rejected: without `deny` the budget stays
  over and the visibility half remains unfixed.

### Decision: wrappers do NOT use `subtask`

A wrapper was first written with `subtask: true` so the skill work would not
pollute the caller's context. Probing a live process showed that this
discards the declared model tier: OpenCode applies a command's `model:` to
the command's own session, but a `subtask` child is created with the
**invoking agent's** model. `/dedupe` declared `ollama-cloud/gpt-oss:20b`
and its child ran on `minimax/MiniMax-M3` — the expensive tier the wrapper
existed to avoid. The `task` tool metadata recorded
`{"providerID":"minimax","modelID":"MiniMax-M3"}` while the command frontmatter
said otherwise.

The wrappers therefore omit `subtask`. The trade-off is accepted: skill work
enters the caller's context, but the tier is honoured, which is the point of
the wrapper. A dedicated cheap agent plus `subtask` is the alternative if
context isolation later matters more than the model override.

Alternatives considered:

- **Keep `subtask: true` and drop the `model:`** — rejected: it abandons the
  feature the wrapper exists for.
- **A dedicated value-tier agent dispatched with `subtask: true`** — works
  (verified: the child runs on the agent's model), but adds an agent and a
  dispatch hop, and the command's own `model:` becomes redundant. Deferred.

### Decision: the validator derives the hidden set from the config

The budget check now reads the `deny` entries from `permission.skill`. A
second check verifies that every `cat ~/.config/opencode/skills/<path>`
injected by a wrapper resolves to a file in `skills/`. Both are static, so
`install.sh` fails before linking on either violation.

Alternatives considered:

- **Ask opencode for the live skill list** — rejected: not available to a
  static installer script, and would make install depend on a running
  OpenCode.

## Risks / Trade-offs

- **[Risk]** `permission.skill: "deny"` removes the skill from every agent,
  so a hidden skill can no longer be reached by a *subagent* mid-task.
  → **Mitigation**: the seven hidden skills are operation-specialized and
  user-triggered by design; the router index documents each wrapper. If a
  delivery flow ever needs one autonomously, remove its `deny` and re-add
  the budget headroom elsewhere.
- **[Risk]** The wrappers depend on the installed path
  `~/.config/opencode/skills/...`, which `install.sh` creates via symlink.
  On a machine where the link is absent, `/archify` injects an error string
  rather than the skill. → **Mitigation**: the path check in the validator
  catches a missing skill file in the repo; the link itself is covered by
  `install.sh`.
- **[Trade-off]** Seven new top-level commands lengthen the command surface.
  → Accepted: they replace a broken visibility mechanism, and each name
  matches the skill it reaches.
- **[Risk]** `mmx-cli/h3-video` is a nested skill; its wrapper path
  (`skills/mmx-cli/h3-video/SKILL.md`) is unusual and easy to get wrong.
  → **Mitigation**: the path check validates it like any other.

## Migration Plan

1. Add the `skill` deny block to `permission` in `opencode.jsonc`.
2. Create the eight wrappers (seven hidden skills plus `/dedupe`).
3. Remove the inert `disable-model-invocation` flag from the six skill files.
4. Rewrite the budget and path checks in `scripts/validate-config.mjs`.
5. Update `skills/router/SKILL.md` to index wrappers instead of raw names.
6. Verify, then restart OpenCode.

**Rollback strategy**: revert the commit. Removing the deny block restores
the previous (over-budget but working) surface; no schema, dependency, or
permission outside `skill` changes.

## Open Questions

- Whether the seven hidden skills should also be denied to specific
  *subagents* only, rather than globally, once per-agent `permission.skill`
  is exercised. Deferred: the global deny matches how they are used today.
- Whether the description budget should drop below 3000 now that the real
  surface is 2653. Deferred to the metrics surface.
