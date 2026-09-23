## 1. Local Jev MCP server

- [x] 1.1 `.opencode/mcp/jev/server.mjs` is a dependency-free Node stdio MCP
  server implementing `initialize`, `ping`, `tools/list`, and `tools/call`.
  Verified by the protocol harness: framed `initialize` exits with
  `serverInfo.name = "jev"` and produces no stdout other than MCP frames.
- [x] 1.2 Exposes exactly `jev_evaluate` with JSON Schema requiring `state`
  and a named `questions` map of `noul`, `choice`, or `score` primitives.
  Verified: `tools/list` returns that one tool; an unknown tool name and a
  call missing `state` both return a structured `isError: true` payload
  with no process exit.
- [x] 1.4 Resolves credentials from `OPENROUTER_API_KEY` first and falls
  back to the existing OpenCode `openrouter.key` auth entry. Verified: the
  protocol harness runs with no env and a non-existent `OPENCODE_AUTH_PATH`,
  returning a `/connect` remediation hint; stderr/stdout never contain a
  fixture key marker.
- [ ] 1.3 Implement REST forwarding to OpenRouter SystemOne with model
  `typesafe/jev-1.13`, verbatim successful `{model, answers, usage}` output,
  and a 25-second `AbortController` deadline; verify mocked success,
  non-2xx, abort, and network-error paths each return structured errors
  before OpenCode's 30-second deadline. (`1.4` was verified first because
  it is independent of the network; `1.3` is verified live in 4.2 against
  the operator's existing OpenRouter credential with all three primitives
  and a fake-upstream pass for the non-2xx path.)

## 2. Rendered path and agent scope

- [x] 2.1 `scripts/render-config.mjs` substitutes `{__repo_root__}` inside
  every local MCP `command` argument. Verified: a personal render resolves
  `mcp.jev.command` to an existing absolute server path while the
  checked-in template still contains the `{__repo_root__}` placeholder.
- [x] 2.2 `config/opencode.template.jsonc` declares the enabled `mcp.jev`
  with the rendered-absolute script path placeholder and the
  `OPENROUTER_API_KEY` environment hint; `jev_*: "allow"` is present only on
  `build`, `plan`, and `adversarial`. Verified: the rendered config has one
  Jev MCP and exactly three agents with the allow token.
- [x] 2.3 New harness assertions verify that the rendered Jev command
  contains an absolute path to an existing file, that the template carries
  the `{__repo_root__}` placeholder (or an equivalent absolute token), and
  that `jev_*` is allowed only by the three expected agents.

## 3. Documentation and MCP policy

- [x] 3.1 README now has a top-level "Jev decision tool" section covering
  setup via `/connect`, the absolute-path renderer, the three primitives
  (`noul`, `choice`, `score`) with an example commit-type `choice`
  prompt, the 25-second failure behavior, the distinction with the
  hosted OpenRouter discovery MCP, a direct REST example, and the
  signal-not-authorization warning.
- [x] 3.2 `openspec/specs/mcp-profiles/spec.md` synced: matrix has a
  `jev` column with only `build`/`plan`/`adversarial` allowed; two new
  ADDED Requirements cover the typed decision adapter and the bounded
  startup/auth/failure behavior; the new "OpenCode starts from another
  project directory" scenario asserts the relative-CWD timeout cannot
  recur. `openspec validate --specs --strict --type spec` passes
  (10/10 specs OK).

## 4. End-to-end verification and installation

- [x] 4.1 Live test launched the resolved absolute server from `cwd=/tmp`
  (outside the repository) and timed `initialize` and `tools/list` at 30 ms
  each, well under the 1000 ms gate. The relative-CWD timeout cannot recur.
- [x] 4.2 Live `noul`, `choice`, and `score` rounds-trip through OpenRouter
  using model `typesafe/jev-1.13-20260917` (per-call cost between
  $0.000012 and $0.000015). stdout and stderr contained no key-like prefix;
  the key stayed in OpenCode's per-user auth store.
- [x] 4.3 `validate-config` passes, harness 14/14 (was 12; +2 Jev checks),
  profile tests pass, `openspec validate --specs --strict` passes
  (10/10 specs OK). `.opencode/mcp/jev/` contains only `server.mjs`.
- [x] 4.3a `./install.sh` ran end-to-end: backup
  `opencode.jsonc.bak.20260922234701`, render installed, symlinks re-issued,
  validator OK. (`4.4` — restart OpenCode and confirm TUI from an unrelated
  CWD — is operator-side; the rendered config and harness assertions cover
  the config-side requirement and the 30-second startup gate.)

## 5. Archive

- [ ] 5.1 After all verification is green, archive the change and verify
  `openspec list --json` reports no active `readd-jev-local-mcp` change.
