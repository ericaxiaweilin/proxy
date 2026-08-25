#!/usr/bin/env bash
# fresh-db migration test
# 验证：空 PostgreSQL → 按 001/002/003 顺序跑迁移 → schema 与预期完全一致
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MIGRATIONS="$ROOT/apps/api-go/migrations"

# 从 .env 读 DATABASE_URL（不打印密码）
PW=$(python3 -c "
import re, urllib.parse
src = open('$ROOT/.env', encoding='utf-8').read()
m = re.search(r'DATABASE_URL=(\S+)', src)
if m:
    u = urllib.parse.urlparse(m.group(1))
    print(urllib.parse.unquote(u.password or ''))
")
export PGPASSWORD="$PW"

FRESH_DB="proxy_fresh_test"
echo "=== 1. 创建空库 $FRESH_DB ==="
# 建库/删库用当前 macOS 用户（superuser），迁移和断言用 proxy 用户
psql -d postgres -c "DROP DATABASE IF EXISTS $FRESH_DB;" > /dev/null
psql -d postgres -c "CREATE DATABASE $FRESH_DB OWNER proxy;" > /dev/null
echo "空库已创建"

echo "=== 2. 按顺序跑迁移 ==="
for f in 001_r14_schema.sql 002_identity_demand.sql 003_integration.sql 003_passwordless_identity_uniqueness.sql 004_supply.sql 005_media.sql 006_contribution.sql 007_interaction_events.sql 008_security_hardening.sql 009_post_author_display_name.sql 010_session_tokens_updated_at.sql 011_social_media_pipeline.sql 012_media_processing_jobs.sql 013_outbox_worker_lease.sql 014_social_space.sql 015_feed_preferences_reports.sql 016_demand_canonical_task.sql 017_offer_order.sql 018_payment_ledger.sql 019_execution_evidence.sql 020_outcome_intelligence.sql 021_inbox_notification.sql 022_safety_operator.sql 023_business_workspace.sql; do
  echo "--- $f ---"
  psql -h localhost -U proxy -d $FRESH_DB -f "$MIGRATIONS/$f" > /dev/null
  echo "OK"
done

echo "=== 3. Schema 断言 ==="
EXPECTED_TABLES=$(psql -h localhost -U proxy -d proxy -t -A -c "
SELECT schemaname || '.' || tablename FROM pg_tables
WHERE schemaname IN ('citycompanion','localnet','localcontext','conversation','engagement','fulfillment','identity','demand','integration','supply','media','contribution','socialspace')
ORDER BY 1;")
FRESH_TABLES=$(psql -h localhost -U proxy -d $FRESH_DB -t -A -c "
SELECT schemaname || '.' || tablename FROM pg_tables
WHERE schemaname IN ('citycompanion','localnet','localcontext','conversation','engagement','fulfillment','identity','demand','integration','supply','media','contribution','socialspace')
ORDER BY 1;")

echo "--- 表数量 ---"
EXPECTED_COUNT=$(echo "$EXPECTED_TABLES" | grep -c . || true)
FRESH_COUNT=$(echo "$FRESH_TABLES" | grep -c . || true)
echo "生产测试库: $EXPECTED_COUNT 张 | 空库跑迁移后: $FRESH_COUNT 张"
if [ "$EXPECTED_COUNT" != "$FRESH_COUNT" ]; then
  echo "FAIL: 表数量不一致"
  diff <(echo "$EXPECTED_TABLES") <(echo "$FRESH_TABLES") || true
  exit 1
fi

echo "--- 表集合 diff（应为空）---"
DIFF=$(diff <(echo "$EXPECTED_TABLES") <(echo "$FRESH_TABLES") || true)
if [ -n "$DIFF" ]; then
  echo "FAIL: 表集合不一致"
  echo "$DIFF"
  exit 1
fi
echo "表集合完全一致 ✓"

echo "=== 4. 关键列断言（login_challenges / sessions / session_tokens）==="
for TABLE in "identity.login_challenges" "identity.sessions" "identity.session_tokens" "identity.memberships"; do
  C1=$(psql -h localhost -U proxy -d proxy -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_schema=split_part('$TABLE','.',1) AND table_name=split_part('$TABLE','.',2);")
  C2=$(psql -h localhost -U proxy -d $FRESH_DB -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_schema=split_part('$TABLE','.',1) AND table_name=split_part('$TABLE','.',2);")
  echo "$TABLE: 生产=$C1 列 | fresh=$C2 列 $([ "$C1" = "$C2" ] && echo '✓' || echo '✗ MISMATCH')"
  if [ "$C1" != "$C2" ]; then exit 1; fi
done

echo "=== 5. 清理 ==="
psql -d postgres -c "DROP DATABASE IF EXISTS $FRESH_DB;" > /dev/null
echo "fresh-db migration test: PASS ✅"
