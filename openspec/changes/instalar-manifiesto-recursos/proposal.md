# Proposal

## Why

The installer links `agent/`, `commands/`, `skills/` and the TUI files into
`~/.config/opencode` without recording what it manages. A resource the
operator owns can therefore be replaced by the next install without warning,
resources removed from this repository linger in the global configuration
indefinitely, and the installer cannot tell the operator whether the
installed state is already current. Because the global configuration is
shared by every project on the host, an undetected overwrite is a silent
cross-project data-loss event.

## What Changes

- Record every globally installed resource in a manifest under
  `~/.config/opencode`, recording the install kind, the target path, the
  source it points at, and the content digest of the rendered root
  configuration.
- Detect global resources this repository does not own and report them as
  conflicts instead of replacing them.
- Remove resources this repository used to manage and no longer ships, but
  only while they are still exactly the artifacts a previous install
  created.
- Make the install idempotent: a run with nothing to change reports the
  current state instead of rewriting the configuration.
- Add a non-mutating `--check` mode that verifies the installed state and
  exits non-zero when the configuration is out of sync.
- Fail closed when the manifest is present but unreadable or malformed, so a
  corrupted manifest can never be mistaken for "nothing is managed". A
  missing manifest is the first-install case and bootstraps the record
  instead of failing.

## Capabilities

### New Capabilities

- `installation-resource-manifest`: record, verify, and protect the global
  OpenCode resources that this repository installs.

### Modified Capabilities

- `installer-portability`: add the idempotent-state report and the
  non-mutating check mode to the installer contract.

## Impact

- Installer: `install.sh` (argument parsing, link step, final summary) and a
  new `scripts/resource-manifest.mjs` that owns manifest read/write, the
  ownership test, and the conflict rules.
- Validation: `scripts/validate-config.mjs` and `scripts/acceptance-harness.mjs`
  gain static assertions for the manifest contract and the check mode.
- Documentation: `README.md` (install and verify sections) and `AGENTS.md`
  (validation gates) describe the new mode and the conflict policy.
- No change to the rendered root configuration, the model-profile manifest,
  the agent definitions, the skills, or the commands.
