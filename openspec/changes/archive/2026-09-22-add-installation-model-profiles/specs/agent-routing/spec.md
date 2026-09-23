## MODIFIED Requirements

### Requirement: Configured model ids resolve against authenticated providers

The system SHALL declare only model ids that an authenticated provider serves.
The version-controlled model-profile manifest SHALL provide every model
assignment for the root default, `small_model`, global agents, and command
overrides. `scripts/validate-config.mjs` SHALL validate the manifest structure,
ensure the selected profile covers every configured model consumer, and verify
its selected IDs against the OpenCode models catalog.

The check SHALL treat a missing catalog as a skip with a printed notice and
SHALL NOT fail the install, so a machine that has never started OpenCode still
installs. The check SHALL fail with the profile, consumer, and unresolved ID
when the catalog is present and an ID is absent. The installer SHALL validate
the selected profile before generating or replacing installed configuration.

#### Scenario: a phantom model id fails the validator

- **WHEN** `scripts/validate-config.mjs` runs for a profile that assigns
  `openai/gpt-5.6-terra-fast` to an agent
- **THEN** the script SHALL exit non-zero and name the profile, agent, and
  unresolved id

#### Scenario: a valid model id passes the validator

- **WHEN** every model assignment in the selected profile is present in the
  catalog for its provider
- **THEN** the script SHALL report `validate-config: OK` and exit zero

#### Scenario: a missing catalog skips the check

- **WHEN** `~/.cache/opencode/models.json` does not exist
- **THEN** the script SHALL print a skip notice for the catalog check and SHALL
  NOT fail on it
