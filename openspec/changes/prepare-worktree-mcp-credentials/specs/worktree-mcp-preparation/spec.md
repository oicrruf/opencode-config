# Spec Delta

## Purpose

Managed worktrees need an explicit and safe way to establish whether their MCP configuration and required local credential files are ready, without confusing configuration presence with provider connectivity or exposing unrelated secrets.

## ADDED Requirements

### Requirement: Worktree creation verifies effective MCP readiness

The system SHALL inspect the effective MCP configuration from the actual worktree location after creating or reusing a managed worktree. It SHALL report configuration presence separately from provider connectivity and SHALL NOT infer a successful connection merely because a configuration file or global credential exists.

#### Scenario: Effective configuration is present but provider connection is unknown
- **WHEN** a worktree has effective MCP configuration but connection status cannot be verified
- **THEN** readiness SHALL report configuration as present and connectivity as unknown, without claiming the provider is connected

#### Scenario: Configuration inspection is unavailable
- **WHEN** the system cannot inspect effective configuration from the worktree
- **THEN** preparation SHALL be reported as incomplete and block successful readiness

### Requirement: Preparation preserves MCP enablement policy

The system SHALL determine local file needs from effective configuration and SHALL NOT enable a disabled MCP server or impose a fixed server allowlist. A required local file SHALL be considered only for a server enabled in the effective configuration.

#### Scenario: Disabled server has local credentials
- **WHEN** a configured MCP server is disabled but a matching local credential file exists
- **THEN** preparation SHALL NOT activate the server or treat that file as a reason to copy credentials

#### Scenario: Enabled server does not require local files
- **WHEN** an enabled MCP uses globally available configuration and requires no local credential materialization
- **THEN** preparation SHALL preserve the global configuration and SHALL NOT create a local credential file

### Requirement: Local credential materialization is minimal and safe

The system SHALL prefer authorized global credentials. If local materialization is required and authorized, it SHALL copy only the minimum declared credential files, use restrictive permissions, accept only safe regular files, and refuse symlinked or unsafe source and destination paths. It SHALL NOT copy `.env`, entire ignored directories, or unrelated credentials.

#### Scenario: Explicitly authorized credential file is materialized
- **WHEN** an enabled MCP requires a local file and a minimal source file is authorized and safe
- **THEN** the system SHALL copy only that file with restrictive permissions and record that it owns the resulting file

#### Scenario: Unsafe or unauthorized source is encountered
- **WHEN** a candidate credential source is a symlink, unsafe path, or not authorized for materialization
- **THEN** the system SHALL refuse to copy it and report preparation as incomplete without exposing its contents

### Requirement: Incomplete preparation is blocked and resumable

The system SHALL record preparation progress and ownership so an incomplete operation can be safely resumed. Worktree creation SHALL NOT report successful readiness while required preparation remains incomplete.

#### Scenario: Preparation fails after partial materialization
- **WHEN** a preparation step fails after creating one or more owned credential files
- **THEN** the system SHALL preserve enough ownership/progress metadata to resume or selectively clean up those files and SHALL report the worktree as not ready

### Requirement: Retirement removes only owned credential material

The system SHALL refuse to request worktree removal while any credential file it owns remains present at its recorded path, regardless of whether that file still matches the recorded identity. It SHALL NOT ask the worktree API to delete owned credentials because the API cannot provide an atomic file-identity precondition. The operator must explicitly move or delete owned credential files before retrying retirement. Only after all owned paths are safely verified absent may retirement proceed; stale ownership metadata SHALL be cleared only after the worktree API succeeds and the path is confirmed gone. A pending transaction or unsafe/unverifiable path SHALL block retirement.

#### Scenario: Owned credential files remain in the worktree
- **WHEN** explicit retirement is requested while one or more control-owned credential files remain present
- **THEN** the system SHALL refuse retirement before calling the worktree API, preserve all credential files and ownership metadata, and tell the operator to move or delete those files explicitly

#### Scenario: Operator has moved owned credential files
- **WHEN** all owned credential paths are safely verified absent and the remaining retirement checks pass
- **THEN** the system MAY request worktree removal and SHALL clear stale ownership metadata only after the API succeeds and the worktree directory is gone

#### Scenario: Owned file identity changed
- **WHEN** a recorded credential path exists but its current file identity differs from the ownership manifest
- **THEN** the system SHALL still block retirement and SHALL NOT treat the changed file as safe to delete

#### Scenario: Unowned credentials are present
- **WHEN** a credential-like file is not recorded as owned by the preparation control
- **THEN** cleanup SHALL leave it untouched and existing retirement protections SHALL remain in force

### Requirement: Credential contents are never disclosed

The system SHALL NOT include credential values in logs, tool results, readiness reports, manifests, or error messages. Reports MAY include safe file metadata and redacted reasons necessary to explain preparation status.

#### Scenario: Preparation reports a credential error
- **WHEN** reading or copying a credential file fails
- **THEN** the report SHALL identify the failed operation without including any credential value or secret-bearing file contents
