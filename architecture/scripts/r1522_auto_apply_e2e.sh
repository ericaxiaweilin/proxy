#!/usr/bin/env bash
# R15.22 — 启动 API 自动 apply migrations + observer role 端到端
# 测 4 件事:
#   1. 启动 API with DATABASE_URL + PROXY_MIGRATIONS_DIR:
#      log 应有 "auto-applied N migration(s)" 或 "migrations up-to-date"
#   2. 加新 migration 文件, 重启 API, log 报 "auto-applied 1 migration(s)"
#   3. observer role 在 schema_migrations 之后可读
#      (用 SET LOCAL ROLE proxy_api_observer + SELECT 验证)
#   4. observer INSERT 必须被拒 (跟 R15.20 auditor 一样 fail-closed)
set -uo pipefail
PORT=4202
cd /Users/thanhhuyennguyen/Desktop/kake

PASS=0; FAIL=0
check() {
  local label="$1" expect="$2" got="$3"
  if [[ "$got" == *"$expect"* ]]; then
    echo "  ✓ $label: $got"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label: expected '$expect', got '$got'"
    FAIL=$((FAIL+1))
  fi
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL env required"
  exit 1
fi

echo "=== R15.22 auto-apply + observer role e2e ==="
echo "DATABASE_URL: ${DATABASE_URL//:*@/:***@}"
echo ""

# Build
go -C apps/api-go build -o /tmp/proxy-api-r1522 ./cmd/api 2>&1 | tail -1
if [[ ! -x /tmp/proxy-api-r1522 ]]; then
  echo "✗ build failed"
  exit 1
fi

# Test 1: 启动 + 报 "migrations up-to-date"
echo "── 1. 启动 API 报 migrations up-to-date ──"
lsof -ti:$PORT 2>/dev/null | xargs -r kill 2>/dev/null
sleep 1
DATABASE_URL="$DATABASE_URL" PROXY_MIGRATIONS_DIR="$(pwd)/apps/api-go/migrations" \
  API_PORT=$PORT /tmp/proxy-api-r1522 > /tmp/api-r1522-e2e.log 2>&1 &
sleep 3
LOG=$(cat /tmp/api-r1522-e2e.log)
check "migrations log" "migrations up-to-date" "$LOG"
HEALTH=$(curl -sS http://127.0.0.1:$PORT/health/live 2>&1 | head -1)
check "API healthy" '"status":"ok"' "$HEALTH"
echo ""

# Test 2: 加新 migration (R15.22 observer role), 重启
# 注意: R15.22 已经在 migrations/034_media_observer_role.sql 里了。
# 这里测的是: 启动 API 时自动 apply migrations 034。
# 之前已跑过 R15.21 migrate e2e 走过 schema_migrations, 034 在那里
# 已经记录了 (auto-applied in earlier R15.22 verification)。
# 现在 035_media_test.sql 不存在, 模拟 dev 加新 migration:
echo "── 2. 加新 migration, 重启 API, log 报 auto-applied ──"
TMP_MIG_DIR=$(mktemp -d -t r1522mig.XXXXXX)
# 复制 001-034 到 tmp dir + 加 035
cp apps/api-go/migrations/*.sql "$TMP_MIG_DIR/"
NEW_MIG="$TMP_MIG_DIR/035_smoke_r1522.sql"
cat > "$NEW_MIG" <<'EOF'
-- R15.22 smoke test migration (transient, cleaned up at end)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='r1522_smoke' AND schemaname='public') THEN
    CREATE TABLE public.r1522_smoke (id int);
  END IF;
END$$;
EOF

lsof -ti:$PORT 2>/dev/null | xargs -r kill 2>/dev/null
sleep 1
DATABASE_URL="$DATABASE_URL" PROXY_MIGRATIONS_DIR="$TMP_MIG_DIR" \
  API_PORT=$PORT /tmp/proxy-api-r1522 > /tmp/api-r1522-e2e-2.log 2>&1 &
sleep 3
LOG=$(cat /tmp/api-r1522-e2e-2.log)
check "auto-applied log" "auto-applied 1 migration(s)" "$LOG"
check "auto-applied 035" "035_smoke_r1522" "$LOG"
echo ""

# Test 3: 验证 035 已 apply (table 存在)
echo "── 3. 035 migration 已 apply (table public.r1522_smoke 存在) ──"
mkdir -p apps/api-go/cmd/_r1522check
cat > apps/api-go/cmd/_r1522check/main.go <<EOF
package main
import (
  "context"
  "fmt"
  "os"
  "github.com/jackc/pgx/v5"
)
func main() {
  ctx := context.Background()
  conn, err := pgx.Connect(ctx, os.Getenv("PG_URL"))
  if err != nil { fmt.Println("err:", err); return }
  defer conn.Close(ctx)
  var exists bool
  conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_tables WHERE tablename='r1522_smoke' AND schemaname='public')").Scan(&exists)
  fmt.Printf("r1522_smoke exists: %v\n", exists)
}
EOF
PG_URL="$DATABASE_URL" \
  go -C apps/api-go run ./cmd/_r1522check 2>&1 | tail -1
rm -rf apps/api-go/cmd/_r1522check
echo ""

# Test 4: observer role — 验证 migration 034 真的 apply (R15.22 已 ship, 仍需要验证)
echo "── 4. observer role migration 034 已在 schema_migrations ──"
mkdir -p apps/api-go/cmd/_r1522check
cat > apps/api-go/cmd/_r1522check/main.go <<EOF
package main
import (
  "context"
  "fmt"
  "os"
  "github.com/jackc/pgx/v5"
)
func main() {
  ctx := context.Background()
  conn, err := pgx.Connect(ctx, os.Getenv("PG_URL"))
  if err != nil { fmt.Println("err:", err); return }
  defer conn.Close(ctx)
  // 验证 observer role 存在
  var obsExists, auditExists, opExists bool
  conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='proxy_api_observer')").Scan(&obsExists)
  conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='proxy_api_auditor')").Scan(&auditExists)
  conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='proxy_api_operator')").Scan(&opExists)
  fmt.Printf("observer: %v  auditor: %v  operator: %v\n", obsExists, auditExists, opExists)

  // 验证 034 migration 记录
  var n int
  conn.QueryRow(ctx, "SELECT count(*) FROM public.schema_migrations WHERE version LIKE '034_%'").Scan(&n)
  fmt.Printf("034 in schema_migrations: %d\n", n)

  // 验证 observer 可读 (RLS policy)
  tx, _ := conn.Begin(ctx)
  defer tx.Rollback(ctx)
  if _, err := tx.Exec(ctx, "SET LOCAL ROLE proxy_api_observer"); err != nil {
    fmt.Println("set role err:", err)
    return
  }
  var cnt int
  err = tx.QueryRow(ctx, "SELECT count(*) FROM media.media_assets").Scan(&cnt)
  if err != nil {
    fmt.Println("observer SELECT media.media_assets err:", err)
  } else {
    fmt.Printf("observer SELECT media.media_assets: %d rows\n", cnt)
  }
  err = tx.QueryRow(ctx, "SELECT count(*) FROM media.media_review_decisions").Scan(&cnt)
  if err != nil {
    fmt.Println("observer SELECT media_review_decisions err:", err)
  } else {
    fmt.Printf("observer SELECT media_review_decisions: %d rows\n", cnt)
  }
  // observer INSERT 应该拒
  _, err = tx.Exec(ctx, "INSERT INTO media.media_review_decisions (decision_id, media_asset_id, from_status, to_status, reason, note, operator_id) VALUES ('mrd_obs_try', 'ma_x', 'QUARANTINED', 'APPROVED', 'APPROVE', 'x', 'op')")
  if err != nil {
    fmt.Printf("observer INSERT denied: %v\n", err)
  } else {
    fmt.Println("observer INSERT succeeded (should have failed)")
  }
}
EOF
PG_URL="$DATABASE_URL" \
  go -C apps/api-go run ./cmd/_r1522check 2>&1 | tail -10
rm -rf apps/api-go/cmd/_r1522check
echo ""

# Cleanup
echo "── cleanup: 删 r1522_smoke table + drop 035 migration record ──"
mkdir -p apps/api-go/cmd/_r1522check
cat > apps/api-go/cmd/_r1522check/main.go <<EOF
package main
import (
  "context"
  "fmt"
  "os"
  "github.com/jackc/pgx/v5"
)
func main() {
  ctx := context.Background()
  conn, err := pgx.Connect(ctx, os.Getenv("PG_URL"))
  if err != nil { return }
  defer conn.Close(ctx)
  _, _ = conn.Exec(ctx, "DROP TABLE IF EXISTS public.r1522_smoke")
  _, _ = conn.Exec(ctx, "DELETE FROM public.schema_migrations WHERE version='035_smoke_r1522'")
  fmt.Println("cleanup done")
}
EOF
PG_URL="$DATABASE_URL" \
  go -C apps/api-go run ./cmd/_r1522check 2>&1 | tail -1
rm -rf apps/api-go/cmd/_r1522check
rm -rf "$TMP_MIG_DIR"
lsof -ti:$PORT 2>/dev/null | xargs -r kill 2>/dev/null
sleep 1
echo ""

echo "=== R15.22 auto-apply + observer role e2e 完成 ==="
trap 'echo ""; echo "PASS: $PASS  FAIL: $FAIL"' EXIT
