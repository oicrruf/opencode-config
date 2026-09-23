## Context

The current configuration declares the same model assignment in several
places: root `opencode.jsonc`, global agent frontmatter, command frontmatter,

## Goals / Non-Goals

**Goals:**
- Make the present assignment an explicit `personal` baseline profile.
- Select and persist a profile only while running the installer.
- Keep model policy centralized and validate it before changing the installed
  root configuration.
- Preserve existing agent and command behavior apart from model selection.

**Non-Goals:**
- Do not add providers, authenticate providers, or choose models dynamically at
  OpenCode launch.
- Do not add an automatic machine, repository, or network-based profile
  detector.
- Do not change routing classes, tool permissions, prompts, steps, skill
  visibility, or subagent depth.
- Do not parse `AGENTS.md` as executable configuration.

## Decisions

### Use a structured, version-controlled profile manifest

Introduce a JSON manifest under `config/` with a `defaultProfile` and named
profiles. Each profile explicitly maps the root default, `small_model`, agent
names, and model-overriding command names to provider/model IDs. `personal`
copies the current assignments exactly; `work` is an optional future profile
whose values must be deliberately supplied rather than guessed.

Markdown is rejected as the machine-readable source: `AGENTS.md` is for human
and agent instructions, while JSON gives the installer deterministic parsing
and validation.

### Generate the installed root config, retain linked behavior templates

Retain a version-controlled root configuration template without duplicated
model values. The install flow renders a temporary root configuration by
combining that template with the selected profile's root, agent, and command
model overrides, validates it, then atomically replaces
`~/.config/opencode/opencode.jsonc`. Agent and command Markdown templates drop
their model frontmatter but remain linked, preserving prompts and policy.

This uses OpenCode's merged configuration surface for model overrides while
keeping Markdown as the canonical home of behavior. Generating the root config
rather than depending on `{env:...}` means no environment must be present when
OpenCode starts.

Alternatives rejected:
- **Runtime environment placeholders**: absent variables resolve to empty
  strings and require shell setup on every launch.
- **Per-profile repository forks or copied templates**: duplicate prompts and
  policy, making updates drift.
- **Parsing `AGENTS.md` from the installer**: couples executable behavior to
  prose and produces fragile parsing rules.

### Make profile selection explicit and idempotent

Add `--profile <name>` argument parsing to `install.sh`; no argument selects
the manifest default. The installer validates all inputs and renders to a
temporary sibling before replacing the active root config. Re-running with a
different profile is the supported profile switch and leaves linked resources
current.

### Validate profiles independently and as rendered configuration

Extend the existing Node validator to load the manifest, establish required
consumers from the base configuration and Markdown templates, validate selected
or all profile coverage, and resolve IDs against the local model catalog when
available. The install flow invokes it for the selected profile before render,
then validates the rendered config's syntax and policy. Tests will cover
default selection, explicit selection, unknown profiles, incomplete profiles,
bad IDs, and output equivalence for `personal`.

## Risks / Trade-offs

- [OpenCode merge precedence between root config and Markdown templates could
  differ from the assumed overlay] → Add a live or resolved-config verification
  proving generated root model overrides are effective before removing template
  models.
- [A partial write can leave a broken global config] → Render and validate a
  temporary file, then use an atomic rename only after success.
- [Work machines may lack one provider referenced by `personal`] → Profile
  selection is explicit; the validator reports the exact unavailable model and
  profile before installation.
- [The existing catalog is absent on a new machine] → Preserve the documented
  non-failing catalog skip while retaining structural and syntax validation.

## Migration Plan

1. Add the manifest, base template, renderer, and profile-aware validation with
   `personal` matching the current assignment.
2. Change the installer to render and atomically install the root config while
   retaining all other links.
3. Remove duplicate model declarations from agent and command frontmatter only
   after proving the generated overlay is effective.
4. Update documentation and run static plus installer-focused checks.
5. Roll back by restoring the previous symlinked root config from the install
   backup and reverting the profile-aware installation changes.
