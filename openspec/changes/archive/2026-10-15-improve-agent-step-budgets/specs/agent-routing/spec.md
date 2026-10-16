# Spec Delta

## ADDED Requirements

### Requirement: Execution step ceilings are selective and consistent

The system SHALL configure `build` with a ceiling of 120 model steps and `general`, `frontend`, and `backend` with ceilings of 80 model steps each. Other agent ceilings SHALL remain unchanged by this change. All maintained declarations of an agent's ceiling SHALL agree. A ceiling SHALL NOT be treated as a quota or a reason to continue after acceptance conditions pass.

#### Scenario: Implementation ceilings agree across configuration surfaces
- **WHEN** configuration is rendered for either supported installation profile
- **THEN** the template, rendered configuration, routing matrix, and any corresponding Markdown frontmatter SHALL agree on the specified ceilings

#### Scenario: Completed work stops early
- **WHEN** acceptance conditions and required verification pass before the ceiling
- **THEN** the agent SHALL stop rather than consume its remaining allowance

### Requirement: Agents conserve steps without weakening verification

Agents SHALL reuse relevant evidence already obtained and group independent reads or queries when tool capabilities and dependency ordering permit. They SHALL NOT repeat successful discovery without a concrete reason such as changed files, stale results, or an identified information gap. Coordinators SHALL divide long work into bounded verifiable units within existing scope and delegation gates. Efficiency SHALL NOT bypass required verification, permissions, planning boundaries, or review.

#### Scenario: Existing discovery answers the next question
- **WHEN** a successful query already establishes the relevant implementation boundary
- **THEN** the agent SHALL use that evidence rather than repeat a broad search unless it states a concrete reason

#### Scenario: Independent work can be grouped
- **WHEN** multiple discovery operations have no ordering dependency or shared mutable state
- **THEN** the agent SHALL group them when supported, without parallelizing dependent edits or checks

### Requirement: Interrupted execution produces a recoverable handoff

When an agent receives a budget-exhaustion instruction or otherwise must stop with unfinished work, it SHALL provide a compact text handoff using available evidence: completed work and affected files, pending work in order, verification run and not run, blockers or risks, and the next action for manual continuation. It SHALL distinguish incomplete work from verified completion and SHALL NOT claim access to an exact remaining-step counter unless exposed by the runtime. It SHALL NOT require a final tool call to produce this handoff or automatically restart execution. Specialist handoffs SHALL preserve the existing structured return fields, placing pending work and next actions within decision, blockers, or OpenSpec task impact as appropriate.

#### Scenario: Final step has no tools
- **WHEN** the runtime removes tools at the final step with work unfinished
- **THEN** the agent SHALL summarize known progress, pending tasks, verification gaps, risks, and the next manual action in text without claiming a new file write or test run

#### Scenario: Manual continuation uses the handoff
- **WHEN** the user asks to continue an interrupted run
- **THEN** the agent SHALL start from the pending action and revalidate state only as necessary rather than repeat the entire investigation

#### Scenario: Specialist budget is exhausted
- **WHEN** a specialist cannot complete its bounded unit within its allowance
- **THEN** it SHALL return incomplete status, evidence, and pending actions within the existing specialist return contract without recursively dispatching or restarting itself
