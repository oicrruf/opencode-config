## Context

`install.sh --help` on `origin/main` (HEAD `22f0ce7` after the
`installer-cross-platform-fixes` rebase) emits a bash syntax error to
stderr and renders one paragraph with an empty clause where the contract
example should be. The bug was introduced by commit `0dadf73 feat(install):
add post-install verification gates` when it added a new paragraph to the
help body containing a backticked example of the gate-summary format.

### Reproduction

```bash
$ bash ./install.sh --help 2>/tmp/help.err 1>/tmp/help.out
$ cat /tmp/help.err
./install.sh: command substitution: line 48: syntax error near unexpected token `('
./install.sh: command substitution: line 48: `install.sh: OK — <p>/<r> gates passed (<s> skipped)'
$ grep -A1 'final line is' /tmp/help.out
  final line is .
```

The line numbers 48 come from bash's internal heredoc parser counting from
the `<<EOF` marker; the actual text is on line 96 of `install.sh`:

```bash
96: "  final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`."
```

### Why `set -euo pipefail` did not catch it

The `cat <<EOF` body is processed by the heredoc parser before the parser
sees the `cat` command. When bash encounters the backticks it attempts to
evaluate them as a subshell command substitution. The `set -e` directive
applies to command execution, not to the static expansion that happens
during heredoc parsing. The subshell fails (no `install.sh` on PATH in this
context, plus the parenthesis syntax error in the substituted command line);
bash emits the syntax error to stderr and substitutes an empty string into
the heredoc output. The `cat` command itself runs successfully, so `set -e`
never fires.

This means `install.sh --help` exits 0 (the `cat` succeeds) but pollutes
stderr and renders an incomplete paragraph. CI scripts that capture both
stdout and stderr (e.g. for log analysis) will see the noise; CI scripts
that only check exit status will not.

## Goals / Non-Goals

**Goals**

1. `bash ./install.sh --help` exits 0 with **zero bytes on stderr**.
2. The help body contains the exact line
   ``On success the final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.``
   rendered verbatim, including the surrounding backticks.
3. No other line of the help body changes. The fix is single-character
   at the heredoc delimiter.
4. The change does not affect any other file in the repo.

**Non-Goals**

1. No rewording of the help body.
2. No change to the gate-summary format contract.
3. No refactor of `print_help` into a separate file or function.
4. No change to any other heredoc or quoted block in `install.sh`.
5. No change to the post-install gate logic itself.
6. No attempt to also harden other places where the help body might
   reference shell metacharacters in the future. The spec covers the
   current body; future content can introduce new quoting rules if
   needed.

## Decisions

### Decision: quote the heredoc delimiter (`<<EOF` → `<<'EOF'`)

Bash documents two heredoc variants:

- `<<EOF` — performs parameter expansion (`$var`), command substitution
  (`$(...)` and backticks), and arithmetic expansion (`$((...))`) inside
  the body.
- `<<'EOF'` (or `<<\EOF`) — passes the body through verbatim, with no
  expansion of any kind.

The help body is a documentation string. It contains literal
`` `install.sh: OK — <p>/<r> gates passed (<s> skipped)` `` as an
example, plus a `$HOME` reference on line 53 that expands to the
operator's home directory. Switching to `<<'EOF'` removes the
interpolation entirely:

- The `$HOME` on line 53 will render as the literal string `$HOME`
  instead of `/home/<user>` or `C:\Users\<user>`. This is **less useful**
  for the operator reading the help, but it is **consistent** with how
  the rest of the help renders (no interpolation anywhere else), and it
  removes the class of bugs that interpolation enables.
- The backticks around the gate-summary example render literally, which
  is what the spec wants.

**Alternatives considered**

- **Escape the backticks individually with `\`** (`\`install.sh: OK...\``).
  Rejected: requires touching every line that uses backticks in the future;
  the contract becomes "remember to escape every metacharacter" instead of
  "the help body is verbatim". The quoted-delimiter approach makes the
  contract structural.
- **Replace backticks with single quotes in the example**. Rejected:
  changes the documented contract. Operators reading the help would see
  `'install.sh: OK — <p>/<r> gates passed (<s> skipped)'` and grep for
  that pattern in CI; the actual output keeps the backticks, so the grep
  fails.
- **Use `printf` instead of `cat <<EOF`**. Rejected: requires escaping
  every `%` in the help body; `printf` interprets `%` as a format
  specifier. The heredoc is more uniform with the rest of the bash
  ecosystem.

### Decision: only `print_help()` changes; other heredocs stay

The only heredoc in `install.sh` is in `print_help()`. The other places
that produce multi-line output (`install.sh: OK — <p>/<r> gates passed`,
the doctor warnings, the prerequisite summary) all use `printf` with
single-argument format strings, which do not have the same interpolation
problem because every interpolated value is a quoted shell variable.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Operator relies on `$HOME` expanding in the help body | Low | The current help body has `$HOME` in one place (the `config_dir` line) and it expands to the operator's home, which is implementation noise not contract. The new verbatim rendering shows `$HOME` literally, which is closer to the source. |
| Future contributor adds a new paragraph and reintroduces the bug | Low | The `installer-portability` spec now requires zero stderr during `--help`; a planted test in `tasks.md` regression-tests this. |
| Quoted heredoc changes the rendering of `$(date)` or similar interpolation that might be desired | Negligible | The current help body does not interpolate any command output. The `printf` paths use individual arguments with explicit formatting. |
| The fix conflicts with a future refactor that wants interpolated help | Low | A future refactor can switch back to `<<EOF` and use proper escaping; the contract is "the help body renders verbatim unless explicitly changed", not "must use quoted heredoc forever". |

## Validation gates

`/opsx-apply` MUST NOT complete until every gate below is green:

1. **`bash ./install.sh --help 2>/tmp/err 1>/tmp/out`** returns exit 0,
   `/tmp/err` is empty (zero bytes), and `/tmp/out` contains the line
   ``On success the final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.``
   rendered verbatim (the surrounding backticks are part of the output).
2. **No other paragraph of the help body changes.** `diff <(bash ./install.sh --help 2>/dev/null) <(expected help)` shows only the one line that
   was empty is now populated.
3. **`node scripts/test-model-profiles.mjs`** still exits 0 and prints
   `all checks passed`. The change does not touch this script.
4. **`node scripts/validate-config.mjs --profile personal`** still prints
   `validate-config: OK` (or the same pre-existing `mmx-cli` warnings that
   are unrelated to this change). The change does not touch the validator.
5. **Check #9** still reports 0 CRLF in the 169 shell/runtime files in the
   Git index.
6. **`bash -n install.sh`** exits 0 (syntax check).
7. **`openspec validate fix-install-help-heredoc --strict`** exits 0.
8. **`openspec validate --specs --strict`** exits 0 after the change is
   archived.

## Out of scope (deferred)

- Hardening the `printf` paths to escape `%` is out of scope. They do
  not interpolate user input; only `printf '%d/%d gates passed\n' $pass
  $required` style, which is safe.
- Refactoring `print_help` into a here-doc-free helper is out of scope;
  it would touch more lines than necessary for a 1-character fix.
- Documenting the `$HOME` → literal `$HOME` change in the README is out
  of scope; the operator's mental model already accepts that the help
  shows the source as written.
