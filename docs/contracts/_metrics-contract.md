## Session metrics

Every `build`, `qa`, and `adversarial` session ends with this fenced
block. The shape is the contract; if a plugin later harvests these
counters, this block is the source of truth.

```
metrics:
  class: <small|medium|spec-required|audit>
  input_tokens: <n>
  output_tokens: <n>
  tool_calls: <n>
  subagent_dispatches: <n>
  compaction_events: <n>
  files_changed:
    - <path>
  verification:
    - <command or observation>
```

Rules:

- `class` is the single class the dispatcher picked at the start of
  the session.
- `input_tokens` and `output_tokens` are the totals the model reports
  in the session; if the model does not surface them, use the most
  recent compact summary count and note `estimated: true`.
- `tool_calls` counts every tool invocation, including failed ones.
- `subagent_dispatches` counts every `task` tool call, including
  refused ones (those should also be listed in `verification`).
- `compaction_events` is `0` if no compaction happened, otherwise the
  number of compaction runs the session observed.
- `files_changed` lists every file the session wrote or modified.
- `verification` lists the verification commands the session ran
  (lint, type check, tests, screenshots, etc.) with their outcomes.
