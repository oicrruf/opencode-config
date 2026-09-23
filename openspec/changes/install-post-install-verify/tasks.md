## 1. Post-install verification block

- [x] 1.1 Add a post-install verification block to `install.sh` that
  runs the profile tests, Jev client self-tests, the static acceptance
  harness, and `openspec validate --specs --strict --type spec`; print
  a `OK — <p>/<r> gates passed (<s> skipped)` summary and exit
  non-zero when any required gate fails.

## 2. Opt-out variables and docs

- [x] 2.1 Honor `OPENCODE_SKIP_PROFILE_TESTS`,
  `OPENCODE_SKIP_JEV_CLIENT_TESTS`, `OPENCODE_SKIP_ACCEPTANCE`, and
  `OPENCODE_SKIP_OPENSPEC_VALIDATE`; update `README.md` to document
  the new contract and the env vars; verify `./install.sh` end to
  end.
