## Context

See `proposal.md`. Today the install script validates the rendered
config twice but does not exercise the rest of the repo's gates. We
want the install to be the single source of truth for "this
configuration is healthy".

## Goals / Non-Goals

**Goals:**
- Add a post-install block that runs the existing static and
  self-test gates.
- Allow per-gate opt-out via environment variables.
- Emit a final summary line that CI can grep.

**Non-Goals:**
- Add new gate scripts; reuse the existing ones.
- Touch live runtime assertions (`acceptance-harness.mjs --live`)
  because they need a real OpenCode process and are operator-driven.
- Change the existing pre-install validate-config calls.

## Decisions

### Reuse the existing scripts

The post-install block runs:

- `node scripts/test-model-profiles.mjs`
- `node --test agent/lib/test/jev-client.test.mjs`
- `node scripts/acceptance-harness.mjs`
- `openspec validate --specs --strict --type spec`

It does not run `acceptance-harness.mjs --live` because that requires
an interactive OpenCode process.

### Opt-out via OPENCODE_SKIP_* variables

Each gate has a matching `OPENCODE_SKIP_<NAME>` variable. When set to
`1`, the gate is recorded as skipped in the summary and does not
contribute to the failure count. The variables follow the
`OPENCODE_*` pattern already used elsewhere in `install.sh`.

### Summary line as CI signal

A single final line `install.sh: OK — <p>/<r> gates passed (<s>
skipped)` keeps the existing print style. On failure the script
prints `install.sh: FAIL — <reason>` and the previous output is
preserved for debugging.

## Risks / Trade-offs

- [A test becomes flaky on install] → the static gates have been
  stable for months; if any gate becomes flaky, fix the gate rather
  than opt it out by default.
- [CI times out] → each gate is bounded; the Jev client test takes
  ~100 ms; the static harness a few seconds.

## Migration Plan

1. Update `install.sh` with the post-install block, opt-out
   variables, and the summary line.
2. Update `README.md` to document the new contract and the
   `OPENCODE_SKIP_*` env vars.
3. Run the existing local tests (validator, harness, profile tests,
   Jev client tests) to confirm the new block does not regress.
4. Run `./install.sh` end-to-end and verify the summary line.
