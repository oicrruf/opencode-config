## Why

Two problems in the current skill surface, both caused by relying on a
mechanism opencode does not implement.

**1. The visibility flag is inert.** Six skills declare
`disable-model-invocation: true` (`archify`, `caveman-commit`,
`git-workflow`, `herdr-integration`, `mmx-cli`, `router`, plus
`writing-great-skills`). opencode's documented skill frontmatter recognizes
only `name`, `description`, `license`, `compatibility`, and `metadata` —
"unknown frontmatter fields are ignored" — and the config schema exposes no
per-skill visibility or model field (`Config.skills` accepts only `paths`
and `urls`). The flag therefore does nothing: all seven descriptions are
still advertised to every agent. Measured against the real prompt surface,
the union of skill descriptions is **3620 characters**, over the 3000
budget in `specs/skill-surface/spec.md`. `scripts/validate-config.mjs`
reports `OK` because it honours the inert flag, so the validator silently
certifies a violated budget.

**2. Skills have no model tier.** A skill runs on the model of whichever
agent loads it, and there is no way to declare a model in `SKILL.md`. Work
that is mechanical and read-only (dedupe scanning, diagram rendering, media
CLI) therefore runs on the expensive decision-tier model of its caller,
while the skill content itself is model-independent.

The goal is a skill surface that is actually hidden where intended, within
budget, and able to run a skill on a cheaper model **without forking the
skill content** — so upstream updates to a skill keep flowing.

## What Changes

- Replace the inert `disable-model-invocation` flag with the mechanism
  opencode actually implements: `permission.skill` with `deny` patterns in
  `opencode.jsonc`. Because `deny` also rejects the `skill` tool call, each
  hidden skill gets a **user-invoked command wrapper** that injects the
  canonical `SKILL.md` content from its installed path.
- Add seven command wrappers — `/archify`, `/caveman-commit`, `/git-workflow`,
  `/herdr-integration`, `/mmx`, `/router`, `/writing-great-skills` — whose
  bodies read the canonical skill file rather than copying it, so the skill
  folder stays the single source of truth and updates propagate.
- Attach a model tier to the wrappers that benefit from a cheaper model:
  `/archify` and `/mmx` on the value tier, `/dedupe` (new) on the value
  tier. The refactor, debugging, and review skills remain on the decision
  and execution tiers because they edit code.
- Add a `/dedupe` wrapper on the value tier for the read-only dedupe scan,
  which is the most expensive description currently auto-invoked (444 chars)
  and the most mechanical use case.
- Make `scripts/validate-config.mjs` honest: compute the description budget
  from the skills that are `deny`-hidden in `opencode.jsonc` instead of from
  the inert flag, and add a check that every skill referenced by a wrapper
  command exists on disk.
- Keep `disable-model-invocation` in place only as dead metadata; the spec
  no longer relies on it.

## Non-Goals

- No change to agent models. The previous change
  (`model-tiering-and-plan-fix`) owns that.
- No forking of skill content. Every wrapper reads the canonical
  `SKILL.md`; no skill is copied per model or per tier.
- No change to `steps`, depth, MCP gating, or the routing classes.
- No removal of any skill. Hidden skills stay reachable through their
  wrapper.
