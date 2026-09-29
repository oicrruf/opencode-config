## 1. Evidence-locked client

- [x] 1.1 Extend `consult()` so every successful result carries a literal
  `details.evidence` upstream payload, and reject any call that returns
  `status: "ok"` without the recommendation appearing verbatim inside
  that payload; verify via a fabrication-resistance regression test.

## 2. Append-only audit log

- [x] 2.1 Implement an append-only JSONL writer that records one row per
  consultation with `timestamp`, `briefDigest`, `status`, `reason`
  (when unavailable), `recommendation`, `confidence`, and
  `evidenceDigest`; verify a successful row and an unavailable row are
  appended atomically.

## 3. Host prompt tightening and acceptance coverage

- [x] 3.1 Update `agent/triage.md` so the host cannot paraphrase the
  upstream recommendation; run the validator, harness, profile tests,
  Triage client tests, and strict OpenSpec validation; render and install
  the personal profile.
