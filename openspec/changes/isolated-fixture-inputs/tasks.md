# Tasks

## 1. Implement capture
- [x] 1.1 Validate the opt-in selector, normalization, Dockerfile/context membership and limits; test absent vs empty selector, unsupported declarations and unchanged legacy behavior.
- [x] 1.2 Capture and screen exact bytes with protected path/alias, directory replacement and source drift checks. Test selected secrets are refused, unselected sentinels never enter capture or build, and no selector can include configuration or secret state.
- [x] 1.3 Integrate manifest fingerprints, quota cleanup, build isolation and refusal evidence. Exercise failure before build, capture mutation and missing pinned dependencies.

## 2. Verify and activate
- [x] 2.1 Run capture/configuration/lifecycle fixtures and global configuration, profile and acceptance gates. Obtain independent security review and fix introduced major findings before activation.
- [x] 2.2 Document activation/rollback and run a managed disposable fixture end-to-end, proving no host mounts/ports/egress and verified cleanup. Keep project-specific fixture files in their owning project. Record prerequisites or blockers; do not infer WordPress acceptance from a generic smoke test.

## Apply baseline

Before selector integration, `validate-config --profile personal`, model-profile
checks and acceptance harness passed (45/45 static checks). The separate
resource-manifest/installation-state suite passed 30 tests, and
`bash install.sh --check` confirmed the installed personal resources without
rewriting them. Installed sandbox/worktree entrypoints are links to this
repository, so source edits are visible to later loaders without a separate
copy/install step; do not claim an already-running session reloaded its modules.

The operator guide and `scripts/probe-fixture-inputs.mjs` describe a cached-image
managed smoke test with both selected-secret refusal and unselected-fixture
isolation. It is not executed or WordPress acceptance at this checkpoint.
No task is completed by this baseline.

## Integrated verification

Coordinator reran all sandbox module tests: **186/186 passed**, including the
new selector/admission/capture/lifecycle cases and the legacy suite. Final
configuration validation, model-profile tests and acceptance harness also pass
(45/45 static checks). Tasks 1.1–1.3 are implemented and fixture-verified.
Independent security review and the real managed smoke are still pending;
tasks 2.1/2.2 are not completed by these simulated engine fixtures.

## Final managed-engine verification and handoff

Independent security review found no introduced findings and independently
passed 48 focused cases; its verdict remains `incomplete` because runtime and
global gates had not been run under its constraints. Coordinator subsequently
ran the global gates above and `node scripts/probe-fixture-inputs.mjs`:
selected-secret attempt was blocked before build, then exactly two selected
inputs built and ran with a pinned cached Alpine image. Observed no host mounts
or ports, internal runtime network, dropped capabilities and no added privileges.
Managed finish returned cleanup OK and quota released. Independent Docker
label inspection confirmed no attributable containers/images/networks/volumes.
The stopped website app remained stopped and its database volume exists.
`runtime-evidence.json` preserves the non-secret scoped results and external
report references. No image pull, session restart or global-config overwrite ran.

All five tasks complete. Ready for human PR review; no PR was created, approved
or merged. The reviewer's historical incomplete verdict is not changed into an
independent runtime signoff. Generic smoke does not prove WordPress/Polylang or
MTB Home Sync acceptance; compatible pinned runtime prerequisites and that
project's disposable native integration tests remain its separate work.
