#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Sync global skills from gamigamiigami/claude repo
mkdir -p ~/.claude/commands
if [ -d /tmp/global-skills/.git ]; then
    git -C /tmp/global-skills pull --ff-only -q 2>/dev/null || true
else
    git clone --depth=1 -q https://github.com/gamigamiigami/claude.git /tmp/global-skills 2>/dev/null
fi
cp /tmp/global-skills/.claude/commands/*.md ~/.claude/commands/ 2>/dev/null || true
