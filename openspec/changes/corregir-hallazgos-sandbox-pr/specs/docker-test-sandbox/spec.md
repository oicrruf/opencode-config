## MODIFIED Requirements

### Requirement: Secrets and local agent state are excluded by default

The system SHALL exclude the secrets and the agent's local state from the
capture, including environment files, integration credentials, model keys,
sessions, the project memory, global configuration, Git metadata, and
dependency directories. These exclusions SHALL take precedence over
project-controlled `include` declarations. The system SHALL supply only the
test secrets the developer declares explicitly, outside the build context,
and SHALL NOT include their values in any argument, response, or evidence.

An internal symbolic link SHALL be recreated as a link within the capture
when its target is included. It SHALL NOT expose an excluded target. If an
internal link cannot be preserved safely, the capture SHALL be refused.

#### Scenario: The source contains local credentials

- **WHEN** the worktree contains an environment file, an integration
  credential, a model key, or the agent's local state
- **THEN** none of it SHALL appear in the capture, in the build context, or
  in the evidence

#### Scenario: A test secret is required

- **WHEN** the developer declares a credential or safe data that the test
  needs
- **THEN** it SHALL be supplied with the minimum scope, outside the build
  context, through a mechanism that does not write it into an image layer,
  and the evidence SHALL preserve it without its value

#### Scenario: Project configuration includes a protected file

- **WHEN** sandbox configuration explicitly includes an environment file, credential file, model key, or other protected path
- **THEN** the capture SHALL continue to exclude the protected path and SHALL NOT expose it through a symbolic link

#### Scenario: An internal link points to an excluded target

- **WHEN** an internal symbolic link in an included source points to a protected path
- **THEN** the capture SHALL be refused rather than omit the link silently or copy the protected target
