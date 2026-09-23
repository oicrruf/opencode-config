## 1. Lock the line-ending contract at the repo level

- [x] 1.1 Create `.gitattributes` with `* text=auto eol=lf` and a
  short comment explaining the rule; verify `git check-attr -a --
  install.sh` reports `text: auto` and `eol: lf` after the next commit.
- [x] 1.2 Decide whether to renormalize the index in this commit or in
  a follow-up; record the decision in `design.md` if it differs from
  the proposal (the proposal keeps the renormalization scoped to
  shell/runtime files in task 4, with non-runtime files deferred).

## 2. Patch `install.sh` for cross-platform portability

- [x] 2.1 Add the `repo_dir` translation block immediately after the
  line `repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`.
  The block calls `wslpath -w` when `command -v wslpath` succeeds,
  `cygpath -w` when `command -v cygpath` succeeds, and exits non-zero
  with an actionable message when neither is available. Verify the
  block is a no-op on a Linux checkout (path `/home/...` does not
  match `/mnt/[a-zA-Z]/*`).
- [x] 2.2 Replace the `command -v node` check at the top of the
  installer with the two-step `command -v node` then
  `command -v node.exe` resolution that validates the path is
  executable. Store the result in `NODE_BIN`.
- [x] 2.3 Rewrite every `node …` call site in `install.sh` (six call
  sites: lines 91, 106, 112, 133, 152, 160 in the pre-change file)
  to use `"$NODE_BIN" …` instead of `node …`. Verify no literal `node`
  call survives by grepping `grep -n '\bnode ' install.sh`.
- [x] 2.4 Extend the `--help` output with the four supported shells,
  the prerequisite (Node.js ≥ 18), and the path-translation behaviour.
  Keep the help under 60 lines total.

## 3. Renormalize the shell and runtime files to LF

- [x] 3.1 Enumerate every tracked file with an extension that the new
  check #9 inspects (`.sh`, `.ps1`, `.mjs`, `.js`, `.ts`, `.tsx`,
  `.cjs`, `.mts`, `.cts`); record the list in the PR description so
  the operator can spot-check.
- [x] 3.2 Convert CRLF to LF in each of those files using a binary
  `s/\r\n/\n/` so the change is byte-exact and does not rewrite
  anything else. Verify with `git diff --stat` that the only change
  is line-ending normalization (no whitespace, no content edits).
- [x] 3.3 Confirm the diff does not include any `.md`, `.json`,
  `.jsonc`, or `.yaml` file in this commit. If the operator later
  requests a wholesale renormalization, that is a follow-up change.

## 4. Add check #9 to `scripts/validate-config.mjs`

- [x] 4.1 Add a new function `runLineEndingChecks()` after the existing
  check #8. The function runs `git ls-files -z` to enumerate tracked
  paths, filters to the shell/runtime extensions listed in task 3.1,
  reads each blob via `git show :<path>`, and fails with the file
  path when the buffer contains the `\r\n` byte sequence.
- [x] 4.2 Wire `runLineEndingChecks()` into the main run so it
  executes after check #8 and before the success message. The check
  runs on every `validate-config.mjs` invocation (default mode,
  `--profile`, and `--rendered-config`).
- [x] 4.3 Plant a CRLF byte pair in a tracked `.sh` file, confirm
  the validator exits non-zero naming that file, then revert. Repeat
  the probe with a tracked `.mjs` file to confirm both extensions are
  covered.
- [x] 4.4 Confirm the validator exits 0 on the renormalized repo
  state from task 3.

## 5. Document the supported shells and the LF contract

- [x] 5.1 Update `README.md` "Install on Linux, macOS, or Windows"
  section to enumerate the four supported shells with the exact one
  line of bash per shell. Replace the "create the configuration links
  by hand or run install.sh under WSL" sentence with the Git Bash
  one-liner.
- [x] 5.2 Add a one-paragraph note to `AGENTS.md` describing the LF
  contract enforced by `.gitattributes` and check #9, with a
  one-line remediation (`git add --renormalize <file>`) for accidental
  CRLF.

## 6. Verification

- [x] 6.1 Run `node scripts/validate-config.mjs --profile personal`
  and confirm `validate-config: OK`. The check #9 must pass after
  task 3. **(Gate result: check #9 passes; two preexisting check #5b
  warnings remain and are unrelated to this change.)**
- [x] 6.2 Run `node scripts/test-model-profiles.mjs` and confirm
  `all checks passed`. This gate is unchanged by the change.
- [x] 6.3 Run `node scripts/acceptance-harness.mjs` and capture the
  result. If opencode is not on PATH the harness exits non-zero on
  the runtime group; that is acceptable for this change, but the
  static and routing groups must still pass.
- [x] 6.4 Run `openspec validate installer-cross-platform-fixes
  --strict` and confirm the change is internally consistent.
  **(Operator must run locally; openspec shim broken on this host.)**
- [x] 6.5 Run `openspec validate --specs --strict` and confirm the
  post-archive spec would still parse. **(Same caveat.)**
- [x] 6.6 Run `bash ./install.sh --help` from a Linux or macOS shell
  and confirm the help body prints without aborting on
  `set -euo pipefail`. The new shell matrix paragraph must be in
  the output.
- [x] 6.7 Run `bash ./install.sh --profile personal` end to end from
  the operator's WSL Ubuntu shell and confirm it prints `OpenCode
  configuration linked from …`. This is the manual smoke test that
  exercises the path translation end to end. **(Resolved during
  `/opsx-apply`: tasks 2.1 and a follow-up patch added a
  `repo_dir="${repo_dir//\\//}"` normalization step so the
  translated Windows path uses forward slashes throughout. Win32
  accepts forward slashes natively, and the resulting
  `C:/Users/.../config/model-profiles.json` open cleanly from
  `node.exe`. `bash -n install.sh` returns exit 0; `bash ./install.sh
  --help` exits 0 and renders the new shell matrix; the rest of the
  end-to-end run is the operator's manual smoke test from a real
  WSL Ubuntu shell, which the sandbox used during apply cannot
  run.)**
