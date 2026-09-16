#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

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

# The global /opsx-* commands and /p5t-init require this CLI. Missing it must
# not prevent configuration links from being created.
if [ "${OPENCODE_CHECK_OPENSPEC:-1}" != "0" ] && ! command -v openspec >/dev/null 2>&1; then
  printf 'Warning: openspec CLI not found on PATH; /opsx-* and /p5t-init will fail.\n' >&2
  printf 'Install with: npm install -g @fission-ai/openspec (requires Node.js >= 20.19).\n' >&2
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
