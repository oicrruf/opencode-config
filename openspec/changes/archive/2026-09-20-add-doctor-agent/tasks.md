## 1. Doctor agent and command

- [x] 1.1 Create `agent/doctor.md` with subagent frontmatter (`mode: subagent`, `model: ollama-cloud/gpt-oss:20b`, `steps: 100`, `permission.bash: ask`, `permission.edit: deny`, `codegraph_*: allow`, `context7_*: allow`, browser MCP `deny`) and document the doctor workflow (read the report from `scripts/doctor.mjs --check-only`, prioritise findings, prompt the operator for explicit approval on every `requires-approval` row); verify by running `bash -n` against any embedded shell and reading the rendered file end-to-end.
- [x] 1.2 Create `commands/doctor.md` as a thin wrapper (`subtask: true`, `agent: doctor`) that injects the agent prompt and forwards `$ARGUMENTS` as free-form context; verify by reading the file and confirming it follows the same shape as `commands/p5t-init.md`.

## 2. Doctor script

- [x] 2.1 Create `scripts/doctor.mjs` as a Node script (no third-party deps) that parses `opencode.jsonc` (with the same JSONC stripper as `scripts/validate-config.mjs`), inspects the OS via `process.platform`, runs `command -v` against the canonical dependencies (`lazygit`, `lazydocker`, `openspec`, `codegraph`, `serena`), invokes `openspec status --json` once and caches the result, runs `node scripts/validate-config.mjs`, and checks each symlink under `~/.config/opencode`; verify by running `node scripts/doctor.mjs --check-only` on the dev box and confirming it exits `1` with a complete report (the dev box lacks `lazygit`, `lazydocker`, `openspec`, `codegraph`).
- [x] 2.2 Add `--apply-safe` mode to `scripts/doctor.mjs` that installs missing `lazygit` and `lazydocker` using `brew` on macOS and the first available of `apt-get`, `dnf`, `pacman` on Linux (skipping the install when the binary already exists and recording `ok`), re-creates any missing or non-symlink `~/.config/opencode/<entry>` from the clone using the same `link` helper shape as `install.sh` (with timestamped backups), and re-runs `validate-config.mjs`; verify by running `node scripts/doctor.mjs --apply-safe --dry-run` (a new flag) which prints the actions without executing them, and by simulating a missing symlink with `rm ~/.config/opencode/agents && node scripts/doctor.mjs --apply-safe` confirming the link is restored and reported.
- [x] 2.3 Add the four-level report (`ok`, `warn`, `fail`, `requires-approval`) to `scripts/doctor.mjs`, including the `requires-approval` rows for disabled MCPs and pending OpenSpec changes; verify by reading the rendered report on the dev box, which should list the missing dependencies as `fail`, any disabled MCP as `requires-approval`, and any pending OpenSpec change as `requires-approval` with the exact `/opsx-apply <name>` line.

## 3. `install.sh` integration

- [x] 3.1 Update `install.sh` so it no longer attempts to install `lazygit` or `lazydocker` and instead detects their absence alongside the existing Nerd Fonts / `openspec` checks; verify by reading the diff and confirming only detection (no install logic) is added.
- [x] 3.2 Add a final warning block in `install.sh` that, when at least one dependency is missing, prints each missing item and the matching remediation line (`/doctor`, `node scripts/doctor.mjs --apply-safe`, or the existing Nerd Fonts / `openspec` notes), and still exits `0`; verify by running `install.sh` on the dev box and confirming the symlinks are created, the warning block prints every missing item, and the script exits `0`.

## 4. Routing table and README

- [x] 4.1 Add the `doctor` row to the per-agent defaults table in `agent/routing.md` (`model: ollama-cloud/gpt-oss:20b`, `steps: 100`, browser MCP `deny`, CodeGraph `allow`, Serena `deny`, Context7 `allow`); verify by reading the rendered table and confirming the entry matches the new `agent/doctor.md` frontmatter.
- [x] 4.2 Add a "Diagnose and repair (`/doctor`)" section to `README.md` before "Initialize a project" covering: what `/doctor` inspects, the two modes (`--check-only` default vs `--apply-safe`), the four-level report, and the opt-out via `OPENCODE_DOCTOR=0`; verify by reading the rendered section and confirming it does not promise automatic MCP activation or OpenSpec application.

## 5. Verification

- [x] 5.1 Run `node scripts/validate-config.mjs` and confirm it still passes after adding the new agent and command files; verify by reading the exit code (`0`) and stdout (no errors).
- [x] 5.2 Run `node scripts/doctor.mjs --check-only` on the dev box and confirm the report lists every missing prerequisite as `fail` and exits non-zero; verify by capturing stdout and exit code into the task report.
- [x] 5.3 Run `bash install.sh` on the dev box and confirm every configuration link is created, the warning block lists every missing dependency with the `/doctor` remediation line, and the script exits `0`; verify by listing `$XDG_CONFIG_HOME/opencode` and capturing the warning block and exit code.
