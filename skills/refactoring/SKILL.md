---
name: refactoring
description: Catalog of refactor patterns — extract, inline, rename, move, introduce, change signature — with when to apply each, the mechanical steps, and the safety checks. Use when restructuring code without changing behavior, reducing duplication, clarifying intent, or preparing for a feature.
---

# refactoring

Mechanical transformations that improve code structure **without changing
observable behavior**. The test suite is your safety net: a refactor is
done correctly when all tests pass before and after, with no new tests
needed for the refactor itself (regression tests are separate).

## When to refactor

- **Rule of three**: the third time you write similar code, refactor.
- **Before adding a feature**: clean the area first so the feature fits
  the new shape.
- **During code review**: when you spot a smell, propose a refactor
  before approving.
- **Never during a hotfix**: focus on the fix; refactor in a follow-up.

## When NOT to refactor

- Right before a release. Refactors add risk to a stable moment.
- When you don't have tests covering the area.
- When the user didn't ask and the change is large.
- When "it would be cleaner" but the current shape works and is short.

## The catalog

Each pattern lists: **when**, **how**, **verify**.

### Extract Function
- **When**: a block of code does one logical thing but lives inline;
  it has a name begging to exist; or it makes the parent function too long.
- **How**: copy the block into a new function with a descriptive name;
  pass the needed inputs as parameters; replace the original block with
  a call.
- **Verify**: tests still pass; the new function reads as one idea;
  callers haven't grown parameters.

### Extract Variable
- **When**: a complex expression is hard to read; or the same sub-expression
  appears twice.
- **How**: assign the sub-expression to a named variable. Inline the
  variable back if it makes the code less clear.
- **Verify**: the name carries the meaning; the line still fits.

### Inline Function / Variable
- **When**: the body is as clear as the name; or the indirection adds
  no value.
- **How**: replace the call site with the body; delete the function.
- **Verify**: no information lost; the call site reads cleanly.

### Rename
- **When**: the current name misleads, or new convention emerged.
- **How**: rename across the codebase; update tests, docs, comments.
  Use `grep` to find every reference.
- **Verify**: nothing references the old name; tests still pass.

### Move Function / Class
- **When**: a function uses more features of another module than its own;
  or it lives in the wrong context.
- **How**: move the function and its dependencies; update callers;
  re-export if needed.
- **Verify**: callers updated; tests for the moved function still pass.

### Change Function Signature
- **When**: adding a parameter, removing one, or reordering.
- **How**: change the signature; update all callers; consider
  default values for backwards compatibility.
- **Verify**: callers compile/pass tests; behavior unchanged for valid
  inputs; default values match old behavior for omitted args.

### Replace Conditional with Polymorphism
- **When**: a `switch` or `if/else` chain dispatches on type/tag and
  each branch is meaningful.
- **How**: create a type per branch; push the branch behavior into the
  type's method; replace the switch with a virtual call.
- **Verify**: each type's behavior unchanged; no branch forgotten.

### Introduce Parameter Object
- **When**: a function takes 3+ related parameters that travel together.
- **How**: group them into a struct/object; update callers to pass the object.
- **Verify**: callers simplified; the object has a clear name.

### Replace Magic Number with Constant
- **When**: a literal value appears in code without context.
- **How**: name it. If the value depends on context, compute it from a
  config value.
- **Verify**: the name conveys intent; the constant is referenced from
  one place if possible.

### Decompose Conditional
- **When**: a complex `if (condition) { ... } else { ... }` where the
  condition or each branch is hard to read.
- **How**: extract the condition into a named function (`isEligibleForDiscount`);
  extract each branch into its own function.
- **Verify**: the conditional reads as a sentence; branches read as
  paragraphs.

### Pull Up / Push Down
- **When**: two subclasses share behavior that should be in the parent
  (pull up); or a parent's behavior is used by only one child (push down).
- **How**: move the method to the appropriate level; update overrides.
- **Verify**: each subclass's behavior unchanged; polymorphism still works.

### Replace Inheritance with Delegation
- **When**: an inheritance relationship is forced and the child doesn't
  really "is-a" of the parent.
- **How**: make the parent a field; delegate calls to it.
- **Verify**: behavior unchanged; composition reads more naturally.

## The order of operations

When doing several refactors in one pass, **commit after each** so you
can revert cleanly:

1. Extract small things first (variables, constants).
2. Rename for clarity.
3. Extract functions.
4. Move functions/classes.
5. Change signatures last (they ripple the most).

Never combine a refactor with a feature in one commit. The diff becomes
un-reviewable and revert becomes coarse.

## Safety checks

- Run the test suite **before** the refactor (baseline).
- Run it **after each commit**, not just at the end.
- If a test fails, revert the last change and rethink.
- For UI: take a screenshot before and after; pixel-diff if possible.
- For APIs: capture the request/response of a representative call
  before and after.
- For performance: measure before and after; a refactor shouldn't regress
  latency/throughput.

## Reporting a refactor

When handing back a refactor:
- What was extracted/renamed/moved, with file references.
- Behavior preserved (cite the test run).
- Any callers updated.
- Risks not addressed (e.g., "didn't rename public API for compatibility").
