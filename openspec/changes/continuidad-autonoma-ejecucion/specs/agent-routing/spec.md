## MODIFIED Requirements

### Requirement: Execution step ceilings are selective and consistent

The system SHALL omit `steps` for the primary agents `build` and `plan` in the template, rendered configuration, and Markdown frontmatter. It SHALL retain specialist ceilings: `general`, `frontend`, and `backend` 80; `explore` and `triage` 25; `qa` 60; `architect`, `orchestrator`, `refactor`, `adversarial`, `cotizador`, `p5t-installer`, and `doctor` 100. All maintained declarations SHALL agree for both supported profiles. A specialist ceiling SHALL NOT be treated as a quota. The system SHALL NOT substitute zero, null, maxSteps, or an artificially large integer for primary omission.

#### Scenario: Implementation ceilings agree across configuration surfaces
- **WHEN** configuration is rendered for either supported installation profile
- **THEN** primary agents SHALL have no steps property and all declared specialist budgets SHALL agree across maintained surfaces

#### Scenario: Completed work stops early
- **WHEN** acceptance conditions and required verification pass
- **THEN** the agent SHALL stop without spending additional iterations

### Requirement: Interrupted execution produces a recoverable handoff

When an external runtime limit or real blocker interrupts unfinished work, the agent SHALL provide a compact text handoff with completed work and affected files, ordered pending work, verification run and not run, blockers or risks, and the next action. It SHALL distinguish incomplete work from verified completion and SHALL NOT claim an exact remaining-step counter unless exposed by the runtime. It SHALL NOT require a final tool call, automatically restart itself, or fabricate user input. Manual continuation SHALL be the fallback for an interrupted primary, not a requirement merely because ordinary authorized work is long. Specialist handoffs SHALL preserve classification, decision, changed files, verification results, blockers, and OpenSpec task impact.

#### Scenario: Final step has no tools
- **WHEN** an external override removes tools with work unfinished
- **THEN** the agent SHALL summarize known evidence and next manual action without claiming a new write or test

#### Scenario: Manual continuation uses the handoff
- **WHEN** the user continues a genuinely interrupted run
- **THEN** the agent SHALL resume pending actions and revalidate only potentially changed evidence

#### Scenario: Specialist budget is exhausted
- **WHEN** a specialist reaches its finite allowance before completing its unit
- **THEN** it SHALL return incomplete status and pending actions without recursive dispatch or self-restart, and the coordinator SHALL manage remaining authorized work within the existing routing, permissions, and review re-dispatch gates

## ADDED Requirements

### Requirement: Primary execution continues toward the authorized outcome

The system SHALL deliver the essential continuity and stop controls in installed primary prompts, including for unrelated consumer projects without this repository's AGENTS.md. Primary agents SHALL continue pending authorized work while making progress until acceptance and required verification are complete or a real blocker requires stopping. They SHALL checkpoint completed work/files, pending actions, verification evidence, and blockers after bounded units. They SHALL stop after three consecutive unsuccessful attempts at the same blocked action without new evidence, unless an operator specifies another finite threshold. They SHALL honor explicit operator time/cost budgets using observed values and SHALL disclose unavailable accounting. These controls SHALL be documented as prompt-level rather than guaranteed runtime watchdogs. Continuity SHALL NOT bypass cancellation, permissions, planning boundaries, scope, or review. No automatic restart supervisor SHALL be introduced by this change.

#### Scenario: Long authorized task completes without renewal
- **WHEN** a primary task needs more model steps than an isolated finite comparison budget
- **THEN** it SHALL retain tool access and finish required work without another user message

#### Scenario: No progress requires a recoverable stop
- **WHEN** the applicable consecutive no-progress threshold is reached
- **THEN** the agent SHALL stop and report the attempts, evidence, pending work, and blocker rather than loop

#### Scenario: Permission or cancellation controls remain authoritative
- **WHEN** permission is denied, the user cancels, or continuation requires new authorization
- **THEN** the agent SHALL respect that boundary without automatic renewal or a broader scope
