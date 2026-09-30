#!/bin/bash
# R16.7-P1-E: Jurisdiction Policy Engine end-to-end test
# against a LIVE server. Run after the server is up
# (e.g. via the gate g3 runner).
#
# What it covers:
#   1. GET /v1/identity/jurisdiction without auth → 401.
#   2. CreateAnonymousSession gives us a real access token.
#   3. GET /v1/identity/jurisdiction with auth returns the
#      platform default (VN-79) for a fresh user.
#   4. PATCH to VN-HN is accepted; subsequent GET reflects
#      the new value with source=USER_SELF.
#   5. PATCH to a closed-set region (DNG) is accepted.
#   6. PATCH to a non-Vietnamese country (KR-11) is rejected
#      with INVALID_JURISDICTION.
#   7. PATCH to an unknown region (VN-XX) is rejected.
#   8. Two Orders in different jurisdictions produce two
#      distinct policy decision ids (R16.7-P1-E drives the
#      LC-28 audit log under the right regulatory family).
set -e
BASE="${PROXY_API_BASE_URL:-http://127.0.0.1:4100}"
TS=$(date +%s%N)
NONCE=$(head -c 8 /dev/urandom | xxd -p)

echo "=== 0. health check ==="
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health/live")
[ "$status" = "200" ] || { echo "FAIL: server not healthy: $status"; exit 1; }
echo "  OK: /health/live 200"

# Helpers ------------------------------------------------------------

envelope_create_offer() {
  local command_id="$1"
  local actor_id="$2"
  local settlement_mode="$3"
  local payment_label="$4"
  cat <<EOF
{
  "commandType":"CreateOffer",
  "commandVersion":1,
  "commandId":"${command_id}",
  "idempotencyKey":"e2e-p1e-${TS}-${command_id}-abcdef",
  "actor":{"type":"USER","id":"${actor_id}"},
  "principal":{"type":"INDIVIDUAL","id":"${actor_id}"},
  "target":{"type":"Order","id":"new"},
  "authContext":{},
  "purpose":"e2e_p1e",
  "correlationId":"${command_id}",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{
    "needId":"e2e-p1e-need-${TS}",
    "agentId":"${agent_user_id}",
    "serviceSku":"cc_8h",
    "needVersion":"v1",
    "routeVersion":"v1",
    "duration":"8H",
    "startTime":"2026-09-04T15:00:00Z",
    "meetingContext":"test",
    "agreedCompensation":1200000,
    "currency":"VND",
    "includedScope":"test",
    "excludedScope":"none",
    "settlementMode":"${settlement_mode}",
    "paymentMethodLabel":"${payment_label}"
  }
}
EOF
}

envelope_confirm() {
  local command_id="$1"
  local order_id="$2"
  local actor_id="$3"
  cat <<EOF
{
  "commandType":"ConfirmCooperation",
  "commandVersion":1,
  "commandId":"${command_id}",
  "idempotencyKey":"e2e-p1e-${TS}-${command_id}-abcdef",
  "actor":{"type":"USER","id":"${actor_id}"},
  "principal":{"type":"INDIVIDUAL","id":"${actor_id}"},
  "target":{"type":"Order","id":"${order_id}"},
  "authContext":{},
  "purpose":"e2e_p1e",
  "correlationId":"${command_id}",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{}
}
EOF
}

echo
echo "=== 1. GET /v1/identity/jurisdiction (no auth) ==="
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/identity/jurisdiction")
[ "$status" = "401" ] || { echo "FAIL: expected 401, got $status"; exit 1; }
echo "  OK: 401 access_token_required"

echo
echo "=== 2. CreateAnonymousSession (requester + agent) ==="
# ORDER-CONFIRM-AGENT-001：只有接单方（order.AgentID == actor）能确认合作。所以下单人和
# 接单方必须是**两个真实账号**。这里以前写死 "agentId":"e2e-agent-${TS}" 再拿下单人自己的
# token 去确认 —— 那个合成 id 永远不可能等于任何真实用户，于是第 8 步必然被拒。
# lc28 早就改成开两个真实匿名账号了，这个套件没跟上。现在跟上了。
# create_session <label> -> 打印 "<accessToken> <userAccountId>"
create_session() {
  local label="$1"
  local payload
  payload=$(cat <<EOF
{
  "commandType":"CreateAnonymousSession",
  "commandVersion":1,
  "commandId":"anon-${label}-${TS}",
  "idempotencyKey":"anon-${label}-${TS}-${NONCE}",
  "actor":{"type":"USER","id":"ignored"},
  "principal":{"type":"INDIVIDUAL","id":"ignored"},
  "target":{"type":"Session","id":"ignored"},
  "authContext":{"clientIp":"127.0.0.1"},
  "purpose":"e2e_p1e",
  "correlationId":"anon-${label}-${TS}",
  "causationId":"",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{
    "deviceId":"e2e-p1e-${label}-${TS}",
    "platform":"IOS",
    "deviceCredential":"01234567890123456789012345678901",
    "dateOfBirth":"2000-01-01",
    "legalDocVersion":"1.1",
    "consents":{"terms":true,"privacy":true}
  }
}
EOF
)
  curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$BASE/v1/commands/CreateAnonymousSession" | python3 -c "
import json, sys
d = json.load(sys.stdin)
auth = d.get('auth', {})
print(auth.get('accessToken', ''), auth.get('userAccountId', ''))"
}
read -r access_token user_id <<<"$(create_session requester)"
read -r agent_access_token agent_user_id <<<"$(create_session agent)"
[ -n "$access_token" ] && [ -n "$user_id" ] || { echo "FAIL: no requester session"; exit 1; }
[ -n "$agent_access_token" ] && [ -n "$agent_user_id" ] || { echo "FAIL: no agent session"; exit 1; }
[ "$user_id" != "$agent_user_id" ] || { echo "FAIL: requester and agent must be different accounts"; exit 1; }
echo "  OK: requester=$user_id agent=$agent_user_id"

