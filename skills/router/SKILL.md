---
name: router
description: Router for user-invoked skills. Names each operation-specialized skill and when to reach for it. Load manually.
disable-model-invocation: true
---

A flat index of the operation-specialized skills that are not auto-loaded.
The agent never sees these descriptions; you invoke them by name when the
task needs them.

| Skill                  | Reach for it when…                                                          |
|------------------------|------------------------------------------------------------------------------|
| `archify`              | You need a polished diagram (architecture, sequence, data flow, lifecycle). |
| `caveman-commit`       | You want a Conventional Commits message compressed to intent only.          |
| `git-workflow`         | You are committing, branching, rebasing, or recovering from a botched merge.|
| `herdr-integration`    | You are editing `~/.config/opencode/plugins/herdr-agent-state.js` or chasing "herdr says wrong state". |
| `mmx-cli`              | You need MiniMax text/image/video/speech generation or web search.           |
| `writing-great-skills` | You are writing or editing a skill and want the reference for skill craft.   |

Delivery skills that stay model-invocated (no need to invoke them by hand):
`debugging`, `surgical-patch`, `verify-and-stop`, `lean-build`,
`code-review`, `dedupe`, `investigate-first`, `safe-refactor`,
`frontend-design`, `interface-design`, `refactoring`.
