## MODIFIED Requirements

### Requirement: Triage unavailability is non-blocking

The system SHALL treat missing credentials, unavailable network access,
upstream errors, timeouts, and unverifiable recommendations as an unavailable
optional consultation. The parent workflow SHALL continue without a Triage
recommendation unless it independently requires a human decision.

#### Scenario: OpenRouter credentials are missing

- **WHEN** Triage cannot resolve an OpenRouter credential
- **THEN** it SHALL return `status: "unavailable"` with reason
  `missing_credentials`, and the dispatcher SHALL continue without Triage

#### Scenario: Upstream consultation fails

- **WHEN** SystemOne times out or returns an upstream error
- **THEN** Triage SHALL report the unavailable result without repeatedly
  retrying or blocking the parent workflow

#### Scenario: Triage succeeds

- **WHEN** a consultation returns a valid evidence-backed recommendation
- **THEN** the dispatcher MAY use it as advisory input and SHALL continue to
  own the final decision