echo
echo "=== 3. GET /v1/identity/jurisdiction (default) ==="
out=$(curl -s -H "Authorization: Bearer $access_token" "$BASE/v1/identity/jurisdiction")
echo "  resp: $out"
country=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('jurisdiction',{}).get('country',''))")
region=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('jurisdiction',{}).get('region',''))")
source=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('source',''))")
[ "$country" = "VN" ] || { echo "FAIL: expected country=VN, got $country"; exit 1; }
[ "$region" = "79" ] || { echo "FAIL: expected region=79, got $region"; exit 1; }
[ "$source" = "DEFAULT" ] || { echo "FAIL: expected source=DEFAULT, got $source"; exit 1; }
echo "  OK: default VN-79 with source=DEFAULT"

echo
echo "=== 4. PATCH to VN-HN ==="
out=$(curl -s -X PATCH -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"VN-HN"}' "$BASE/v1/identity/jurisdiction")
echo "  resp: $out"
region=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('jurisdiction',{}).get('region',''))")
source=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('source',''))")
[ "$region" = "HN" ] || { echo "FAIL: expected region=HN, got $region"; exit 1; }
[ "$source" = "USER_SELF" ] || { echo "FAIL: expected source=USER_SELF, got $source"; exit 1; }
echo "  OK: now VN-HN with source=USER_SELF"

echo
echo "=== 5. PATCH to VN-DNG ==="
out=$(curl -s -X PATCH -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"VN-DNG"}' "$BASE/v1/identity/jurisdiction")
region=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('jurisdiction',{}).get('region',''))")
[ "$region" = "DNG" ] || { echo "FAIL: expected region=DNG, got $region"; exit 1; }
echo "  OK: now VN-DNG"

echo
echo "=== 6. PATCH to KR-11 (unsupported country) ==="
out=$(curl -s -X PATCH -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"KR-11"}' "$BASE/v1/identity/jurisdiction")
echo "  resp: $out"
err=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))")
[ "$err" = "invalid_jurisdiction" ] || { echo "FAIL: expected error=invalid_jurisdiction, got $err"; exit 1; }
echo "  OK: rejected with invalid_jurisdiction"

echo
echo "=== 7. PATCH to VN-XX (unknown region) ==="
out=$(curl -s -X PATCH -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"VN-XX"}' "$BASE/v1/identity/jurisdiction")
echo "  resp: $out"
err=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))")
[ "$err" = "invalid_jurisdiction" ] || { echo "FAIL: expected error=invalid_jurisdiction, got $err"; exit 1; }
echo "  OK: rejected with invalid_jurisdiction"

echo
echo "=== 8. Two PLATFORM_PAY Orders in different jurisdictions produce different decision ids ==="
# Move jurisdiction back to VN-HN for the first Order.
curl -s -X PATCH -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"VN-HN"}' "$BASE/v1/identity/jurisdiction" > /dev/null
first=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_create_offer e2e-p1e-${TS}-1 $user_id PLATFORM_PAY 'Proxy 钱包')" \
  "$BASE/v1/commands/CreateOffer")
order1=$(echo "$first" | python3 -c "import json,sys; d=json.load(sys.stdin); body=json.loads(d.get('operationRef') or '{}'); print(body.get('orderId',''))")
[ -n "$order1" ] || { echo "FAIL: first order id missing: $first"; exit 1; }
conf1=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_confirm e2e-p1e-${TS}-c1 $order1 $agent_user_id)" \
  "$BASE/v1/commands/ConfirmCooperation")
decision1=$(echo "$conf1" | python3 -c "import json,sys; d=json.load(sys.stdin); body=json.loads(d.get('operationRef') or '{}'); print(body.get('policyDecisionId',''))")
[ -n "$decision1" ] || { echo "FAIL: first decision id missing: $conf1"; exit 1; }
echo "  OK: first Order under VN-HN, decisionId=$decision1"

# Move jurisdiction to DNG.
curl -s -X PATCH -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"VN-DNG"}' "$BASE/v1/identity/jurisdiction" > /dev/null
second=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_create_offer e2e-p1e-${TS}-2 $user_id PLATFORM_PAY 'Proxy 钱包')" \
  "$BASE/v1/commands/CreateOffer")
order2=$(echo "$second" | python3 -c "import json,sys; d=json.load(sys.stdin); body=json.loads(d.get('operationRef') or '{}'); print(body.get('orderId',''))")
[ -n "$order2" ] || { echo "FAIL: second order id missing: $second"; exit 1; }
conf2=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_confirm e2e-p1e-${TS}-c2 $order2 $agent_user_id)" \
  "$BASE/v1/commands/ConfirmCooperation")
decision2=$(echo "$conf2" | python3 -c "import json,sys; d=json.load(sys.stdin); body=json.loads(d.get('operationRef') or '{}'); print(body.get('policyDecisionId',''))")
[ -n "$decision2" ] || { echo "FAIL: second decision id missing: $conf2"; exit 1; }
[ "$decision1" != "$decision2" ] || { echo "FAIL: same jurisdiction expected different decision ids, both $decision1"; exit 1; }
echo "  OK: second Order under VN-DNG, decisionId=$decision2 (distinct from $decision1)"

echo
echo "=== ALL P1-E JURISDICTION GATE TESTS PASSED ==="
exit 0
