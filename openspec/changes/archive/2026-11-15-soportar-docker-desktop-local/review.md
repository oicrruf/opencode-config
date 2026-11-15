# Adversarial review — 2026-11-14

Required by agent/routing.md for compatibility/security impact. Reviewers used
read-only native agent execution at depth 1 and did not modify files.

First final review (`review_desktop`) confirmed two MAJOR findings:

1. Ambient BUILDX_BUILDER could redirect docker build despite daemon probes.
2. preserveClosure could overwrite original runtime observations during cancel
   or recover after a cleanup-pending finish.

Both were corrected and covered by regression tests. The introduced MINOR log
race in the prerequisite probe was corrected with bounded wait/JSON validation.
The single permitted focused re-review (`review_desktop_fixes`) independently
passed 26/26 engine/lifecycle tests and inspected the corrected real execution's
external evidence. Verdict: **both MAJOR resolved; no BLOCKER/MAJOR outstanding
within the reviewed scope**. Acceptance 44/44 and diff check also reviewed.

The full implementation remains incomplete: no Linux/arm64 OpenCode executable
in the declared cached image, no real OpenCode session or tool-registry loading
observation. Tasks 3.1–3.3 and AT-188 4.5 remain pending. The prerequisite probe
does not establish plugin loading. The pre-existing numeric capture fingerprint
is a string-length value and is not accepted as sufficient identity proof.
No additional review was dispatched for cosmetic concerns or unrelated debt.
