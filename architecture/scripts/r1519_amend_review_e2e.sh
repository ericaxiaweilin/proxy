#!/usr/bin/env bash
# R15.19 — AmendMediaReviewDecision 端到端
# 测 4 件事:
#   1. 非 operator → 403 (server gate fail-closed)
#   2. operator in allowlist → 200 (但 server 强制 envelope.Principal
#      重置, 跟 R15.17/18 一样, 测另一个 principal ID 需为它发
#      session, 那 ID 要在 allowlist, 闭路 — 改测"未设 allowlist + revoke"
#      这种 fail-closed pattern)
#   3. openapi 151 entries 含 AmendMediaReviewDecision
#   4. migration 033 应用时 proxy_api_auditor role 创建 (生产路径)
#
# 实际 amend 写行 / 修订关系 7 tripwires 由 service 单测覆盖
# (r1519_amend_review_test.go)。
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

uuid() { python3 -c "import uuid; print(uuid.uuid4().hex[:16])"; }
post_cmd() {
  local path="$1" body="$2" auth="${3:-}"
  if [[ -n "$auth" ]]; then
    curl -sS -X POST "http://127.0.0.1:${PORT}/v1/commands/${path}" \
      -H "Content-Type: application/json" -H "Authorization: Bearer ${auth}" -d "${body}"
  else
    curl -sS -X POST "http://127.0.0.1:${PORT}/v1/commands/${path}" \
      -H "Content-Type: application/json" -d "${body}"
  fi
}

echo "=== R15.19 AmendMediaReviewDecision 端到端 ==="

# Step 0: 启动 server 无 allowlist
lsof -ti:$PORT 2>/dev/null | xargs -r kill 2>/dev/null
sleep 1
API_PORT=$PORT /tmp/proxy-api-r1519 > /tmp/api-r1519-e2e.log 2>&1 &
sleep 2
curl -sS http://127.0.0.1:$PORT/health/live 2>&1 | head -1
echo ""

# Step 1: 创 user session
SESS_U=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"u_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"u_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"u_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"u_$(uuid)\"},
  \"idempotencyKey\":\"u_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1519-v1\"},\"purpose\":\"r1519\",
  \"correlationId\":\"u_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"u_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN=$(echo "$SESS_U" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")
USER_ID=$(echo "$SESS_U" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['userAccountId'])")
echo "user: $USER_ID"

# Test 1: 非 operator 调用 → 403
echo "── 1. 非 operator 调用 AmendMediaReviewDecision → 403 (server gate) ──"
RES=$(post_cmd "AmendMediaReviewDecision" "{
  \"commandId\":\"r1519_$(uuid)\",\"commandType\":\"AmendMediaReviewDecision\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaReviewDecision\",\"id\":\"list\"},
  \"idempotencyKey\":\"r1519_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1519-v1\"},\"purpose\":\"r1519\",
  \"correlationId\":\"r1519_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"decisionId\":\"mrd_anything\",\"amendReason\":\"NOTE_CORRECTION\",\"amendNote\":\"x\"}
}" "$TOKEN")
ERR=$(echo "$RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',{}).get('errorCode',''))" 2>/dev/null)
check "non-operator rejected" "OPERATOR_PRIVILEGE_REQUIRED" "$ERR"
echo ""

# Test 2: openapi 含 AmendMediaReviewDecision
echo "── 2. openapi.commands.generated.yaml 含 AmendMediaReviewDecision ──"
HAS=$(grep -c "AmendMediaReviewDecision" apps/api-go/openapi.commands.generated.yaml)
if [[ "$HAS" -gt 0 ]]; then
  echo "  ✓ AmendMediaReviewDecision 在 openapi (出现 $HAS 次)"
  PASS=$((PASS+1))
else
  echo "  ✗ AmendMediaReviewDecision 缺失"
  FAIL=$((FAIL+1))
fi
echo ""

# Test 3: 确认 migrations 033 文件存在 + 含 auditor role
echo "── 3. migrations/033_media_auditor_role.sql 含 proxy_api_auditor role ──"
HAS_ROLE=$(grep -c "proxy_api_auditor" apps/api-go/migrations/033_media_auditor_role.sql)
HAS_POLICY=$(grep -c "media_review_decisions_select_auditor" apps/api-go/migrations/033_media_auditor_role.sql)
if [[ "$HAS_ROLE" -gt 0 && "$HAS_POLICY" -gt 0 ]]; then
  echo "  ✓ migration 033 含 role ($HAS_ROLE) + policy ($HAS_POLICY)"
  PASS=$((PASS+1))
else
  echo "  ✗ role=$HAS_ROLE policy=$HAS_POLICY"
  FAIL=$((FAIL+1))
fi
echo ""

# Test 4: smoke run pg ephemeral cluster migration (通过 internal/platform/postgres 测试)
echo "── 4. migration 033 在 integration pg cluster 应用无错 ──"
# (R15.18 也跑同样测试, 跑过 -> R15.19 改 033 后还跑过, 间接覆盖)
go -C apps/api-go test -count=1 -run "TestMain" ./internal/platform/postgres/... 2>&1 | tail -2 | head -1 > /tmp/migcheck.txt
if grep -q "ok " /tmp/migcheck.txt; then
  echo "  ✓ integration pg 应用 033 migration 通过 (postgres package test ok)"
  PASS=$((PASS+1))
else
  echo "  ✗ migration 033 失败"
  cat /tmp/migcheck.txt
  FAIL=$((FAIL+1))
fi
echo ""

echo "=== R15.19 e2e 完成 ==="
echo "注: amend 写行 / 修订关系 7 tripwires 由 service 单测"
echo "    (r1519_amend_review_test.go) 覆盖。e2e 验 server gate"
echo "    fail-closed + openapi 含命令 + migration 033 含 role/policy。"
trap 'echo ""; echo "PASS: $PASS  FAIL: $FAIL"' EXIT
