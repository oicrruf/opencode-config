# AT-200 implementation verification

## Base and scope

- Branch: `feat/at-200-sandbox-command`.
- Base reconciled by fast-forward from `f0b4929` to `517dd92e02645150d4a50d6cc09a67fdfd9b896e`; the incoming shared adapter MCP config API was preserved.
- Read-only Linear check confirmed AT-188 is Done (2026-11-15). No Linear writes were made.
- No project sandbox state existed at the initial checkout inspection. Test executions used independent temporary Git fixtures and independent captures.

## Implemented behavior

- Native V2 `/sandbox` executor owns the command and calls the strict parser before any model prompt/tool. No same-name Markdown template is installed; its reference is `docs/contracts/sandbox-command.md`.
- Help and invalid arguments are recorded as durable synthetic session replies (`delivery: queue`, `resume: false`) without waking the agent. Valid commands and new tools assert the active session's named sandbox permission.
- Source identity uses the effective session's Git toplevel, verified V2 project/session, inventory and public worktree listing, without inferring work from a branch or selecting another source.
- Operator-approved configuration handling keeps the selected JSON and hardlink aliases out of the capture even with include. External evidence carries SHA-256 and allowlisted secret-free parameters. A bounded descriptor-relative reader reuses existing Python filesystem primitives; missing capability blocks, with no installation.
- Common cross-process exclusion covers ordinary lifecycle/reservation/supervisor mutations. Versioned generations bind token authority to the exact execution.
- Rebuild/transfer preserve external reports, verify attributable closure and retain continuous quota through atomic successor ownership. Manual applications, other work, ambiguous/legacy ownership and active competing operations remain blocked.
- Explicit transition recovery never builds. It verifies exact identities and conservatively reconciles dead operation owners. A running successor can be recovered by its verified owner or after proving the prior operation owner ended, covering lost token delivery.
- Records remain present while resources/secrets are removed; terminal state is atomically persisted before quota release. Closed provisional successors are revalidated on retry after journal-write failure.

## Final implementation verification

| Check | Observed result |
| --- | --- |
| `node --test plugins/sandbox-control/test/*.test.mjs plugins/worktree-control/test/*.test.mjs` | 196/196 passed |
| `node scripts/validate-config.mjs --profile personal` | Passed |
| `node scripts/validate-config.mjs --profile work` | Passed |
| `node scripts/test-model-profiles.mjs` | All 9 reported checks passed |
| `node scripts/acceptance-harness.mjs` | 45/45, static mode; includes new engine-free/V2 tests |
| `openspec validate sandbox-command-safe-rebuild --strict` | Passed |
| `git diff --check` | Passed |

Unit/integration fixtures cover strict arguments, paths/symlinks, configuration changes during capture, exclusions/secrecy, generation isolation, real OS-process contention/death, report/cleanup failures, interruptions at intent/closed/prepared/successor/running, terminal-record write failure and journal failure after provisional closure.

## Isolated runtime

`node scripts/probe-at200-sandbox.mjs` passed using the already-cached exact OpenCode 2.2.7 Linux/arm64 OCI image on local macOS arm64 Docker Desktop 29.7.2. No image/package/provider was provisioned.

Durable evidence: `runtime-evidence.json`. It records actual build → rebuild → transfer with distinct identities, previous reports preserved, a rejected competing build, actual container/network inspection and verified final attributable cleanup/quota release. All three runs had no mounts, no privileges/added capabilities/devices/host PID or IPC, a private internal network (no host network), no publications and explicit 512 MiB/1 CPU/64 PID limits.

Inside the actual OpenCode V2 runtime, all 21 expected tool IDs were observed once. Eight calls through the public command API returned usage/error text in the durable session context or pending synthetic inbox with zero tool calls and zero model requests. This proves native command handling/admission, not a rendered UI or delivery into an idle model transcript. The earlier lack-of-model limitation was superseded by the native executor; no fake model was substituted.

The host lifecycle controller used a fixture session/project-scoped listing; real V2 registration and command routing were observed separately inside the container. Unit integration checks exercise the adapter's verified context and permissions. This is not a claim of end-to-end managed worktree creation, native Linux host execution or production equivalence.

## Adversarial review and delivery boundary

The initial read-only review found four introduced MAJOR defects; `review.md` records them. All four corrections and regression tests are present. The single focused re-review returned `pass`, independently running 9/9 focused regressions and finding no MAJOR/BLOCKER remaining within its scope. All 17 tracked tasks are complete. This is not human approval.

No commit, push, PR, merge, Linear update or global installation has been performed. Activation and rollback are documented in GUIDE.md. Installed-state activation is separate from repository/fixture verification.

## Specification synchronization and archive

Both main specs were synchronized, preserving their titles, Purpose sections and unrelated requirements: docker-test-sandbox gained four requirements; local-execution-reservation gained two and updated ownership. All deltas were compared back against canonical blocks before moving the change. Main-spec strict validation passed 15/15, and the delta passed strict validation. The completed 17/17 change is archived as `2026-11-16-sandbox-command-safe-rebuild`.
