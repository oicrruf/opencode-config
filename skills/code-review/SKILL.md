---
name: code-review
description: Generic code review checklist for style, naming, error handling, testability, and conventions. Use when reviewing a diff before commit, before PR, or before merge — to complement the adversarial agent (which focuses on security/correctness) with style-level concerns.
---

# code-review

Generic review checklist applied to a diff. Complements the `adversarial`
agent: that one focuses on security, correctness, and broken assumptions;
this skill focuses on **legibility, maintainability, and convention drift**.

## When to apply

- Before committing a non-trivial change.
- Before opening or merging a PR.
- After a series of edits, as a final polish pass.
- When the user asks "review", "está limpio?", "faltan tests?", "se entiende?".

## Checklist (in order)

### 1. Naming
- Functions/classes describe **what they do**, not **how they do it**.
- Booleans read as questions: `isReady`, `hasChildren`, `canSubmit`.
- No abbreviations unless standard (id, url, db, dto, dtoId).
- Units in the name when ambiguous: `timeoutMs`, `maxRetries`, `sizeBytes`.
- No misleading names: don't call something `parse` if it doesn't parse, or
  `validate` if it doesn't validate.

### 2. Function size and shape
- <40 lines per function. If longer, look for extraction candidates.
- One level of abstraction per function. Don't mix high-level orchestration
  with low-level detail in the same body.
- Early returns over nested `if/else` chains (guard clauses).
- No "pyramid of doom" — deep nesting means a piece is in the wrong place.

### 3. Error handling
- Errors caught at the right boundary; don't swallow them silently.
- Error messages include enough context: which operation, which input.
- Public APIs return structured errors (`{code, message, details}`), not
  raw exceptions or strings.
- Async/IO code handles timeouts and cancellation explicitly.
- No bare `catch {}` or `except: pass`.

### 4. Side effects
- Pure functions stay pure. If you must add a side effect, name it.
- No global state mutation unless the project's convention.
- HTTP/server handlers are idempotent or guard against duplicates.
- File operations are atomic when possible (write to temp + rename).

### 5. Testability
- New logic is reachable from a test without spinning up the world.
- Dependencies (DB, HTTP, time, randomness) are injectable.
- Tests cover the happy path **and** at least one boundary failure.
- Test names describe the behavior, not the implementation.

### 6. Comments and docs
- Comments explain **why**, not what. The code shows what.
- No comments narrating the change ("// now we add the validation").
- Public APIs have a one-line summary.
- TODO comments include the owner and a tracking reference, not just `TODO`.

### 7. Consistency with the codebase
- Match the project's existing patterns, even if you'd write them differently.
- Don't introduce a new style in a file that uses the old style.
- Imports grouped and sorted as the project does.
- Linter/formatter is satisfied; if the project doesn't have one, the
  diff is formatted manually to match nearby code.

### 8. Dead code and scope creep
- No commented-out code in the diff. Trust git history.
- No unrelated changes ("while I was here").
- No new dependencies unless required by the change itself.
- Debug logs (`console.log`, `var_dump`, `print(...)`) removed before commit.

## Output format

For each finding, report:
- `file:line`
- `category` (from the checklist above)
- `severity`: `nit`, `minor`, `major`
- `summary` (1 line)
- `fix_hint` (1 line, optional)

End with a verdict:
- `clean` — no findings or only nits
- `needs-polish` — minor or major findings, addressable in this PR
- `needs-rework` — major findings that block the PR
