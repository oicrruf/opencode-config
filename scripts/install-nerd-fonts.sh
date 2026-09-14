#!/usr/bin/env bash
#
# install-nerd-fonts.sh — install JetBrainsMono Nerd Font into a user-scope
# directory on Linux and macOS.
#
# Behaviour contract:
#   - exit 0   ⇒ installed (or already present) successfully
#   - exit 1   ⇒ a non-fatal failure occurred; `install.sh` logs a warning and
#                continues with the rest of the OpenCode configuration links
#
# Flags:
#   --skip              Skip the install entirely (exit 0).
#   --offline <archive> Use a previously-downloaded release zip instead of
#                       contacting the GitHub API. The archive must be the
#                       JetBrainsMono zip from the official
#                       ryanoasis/nerd-fonts release marked "latest".
#   --target <dir>      Override the destination directory (defaults to
#                       ~/.local/share/fonts/JetBrainsMonoNerdFont on Linux
#                       and ~/Library/Fonts/JetBrainsMonoNerdFont on macOS).
#
# Environment:
#   OPENCODE_INSTALL_NERD_FONTS=0 ⇒ exit 0 immediately with no work.
#
# This script intentionally avoids any privilege escalation. The destination
# is always inside $HOME; the script does not call sudo. The user must select
# "JetBrainsMono Nerd Font" in their terminal profile after this script
# finishes — installing the font does not activate it automatically.

set -euo pipefail

# ---- CLI parsing ------------------------------------------------------------

SKIP=0
OFFLINE_ARCHIVE=""
TARGET_OVERRIDE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip)
      SKIP=1
      shift
      ;;
    --offline)
      shift
      if [ "$#" -eq 0 ]; then
        printf 'install-nerd-fonts: --offline requires an archive path\n' >&2
        exit 1
      fi
      OFFLINE_ARCHIVE="$1"
      shift
      ;;
    --target)
      shift
      if [ "$#" -eq 0 ]; then
        printf 'install-nerd-fonts: --target requires a directory\n' >&2
        exit 1
      fi
      TARGET_OVERRIDE="$1"
      shift
      ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      printf 'install-nerd-fonts: unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

if [ "${OPENCODE_INSTALL_NERD_FONTS:-1}" = "0" ]; then
  exit 0
fi

if [ "$SKIP" = "1" ]; then
  printf 'install-nerd-fonts: --skip requested, nothing to do\n'
  exit 0
fi

# ---- Logging helpers --------------------------------------------------------

log()  { printf 'install-nerd-fonts: %s\n' "$*" >&2; }
warn() { printf 'install-nerd-fonts: warning: %s\n' "$*" >&2; }
fail() { printf 'install-nerd-fonts: error: %s\n' "$*" >&2; exit 1; }

# ---- Platform detection -----------------------------------------------------

UNAME_S="$(uname -s)"
case "$UNAME_S" in
  Linux)  PLATFORM=linux ;;
  Darwin) PLATFORM=macos ;;
  *)      fail "unsupported platform: $UNAME_S (supported: Linux, macOS)" ;;
esac

# ---- Target directory --------------------------------------------------------

default_target() {
  case "$PLATFORM" in
    linux) printf '%s\n' "$HOME/.local/share/fonts/JetBrainsMonoNerdFont" ;;
    macos) printf '%s\n' "$HOME/Library/Fonts/JetBrainsMonoNerdFont" ;;
  esac
}

TARGET_DIR="${TARGET_OVERRIDE:-$(default_target)}"

if [ -d "$TARGET_DIR" ] && [ -n "$(find "$TARGET_DIR" -maxdepth 1 -type f \( -name '*.ttf' -o -name '*.otf' \) -print -quit 2>/dev/null)" ]; then
  log "JetBrainsMono Nerd Font already present in $TARGET_DIR; skipping download"
  exit 0
fi

# ---- HTTP helper -------------------------------------------------------------

fetch() {
  # fetch <url> <output>
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error --retry 3 --retry-delay 2 -o "$output" "$url"
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget --quiet -O "$output" "$url"
    return $?
  fi
  warn "neither curl nor wget is on PATH; cannot download $url"
  return 127
}

