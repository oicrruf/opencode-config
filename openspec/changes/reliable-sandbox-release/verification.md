# Verification — 2026-11-19

- Sandbox and worktree suites: 236/236 passed.
- Focused release/source/Compose suites: 28/28 passed independently by final adversarial reviewer.
- Configuration validators: personal and work passed.
- Model profile checks: passed.
- Acceptance harness: 45/45 static passed; live OpenCode harness not run.
- OpenSpec strict validation and git diff --check: passed.
- Adversarial review: PASS after correcting malformed-inventory acceptance. No introduced BLOCKER/MAJOR outstanding.
- Installed distribution: bash ./install.sh --check synchronized, personal profile. Existing plugin symlink resolves to this checkout. A fresh OpenCode session is needed to load changed modules; in-process reload was not verified.

## Real authorized release

Executed the operator CLI against /Users/oicrruf/Projects/more-time-back/website. Result: ok=true, released=true, resourceWorkId=at-157-bilingual-routes-switching, Compose project website-mtb-local. Both exact container IDs and all containers bearing this Compose project label are absent. Reservation independently read as free.

Evidence: /Users/oicrruf/Projects/more-time-back/website/.opencode/state/sandbox/reports/compose-release-f68dc084885539d1f4e0213421e8bf27.json

The database volume website-mtb-local_database_data retained its Name/CreatedAt/Driver/Mountpoint identity. All three bind paths retained their inode. The .env hash and complete uploads file/hash mapping match the pre-release baseline. Database logical contents were not queried; no volume operation or bind deletion was performed. Compose network retained.

## Scope and delivery

One application per project remains. The fixed blockers were release identity's dependency on the managed API and global rejection caused by unrelated containers with incomplete Compose labels. No manual Docker stop/rm, lock deletion, worktree registration/removal or quota bypass was used. The operator CLI handles the Git fallback; managed-success sessions with an unrecorded runtime owner can use that CLI. Changes are local, not committed or pushed. Pre-existing .opencode state changes were preserved.
