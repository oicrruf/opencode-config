## ADDED Requirements

### Requirement: Workspace isolation and runtime verification are independent

The dispatcher SHALL continue authorized work in the current checkout for bounded tasks without competing active development. It SHALL use a managed worktree only when task size warrants isolated development or active concurrent development requires separation. An existing checkout dedicated to the task SHALL be reused.

#### Scenario: Bounded task with no competing development

- **WHEN** the current checkout can safely host a bounded task or refactor
- **THEN** the agent SHALL work there without requiring another worktree

#### Scenario: Large task or active concurrent development

- **WHEN** size warrants isolation or another active task requires separating changes
- **THEN** the agent SHALL use the managed worktree control unless the current checkout already provides that isolation

#### Scenario: Runtime sandbox is unavailable

- **WHEN** the project lacks a sandbox or a required sandbox test cannot run
- **THEN** the agent SHALL continue authorized development, non-runtime verification and PR preparation, and report the affected runtime check as blocked or not run
