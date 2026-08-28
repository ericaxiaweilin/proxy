#!/usr/bin/env bash
# R15.17 — ReviewMediaAsset 端到端验证
# 测 6 件事:
#   1. 未设 PROXY_OPERATOR_PRINCIPALS env → 任何调用 → 403
#   2. user principal ID 不在 allowlist → 403
#   3. principal ID in allowlist → 200 + asset.ModerationStatus 更新
#   4. invalid reason → INVALID_REVIEW_REASON
#   5. asset not found → MEDIA_ASSET_NOT_FOUND
#   6. unblock: REJECTED_CONTENT_NUDITY → APPROVED
#
# 关键: server 在 /v1/commands 边界把 envelope.Principal 重置为
# session 里的 principal.ID (server 拥有的会话是 source of truth)。
# 所以我们必须:
#   - 在已启动的 server 上创 user session, 拿 userAccountId
#   - kill + restart with PROXY_OPERATOR_PRINCIPALS=<那个 userAccountId>
#   - 再次创 session, 用这次的 userAccountId (跟之前一致) — 但 in-mem 重置了,
#     新的 ID 跟旧的不一样!
# 解决: 创 user session (拿 ID) → kill+restart with PROXY_OPERATOR_PRINCIPALS=
#       <新 ID> → 直接用新 ID 创 session.
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

restart_with() {
  # arg: PROXY_OPERATOR_PRINCIPALS value ("" for no allowlist)
  local allowlist="$1"
  lsof -ti:$PORT 2>/dev/null | xargs -r kill 2>/dev/null
  sleep 1
  if [[ -n "$allowlist" ]]; then
    API_PORT=$PORT PROXY_OPERATOR_PRINCIPALS="$allowlist" /tmp/proxy-api-r1517 > /tmp/api-r1517-op.log 2>&1 &
  else
    API_PORT=$PORT /tmp/proxy-api-r1517 > /tmp/api-r1517-op.log 2>&1 &
  fi
  sleep 2
  curl -sS http://127.0.0.1:$PORT/health/live 2>&1 | head -1
}

# Step 0: 启动 server 无 allowlist
restart_with ""
echo ""

# Step 1: 创 user session, 拿 userAccountId, 验证 Test 1+2
SESS_U=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"u_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"u_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"u_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"u_$(uuid)\"},
  \"idempotencyKey\":\"u_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1517-v1\"},\"purpose\":\"r1517\",
  \"correlationId\":\"u_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"u_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN=$(echo "$SESS_U" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")
USER_ID=$(echo "$SESS_U" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['userAccountId'])")
echo "user: $USER_ID"

# Test 1: 未设 allowlist env → 任何调用 → 403
echo "── 1. 未设 PROXY_OPERATOR_PRINCIPALS env → 任何调用 → 403 ──"
RES=$(post_cmd "ReviewMediaAsset" "{
  \"commandId\":\"r1517_$(uuid)\",\"commandType\":\"ReviewMediaAsset\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaAsset\",\"id\":\"ma_x\"},
  \"idempotencyKey\":\"r1517_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1517-v1\"},\"purpose\":\"r1517\",
  \"correlationId\":\"r1517_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"reason\":\"REJECT_NUDITY\"}
}" "$TOKEN")
ERR=$(echo "$RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',{}).get('errorCode',''))" 2>/dev/null)
check "no-allowlist" "OPERATOR_PRIVILEGE_REQUIRED" "$ERR"
echo ""

# Step 2: 重启 with allowlist, 但 ID 是 USER_ID (这个 user 同时是 operator)
restart_with "$USER_ID"
echo ""

# 重新创 session — 新 userAccountId 跟 USER_ID 不同
SESS_U2=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"u2_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"u2_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"u2_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"u2_$(uuid)\"},
  \"idempotencyKey\":\"u2_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1517-v1\"},\"purpose\":\"r1517\",
  \"correlationId\":\"u2_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"u2_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN=$(echo "$SESS_U2" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")
USER_ID=$(echo "$SESS_U2" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['userAccountId'])")
# 这时候 USER_ID != allowlist env (allowlist 是旧 USER_ID)。所以这个 user 不是 operator
# 实际 — 我们要的是 USER_ID 在 allowlist。重新 kill+restart with 这个新 ID
restart_with "$USER_ID"
echo ""
# 再创一次 — 这时新 ID 跟 allowlist 一致
SESS_U3=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"u3_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"u3_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"u3_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"u3_$(uuid)\"},
  \"idempotencyKey\":\"u3_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1517-v1\"},\"purpose\":\"r1517\",
  \"correlationId\":\"u3_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"u3_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN=$(echo "$SESS_U3" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")
USER_ID=$(echo "$SESS_U3" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['userAccountId'])")
# 还是不一致 — 又要再 kill+restart!
restart_with "$USER_ID"
SESS_U4=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"u4_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"u4_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"u4_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"u4_$(uuid)\"},
  \"idempotencyKey\":\"u4_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1517-v1\"},\"purpose\":\"r1517\",
  \"correlationId\":\"u4_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"u4_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN=$(echo "$SESS_U4" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")
USER_ID=$(echo "$SESS_U4" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['userAccountId'])")
# 还是不一致 — 鸡生蛋问题
# 最终方案: USER_ID 跟 allowlist 一致的"在"上次 env 设时拿到的
# 但每次 session 都重新 mint
#
# 实用做法: 接受不一致, server 重启时, allowlist 设的 ID 是
# 任何之前的 session。则该 session token 失效, 但 userAccountId 我们有
# 走 actor.type=OPERATOR + principal.type=OPERATOR 是被 server 重置, 不行。
# 走 authContext.role=OPERATOR 是被重置, 不行。
#
# 唯一解决: server env 必须 reflect 当前 session. 永远要 N+1 次 restart.
# 或: 新增 临时 env override "ALLOW_NOW_THIS_PRINCIPAL" 测试 only — 不接受。
#
# → 改成测 1+2 (未设 allowlist + user 不在 allowlist 拒), 测 3+ 用更聪明办法:
# 直接调 service.reviewMediaAsset 跳过 server gate (这是单元测试覆盖的)
# e2e 只验 server gate fail-closed。

echo "user: $USER_ID"
echo ""
echo "── 2. user principal ID 不在 allowlist → 403 ──"
RES=$(post_cmd "ReviewMediaAsset" "{
  \"commandId\":\"r1517_$(uuid)\",\"commandType\":\"ReviewMediaAsset\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaAsset\",\"id\":\"ma_x\"},
  \"idempotencyKey\":\"r1517_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"r1517-v1\"},\"purpose\":\"r1517\",
  \"correlationId\":\"r1517_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"reason\":\"REJECT_NUDITY\"}
}" "$TOKEN")
ERR=$(echo "$RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',{}).get('errorCode',''))" 2>/dev/null)
check "non-allowlisted" "OPERATOR_PRIVILEGE_REQUIRED" "$ERR"
echo ""

echo "=== R15.17 e2e 完成 (server gate 验证) ==="
echo "注: 实际 operator 真能 review 的路径 (Test 3-6) 由 service 单元"
echo "    测试 (r1517_review_test.go) 覆盖 8 tripwires。e2e 验证 server"
echo "    boundary 的 operator allowlist 门 fail-closed。"
trap 'echo ""; echo "PASS: $PASS  FAIL: $FAIL"' EXIT
