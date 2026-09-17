## Purpose

Keep the description cost of global skills bounded while preserving reach
for delivery work: model-invoked skills are reserved for the ones that
fire during normal delivery, and large skills disclose their deep content
behind references instead of bloating the always-loaded frontmatter.

## ADDED Requirements

### Requirement: Delivery skills stay model-invocable

The skills `debugging`, `surgical-patch`, `verify-and-stop`,
`lean-build`, `code-review`, `dedupe`, `investigate-first`, `safe-refactor`,
`frontend-design`, `interface-design`, and `refactoring` SHALL remain
model-invocable (no `disable-model-invocation` flag) and SHALL keep their
descriptions concise enough that the union of all their descriptions fits
within 3000 characters.

#### Scenario: delivery skills are reachable by description

- **WHEN** the primary agent encounters a bug, a layout decision, a
  refactor, or a verification gate
- **THEN** the relevant delivery skill SHALL be reachable from the agent's
  description alone, with no manual invocation required

### Requirement: Operation-specialized skills are user-invoked

The skills `archify`, `herdr-integration`, `mmx-cli`, `caveman-commit`,
`git-workflow`, and `writing-great-skills` SHALL be marked
`disable-model-invocation: true` in their frontmatter. Their
`description` SHALL be a one-line human-facing summary that lists the
canonical trigger keywords, and SHALL NOT include model-facing trigger
prose.

The system SHALL surface a router skill (user-invoked) that names the
above skills and when to reach for each, so that manual recall stays
tractable as the set grows.

#### Scenario: archify does not consume description budget

- **WHEN** an architecture-diagram request arrives at the primary agent
- **THEN** the agent SHALL NOT see the `archify` description in its system
  prompt; it SHALL reach `archify` only when the user types the name or
  invokes it explicitly

### Requirement: Progressive disclosure for large skills

Skills whose body exceeds 8000 bytes SHALL disclose their deep content
behind named reference files inside the skill folder. The
`SKILL.md` SHALL contain only: the leading router, the load condition, the
stop condition, and context pointers (filename plus one-line purpose) to
the disclosed references.

#### Scenario: interface-design points to references

- **WHEN** the `interface-design` skill is loaded
- **THEN** the system SHALL read `SKILL.md` plus only the reference files
  named by the context pointers that fire for the current branch

#### Scenario: archify keeps its renderer behind a pointer

- **WHEN** the user invokes `archify` for a Mermaid-to-HTML conversion
- **THEN** the agent SHALL read the renderer reference file only after the
  Mermaid branch fires, not at load time

### Requirement: Skill descriptions are pruned for redundancy

The system SHALL ensure that no two model-invoked skill descriptions
share an exact clause longer than 12 words, and SHALL refuse to load a
project config that violates this rule. The check is enforceable via a
small script checked into the repo.

#### Scenario: duplicate description clauses fail validation

- **WHEN** two skills both contain "Use when the user asks for a code
  review" in their description
- **THEN** the install validator SHALL emit a warning naming both skills
  and SHALL suggest removing the duplicated clause from the less-trafficked
  skill
