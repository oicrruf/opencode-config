# AT-200 completion audit

Scope: local implementation and review-ready handoff on
`feat/at-200-sandbox-command`, based on `517dd92`. Publication, activation,
merge and Linear closure are outside this local handoff.

| Issue requirement | Current authoritative evidence | Result |
| --- | --- | --- |
| Exact operations/arguments; invalid input causes no tool dispatch or sandbox mutation | Native executor in `command.mjs` is connected by plugin setup; pure and V2 integration tests exercise strict parsing, permission ordering and invalid direct inputs. `runtime-evidence.json` records eight actual command-API cases with durable usage/errors, zero tool calls and zero model requests. | Proven in stated scope |
| Effective checkout, configuration and work identity without silent worktree substitution | `source.mjs` uses the active V2 directory/project/session, Git toplevel and verified inventory/public listing; source/configuration tests cover missing/ambiguous/foreign identity, subdirectories, explicit/default declarations, escaping paths/symlinks and changing configuration. JSON and aliases stay outside capture; fingerprint/allowlisted external evidence follows the operator's decision. | Proven by code and scoped fixtures |
| Rebuild preserves external report and verifies closure before successor; failures retain quota | `transition.mjs`, `operation.mjs`, reservation generation and lifecycle retained-record paths; injected report, cleanup, terminal-write and journal failures; actual isolated build/rebuild/transfer with previous report bodies preserved and attributable closure. | Proven in stated scope |
| Verified transfer and serialization, without another session's token | Verified session/project/work checks, exact execution/generation matching, exclusive operation and atomic reservation replacement; cross-process competition/death and token-delivery interruption tests; manual/other-work/legacy refusal tests; focused re-review pass. | Proven in stated scope |
| One application, isolation, no provisioning, uncertain retries, approval or Git/Linear effects | Shared exclusion/quota across manual applications and sandbox; controller refuses competition. Actual inspections record no mounts/socket, host network/PID/IPC, privileges, added capabilities or devices, internal network, no ports and resource limits. Missing prerequisites block; recovery closes only. No code publication/global installation/Linear writes occurred. | Proven for observed fixtures and affected code |

## Explicit gates and artifacts

- All 17 OpenSpec tasks complete; proposal, design and two deltas preserved in
  this archive. Main specs synchronized (six additions, one modified requirement),
  with original titles/Purpose and unrelated requirements retained.
- Sandbox plus directly affected worktree tests: **196/196**.
- Config validators: **personal passed; work passed**.
- Model-profile checks: **9/9**; acceptance harness: **45/45 static**.
- Main-spec strict validation: **15/15**; change strict validation and diff
  whitespace validation passed before archive.
- Initial review's four introduced MAJOR findings corrected. The sole focused
  re-review returned **pass**, independently running **9/9** regressions.
- Runtime evidence is real OpenCode 2.2.7/Linux arm64 in local macOS arm64
  Docker Desktop. The existing pinned image was reused; no dependency was
  provisioned. All 21 expected tool IDs appeared once. Reports are external,
  actual resource absence was verified and final quota was released.
- The source/controller listing is a fixture context. V2 registration and
  native command routing were observed separately inside the container. No
  rendered-UI, full managed-worktree creation, native Linux-host or production
  equivalence claim is made.
- Activation/rollback commands and prerequisites are documented in GUIDE.md.
  Root global activation/install-state verification was not performed or claimed.

The local implementation has no unfinished tracked task or unresolved finding
from the required review scope. It is ready for human review; it is not a claim
that the issue was merged, published, activated or closed in Linear.
