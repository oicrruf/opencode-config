## 1. Patch the heredoc delimiter in `install.sh`

- [x] 1.1 Change `cat <<EOF` to `cat <<'EOF'` on the line that begins
  the `print_help()` heredoc body in `install.sh` (line 49 in the
  post-rebase file). Verify with `git diff` that the diff is exactly
  one character (the `'` between `<<` and `EOF`).
- [x] 1.2 Confirm no other heredoc or quoted block in `install.sh`
  needs the same treatment. `grep -n '<<' install.sh` should return
  only the one occurrence.

## 2. Verify the help renders correctly

- [x] 2.1 Run `bash ./install.sh --help 2>/tmp/help.err 1>/tmp/help.out`
  and confirm exit 0, `/tmp/help.err` is empty (zero bytes), and
  `/tmp/help.out` contains the line
  ``On success the final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.``
  rendered verbatim with the surrounding backticks intact.
- [x] 2.2 Run a planted regression test: revert the fix
  temporarily, re-run `bash ./install.sh --help 2>/tmp/err`, confirm
  `/tmp/err` is non-empty and `/tmp/help.out` has the empty `final
  line is .` paragraph, then re-apply the fix and confirm both
  expectations invert. Document the planted test in the commit body.
- [x] 2.3 Compare the full `--help` output before and after the fix
  (use `git stash` to keep a copy of the pre-fix version, or store the
  current output to a fixture file). Confirm only the one paragraph
  changes; all other paragraphs render identically.

## 3. Re-validate the unrelated gates

- [x] 3.1 Run `node scripts/test-model-profiles.mjs` and confirm
  `all checks passed`. The change does not touch this script.
- [x] 3.2 Run `node scripts/validate-config.mjs --profile personal`
  and confirm the same pre-existing `mmx-cli` warnings still print
  (these are unrelated to this change). The check #9 line-ending
  guard should still report 0 CRLF in 169 shell/runtime files.
- [x] 3.3 Run `bash -n install.sh` and confirm exit 0.

## 4. Spec delta and validation

- [x] 4.1 Apply the spec delta from this change to
  `openspec/specs/installer-portability/spec.md` (the new scenarios
  for verbatim rendering and zero-stderr during `--help`).
- [x] 4.2 Run `openspec validate fix-install-help-heredoc --strict`
  and confirm exit 0. **(Operator must run locally; openspec shim is
  broken on this host, same constraint as the previous change.)**
- [x] 4.3 Run `openspec validate --specs --strict` and confirm exit 0
  after the spec delta is in place. **(Operator must run locally.)**

## 5. Commit and archive

- [x] 5.1 Stage `install.sh` and the spec delta and the change
  directory. Run `git status --short` to confirm exactly three paths
  are staged (the script, the spec file, and the change directory).
- [x] 5.2 Commit with the message
  `fix(installer): quote heredoc in print_help to render --help verbatim`
  and a body listing the four verification commands that pass after
  the fix.
- [ ] 5.3 Run `/opsx-archive fix-install-help-heredoc` once the
  commit is on `main` and pushed, and the operator confirms the
  `openspec validate --strict` runs pass locally.
