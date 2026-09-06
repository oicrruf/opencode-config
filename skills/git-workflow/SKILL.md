---
name: git-workflow
description: Git workflow conventions — atomic commits, branch hygiene, revert strategy, history rewriting, and conflict resolution. Use when committing changes, drafting a PR description, deciding how to split work into commits, recovering from a botched merge, or rebasing. Applies to any project.
---

# git-workflow

Generic git conventions that travel with the repo. Apply these unless the
project has explicit overrides in `AGENTS.md` or `CONTRIBUTING.md`.

## Commit hygiene

### Atomic commits
- **One commit = one logical change.** Each commit should be revertible
  independently without leaving the repo in a broken state.
- Don't bundle a refactor with a feature, or a format pass with a fix.
- If a task has multiple subtasks → split into commits, **or** wait for
  the whole unit; never commit "a medias" to avoid losing the change.
  Use `git stash` to hold partial work.

### Commit message format
- **Subject line**: 50 chars max, imperative mood, no trailing period.
  - ✅ `add user-scoped cache key`
  - ❌ `Added the cache key for users.` (past tense, period)
- **Body**: wrap at 72 chars, explain **why**, not what. The diff shows
  what; the body explains reasoning, trade-offs, follow-ups.
- **Footer**: reference issues, breaking changes, co-authors.
- Use conventional prefixes when the project uses them: `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`.

### What to commit
- Code, tests, config — yes.
- Generated files (build output, lockfiles that drift) — usually no, unless
  the project requires them.
- Debug code, commented-out code, scratch notes — never.
- Secrets — never. Rotate if accidentally committed.

### What NOT to do in commits
- Don't commit secrets, even with `git rm --cached` later (rotate the secret).
- Don't rewrite published history unless the project policy allows it.
- Don't bundle unrelated changes "to save a commit".

## Branch hygiene

- Default branch (`main`/`master`) is **always deployable**.
- Feature branches: `<type>/<short-kebab-description>` (e.g., `feat/user-cache`,
  `fix/polylang-redirect`).
- Hotfix branches: `hotfix/<short-description>`.
- Delete branches after merge (locally and on remote).
- Long-lived branches need a reason in `AGENTS.md` or equivalent.

## Reverting and recovering

| Situation | First move |
|---|---|
| Commit not pushed, broke build | `git reset --soft HEAD~1` (keep changes staged) |
| Commit pushed, not yet merged | `git revert <sha>` (creates a revert commit) |
| Merge botched | `git merge --abort` if still in progress |
| Rebase botched | `git rebase --abort` |
| Lost work after reset | `git reflog` then `git reset --hard <sha>` |
| Need to recover a deleted branch | `git reflog` then `git checkout -b <name> <sha>` |

## History rewriting

- **Before push**: rewrite freely (rebase, squash, reword, fixup).
- **After push, before merge**: rewrite only with team agreement.
- **After merge**: never rewrite shared history. Use revert commits.

Interactive rebase (`git rebase -i`) cheatsheet:
- `pick` — keep the commit as-is.
- `reword` — change the message.
- `edit` — stop to amend the commit.
- `squash` — combine with the previous commit, edit message.
- `fixup` — combine with the previous commit, drop the message.
- `drop` — discard the commit.

## Conflict resolution

When a conflict appears:
1. **Don't panic-merge**. Read both sides.
2. Identify which version is **semantically correct** for the current goal.
3. Resolve each hunk deliberately. Don't take "all mine" or "all theirs"
   without thinking.
4. After resolution, run the project's tests, not just `git status`.
5. If the conflict is structural (divergent designs), escalate to the
   author of the other side — don't guess.

## Stash discipline

- Use `git stash push -u -m <message>` (always with a message).
- `git stash list` regularly to clean up old stashes.
- Prefer `git stash push <path>` for partial stashes over whole-tree.
- After pulling or rebasing, **never** blindly `git stash pop` — verify
  the changes still apply cleanly first.

## PR description template

When drafting a PR or change summary:

```markdown
## Why
<one paragraph: problem, motivation, context>

## What
<bullet list of changes by area, with file references when useful>

## How
<brief: approach, alternatives considered, trade-offs>

## Testing
<what you tested, how, and what wasn't covered>

## Risk
<what could break, rollback plan>

## Follow-ups
<things deferred, known limitations>
```
