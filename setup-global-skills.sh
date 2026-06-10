#!/bin/bash
# Run this once in any repo to enable global skills from gamigamiigami/claude
set -euo pipefail

SETTINGS=".claude/settings.json"
HOOK_DIR=".claude/hooks"
HOOK_FILE="$HOOK_DIR/sync-skills.sh"

mkdir -p "$HOOK_DIR" "$(dirname $SETTINGS)"

# Create hook script
cat > "$HOOK_FILE" << 'HOOK'
#!/bin/bash
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then exit 0; fi
mkdir -p ~/.claude/commands
if [ -d /tmp/global-skills/.git ]; then
    git -C /tmp/global-skills pull --ff-only -q 2>/dev/null || true
else
    git clone --depth=1 -q https://github.com/gamigamiigami/claude.git /tmp/global-skills 2>/dev/null
fi
cp /tmp/global-skills/.claude/commands/*.md ~/.claude/commands/ 2>/dev/null || true
HOOK
chmod +x "$HOOK_FILE"

# Merge into settings.json
if [ -f "$SETTINGS" ]; then
    python3 -c "
import json, sys
with open('$SETTINGS') as f:
    cfg = json.load(f)
hook = {'type': 'command', 'command': '\$CLAUDE_PROJECT_DIR/$HOOK_FILE', 'async': True}
cfg.setdefault('hooks', {}).setdefault('SessionStart', [{'hooks': []}])
hooks_list = cfg['hooks']['SessionStart'][0]['hooks']
if not any(h.get('command','').endswith('sync-skills.sh') for h in hooks_list):
    hooks_list.append(hook)
with open('$SETTINGS', 'w') as f:
    json.dump(cfg, f, indent=2)
print('Updated existing settings.json')
"
else
    cat > "$SETTINGS" << SETTINGS
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\$CLAUDE_PROJECT_DIR/$HOOK_FILE",
            "async": true
          }
        ]
      }
    ]
  }
}
SETTINGS
    echo "Created $SETTINGS"
fi

echo "✅ Global skills setup complete!"
echo "   Skills will sync automatically on next session start."
echo "   Add $SETTINGS and $HOOK_FILE to your repo."
