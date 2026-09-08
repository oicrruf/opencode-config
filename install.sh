#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

mkdir -p "$config_dir"

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
link "$repo_dir/plugins/herdr-agent-state.js" "$config_dir/plugins/herdr-agent-state.js"

if [ -L "$config_dir/plugins/autonomy.js" ]; then
  rm "$config_dir/plugins/autonomy.js"
fi

printf 'OpenCode configuration linked from %s\n' "$repo_dir"
