# Tasks

## 1. Effective MCP readiness inspection

- [x] 1.1 Inspect OpenCode's read-only effective-config API from the actual worktree directory; test ordered inherited/global and local document responses, disabled-server overrides, invalid/unavailable responses, secret redaction, and connectivity remaining unknown.
- [x] 1.2 Integrate readiness inspection into new and reused worktree creation without enabling or probing servers; verify focused tests prove successful readiness is never claimed when required inspection fails and failed inspection leaves created worktree recorded and resumable.

## 2. Safe credential preparation and ownership

- [x] 2.1 Detect missing `{file:path}` references only for effective enabled MCP servers; reuse already available files and test disabled servers and no-local-file cases do not trigger copies.
- [x] 2.2 Materialize only project-relative files present in the machine-local allowlist using descriptor-relative no-follow operations, safe containment, mode `0600`, exclusive creation, and redacted failures; fail closed if Python 3 or required `dir_fd`/no-follow capabilities are unavailable. Test missing source, symlink source/parent, unsafe destination, no overwrite, and partial failure.
- [x] 2.3 Record only ownership metadata in an atomic mode-`0600` per-worktree manifest; test partial preparation resumption, changed-file refusal, and preservation of unowned files.
- [x] 2.4 Test that `.env`, unrelated secrets, and whole directories are never copied and that credential values never appear in logs or reports.

## 3. Explicit retirement integration and documentation

- [x] 3.1 Block worktree API retirement while any owned credential path exists, including changed identities; allow retirement only after explicit operator removal/relocation and verified absence, then clear stale ownership metadata after successful worktree removal. Test no API call while credentials exist and safe retry after explicit removal.
- [x] 3.2 Document MCP readiness, the machine-local allowlist, Python secure-operation prerequisite, ownership metadata, incomplete/resume behavior, and selective retirement cleanup in `README.md`; verify the documented behavior matches the implementation.

## 4. Integration verification

- [x] 4.1 Run all focused worktree-control tests and `node scripts/validate-config.mjs --profile personal`; record successful results and note no pre-existing failures were observed in these gates.
- [x] 4.2 Include all worktree-control `*.test.mjs` files in the acceptance-harness worktree group, then run `node scripts/test-model-profiles.mjs`, `node scripts/acceptance-harness.mjs`, and `openspec validate --specs --strict --type spec`; record each result.
- [x] 4.3 Do not attempt real runtime connectivity without explicitly authorized secrets; keep connectivity `unknown` and perform no sandbox/provider connection attempt for this change. Verify static readiness never claims connection success.
