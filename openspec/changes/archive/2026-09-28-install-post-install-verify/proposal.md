## Why

`install.sh` already runs the structural `validate-config` twice
(before rendering and against the rendered output), but it does not
exercise the remaining gates (`acceptance-harness`, profile tests,
the Jev client self-tests, and `openspec validate`). Operators only
discover a broken install when they launch OpenCode and the TUI
complains, which is too late for a one-shot install workflow.

We want `./install.sh` to be the single source of truth for "this
configuration is healthy". When the install succeeds, every static
and runtime gate the repo defines SHALL also pass; when the install
fails, the operator SHALL see which gate failed and where.

## What Changes

- Add a post-install verification block to `install.sh` that runs
  the static and self-test gates against the just-installed
  configuration.
- Make each gate independently opt-out via `OPENCODE_SKIP_*` env
  variables so the operator can run a partial install when needed.
- Surface a clear summary at the end of the install ("X/Y gates
  passed") and return non-zero when any required gate fails.
- Document the new behaviour in `README.md`.

## Capabilities

### Modified Capabilities

- `mcp-profiles`: extend the install-time coverage to include the
  static policy checks and the Jev client self-tests so a successful
  install implies all gates pass.

## Impact

- `install.sh` (new post-install block, opt-out variables, summary)
- `README.md` (document the new gate contract and opt-outs)
- `scripts/acceptance-harness.mjs` (no change unless we discover a
  gap during implementation)
