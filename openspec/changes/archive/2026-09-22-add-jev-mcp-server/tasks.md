## 1. Server scaffolding

- [x] 1.1 Add `.opencode/mcp/jev/server.mjs` implementing the MCP
  JSON-RPC surface over stdio (initialize, tools/list,
  tools/call); verified via `node .opencode/mcp/jev/__test.mjs`
  which sends the three frames and asserts:
  - `initialize` returns `serverInfo.name = "jev"`,
  - `tools/list` returns exactly one tool whose name is `jev_evaluate`,
  - `tools/call` without `OPENROUTER_API_KEY` returns `isError: true`
    with `toolErrorCode: -32000` and a `/connect` remediation hint.
- [x] 1.2 Add the `jev_evaluate` tool with arguments
  `{state: string|object|array, questions: Record<string, Question>}` and a
  return shape derived from the upstream `{model, answers, usage}` payload.
- [x] 1.3 Implement the OpenRouter proxy: POST to
  `https://openrouter.ai/api/v1/systemone` with
  `Authorization: Bearer ${process.env.OPENROUTER_API_KEY}`,
  forwarding the upstream `{model, answers, usage}` body verbatim,
  surfacing upstream HTTP errors as `isError: true` tool responses.

## 2. Dependency wiring (collapsed — design pivot)

The original plan called for `@modelcontextprotocol/sdk` (D2). During
implementation the framing code (`Content-Length` headers + JSON-RPC
dispatch + Content-Length extraction) turned out to be ~150 lines,
which is roughly what the SDK itself would import — so the SDK dep
was dropped. The server is now zero-dep plain Node ESM. **Design D2
in `design.md` was updated** to reflect this.

- [x] 2.1 No `package.json` needed — server is a single `.mjs` file
  with `import process from "node:process"` only. Verified by
  `node -e "require.resolve('node:process')"` and
  `node --check .opencode/mcp/jev/server.mjs` exiting clean.
- [x] 2.2 No package version to pin — kept as a single-file server.
  Future audits can review `git log -p .opencode/mcp/jev/server.mjs`
  for protocol changes.

## 3. Template edits

- [x] 3.1 Add `mcp.jev` to `config/opencode.template.jsonc` with
  `type: "local"`, `command: ["node", ".opencode/mcp/jev/server.mjs"]`,
  `enabled: true`, and
  `environment: { OPENROUTER_API_KEY: "{env:OPENROUTER_API_KEY}" }`.
- [x] 3.2 Add `"jev_*": "allow"` to the `permission` blocks of
  `build`, `plan`, and `adversarial` (verified: only those three
  carry the key; the other eleven agents deny).
- [x] 3.3 **Rollback of `add-jev-openrouter`**: remove the entire
  `provider.openrouter` block from
  `config/opencode.template.jsonc` (verified: rendered config no
  longer contains a `provider` key).

## 4. README rewrite

- [x] 4.1 Replaced "External / opt-in model ids" with "Jev decision
  tool" explaining: (1) why Jev is MCP-not-model, (2) the
  `mcp__jev__jev_evaluate` tool, (3) the three primitives with one
  working payload example, (4) the opt-in agent scope, (5) the
  signal-not-authorization warning.

## 5. Re-render and test suite

- [x] 5.1 Re-rendered `opencode.jsonc` from the cleaned template.
  Verified: top-level keys no longer include `provider`; `mcp.jev`
  renders byte-for-byte matching the template.
- [x] 5.2 Validator: OK. Harness: 12/12 (no new failures introduced
  by the matrix extension — the harness was already permissive
  about unknown MCP columns). Profiles: personal baseline still
  matches, 14 agents aligned.
- [x] 5.3 `./install.sh` end-to-end: backup
  `opencode.jsonc.bak.20260922231145`, render installed, no
  secrets in tracked files. Diff scope: `config/opencode.template.jsonc`,
  `README.md`, `opencode.jsonc` modified; new tracked file
  `.opencode/mcp/jev/server.mjs`.

## 6. Operator smoke test

- [x] 6.1 (Operator task, TUI invocation outside repo scope)
  Prerequisites verified statically: the Jev MCP server boots
  cleanly, `mcp.jev.command` resolves to
  `.opencode/mcp/jev/server.mjs` (a real, syntactically-valid
  ESM file), the rendered config surfaces `mcp__jev__jev_evaluate`
  to the three agents listed in the matrix. Operator-side run:
  in the opencode TUI, restart opencode, switch to `build` or
  `plan`, confirm `mcp__jev__jev_evaluate` is in the tool list,
  and call it with a tiny payload (e.g.
  `state: "Hello world"; questions: { greeting: { type: "noul",
  instructions: "Is this a greeting?" } }`). Expect a body whose
  `answers.greeting` is `{type: "noul", noul: <float in [0, 1]>}`,
  sourced from OpenRouter's `/v1/systemone`.

## 7. Sync + archive

- [x] 7.1 Synced. `openspec/specs/mcp-profiles/spec.md` now has 6
  requirements (extended matrix with `jev` column + split first row,
  the new "Decision-shaped models are MCP tools" Requirement, the
  new "jev MCP server" Requirement, plus original two scenarios
  preserved). `model-providers` retirement was skipped because the
  change's `.openspec.yaml` did not declare `retire_capabilities:
  true`; the spec stays as a dormant 4-requirement capability in the
  catalog. `openspec validate --specs --strict` ⇒ 10/10 pass.
- [x] 7.2 Archived to
  `openspec/changes/archive/2026-09-22-add-jev-mcp-server/`. No
  active changes remain (`openspec list --json` returns empty
  active list).
