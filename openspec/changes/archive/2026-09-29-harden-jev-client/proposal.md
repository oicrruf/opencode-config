## Why

The local Triage direct client at `agent/lib/jev-client.mjs` accepts
arbitrary recommendations and has no audit trail. A host agent could
paraphrase, omit, or fabricate a recommendation without an upstream
reply, and the operator cannot replay what Triage said last session.

## What Changes

- `consult()` returns `details.evidence` containing the literal upstream
  payload whenever `status === "ok"`, and refuses to return `ok` when
  the recommendation is not a substring of that evidence.
- An append-only JSONL audit log under
  `.opencode/state/triage/consultations.jsonl` records every consultation
  with `timestamp`, `briefDigest`, `status`, `reason` (when
  unavailable), `recommendation`, `confidence`, `evidenceDigest`.
- Two regression tests under `agent/lib/test/` cover the
  evidence-first contract and the audit log append.

## Capabilities

### New Capabilities

- `triage-evidence-integrity`: The local SystemOne client returns
  evidence-locked results and an append-only audit log; the host agent
  cannot paraphrase the upstream recommendation.

### Modified Capabilities

- `triage-decision-agent`: Tighten the host prompt so the recommendation
  relayed to the dispatcher is verbatim from `details.evidence`.

## Impact

- `agent/lib/jev-client.mjs` (evidence field + audit writer)
- `agent/triage.md` (relay-verbatim rule)
- `agent/lib/test/triage-evidence.test.mjs` (new regression test)
- `agent/lib/test/triage-audit-log.test.mjs` (new regression test)
- `scripts/acceptance-harness.mjs` (audit log file existence check
  after a successful run is out of scope for static-only checks; only
  the new self-tests cover the contract)
