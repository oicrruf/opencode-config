## Context

See `proposal.md`. The current `consult()` returns whatever the host
agent decides to call it, including recommendations that were never
issued by SystemOne. We want the client to refuse `status: "ok"`
unless `details.evidence` proves the upstream reply actually contained
that recommendation, and we want every call logged to an append-only
JSONL.

## Goals / Non-Goals

**Goals:**
- Make fabrication impossible at the client boundary.
- Leave an operator-replayable audit trail per consultation.
- Stay dependency-free: the client remains a single ESM module.

**Non-Goals:**
- Replace the SystemOne model or change the upstream URL.
- Add a UI for the audit log; the JSONL is the contract.
- Persist or rotate audit logs beyond a single append-only file.

## Decisions

### Evidence-first client contract

`consult()` will validate that the recommendation string is a substring
of `details.evidence` whenever `status === "ok"`. A new test hook
(`_setAuditPathOverrideForTest`) lets the regression suite redirect
the audit log to a temp file. A new option `bypassFabricationCheck`
exists only for tests; it is not exported and not callable from the
agent host.

### Append-only audit writer

The writer uses Node's `fs.openSync(..., 'a')` per call with
`fsyncSync` so two concurrent consults cannot interleave a line. The
writer only ever appends; rotating or truncating is out of scope and
must be performed by an operator with shell access.

### Host prompt tightening

`agent/triage.md` gains an explicit rule: "Relay the recommendation
verbatim; never paraphrase or invent one. The audit log is canonical."
This aligns with the spec scenario so the host cannot reinterpret the
upstream text and still satisfy the contract.

## Risks / Trade-offs

- [Evidence string mismatch for `score` primitives] → the
  recommendation includes the score id (`x=score(2)`); the upstream
  `answers[id].score` value is also embedded, so the substring check
  holds for all three primitives.
- [Audit log growth] → document that operators may rotate manually;
  do not auto-prune, as audit retention is a compliance concern.

## Migration Plan

1. Update the client and add the two regression tests.
2. Update the host prompt.
3. Extend the acceptance harness to confirm the audit log file is
   absent at baseline but present after a successful consultation.
4. Validate, install, and restart OpenCode.
