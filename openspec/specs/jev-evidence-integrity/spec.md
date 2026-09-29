# jev-evidence-integrity Specification

## Purpose
Lock the local SystemOne client to evidence-first behavior so the host
agent cannot fabricate or paraphrase a recommendation when the upstream
did not reply, and leave an operator-replayable audit log per
consultation.

## Requirements

### Requirement: Successful consultations carry literal upstream evidence

The system SHALL require that `consult()` returns `status: "ok"` only
when `details.evidence` is present, non-empty, and the recommendation
string is contained verbatim in `details.evidence`. When the upstream
reply does not contain the recommendation substring, the system SHALL
return `status: "unavailable"` with `reason: "fabricated_recommendation"`.

#### Scenario: Successful call returns upstream evidence

- **WHEN** `consult()` receives a valid brief and SystemOne returns a
  typed answer
- **THEN** the result `status` SHALL be `"ok"`, `details.evidence`
  SHALL contain the literal upstream JSON payload, and the
  `recommendation` SHALL appear as a substring of `details.evidence`

#### Scenario: Host cannot fabricate a recommendation

- **WHEN** a caller passes `consult({ ..., recommendation: "..." })`
  with a recommendation that is not a substring of the upstream payload
- **THEN** `consult()` SHALL return `status: "unavailable"` with
  `reason: "fabricated_recommendation"` and SHALL NOT record the call
  as a successful consultation

### Requirement: Append-only audit log records every consultation

The system SHALL append one line per consultation to
`.opencode/state/triage/consultations.jsonl`. Each line SHALL include
`timestamp`, `briefDigest` (sha-256 of the canonical brief), `status`,
`reason` (when unavailable), `recommendation`, `confidence`, and
`evidenceDigest` (sha-256 of `details.evidence`). The log SHALL NOT
contain credentials, raw prompts, or raw upstream bodies.

#### Scenario: Successful call writes an audit row

- **WHEN** `consult()` returns `status: "ok"`
- **THEN** exactly one row SHALL be appended to the audit log with
  non-empty `recommendation` and `evidenceDigest`

#### Scenario: Unavailable calls write an audit row

- **WHEN** `consult()` returns `status: "unavailable"`
- **THEN** the audit row SHALL include `reason` and SHALL NOT include a
  fabricated `recommendation`

### Requirement: Audit log is append-only

The system SHALL write the audit log atomically (one `fsync` per
append) and SHALL refuse to truncate or rewrite existing lines. The
operator SHALL be able to read the log line by line without external
tools.

#### Scenario: Append-only mode preserves prior rows

- **WHEN** an external process attempts to truncate the audit log
  between successive `consult()` calls
- **THEN** the next consultation SHALL still find the original rows
  intact because the writer uses append-only mode (`'a'`)
