# AT-188 — verification

## State under test

Branch `feat/at-188-installation-manifest`, based on
`eb611aa923ffe90a87f560859d56d87ca287cdb6`. Implementation and approved planning
changes are uncommitted. No global installation, credential change, provider
session, push, PR, merge or archival was performed.

## Acceptance evidence

| Criterion | Evidence | Result |
|---|---|---|
| Read-only installed-state check | Public install --check fixtures, filesystem/mtime snapshots, absent state and installed work profile | Passed |
| Ownership and foreign-resource preservation | Manifest validation, legacy adoption, foreign directories, modified roots/links, Herdr, retired artifacts and repeated checks | Passed |
| Doctor uses rendered root and detects drift | Public doctor check-only/dry-run/apply-safe fixtures with stubbed dependency tools, conflict and absence scenarios | Passed |
| Plugin distribution and unique loading | Installed entrypoints imported from an isolated installation and loaded in OpenCode v2.2.7 inside the sandbox; 17 sandbox/worktree IDs appeared exactly once | Passed; runtime evidence in `openspec/changes/archive/2026-11-15-soportar-docker-desktop-local/runtime-evidence.json` |
| Repeat install, obsolete edits and failures | Idempotency, preflight no-write, injected partial failure/journal, lock contention and new root competitor | Passed |

## Commands executed

- `node --test scripts/test-resource-manifest.mjs scripts/test-installation-state.mjs`: **30/30 passed**. Tests use temporary canonical directories, isolated HOME/XDG_CONFIG_HOME, fonts disabled and stubbed dependency tools. The entrypoint import case is an import/surface test, not a live OpenCode loading claim.
- `node scripts/validate-config.mjs --profile personal`: **passed**.
- `node scripts/validate-config.mjs --profile work`: **passed**.
- `node scripts/test-model-profiles.mjs`: **7/7 passed**.
- `node scripts/acceptance-harness.mjs`: **44/44 passed**, without --live. Includes the two focused suites and existing sandbox/worktree module checks; no Docker or provider session.
- `openspec validate instalar-manifiesto-recursos --strict`: **passed**.
- `git diff --check`: **passed**. New files were also inspected through their tests and OpenSpec parsing.
- `openspec validate --specs --strict --type spec`: **passed, 14/14** after the operator requested resolving the outstanding gate. Added the missing scenario under `Installer documents the supported shells in its help`, without changing the requirement. The earlier 13/14 failure was confirmed in HEAD and is now corrected; informational long-requirement notices remain non-failing.

The first integration attempt exposed an obsolete validator assertion requiring
a literal shell link() call; updated it to inspect shared inventory. Subsequent
integration passed. An initial validation of the doctor delta also required
preserving the existing scenario name; the corrected delta passed. These are
resolved development failures, not suppressed test expectations.

## Runtime follow-up — 2026-11-15

- Tasks 4.3–4.5: completed. The final runtime fixture on local Docker Desktop used a pinned OpenCode 2.2.7 Linux/arm64 image and isolated HOME/XDG. The public V2 `ctx.tool.list()` observation returned all 17 expected sandbox/worktree tool IDs exactly once. The report records an independent 29-file capture, isolation settings, refusal of a second start and verified cleanup before quota release. The fixture intentionally has no model provider credentials; it verifies plugin initialization and tool listing, while tool execution paths are covered by focused tests. See `openspec/changes/archive/2026-11-15-soportar-docker-desktop-local/runtime-evidence.json` and the archived `verification.md`.
- Final adversarial review **completed**, with verdict **incomplete verification and no unresolved introduced BLOCKER/MAJOR**. Its earlier runtime concern is resolved by the evidence above; native-platform compatibility outside macOS Docker Desktop and Linux/WSL2 was not exercised. See `review.md`.
- Native Linux, WSL/Git Bash and Windows symlink behavior were not exercised on
  those hosts. Existing shell paths/help and translation rules are retained;
  local fixture success is not proof of native-platform acceptance.

## Recovery / activation

See `docs/contracts/installation-resources.md`. Partial failures retain an
operation journal and block blind retry; there is no automatic takeover or
force-recovery command. Global activation remains a separate operator install
and fresh OpenCode execution. The current local code is not claimed installed.


## Follow-up: resolve outstanding verification

The missing help scenario in the main installer-portability spec was corrected
and the main strict gate now passes 14/14. Delta strict validation, shell help,
profile validation and diff checks were repeated; the implementation code is
unchanged since the 30/30 and 44/44 runs recorded above, so those results remain
applicable. Repeated personal/work validation and the 7/7 profile suite passed. Task 4.3 is complete; 17/18 tasks are now verified.

Runtime investigation found Docker Desktop 4.90.0 with local Linux Engine
29.7.2 responding on the existing desktop-linux context. This resolves daemon
availability, **not** host compatibility: checkEngineHost still rejects the
Darwin client before daemon inspection. The current sandbox spec expressly
requires a Linux/WSL2 host. No Linux/WSL2 control environment or linked-machine
tool is available in this session; limactl, colima, multipass and orb were not
on PATH. No VM, dependencies or environment were installed. No platform value
was forged and the control was not bypassed. A choice of an existing compatible
Linux environment or an explicit extension of Docker Desktop host support is
pending; task 4.5 remains open until actual sandbox runtime evidence exists.

## Docker Desktop follow-up — 2026-11-14

The operator chose the explicit compatibility extension and applied
`soportar-docker-desktop-local`. Its local implementation now recognizes the
verified Unix endpoint and Linux Desktop daemon without forging the client
platform, and pins execution operations to that identity. A real prerequisite
probe through sandbox-control confirmed isolation, exclusivity and successful
attributable cleanup. See the new change's verification.md for exact observations.

At that point the cached image lacked an executable `opencode`, so task 4.5
remained open. The follow-up below records the later pinned-image runtime proof.
No global installation was modified.

## Final runtime evidence — 2026-11-15

The later pinned-image fixture resolved the earlier prerequisite block without
installing dependencies on the host. OpenCode v2.2.7 ran inside the isolated
Linux container controlled by local macOS Docker Desktop. It loaded both
plugins and reported all 17 expected tools once. The execution and cleanup
report are `openspec/changes/archive/2026-11-15-soportar-docker-desktop-local/runtime-evidence.json`; task 4.5
is complete. Local implementation remains uncommitted and not globally
activated.
