# Spec Delta

## REMOVED Requirements

### Requirement: Adversarial review dispatch is risk-proportionate
**Reason**: Synchronized manually into `openspec/specs/agent-routing/spec.md`
because the OpenSpec CLI in this checkout does not provide a standalone
`openspec sync` command; the equivalent effect is the manual merge of
the delta into the main spec before `openspec archive`. Marking the
delta requirement as `REMOVED` keeps the change artifact consistent
with the main spec without duplicating the requirement.
**Migration**: See `openspec/specs/agent-routing/spec.md` for the
authoritative wording.

### Requirement: Targeted adversarial reviews have a bounded closure
**Reason**: Synchronized manually into `openspec/specs/agent-routing/spec.md`
following the same workflow as the risk-proportionate dispatch
requirement above.
**Migration**: See `openspec/specs/agent-routing/spec.md` for the
authoritative wording.

## MODIFIED Requirements

### Requirement: Audit roles expose targeted and full modes
The `qa`, `adversarial`, and `cotizador` agents SHALL each support a
`mode` parameter with values `targeted` (default) and `full`. In `targeted`
mode the agent runs only the minimal verification or audit required for
the declared scope. In `full` mode the agent expands surface to lint,
types, tests, coverage, accessibility, security, performance, and
Playwright crawl where applicable.

The system SHALL require an explicit user request or a concrete
documented risk signal before switching an audit role to `full`. A
concrete risk signal is a security change, a schema or data migration,
a public compatibility change, or an open incident; an external-facing
artifact alone SHALL NOT trigger `full` mode.

#### Scenario: adversarial stays targeted unless asked

- **WHEN** the user requests "revisa estos cambios" without specifying an
  audit depth and no concrete full-review risk signal is documented
- **THEN** the `adversarial` agent SHALL default to `targeted` mode and SHALL
  scan only the final diff, directly affected dependencies, and axes
  relevant to the changed files

#### Scenario: external-facing artifact alone remains targeted

- **WHEN** the changed output is external-facing but has no documented
  security, schema, compatibility, or incident risk and the user did not
  request a full review
- **THEN** the audit role SHALL remain in `targeted` mode

#### Scenario: documented security change upgrades to full

- **WHEN** the review scope includes a documented security change
- **THEN** the audit role SHALL run in `full` mode

#### Scenario: cotizador upgrades to full on confirmed scope

- **WHEN** the user has confirmed the URL, client, final client, scope, rate,
  currency, validity, payment terms, exclusions, and access details
- **THEN** `cotizador` MAY switch to `full` mode and crawl up to the documented
  page budget
