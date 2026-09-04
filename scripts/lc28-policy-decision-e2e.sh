#!/bin/bash
# R16.7-P1-B (LC-28): policy_decision_id on paid Order end-to-end
# test against a LIVE server. Run after `nohup go -C apps/api-go
# run ./cmd/api &` (or via the gate g3 runner, which leaves the
# server up after the api-go tests).
#
# What it covers:
#  * /v1/commands/{CreateOffer,ConfirmCooperation} accept
#    PLATFORM_PAY orders only when the policydecisions service
#    is wired (which happens in main.go).
#  * PLATFORM_PAY Order in CONFIRMED has a policyDecisionId.
#  * DIRECT_SETTLEMENT Order in CONFIRMED does not.
#  * PLATFORM_PAY Order is rejected with
#    POLICY_GATE_NOT_CONFIGURED when the gate is unconfigured.
#    (Tested via the unit test suite; this script only runs
#    against a fully-wired server.)
#  * Two PLATFORM_PAY Orders for the same requester reuse the
#    same policy decision id.
set -e
BASE="${PROXY_API_BASE_URL:-http://127.0.0.1:4100}"
TS=$(date +%s)

echo "=== 0. health check ==="
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health/live")
[ "$status" = "200" ] || { echo "FAIL: server not healthy: $status"; exit 1; }
echo "  OK: /health/live 200"

# Helper: build a create-offer envelope.
envelope_create_offer() {
  local command_id="$1"
  local idempotency_key="$2"
  local actor_id="$3"
  local settlement_mode="$4"
  local payment_label="$5"
  cat <<EOF
{
  "commandType":"CreateOffer",
  "commandVersion":1,
  "commandId":"${command_id}",
  "idempotencyKey":"${idempotency_key}",
  "actor":{"type":"USER","id":"${actor_id}"},
  "principal":{"type":"INDIVIDUAL","id":"${actor_id}"},
  "target":{"type":"Order","id":"new"},
  "authContext":{},
  "purpose":"e2e_lc28",
  "correlationId":"${command_id}",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{
    "needId":"e2e-need-${TS}",
    "agentId":"e2e-agent-${TS}",
    "serviceSku":"cc_8h",
    "needVersion":"v1",
    "routeVersion":"v1",
    "duration":"8H",
    "startTime":"2026-09-04T15:00:00Z",
    "meetingContext":"test",
    "agreedCompensation":1200000,
    "currency":"VND",
    "includedScope":"test",
    "excludedScope":"",
    "settlementMode":"${settlement_mode}",
    "paymentMethodLabel":"${payment_label}"
  }
}
EOF
}

# Helper: build a confirm envelope.
envelope_confirm() {
  local command_id="$1"
  local idempotency_key="$2"
  local actor_id="$3"
  local order_id="$4"
  cat <<EOF
{
  "commandType":"ConfirmCooperation",
  "commandVersion":1,
  "commandId":"${command_id}",
  "idempotencyKey":"${idempotency_key}",
  "actor":{"type":"USER","id":"${actor_id}"},
  "principal":{"type":"INDIVIDUAL","id":"${actor_id}"},
  "target":{"type":"Order","id":"${order_id}"},
  "authContext":{},
  "purpose":"e2e_lc28",
  "correlationId":"${command_id}",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{}
}
EOF
}

echo ""
echo "=== 1. authenticated session is required (CreateOffer without token → 401) ==="
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  -d "$(envelope_create_offer e2e-${TS}-unauth e2e-${TS}-unauth-abcdef anon-${TS} DIRECT_SETTLEMENT "线下现金")" \
  "$BASE/v1/commands/CreateOffer")
[ "$status" = "401" ] || { echo "FAIL: expected 401, got $status"; exit 1; }
echo "  OK: unauth CreateOffer → 401"

echo ""
echo "=== 2. create anonymous session (gives us a real access token) ==="
anon_payload=$(cat <<EOF
{
  "commandType":"CreateAnonymousSession",
  "commandVersion":1,
  "commandId":"anon-${TS}",
  "idempotencyKey":"anon-${TS}-abcdef",
  "actor":{"type":"USER","id":"ignored"},
  "principal":{"type":"INDIVIDUAL","id":"ignored"},
  "target":{"type":"Session","id":"ignored"},
  "authContext":{"clientIp":"127.0.0.1"},
  "purpose":"e2e_lc28",
  "correlationId":"anon-${TS}",
  "causationId":"",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{
    "deviceId":"e2e-lc28-${TS}",
    "platform":"IOS",
    "deviceCredential":"01234567890123456789012345678901",
    "dateOfBirth":"2000-01-01",
    "legalDocVersion":"1.1",
    "consents":{"terms":true,"privacy":true}
  }
}
EOF
)
anon_response=$(curl -s -X POST -H "Content-Type: application/json" -d "$anon_payload" "$BASE/v1/commands/CreateAnonymousSession")
access_token=$(echo "$anon_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('auth',{}).get('accessToken',''))")
user_id=$(echo "$anon_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('auth',{}).get('userAccountId',''))")
[ -n "$access_token" ] || { echo "FAIL: no access token: $anon_response"; exit 1; }
[ -n "$user_id" ] || { echo "FAIL: no user id: $anon_response"; exit 1; }
echo "  OK: user=$user_id"

