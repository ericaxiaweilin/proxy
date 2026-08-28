#!/usr/bin/env bash
# R15.21 — migrate CLI 端到端
# 测 4 件事:
#   1. migrate -status 报 34 applied (跟 R15.20 跑过的状态)
#   2. migrate -dry-run 报 "no pending"
#   3. migrate -check-drift 报 "no drift" (且 exit 0)
#   4. migrate -apply 报 "applied 0, skipped 34 already-applied" (idempotent)
#
# 8 个 service tripwires (migrator_test.go) 覆盖 Apply/Status/DryRun
# 状态机/计数/漂移/孤儿/顺序/filename-with-dots/non-sql 忽略。
set -uo pipefail
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

echo "=== R15.21 migrate CLI e2e ==="
echo "DATABASE_URL: ${DATABASE_URL//:*@/:***@}"
echo ""

# Build CLI
go -C apps/api-go build -o /tmp/migrate ./cmd/migrate 2>&1 | tail -1
if [[ ! -x /tmp/migrate ]]; then
  echo "✗ migrate CLI build failed"
  exit 1
fi
echo "  CLI built: /tmp/migrate"
echo ""

# Test 1: status
echo "── 1. migrate -status 报 34 applied / 0 pending / 0 drift ──"
OUT=$(DATABASE_URL="$DATABASE_URL" /tmp/migrate -status 2>&1)
SUMMARY=$(echo "$OUT" | grep "^summary:")
check "summary" "applied=34 pending=0 drift=0 orphan=0 total=34" "$SUMMARY"
echo ""

# Test 2: dry-run
echo "── 2. migrate -dry-run 报 no pending ──"
OUT=$(DATABASE_URL="$DATABASE_URL" /tmp/migrate -dry-run 2>&1)
check "dry-run" "no pending migrations" "$OUT"
echo ""

# Test 3: check-drift (exit code matters)
echo "── 3. migrate -check-drift 报 no drift (exit 0) ──"
OUT=$(DATABASE_URL="$DATABASE_URL" /tmp/migrate -check-drift 2>&1)
RC=$?
check "check-drift no drift" "no drift" "$OUT"
if [[ $RC -ne 0 ]]; then
  echo "  ✗ check-drift exit code: $RC (want 0)"
  FAIL=$((FAIL+1))
else
  echo "  ✓ check-drift exit 0"
  PASS=$((PASS+1))
fi
echo ""

# Test 4: apply (idempotent)
echo "── 4. migrate -apply 报 applied 0, skipped 34 (idempotent) ──"
OUT=$(DATABASE_URL="$DATABASE_URL" /tmp/migrate -apply 2>&1)
check "idempotent apply" "applied 0" "$OUT"
check "skip 34" "skipped 34" "$OUT"
echo ""

# Test 5: drift 检测 — 改一个文件然后 check-drift
echo "── 5. check-drift 检到改文件 ──"
# 备份
cp apps/api-go/migrations/001_r14_schema.sql /tmp/001_r14_schema.sql.bak
echo "-- tampered" >> apps/api-go/migrations/001_r14_schema.sql
OUT=$(DATABASE_URL="$DATABASE_URL" /tmp/migrate -check-drift 2>&1)
RC=$?
# 恢复
mv /tmp/001_r14_schema.sql.bak apps/api-go/migrations/001_r14_schema.sql
check "drift detected" "DRIFT" "$OUT"
if [[ $RC -ne 1 ]]; then
  echo "  ✗ drift exit code: $RC (want 1)"
  FAIL=$((FAIL+1))
else
  echo "  ✓ check-drift exit 1 on drift"
  PASS=$((PASS+1))
fi
echo ""

echo "=== R15.21 migrate CLI e2e 完成 ==="
trap 'echo ""; echo "PASS: $PASS  FAIL: $FAIL"' EXIT
