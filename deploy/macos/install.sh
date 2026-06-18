#!/usr/bin/env bash
# Install the bridge as a launchd LaunchAgent (starts at login, restarts on crash).
# Prereqs: `npm install && npm run build` and a filled-in config.json at the repo root.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="$(command -v node)"
LABEL="com.mytho.telegram-claude-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$REPO/dist/index.js" ]; then
  echo "Missing $REPO/dist/index.js — run 'npm run build' first." >&2
  exit 1
fi
if [ ! -f "$REPO/config.json" ]; then
  echo "Missing $REPO/config.json — copy config.example.json and fill it in first." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$REPO/data"
sed -e "s|__NODE__|$NODE|g" -e "s|__REPO__|$REPO|g" -e "s|__LABEL__|$LABEL|g" \
  "$REPO/deploy/macos/com.mytho.telegram-claude-bridge.plist" > "$PLIST"

# Reload cleanly if it was already installed.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed and started $LABEL."
echo "Logs: $REPO/data/daemon.out.log  /  daemon.err.log"
echo "Stop/remove with: deploy/macos/uninstall.sh"
