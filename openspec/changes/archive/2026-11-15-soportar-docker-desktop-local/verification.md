# Verification

## Pinned OpenCode V2 runtime on Docker Desktop

- Result: `passed` on 2026-11-15; report: `runtime-evidence.json`.
- Client/engine: macOS arm64 using local Docker Desktop 29.7.2; daemon reports
  Linux containers and arm64.
- Runtime: official OpenCode v2.2.7 image, local image ID
  `sha256:7b1e3139a64121d12e572530974a18b9452967fb4d67516d8cfd9c0e763dd57d`.
- Configuration: isolated `/fixture/opencode.json`, SHA-256
  `515235fa31360b952a0f500ba2ebcbaf48ee8de62f252cb27104a88a12a04ddf`; the
  fixture adds only its local runtime verifier. Control entrypoints use the
  same flat file layout recorded by the resource inventory.
- Runtime execution `at188-v2-runtime-b133b7cc`: `ctx.tool.list()` returned every expected
  sandbox-control and worktree-control tool ID exactly once (17/17). The
  runtime verifier waits for the asynchronous plugin activation before
  recording the final list.
- Capture: 29 files, independent from the source fixture; fixture fingerprint
  `0782b931997d99ceb6e544915f121e469db65275ec11449372bebc3855d495df`, capture
  fingerprint `5f26bb8155a99fa4e606e7d722a5b8a4203c26ff9e375c597bbf8bd494f5c411`.
- Isolation: internal network, no published ports, no mounts, no added
  privileges, all capabilities dropped, `no-new-privileges`, 1 CPU,
  512 MiB memory, and 64 PID limit. A concurrent second start was refused.
- Closure: own container, network and image removed; no resources remained;
  reservation released. The execution is evidence of runtime loading and
  isolation, not product approval.
- Focused adversarial re-review: both prior major findings (session-scoped
  identity and required argument schema) resolved; no material findings
  remain. The real runtime probe verifies registration, while tool execution
  paths are covered by unit tests rather than a model-driven session.
- Platform coverage: macOS arm64 with Docker Desktop was exercised end to end.
  Linux endpoint selection and socket validation are covered by focused tests;
  an end-to-end run from a Linux host was not available in this environment.
  OpenCode itself ran in the Linux arm64 container in the runtime probe.
- The fixture has no model provider credentials by design. The attempted
  model completion was unavailable; the result verifies OpenCode V2 plugin
  initialization and the public runtime tool listing, not model response
  behavior. Tool execution paths are exercised by the focused tests.

## Repository gates

- `node --test plugins/test-plugin-v2-adapter.mjs plugins/sandbox-control/test/*.test.mjs plugins/worktree-control/test/*.test.mjs` — 112/112 passed.
- `node scripts/validate-config.mjs --profile personal` — passed.
- `node scripts/validate-config.mjs --profile work` — passed.
- `node scripts/test-model-profiles.mjs` — all checks passed.
- `node scripts/acceptance-harness.mjs` — 44/44 static checks passed; its
  separate `--live` assertions were not run (the pinned sandbox probe above
  supplies the runtime observation for this change).
- `openspec validate soportar-docker-desktop-local --strict` — passed.
- `git diff --check` — passed.
