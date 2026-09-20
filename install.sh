#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

# Validate the configuration before linking. The validator enforces the
# deny-by-default permission baseline, the per-agent MCP gating, and the
# skill-description budget. Fail loudly so the operator sees the violation.
if [ -x "$repo_dir/scripts/validate-config.mjs" ]; then
  if ! node "$repo_dir/scripts/validate-config.mjs"; then
    printf 'OpenCode configuration validation failed; refusing to link.\n' >&2
    exit 1
  fi
elif [ -f "$repo_dir/scripts/validate-config.mjs" ]; then
  if ! node "$repo_dir/scripts/validate-config.mjs"; then
    printf 'OpenCode configuration validation failed; refusing to link.\n' >&2
    exit 1
  fi
fi

mkdir -p "$config_dir"

# Install JetBrainsMono Nerd Font (Linux/macOS only). The PowerShell installer
# in scripts/install-nerd-fonts.ps1 is the supported path for Windows.
#
# This step is opt-out via OPENCODE_INSTALL_NERD_FONTS=0 and is non-fatal:
# a failure here MUST NOT prevent the OpenCode configuration links from being
# created. Exit codes: 0 = installed/skipped, 1 = failed (we just warn).
if [ "${OPENCODE_INSTALL_NERD_FONTS:-1}" != "0" ] && [ -x "$repo_dir/scripts/install-nerd-fonts.sh" ]; then
  if ! "$repo_dir/scripts/install-nerd-fonts.sh"; then
    printf 'Warning: JetBrainsMono Nerd Font install failed; OpenCode configuration links were still created.\n' >&2
    printf 'See scripts/install-nerd-fonts.sh --help for manual steps.\n' >&2
  fi
fi

# Track which prerequisites are missing so the final warning block can list
# every missing dependency with its remediation hint. The installer never
# installs `lazygit` or `lazydocker`; that responsibility moved to the
# `doctor` subagent and to `scripts/doctor.mjs --apply-safe`.
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

link "$repo_dir/opencode.jsonc" "$config_dir/opencode.jsonc"
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

# Final non-fatal reminder. The configuration links are created regardless
# of the missing tools; the operator decides whether to invoke /doctor.
if [ "${OPENCODE_DOCTOR:-1}" != "0" ] && [ "${#missing_deps[@]}" -gt 0 ]; then
  printf '\ndoctor: %s prerequisite(s) missing — run /doctor for a full diagnosis.\n' "${#missing_deps[@]}" >&2
  for dep in "${missing_deps[@]}"; do
    printf '  - %s\n' "$dep" >&2
  done
  printf 'doctor: invoke `/doctor` or `node scripts/doctor.mjs --apply-safe` to repair. Set OPENCODE_DOCTOR=0 to silence this warning.\n' >&2
fi
