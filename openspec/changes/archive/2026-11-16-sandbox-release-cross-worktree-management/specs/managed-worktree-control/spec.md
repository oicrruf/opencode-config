# Spec Delta

## ADDED Requirements

### Requirement: Retirement refuses worktrees mounted by active local containers

The managed worktree control SHALL inspect active local container bind mounts before retirement and before the final removal. If an active container bind-mounts the target worktree, retirement SHALL be refused before evidence preservation or removal and SHALL direct the operator to release the application with `/sandbox release`. Container mount inspection SHALL use the verified local engine and allowlisted mount metadata only; failure to verify the local engine or inspect its running-container mounts SHALL block retirement. Retirement SHALL run under the shared project sandbox-operation gate so a sandbox or application mutation cannot start between the final check and worktree removal. Retirement SHALL NOT stop containers or remove persistent database volumes or upload paths itself.

#### Scenario: An active Compose app uses the worktree

- **WHEN** an active local container bind-mounts a managed worktree
- **THEN** the retirement control SHALL preserve the worktree and report that `/sandbox release` must close the app before retirement

#### Scenario: The application has been released

- **WHEN** the verified application is released and no active local container bind-mounts the worktree
- **THEN** the container-access check SHALL allow retirement to continue through its other explicit retirement checks

#### Scenario: A sandbox start races with retirement

- **WHEN** retirement begins while a sandbox mutation is active, or a mutation requests the shared gate during retirement
- **THEN** only one operation SHALL proceed and the refused operation SHALL leave the worktree and runtime unchanged

#### Scenario: Container mount inspection is uncertain

- **WHEN** the verified local engine is reachable but running-container mount metadata cannot be inspected
- **THEN** retirement SHALL block before evidence preservation and removal

#### Scenario: The local engine cannot be verified

- **WHEN** the local engine socket or metadata cannot be verified
- **THEN** retirement SHALL block before evidence preservation and removal
