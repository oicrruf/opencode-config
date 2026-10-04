## Why

`bash ./install.sh --help` on `origin/main` (commit `0dadf73`) prints
`./install.sh: command substitution: line 48: syntax error near unexpected
token`('` to stderr, and the line that documents the post-install gate summary
is rendered empty in the help body:

```
Post-install verification:
  After linking resources, install.sh runs the project's required gates
  (profile tests, Jev client self-tests, static acceptance harness,
  and openspec validate --specs --strict --type spec). On success the
  final line is .
```

The intended line was:

```
On success the final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.
```

**Root cause.** `print_help()` in `install.sh` writes its body with an
unquoted heredoc:

```bash
cat <<EOF
Usage: ./install.sh [--profile <name>]
...
Post-install verification:
  ...
  final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.
EOF
```

In bash, `<<EOF` (without quotes) performs parameter expansion, command
substitution on backticks, and arithmetic expansion inside the heredoc. The
backticks around `install.sh: OK — <p>/<r> gates passed (<s> skipped)` are
parsed as a command substitution. Bash tries to run `install.sh` with the
arguments `OK`, `—`, `<p>/<r>`, `gates`, `passed`, `(<s>`, `skipped)`; the
parentheses in `(<s>` cause a syntax error, and the entire backtick expression
expands to empty string in the output. That leaves the help body with a
sentence that ends in `final line is .` and a non-zero exit status from the
parser (caught by `set -euo pipefail` upstream as a stderr warning).

This is a regression introduced by commit `0dadf73 feat(install): add
post-install verification gates`. Before that commit, the help body contained
no backticks. The new "Post-install verification" paragraph pasted an example
of the final summary line without escaping the surrounding backticks.

**Why it matters.** The post-install gates print exactly the line the help
promises. If the help is wrong, operators (and CI) that grep the help to learn
the contract will grep a wrong string, and the contract between the help
text and the actual output breaks silently. The help body is also the place
where the operator confirms the supported-shell matrix and the path
translation behaviour introduced by the previous change; a syntax error
undermines trust in the entire `--help` surface.

## What Changes

- Quote the heredoc delimiter in `install.sh` so the help body renders
  verbatim without bash interpolating any character. The change is the
  single-character substitution `<<EOF` to `<<'EOF'` on the `cat` line of
  `print_help()`.
- Add a `MODIFIED` requirement to `installer-portability` that documents
  the `--help` body SHALL render verbatim (no command substitution, no
  parameter expansion, no arithmetic expansion), and SHALL NOT print
  any stderr output during `bash ./install.sh --help`.

## Capabilities

### Modified Capabilities

- `installer-portability`: extend the
  `Installer documents the supported shells in its help` requirement with
  two new scenarios covering the verbatim rendering of the post-install
  summary line and the absence of stderr noise during `--help`.

## Impact

- `install.sh` — 1-character change in the `print_help` function
- `openspec/specs/installer-portability/spec.md` — two new scenarios
- `openspec/changes/fix-install-help-heredoc/` — proposal, design, tasks,
  spec delta

## Non-Goals

- No rewording of the help body. The content is correct; only the heredoc
  quoting needs to change.
- No refactor of `print_help` into a separate file or function.
- No change to the gate-summary format itself. The contract
  `install.sh: OK — <p>/<r> gates passed (<s> skipped)` stays exactly as
  `0dadf73` defined it.
- No change to any other file in the repo.
