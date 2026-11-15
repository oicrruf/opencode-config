## 1. Sandbox safety and lifecycle

- [x] 1.1 Make protected capture exclusions non-overridable and preserve internal links or refuse unsafe targets; verify the capture regression tests pass.
- [x] 1.2 Verify owner/process-group state during recovery; route sandbox reservations through execution-specific recovery and return recovery credentials when needed; verify reservation tests pass.
- [x] 1.3 Start an independent deadline helper for bounded runs and keep retries evidence-preserving and scoped; verify the deadline lifecycle test passes.
- [x] 1.4 Screen all caller-controlled report values, hash sorted capture fingerprints, and remove/verify capture and execution state during cleanup; verify lifecycle regressions pass.
- [x] 1.5 Wire the managed V2 worktree listing into `reservation_start` and require inventory-backed worktree identity; verify adapter and managed-worktree tests pass.

## 2. Regression and validation

- [x] 2.1 Add targeted regression tests for all review findings; verify the complete sandbox-control and plugin adapter suites pass.
- [x] 2.2 Run focused suites, repository validation gates, strict OpenSpec validation, and final review; update verification evidence.
