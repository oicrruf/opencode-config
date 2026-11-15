# Spec Delta

## REMOVED Requirements

### Requirement: Personal profile preserves the existing assignment

**Reason**: AT-202 intentionally replaces the previous multi-provider model
baseline with OpenAI-only model assignments.

**Migration**: Treat the checked-in `personal` manifest and its rendered
configuration as the new baseline; validate its profile, agents, root, and
command consumers against that manifest.

## ADDED Requirements

### Requirement: All profiles use OpenAI model assignments

Every model ID assigned to the root, `small_model`, a global agent, or a
command in any profile SHALL use the `openai/` provider prefix. Command
frontmatter overrides SHALL also use OpenAI IDs. The validator SHALL check
every profile and command override, not only the selected profile, and SHALL
name the profile and consumer for violations. Catalog absence SHALL remain a
skip for model resolution and SHALL NOT cause installation to fail solely due
to missing credentials; invocation uses the operator's existing OpenAI
provider authentication.

#### Scenario: every profile stays on OpenAI

- **WHEN** model validation runs with any selected profile
- **THEN** it SHALL reject a non-OpenAI assignment in any declared profile
  and report the affected profile and consumer

#### Scenario: a command override stays on OpenAI

- **WHEN** a command file declares a model override outside the OpenAI
  provider
- **THEN** validation SHALL fail and identify the command file

#### Scenario: an operator has not connected OpenAI yet

- **WHEN** the models catalog is present but the OpenAI provider has not been
  authenticated
- **THEN** profile installation SHALL remain independent of credential
  setup, while invoking the model reports the provider authentication error
