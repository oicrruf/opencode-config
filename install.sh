#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Translate $repo_dir to a Windows path when running under WSL or Git Bash,
# so node.exe (a Windows binary on $PATH) can read the manifest and template.
# Native Linux/macOS users are unaffected because the case doesn't match.
# The translated path uses forward slashes (not backslashes) so that
# subsequent path concatenation like "$repo_dir/config/..." stays clean;
# node.exe / Win32 accept forward slashes natively.
case "$repo_dir" in
  /mnt/[a-zA-Z]/*)
    if command -v wslpath >/dev/null 2>&1; then
      repo_dir="$(wslpath -w "$repo_dir")"
    elif command -v cygpath >/dev/null 2>&1; then
      repo_dir="$(cygpath -w "$repo_dir")"
    else
      printf 'install.sh: cannot translate WSL path %s (need WSL or Git Bash)\n' "$repo_dir" >&2
      exit 1
    fi
    # Normalize backslashes to forward slashes. Win32 accepts either, but
    # bash's quoting of single backslashes inside `tr '...'` is brittle,
    # and mixed paths ("C:\foo/bar") confuse node.exe when the leading
    # drive letter is interpreted as a relative path component. Use bash
    # parameter expansion which handles the backslash literally.
    repo_dir="${repo_dir//\\//}"
    ;;
esac

config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
#
# Supported flags:
#   --profile <name>    select a profile from config/model-profiles.json
#                       (default: the manifest's defaultProfile, normally
#                       "personal")
#   --profile=<name>    same as above
#   --help, -h          show usage and exit 0
#
# Anything else is rejected with exit 1.

PROFILE_OVERRIDE=""
print_help() {
  cat <<EOF
Usage: ./install.sh [--profile <name>]

Profile selection:
  The model assignments are read from config/model-profiles.json and
  rendered into ~/.config/opencode/opencode.jsonc by
  scripts/render-config.mjs. The selected profile persists in the
  installed configuration; ordinary opencode invocations need no
  profile argument or environment variables.

  --profile <name>   pick a profile from the manifest. If omitted, the
                     manifest's defaultProfile is used (currently
                     "personal"). Run ./install.sh --profile work to
                     switch to the demonstration "work" profile.

  --help, -h         show this help.

Supported shells:
  The installer runs to completion on the four bash-based shells below
  without operator workarounds. A Node.js >= 18 binary MUST be on PATH
  for every shell; the installer resolves "node" first and "node.exe"
  second, and rejects the run when neither is found.

  - Linux bash (native)         bash ./install.sh --profile personal
  - macOS bash (native)         bash ./install.sh --profile personal
  - WSL Ubuntu bash             bash ./install.sh --profile personal
  - Git Bash on Windows         bash ./install.sh --profile personal

Path translation:
  When the repository lives under /mnt/<drive>/... (WSL Ubuntu) or
  /<drive>/... (Git Bash on Windows), the installer translates repo_dir
  to a Windows path before invoking node.exe. The translation uses
  wslpath -w when available and cygpath -w as a fallback. Native Linux
  and macOS paths are passed through unchanged.

Font installer:
  On Linux and macOS the bash font installer runs automatically. On
  Windows, scripts/install-nerd-fonts.sh is not invoked; run
  scripts/install-nerd-fonts.ps1 by hand to install the font.

Profile changes are durable: edit config/model-profiles.json through the
OpenSpec workflow at openspec/changes/<change-name>/. AGENTS.md has the
full process.

Post-install verification:
  After linking resources, install.sh runs the project's required gates
  (profile tests, Jev client self-tests, static acceptance harness,
  and openspec validate --specs --strict --type spec). On success the
  final line is `install.sh: OK — <p>/<r> gates passed (<s> skipped)`.

  Each gate can be opted out via:
    OPENCODE_SKIP_PROFILE_TESTS=1
    OPENCODE_SKIP_JEV_CLIENT_TESTS=1
    OPENCODE_SKIP_ACCEPTANCE=1
    OPENCODE_SKIP_OPENSPEC_VALIDATE=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      shift
      if [[ $# -eq 0 ]]; then
        printf 'install.sh: --profile requires a value\n' >&2
        exit 1
      fi
      PROFILE_OVERRIDE="$1"
      shift
      ;;
    --profile=*)
      PROFILE_OVERRIDE="${1#--profile=}"
      shift
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      printf 'install.sh: unknown argument: %s\n' "$1" >&2
      printf 'Run ./install.sh --help for usage.\n' >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Profile resolution
# ---------------------------------------------------------------------------
#
# Reject unknown profiles BEFORE touching anything on disk. We resolve the
# default profile by reading config/model-profiles.json (jq is intentionally
# avoided; node is already a hard dependency for the renderer).

manifest_path="$repo_dir/config/model-profiles.json"
if [ ! -f "$manifest_path" ]; then
  printf 'install.sh: manifest not found at %s\n' "$manifest_path" >&2
  exit 1
fi

# Resolve the node binary reliably: try `node` first (Linux/macOS), then
# `node.exe` (Windows). Git Bash on Windows can resolve `node.exe` to a
# real path while `command -v node` returns success with empty stdout;
# the empty string is rejected by the executable check below.
NODE_BIN="$(command -v node 2>/dev/null || true)"
[ -z "$NODE_BIN" ] && NODE_BIN="$(command -v node.exe 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  printf 'install.sh: node is required to render the selected profile; install Node.js >= 18.\n' >&2
  exit 1
fi

DEFAULT_PROFILE="$("$NODE_BIN" -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
if(!m.defaultProfile||typeof m.defaultProfile!=='string'){process.exit(2);}
process.stdout.write(m.defaultProfile);
" "$manifest_path")" || {
  printf 'install.sh: manifest is missing a string defaultProfile field\n' >&2
  exit 1
}

SELECTED_PROFILE="${PROFILE_OVERRIDE:-$DEFAULT_PROFILE}"

# Verify the profile exists in the manifest. This is the early gate for task
# 2.4: an unknown profile is rejected before any installed configuration is
# touched.
PROFILE_EXISTS="$("$NODE_BIN" -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
process.stdout.write(m.profiles && m.profiles[process.argv[2]] ? 'yes' : 'no');
" "$manifest_path" "$SELECTED_PROFILE")"
if [ "$PROFILE_EXISTS" != "yes" ]; then
  AVAILABLE="$("$NODE_BIN" -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
process.stdout.write(Object.keys(m.profiles||{}).join(', '));
" "$manifest_path")"
  printf 'install.sh: unknown profile %q (available: %s)\n' "$SELECTED_PROFILE" "$AVAILABLE" >&2
  exit 1
fi

printf 'install.sh: profile=%s\n' "$SELECTED_PROFILE"

# ---------------------------------------------------------------------------
# Validate the source configuration before any install-side mutation.
# ---------------------------------------------------------------------------
#
# The validator checks deny-by-default permission baseline, per-agent MCP
# gating, and skill-description budget. It also loads the manifest and
# verifies the selected profile covers every configured model consumer. Fail
# loudly so the operator sees the violation.

if [ -f "$repo_dir/scripts/validate-config.mjs" ]; then
  if ! "$NODE_BIN" "$repo_dir/scripts/validate-config.mjs" --profile "$SELECTED_PROFILE"; then
    printf 'OpenCode configuration validation failed; refusing to link.\n' >&2
    exit 1
  fi
fi

mkdir -p "$config_dir"

# ---------------------------------------------------------------------------
# Render the selected profile to a temporary file, validate it, then move it
# into place atomically. The previous opencode.jsonc (file or symlink) is
# backed up before the move so the operator can roll back by restoring the
# backup.
# ---------------------------------------------------------------------------

renderer="$repo_dir/scripts/render-config.mjs"
rendered_tmp="$(mktemp -t opencode-rendered-XXXXXX.jsonc)"
trap 'rm -f "$rendered_tmp"' EXIT

if ! "$NODE_BIN" "$renderer" --profile "$SELECTED_PROFILE" --output "$rendered_tmp"; then
  printf 'install.sh: failed to render profile %q into %s\n' "$SELECTED_PROFILE" "$rendered_tmp" >&2
  exit 1
fi

# Validate the rendered output structurally and against the catalog when the
# catalog is present. A render failure or a phantom-id failure must NOT
# replace a previously working installed root config.
if ! "$NODE_BIN" "$repo_dir/scripts/validate-config.mjs" --profile "$SELECTED_PROFILE" --rendered-config "$rendered_tmp"; then
  printf 'install.sh: rendered configuration failed validation; refusing to install.\n' >&2
  exit 1
fi

installed_root="$config_dir/opencode.jsonc"
if [ -e "$installed_root" ] || [ -L "$installed_root" ]; then
  if [ -L "$installed_root" ]; then
    rm "$installed_root"
  else
    backup="${installed_root}.bak.$(date +%Y%m%d%H%M%S)"
    mv "$installed_root" "$backup"
    printf 'install.sh: backed up previous root config to %s\n' "$backup" >&2
  fi
fi

mv "$rendered_tmp" "$installed_root"
rm -f "$rendered_tmp"
trap - EXIT
printf 'install.sh: installed rendered %s profile to %s\n' "$SELECTED_PROFILE" "$installed_root"

# ---------------------------------------------------------------------------
# Install JetBrainsMono Nerd Font (Linux/macOS only). The PowerShell installer
# in scripts/install-nerd-fonts.ps1 is the supported path for Windows.
#
# This step is opt-out via OPENCODE_INSTALL_NERD_FONTS=0 and is non-fatal:
# a failure here MUST NOT prevent the OpenCode configuration links from being
# created. Exit codes: 0 = installed/skipped, 1 = failed (we just warn).
# ---------------------------------------------------------------------------

if [ "${OPENCODE_INSTALL_NERD_FONTS:-1}" != "0" ] && [ -x "$repo_dir/scripts/install-nerd-fonts.sh" ]; then
  if ! "$repo_dir/scripts/install-nerd-fonts.sh"; then
    printf 'Warning: JetBrainsMono Nerd Font install failed; OpenCode configuration links were still created.\n' >&2
    printf 'See scripts/install-nerd-fonts.sh --help for manual steps.\n' >&2
  fi
fi

# ---------------------------------------------------------------------------
# Link the remaining resources (agents, commands, skills, plugins, TUI) from
# the source repository. The root config is the rendered file written above;
# these other paths are symlinked so updates to the repo show up on the next
# OpenCode launch without re-running the installer.
# ---------------------------------------------------------------------------

link() {
  local source="$1"
  local target="$2"

  if [ -e "$target" ] && [ ! -L "$target" ]; then
    local backup="${target}.bak.$(date +%Y%m%d%H%M%S)"
    mv "$target" "$backup"
    printf 'Backed up existing path to %s\n' "$backup" >&2
  fi

  ln -sfn "$source" "$target"
}

link "$repo_dir/agent" "$config_dir/agents"
link "$repo_dir/commands" "$config_dir/commands"
link "$repo_dir/skills" "$config_dir/skills"
link "$repo_dir/tui.jsonc" "$config_dir/tui.jsonc"
link "$repo_dir/herdr-tui-session.js" "$config_dir/herdr-tui-session.js"
link "$repo_dir/quota-tui.tsx" "$config_dir/quota-tui.tsx"
link "$repo_dir/plugins/herdr-agent-state.js" "$config_dir/plugins/herdr-agent-state.js"

if [ -L "$config_dir/plugins/autonomy.js" ]; then
  rm "$config_dir/plugins/autonomy.js"
fi

printf 'OpenCode configuration linked from %s\n' "$repo_dir"

# ---------------------------------------------------------------------------
# Post-install verification: when this block exits, every required gate has
# passed against the just-installed configuration. The block runs the
# project's static and self-test gates; each can be opted out via
# OPENCODE_SKIP_<NAME>=1. The final summary line is the contract that
# operators (and CI) grep for: `install.sh: OK — <p>/<r> gates passed`.
# ---------------------------------------------------------------------------

gate_pass=0
gate_required=0
gate_skipped=0
gate_first_failure=""

run_gate() {
  local label="$1"
  local cmd="$2"
  gate_required=$((gate_required + 1))
  printf 'install.sh: gate %s ... ' "$label"
  if [ "${3:-0}" = "1" ]; then
    printf 'skipped\n'
    gate_skipped=$((gate_skipped + 1))
    return 0
  fi
  if eval "$cmd" >/dev/null 2>&1; then
    printf 'ok\n'
    gate_pass=$((gate_pass + 1))
    return 0
  fi
  printf 'FAIL\n'
  if [ -z "$gate_first_failure" ]; then
    gate_first_failure="$label"
  fi
  return 1
}

gate_status=0

if [ "${OPENCODE_SKIP_PROFILE_TESTS:-0}" = "1" ]; then
  run_gate "profile-tests" "true" 1 || gate_status=$?
else
  run_gate "profile-tests" "node '$repo_dir/scripts/test-model-profiles.mjs'" || gate_status=$?
fi

if [ "${OPENCODE_SKIP_JEV_CLIENT_TESTS:-0}" = "1" ]; then
  run_gate "jev-client-tests" "true" 1 || gate_status=$?
else
  run_gate "jev-client-tests" "node --test '$repo_dir/agent/lib/test/jev-client.test.mjs'" || gate_status=$?
fi

if [ "${OPENCODE_SKIP_ACCEPTANCE:-0}" = "1" ]; then
  run_gate "acceptance-harness" "true" 1 || gate_status=$?
else
  run_gate "acceptance-harness" "node '$repo_dir/scripts/acceptance-harness.mjs'" || gate_status=$?
fi

if [ "${OPENCODE_SKIP_OPENSPEC_VALIDATE:-0}" = "1" ]; then
  run_gate "openspec-validate" "true" 1 || gate_status=$?
elif command -v openspec >/dev/null 2>&1; then
  run_gate "openspec-validate" "openspec validate --specs --strict --type spec" || gate_status=$?
else
  # openspec is missing: count it as required but skipped to avoid
  # blocking the install when the operator simply hasn't installed the CLI.
  run_gate "openspec-validate" "true" 1 || gate_status=$?
fi

if [ "$gate_status" -eq 0 ]; then
  printf 'install.sh: OK — %d/%d gates passed (%d skipped)\n' \
    "$gate_pass" "$gate_required" "$gate_skipped"
else
  printf 'install.sh: FAIL — gate %s failed; rerun with the matching OPENCODE_SKIP_* variable to bypass, or fix the underlying failure and re-run ./install.sh\n' \
    "$gate_first_failure" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Final non-fatal reminder for missing prerequisites. The configuration links
# are created regardless of the missing tools; the operator decides whether
# to invoke /doctor.
# ---------------------------------------------------------------------------

missing_deps=()

if [ "${OPENCODE_CHECK_OPENSPEC:-1}" != "0" ] && ! command -v openspec >/dev/null 2>&1; then
  missing_deps+=("openspec CLI — install with: npm install -g @fission-ai/openspec (requires Node.js >= 20.19). /opsx-* and /p5t-init will fail until it is on PATH.")
fi

if [ "${OPENCODE_CHECK_LAZY_TOOLS:-1}" != "0" ]; then
  if ! command -v lazygit >/dev/null 2>&1; then
    missing_deps+=("lazygit — run /doctor (or \`node scripts/doctor.mjs --apply-safe\`) to install via Homebrew (macOS) or apt/dnf/pacman (Linux).")
  fi
  if ! command -v lazydocker >/dev/null 2>&1; then
    missing_deps+=("lazydocker — run /doctor (or \`node scripts/doctor.mjs --apply-safe\`) to install via Homebrew (macOS) or the official Linux installer script.")
  fi
fi

if [ "${OPENCODE_DOCTOR:-1}" != "0" ] && [ "${#missing_deps[@]}" -gt 0 ]; then
  printf '\ndoctor: %s prerequisite(s) missing — run /doctor for a full diagnosis.\n' "${#missing_deps[@]}" >&2
  for dep in "${missing_deps[@]}"; do
    printf '  - %s\n' "$dep" >&2
  done
  printf 'doctor: invoke `/doctor` or `node scripts/doctor.mjs --apply-safe` to repair. Set OPENCODE_DOCTOR=0 to silence this warning.\n' >&2
fi