echo ""
echo "=== 3. PLATFORM_PAY Order: confirm stamps a policyDecisionId ==="
# The agent is a different USER; we have to act as the requester
# (the access token is the requester's). The Order's agent is a
# stand-in id; the LC-28 gate only inspects SettlementMode and
# evaluates the requester's policy decision, so any non-empty
# agent id is fine.
R1=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_create_offer e2e-${TS}-paid e2e-${TS}-paid-abcdef $user_id PLATFORM_PAY "Proxy 钱包")" \
  "$BASE/v1/commands/CreateOffer")
order_id_paid=$(echo "$R1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('outcome') != 'ACCEPTED':
  print('', end=''); sys.stderr.write('create offer rejected: '+str(d.get('error',{}))); sys.exit(1)
body = json.loads(d.get('operationRef') or '{}')
print(body.get('orderId',''))")
[ -n "$order_id_paid" ] || { echo "FAIL: no order id from CreateOffer: $R1"; exit 1; }
echo "  OK: created PLATFORM_PAY order $order_id_paid"

R2=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_confirm e2e-${TS}-paid-conf e2e-${TS}-paid-conf-abcdef $user_id $order_id_paid)" \
  "$BASE/v1/commands/ConfirmCooperation")
confirm_state=$(echo "$R2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('aggregate',{}).get('state',''))")
if [ "$confirm_state" != "CONFIRMED" ]; then
  err=$(echo "$R2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d.get('error',{})))")
  echo "FAIL: PLATFORM_PAY confirm should be CONFIRMED, got $confirm_state err=$err"
  exit 1
fi
# Extract the policyDecisionId from the operationRef body.
decision_id_1=$(echo "$R2" | python3 -c "
import json, sys
d = json.load(sys.stdin)
body = json.loads(d.get('operationRef') or '{}')
# The body might be the full Order, or it might be wrapped.
order = body.get('order') or body
print(order.get('policyDecisionId',''))")
if [ -z "$decision_id_1" ]; then
  # The wire shape may also expose the decision via the OrderAggregate
  # details. Fall back to the order snapshot if needed.
  echo "WARN: no policyDecisionId in operationRef, response was:"
  echo "$R2" | head -c 800
  echo ""
  echo "FAIL: PLATFORM_PAY Order must carry a policyDecisionId in the response"
  exit 1
fi
echo "  OK: CONFIRMED with policyDecisionId=$decision_id_1"

echo ""
echo "=== 4. DIRECT_SETTLEMENT Order: confirm does NOT stamp a policy decision ==="
R3=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_create_offer e2e-${TS}-direct e2e-${TS}-direct-abcdef $user_id DIRECT_SETTLEMENT "线下现金")" \
  "$BASE/v1/commands/CreateOffer")
order_id_direct=$(echo "$R3" | python3 -c "
import json, sys
d = json.load(sys.stdin)
body = json.loads(d.get('operationRef') or '{}')
print(body.get('orderId',''))")
[ -n "$order_id_direct" ] || { echo "FAIL: no order id from CreateOffer: $R3"; exit 1; }

R4=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_confirm e2e-${TS}-direct-conf e2e-${TS}-direct-conf-abcdef $user_id $order_id_direct)" \
  "$BASE/v1/commands/ConfirmCooperation")
direct_state=$(echo "$R4" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('aggregate',{}).get('state',''))")
[ "$direct_state" = "CONFIRMED" ] || { echo "FAIL: DIRECT confirm should pass: $R4"; exit 1; }
direct_decision=$(echo "$R4" | python3 -c "
import json, sys
d = json.load(sys.stdin)
body = json.loads(d.get('operationRef') or '{}')
order = body.get('order') or body
print(order.get('policyDecisionId',''))")
if [ -n "$direct_decision" ]; then
  echo "FAIL: DIRECT_SETTLEMENT Order must not have a policyDecisionId, got $direct_decision"
  exit 1
fi
echo "  OK: DIRECT_SETTLEMENT CONFIRMED, no policy decision stamped"

echo ""
echo "=== 5. a second PLATFORM_PAY Order reuses the same decision id ==="
R5=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_create_offer e2e-${TS}-paid2 e2e-${TS}-paid2-abcdef $user_id PLATFORM_PAY "Proxy 钱包")" \
  "$BASE/v1/commands/CreateOffer")
order_id_paid2=$(echo "$R5" | python3 -c "
import json, sys
d = json.load(sys.stdin)
body = json.loads(d.get('operationRef') or '{}')
print(body.get('orderId',''))")
[ -n "$order_id_paid2" ] || { echo "FAIL: no order id from second CreateOffer: $R5"; exit 1; }

R6=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_confirm e2e-${TS}-paid2-conf e2e-${TS}-paid2-conf-abcdef $user_id $order_id_paid2)" \
  "$BASE/v1/commands/ConfirmCooperation")
decision_id_2=$(echo "$R6" | python3 -c "
import json, sys
d = json.load(sys.stdin)
body = json.loads(d.get('operationRef') or '{}')
order = body.get('order') or body
print(order.get('policyDecisionId',''))")
[ -n "$decision_id_2" ] || { echo "FAIL: second PLATFORM_PAY confirm should stamp a decision: $R6"; exit 1; }
if [ "$decision_id_1" != "$decision_id_2" ]; then
  echo "FAIL: expected reuse of decision id $decision_id_1, got $decision_id_2"
  exit 1
fi
echo "  OK: second PLATFORM_PAY Order reused decision id $decision_id_2"

echo ""
echo "=== lc28-policy-decision-e2e: ALL CASES PASSED ==="
