---
name: router
description: Router for user-invoked skills. Names each operation-specialized skill and when to reach for it. Load manually.
---

A flat index of the operation-specialized skills that are not auto-loaded.
These skills are `deny`-hidden under `permission.skill` in `opencode.jsonc`,
so the agent never sees their descriptions and the `skill` tool cannot load
them. Each one is reachable through a command wrapper that injects its
canonical `SKILL.md` from the installed path.

| Wrapper command            | Skill                  | Reach for it when…                                                          |
|----------------------------|------------------------|------------------------------------------------------------------------------|
| `/archify`                 | `archify`              | You need a polished diagram (architecture, sequence, data flow, lifecycle). |
| `/caveman-commit`          | `caveman-commit`       | You want a Conventional Commits message compressed to intent only.          |
| `/git-workflow`            | `git-workflow`         | You are committing, branching, rebasing, or recovering from a botched merge.|
| `/herdr-integration`       | `herdr-integration`    | You are editing `~/.config/opencode/plugins/herdr-agent-state.js` or chasing "herdr says wrong state". |
| `/mmx`                     | `mmx-cli`              | You need MiniMax text/image/video/speech generation or web search.           |
| `/mmx-h3-video`            | `mmx-h3-video`         | You are generating, monitoring, or downloading a MiniMax-H3 video.           |
| `/writing-great-skills`    | `writing-great-skills` | You are writing or editing a skill and want the reference for skill craft.   |

Model tiers on the wrappers: `/archify`, `/mmx`, and `/mmx-h3-video` run on
the value tier (`ollama-cloud/gpt-oss:20b`) because their work is mechanical
and read-only. The rest inherit their agent's tier.

`/dedupe` is a wrapper too, on the value tier, but `dedupe` itself stays
model-invocable.

Delivery skills that stay model-invocated (no need to invoke them by hand):
`debugging`, `surgical-patch`, `verify-and-stop`, `lean-build`,
`code-review`, `dedupe`, `investigate-first`, `safe-refactor`,
`frontend-design`, `interface-design`, `refactoring`.
