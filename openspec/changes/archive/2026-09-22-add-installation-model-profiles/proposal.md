## Why

The global configuration currently hardcodes model identifiers across the root config, agent frontmatter, and command frontmatter. A user who needs a different set of permitted or preferred models on a work machine must edit the shared configuration, while the existing configuration already represents a stable personal baseline.

Installation-time model profiles will preserve that personal baseline by default and let a machine select a work profile once during `install.sh`, without requiring runtime environment variables or per-launch wrappers.

## What Changes

- Add a version-controlled model-profile manifest with `personal` as the default profile and values exactly equivalent to the current model assignments.
- Add installation-time profile selection through `./install.sh --profile <name>`; invoking the installer without `--profile` selects `personal`.
- Materialize the selected profile into the installed OpenCode configuration so ordinary `opencode` invocations need no profile argument or environment variables.
- Centralize model assignments for the root configuration, global agents, and model-overriding commands in the profile manifest; retain prompts, permissions, steps, and tool policy in their existing base files.
- Validate profile structure, complete model coverage, and selected model IDs before linking configuration. Preserve the existing missing-catalog skip behavior.
- Add `AGENTS.md` and update installation documentation with the default profile, profile selection command, and the requirement to use the OpenSpec workflow for durable profile changes.

## Capabilities

### New Capabilities
- `installation-model-profiles`: Select, validate, and materialize one named OpenCode model profile at installation time.

### Modified Capabilities
- `agent-routing`: Allow the configured model tiers and model-ID validation to be supplied by the installation-selected profile while preserving the routing roles and tier assignments of the `personal` baseline.

## Impact

- Affected files: `install.sh`, `opencode.jsonc`, `agent/*.md`, `commands/*.md`, `scripts/validate-config.mjs`, `README.md`, new `AGENTS.md`, and new profile-manifest/generation support files.
- The installer will replace its direct `opencode.jsonc` symlink with a generated installed configuration; links for agents, commands, skills, plugins, and TUI configuration remain in place.
- No providers are added, no runtime launcher is introduced, and the default `personal` installation preserves today’s effective model choices.
