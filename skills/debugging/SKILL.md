---
name: debugging
description: Systematic debugging approach — reproduce, isolate, hypothesize, instrument, fix, verify. Use when a bug is reported, an error appears, a test fails, behavior differs from expectation, or production is misbehaving. Generic across stacks.
---

# debugging

A repeatable approach to debugging. Don't guess — **follow the steps**,
and the bug becomes mechanical to find.

## The six steps

### 1. Reproduce
Get the bug to happen on demand. Without a reliable repro, you can't
verify a fix.

- Find the **minimum input** that triggers the bug.
- Note the exact environment (versions, OS, env vars, network state).
- Note what **should** happen vs what **does** happen.
- If you can't reproduce, gather more data: logs, screenshots, traces.

### 2. Isolate
Find the **smallest scope** where the bug lives.

- Bisect the input: which field/argument changes the behavior?
- Bisect the code: which function changes the behavior? Use git bisect
  if the regression is in history.
- Bisect the environment: same code, different env — same bug?
- The bug is at the boundary between what works and what doesn't.
  Find that boundary.

### 3. Hypothesize
Form **explicit, testable hypotheses** ranked by likelihood.

- "X is null when it shouldn't be."
- "The function is called twice when it should be called once."
- "The state is shared between requests when it shouldn't be."

A hypothesis is testable if you can design an experiment that
**disconfirms** it. If you can't, sharpen the hypothesis.

### 4. Instrument
Add observations, not assumptions.

- Logs at the boundary of the suspected scope (in/out values).
- Traces for async/IO calls (when did it start, when did it end).
- Counters for "how many times did this run".
- For UI bugs: screenshot, DOM state, network tab.
- For perf: profile, don't time individual calls.
- **Make the instrumentation toggle-able**, not permanent. Commit
  removals of debug logs before merging.

### 5. Fix
The fix should be **minimal** and **targeted** to the root cause.

- Don't fix symptoms; fix causes.
- Don't expand scope ("while I'm here, also refactor X").
- If the fix reveals more bugs, file them and stay focused on this one.
- Add a **regression test** that fails without the fix and passes with it.
- The regression test is the most valuable part of the fix.

### 6. Verify
Prove the fix works and didn't break anything else.

- The repro now passes.
- All existing tests pass.
- The new regression test passes.
- A second, related scenario also passes (e.g., not just "the bug is gone"
  but "the feature works under variants").
- If you can, deploy to a staging environment and observe.

## Debugging patterns

### "Works on my machine"
Diff environments:
- Versions (runtime, deps, system libs).
- Env vars and config files.
- Filesystem state (caches, lock files).
- Network state (DNS, proxies, certificates).
- Time/clock (timezone, NTP drift).
- Locale and encoding.

### "It works intermittently"
Concurrency or external dependency is suspect.
- Race conditions: add ordering constraints.
- Rate limits: check the dependency's response headers.
- Clock drift: log timestamps with high precision.
- Garbage collection / event loop: add timing instrumentation.

### "It used to work"
A regression. Use `git bisect` to find the commit that introduced it.
- `git bisect start`
- `git bisect bad` (current state)
- `git bisect good <last-known-good-sha>`
- Then mark each step `good` or `bad` until bisect pinpoints the culprit.

### "The error message is misleading"
Read the **call site**, not just the error. The error tells you where
it failed; the call site tells you **why it was called that way**.

### "I have no idea what's happening"
Start from the outside and work in:
- Is the request reaching the system? (logs, network traces)
- Is the system processing it? (state changes, side effects)
- Is the right code path being taken? (logs at decision points)
- Is the data what you expect? (log the inputs at each step)

## Anti-patterns

- **Guess and check** — randomly changing things hoping it works.
- **Defensive code without root cause** — adding null checks everywhere
  instead of finding why nulls appear.
- **Catching and swallowing** — hiding errors that you don't understand.
- **Commenting out failing code** — pretending the problem doesn't exist.
- **Reboot and retry** — works sometimes, but masks intermittent bugs.

## Reporting a debug session

When you finish, write up:
- Repro steps (so someone else can verify).
- Root cause (1-2 sentences).
- Why it happened (the chain of conditions that made it possible).
- Fix description.
- Regression test reference.
- Follow-ups (related risks not addressed yet).
