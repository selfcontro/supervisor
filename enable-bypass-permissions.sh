#!/bin/bash
# 启用 bypassPermissions 模式

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE="$SCRIPT_DIR/.claude/settings.local.json"

# 读取现有配置（如果存在）
if [ -f "$SETTINGS_FILE" ]; then
    EXISTING=$(cat "$SETTINGS_FILE")
else
    EXISTING="{}"
fi

# 使用 jq 添加 defaultMode: bypassPermissions
# 1. 如果 permissions.mode 存在（旧的错误字段），删除它
# 2. 设置 permissions.defaultMode = "bypassPermissions"
# 3. 如果 permissions 节点不存在，创建它
echo "$EXISTING" | jq --arg mode "bypassPermissions" \
    'del(.permissions.mode) | .permissions.defaultMode = $mode' > "$SETTINGS_FILE.tmp" && \
    mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"

echo "已启用 bypassPermissions 模式"
echo "配置文件: $SETTINGS_FILE"
cat "$SETTINGS_FILE"
