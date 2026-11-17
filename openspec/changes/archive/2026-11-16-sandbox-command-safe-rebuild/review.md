# AT-200 adversarial review

## Initial review

Scope: final tracked and untracked diff against `517dd92`, directly affected
dependencies and OpenSpec contracts. Read-only, engine-free reproductions
in temporary repositories. No nested dispatch, Docker or global changes.

Verdict: `pass-with-blocking-findings`, four introduced MAJOR findings:

1. The strict parser was unused by the real slash-command path: Markdown
   instructions did not enforce pre-tool rejection. Connect a native V2
   command executor and verify it through the real command API.
2. A process could die after persisting `running` but before returning the
   new token. Recovery rejected that state and demanded an undelivered token.
3. A provisional successor closed during recovery became unrecoverable if
   publishing `recovered` failed: retries admitted only `preparing`.
4. Transition cleanup deleted the execution directory before writing the
   terminal record; failed terminal persistence lost required recovery identity.

Reopened tasks: 3.2, 3.4, 4.1, 4.2, plus integrated verification after fixes.
Only one focused re-review of these findings is permitted by routing.

## Focused re-review

Verdict: `pass`. All four original MAJOR findings were verified corrected;
no MAJOR/BLOCKER remained within that focused scope. The reviewer independently
ran 9/9 focused regressions covering native command handling, V2 context,
interruption in running, terminal persistence and provisional/journal retry.
No Docker, installation, full-suite rerun or edits were performed by the reviewer.

The review confirmed native pre-dispatch parsing, queue/resume-false responses,
verified running recovery, idempotent closed provisional recovery and preserved
atomic execution records before quota release. It inspected the supplied real
runtime evidence (21 unique tools, eight command cases without tool/model calls,
verified final closure). Its scope does not prove a rendered UI; the fixture
controller listing limitation remains explicitly documented.

This is an agent review, not human approval, merge or global activation.
