# Spec Delta

## MODIFIED Requirements

### Requirement: The reservation records its owner and its token

The system SHALL record the reservation's owner token, the identity of the supervisor process, the time it was taken, its process group, and its session. The token SHALL be the only way to stop the application through ordinary stop/finish/cancel/recover operations. An explicitly requested, permission-checked sandbox release or transfer SHALL be an exception only for exact resources verified against the reservation, Compose labels and managed project worktree inventory. For a legacy application reservation, the recorded work ID MAY differ from the Compose runtime source only when exact project labels and bind mounts resolve to exactly one existing managed worktree; the operation SHALL preserve both identities in its report. Such operations MAY close a reservation owned by a different worktree in the same project without obtaining or exposing the previous token, but SHALL NOT cross projects or act on ambiguous or unverified resources. Transfer SHALL rotate ownership authority without obtaining or exposing the previous token. The system SHALL store only a salted token verifier, SHALL store the name of the executable and SHALL NOT store secrets passed as arguments. New sandbox ownership SHALL include a verified session and generation bound to its exact execution.

#### Scenario: The reservation is recorded
- **WHEN** an application is started
- **THEN** the system SHALL record the token verifier, supervisor identity, start time, process group and session, and SHALL return the token to the requester without writing it to logs or reports

#### Scenario: The arguments carry a secret
- **WHEN** a start request passes a value that looks like a credential
- **THEN** the system SHALL refuse to store it and SHALL report the refusal

#### Scenario: Transfer changes ownership between managed worktrees
- **WHEN** an explicitly permitted transfer verifies source and target worktrees in the same project and proves the exact resource relationship
- **THEN** the system SHALL rotate authority under exclusive control and deliver the new capability only to the new owner without revealing the old capability

#### Scenario: Legacy reservation work ID differs from the Compose source
- **WHEN** a permitted release or transfer finds a stale recorded work ID but all Compose resources map to exactly one managed source worktree in the same project
- **THEN** the system SHALL retain the recorded owner ID and runtime source ID separately and SHALL perform no resource changes if the source match is absent or ambiguous

#### Scenario: Application transfer leaves a reserved handoff
- **WHEN** an explicitly permitted transfer closes a verified application from one managed worktree and targets another worktree in the same project
- **THEN** the system SHALL rotate authority to the target session and worktree, preserve the quota in `awaiting-start`, and return only the new owner capability

#### Scenario: Transfer changes the sandbox owner
- **WHEN** an explicitly requested sandbox transfer passes project/work, resource, session and operation verification
- **THEN** the system SHALL rotate authority under exclusive control and deliver the new capability only to the new owner without revealing the old capability

#### Scenario: Release is explicitly authorized
- **WHEN** an explicitly permitted release verifies the reservation and all attributable runtime resources
- **THEN** the system SHALL close those resources without requiring the prior token, preserve persistent data and record the released worktree identity

#### Scenario: Old authority targets a successor
- **WHEN** an old token, session or supervisor generation attempts to mutate the successor
- **THEN** the system SHALL refuse without changing resources or releasing the current reservation

### Requirement: Reservation replacement is exclusive and continuous across processes

The system SHALL serialize project-level start, replacement, transfer, release, closure, recovery and supervisor mutations across processes. It SHALL keep the project quota held from replacement or release intent through verified closure and successor ownership or verified resource absence, without exposing a free interval. Each mutation SHALL verify the exact execution and ownership generation. Concurrent or uncertain operations SHALL block without automatically retrying or taking over locks by age alone. Manual applications SHALL share this exclusion and quota; they MAY be explicitly released or transferred only when their runtime resources and persistent-data boundaries are uniquely verified.

#### Scenario: Two sessions race to replace or release
- **WHEN** two independent processes request replacement, transfer or release concurrently
- **THEN** only one SHALL mutate the reservation or resources and the other SHALL report a conflict without launching an application

#### Scenario: Two sessions race to replace
- **WHEN** two independent processes request replacement or transfer concurrently
- **THEN** only one SHALL mutate the reservation or resources and the other SHALL report a conflict without launching an application

#### Scenario: Another start races with release
- **WHEN** a sandbox or manual application start arrives after old resources close but before release is committed
- **THEN** it SHALL remain blocked by the continuously held project quota

#### Scenario: Another start races with closure
- **WHEN** a sandbox or manual application start arrives after old resources close but before replacement ownership commits
- **THEN** it SHALL remain blocked by the continuously held project quota

#### Scenario: Supervisor races with transfer or release
- **WHEN** the old supervisor attempts cleanup while transfer or release commits
- **THEN** exclusion and identity verification SHALL prevent it from acting on the successor or releasing the current reservation

#### Scenario: Supervisor races with transfer
- **WHEN** the old supervisor attempts cleanup while transfer commits a new generation
- **THEN** exclusion and identity verification SHALL prevent it from acting on the successor or releasing its reservation

#### Scenario: Persistent data is attached to the application
- **WHEN** release or transfer finds database volumes or host upload paths attached to verified application resources
- **THEN** the system SHALL preserve those volumes and paths and SHALL NOT remove them as disposable runtime resources

#### Scenario: A target resumes a transferred application
- **WHEN** the target session supplies the handoff token, managed work ID, and its own application command with matching persistent mounts
- **THEN** the system SHALL start only that command and SHALL complete the handoff without changing the database volume or upload source

#### Scenario: A target command has mismatched persistence
- **WHEN** the target command mounts a different persistent volume or upload source
- **THEN** the system SHALL not start or release the held quota and SHALL preserve the handoff record and old persistent data

#### Scenario: Application ownership cannot be verified
- **WHEN** application resource labels do not uniquely match the recorded worktree and project
- **THEN** release and transfer SHALL be refused while the reservation and all resources remain intact
