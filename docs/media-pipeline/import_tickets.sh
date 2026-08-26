#!/usr/bin/env bash
# Linear 导入脚本（占位）
# 网络恢复 + 你提供 LINEAR_API_KEY + LINEAR_TEAM_ID 后执行

set -euo pipefail

: "${LINEAR_API_KEY:?set LINEAR_API_KEY env var}"
: "${LINEAR_TEAM_ID:?set LINEAR_TEAM_ID env var}"

DOC="$(dirname "$0")/TICKETS_LINEAR.md"
echo "Reading tickets from $DOC ..."

# 解析 TICKETS_LINEAR.md 的 T-XX 行 + 标题 + 描述
# 调 Linear GraphQL: issueCreate
# 详见：https://developers.linear.app/docs/graphql/working-with-issues

echo "(placeholder — implement with Linear API once network is up)"
echo "推荐：直接用 Linear UI 批量 import markdown，或 Jira 用 CSV import"