# ---- Resolve the latest release ---------------------------------------------

API_URL="https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest"
TMP_DIR="$(mktemp -d -t nerd-fonts.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

RELEASE_JSON="$TMP_DIR/release.json"
RELEASE_ZIP="$TMP_DIR/JetBrainsMono.zip"

if [ -n "$OFFLINE_ARCHIVE" ]; then
  if [ ! -f "$OFFLINE_ARCHIVE" ]; then
    fail "--offline archive not found: $OFFLINE_ARCHIVE"
  fi
  log "using offline archive $OFFLINE_ARCHIVE"
  cp "$OFFLINE_ARCHIVE" "$RELEASE_ZIP"
else
  log "resolving latest JetBrainsMono Nerd Font release from $API_URL"
  if ! fetch "$API_URL" "$RELEASE_JSON"; then
    fail "could not fetch $API_URL; install curl or wget, or re-run with --offline <archive>"
  fi
  if ! grep -q '"tag_name"' "$RELEASE_JSON" 2>/dev/null; then
    fail "GitHub API response did not contain tag_name (rate-limited or blocked?)"
  fi

  # Resolve the asset URL for JetBrainsMono via grep+sed so we do not need jq.
  ASSET_URL="$(grep -o '"browser_download_url":[[:space:]]*"[^"]*JetBrainsMono[^"]*\.zip"' "$RELEASE_JSON" \
    | head -n1 \
    | sed -E 's/.*"browser_download_url":[[:space:]]*"([^"]+)".*/\1/')"

  if [ -z "$ASSET_URL" ]; then
    fail "could not locate the JetBrainsMono zip asset in the latest release"
  fi

  log "downloading $(basename "$ASSET_URL")"
  if ! fetch "$ASSET_URL" "$RELEASE_ZIP"; then
    fail "could not download $ASSET_URL"
  fi
fi

# ---- Extract -----------------------------------------------------------------

mkdir -p "$TARGET_DIR"
if ! command -v unzip >/dev/null 2>&1; then
  fail "unzip is required to extract the font archive but was not found on PATH"
fi

log "extracting fonts to $TARGET_DIR"
if ! unzip -q -o "$RELEASE_ZIP" -d "$TMP_DIR/extracted"; then
  fail "unzip failed on $RELEASE_ZIP"
fi

# Some zips wrap everything in a single top-level directory; the official
# JetBrainsMono release ships files flat (no top-level dir). Accept both.
EXTRACTED_ROOT="$TMP_DIR/extracted"
if [ "$(find "$EXTRACTED_ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = "1" ] \
  && [ "$(find "$EXTRACTED_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" = "0" ]; then
  EXTRACTED_ROOT="$(find "$EXTRACTED_ROOT" -mindepth 1 -maxdepth 1 -type d | head -n1)"
fi

# Only copy TTF/OTF files; the zip also ships LICENSES, README, etc.
shopt -s nullglob
FOUND_ANY=0
for font_file in "$EXTRACTED_ROOT"/*.ttf "$EXTRACTED_ROOT"/*.otf; do
  cp -f "$font_file" "$TARGET_DIR/"
  FOUND_ANY=1
done
shopt -u nullglob

if [ "$FOUND_ANY" = "0" ]; then
  fail "no .ttf/.otf files found inside the JetBrainsMono zip"
fi

# ---- Refresh font cache ------------------------------------------------------

case "$PLATFORM" in
  linux)
    if command -v fc-cache >/dev/null 2>&1; then
      log "refreshing font cache via fc-cache -f"
      if ! fc-cache -f "$TARGET_DIR" >/dev/null 2>&1; then
        warn "fc-cache returned non-zero; fonts are installed but the cache may be stale"
      fi
    else
      log "fc-cache not on PATH; run \`fc-cache -fv $TARGET_DIR\` after installing fontconfig"
    fi
    ;;
  macos)
    log "fonts copied to $TARGET_DIR; macOS enumerates ~/Library/Fonts on next launch"
    ;;
esac

log "JetBrainsMono Nerd Font installed in $TARGET_DIR"
log "select 'JetBrainsMono Nerd Font' in your terminal profile to render the OpenCode TUI icons"
exit 0
