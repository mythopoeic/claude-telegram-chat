#!/usr/bin/env bash
# Stop and remove the launchd LaunchAgent.
set -euo pipefail

LABEL="com.mytho.telegram-claude-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL."
