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
#  * ORDER-CONFIRM-AGENT-001: only the agent (a second, real
#    account) can confirm; the requester's self-confirm is refused.
#  * ORDER-AMEND-001 / LC-30: a Material Change is proposed by one
#    party and takes effect (with a re-evaluated, stamped policy
#    decision) only when the other party accepts it.
#  * ORDER-AUDIT-001: the parties can read the order's audit trail.
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
echo "=== 2. create two anonymous sessions: requester + agent (real accounts) ==="
# create_session <label> -> prints "<accessToken> <userAccountId>"
create_session() {
  local label="$1"
  local payload
  payload=$(cat <<EOF
{
  "commandType":"CreateAnonymousSession",
  "commandVersion":1,
  "commandId":"anon-${label}-${TS}",
  "idempotencyKey":"anon-${label}-${TS}-abcdef",
  "actor":{"type":"USER","id":"ignored"},
  "principal":{"type":"INDIVIDUAL","id":"ignored"},
  "target":{"type":"Session","id":"ignored"},
  "authContext":{"clientIp":"127.0.0.1"},
  "purpose":"e2e_lc28",
  "correlationId":"anon-${label}-${TS}",
  "causationId":"",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{
    "deviceId":"e2e-lc28-${label}-${TS}",
    "platform":"IOS",
    "deviceCredential":"01234567890123456789012345678901",
    "dateOfBirth":"2000-01-01",
    "legalDocVersion":"1.1",
    "consents":{"terms":true,"privacy":true}
  }
}
EOF
)
  curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$BASE/v1/commands/CreateAnonymousSession" | jq -r '"\(.auth?.accessToken // "") \(.auth?.userAccountId // "")"'
}
read -r access_token user_id <<<"$(create_session requester)"
read -r agent_access_token agent_user_id <<<"$(create_session agent)"
[ -n "$access_token" ] && [ -n "$user_id" ] || { echo "FAIL: no requester session"; exit 1; }
[ -n "$agent_access_token" ] && [ -n "$agent_user_id" ] || { echo "FAIL: no agent session"; exit 1; }
[ "$user_id" != "$agent_user_id" ] || { echo "FAIL: requester and agent must be different accounts"; exit 1; }
echo "  OK: requester=$user_id agent=$agent_user_id"

echo ""
echo "=== 3. PLATFORM_PAY Order: confirm stamps a policyDecisionId ==="
# The requester creates the offer; the agent (a different, real
# account) confirms it -- ORDER-CONFIRM-AGENT-001.
R1=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_create_offer e2e-${TS}-paid e2e-${TS}-paid-abcdef $user_id PLATFORM_PAY "Proxy 钱包")" \
  "$BASE/v1/commands/CreateOffer")
order_id_paid=$(echo "$R1" | jq -r 'if (.outcome // "") != "ACCEPTED" then error("create offer rejected: " + ((.error // {}) | tojson)) else ((.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | .orderId? // empty) end')
[ -n "$order_id_paid" ] || { echo "FAIL: no order id from CreateOffer: $R1"; exit 1; }
echo "  OK: created PLATFORM_PAY order $order_id_paid"

R_SELF=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_confirm e2e-${TS}-paid-self e2e-${TS}-paid-self-abcdef $user_id $order_id_paid)" \
  "$BASE/v1/commands/ConfirmCooperation")
self_code=$(echo "$R_SELF" | jq -r '(.error // {}).errorCode? // empty')
[ "$self_code" = "ONLY_AGENT_CONFIRMS" ] || { echo "FAIL: requester self-confirm must be ONLY_AGENT_CONFIRMS: $R_SELF"; exit 1; }
echo "  OK: requester self-confirm refused (ONLY_AGENT_CONFIRMS)"

R2=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_confirm e2e-${TS}-paid-conf e2e-${TS}-paid-conf-abcdef $agent_user_id $order_id_paid)" \
  "$BASE/v1/commands/ConfirmCooperation")
confirm_state=$(echo "$R2" | jq -r '.aggregate.state? // empty')
if [ "$confirm_state" != "CONFIRMED" ]; then
  err=$(echo "$R2" | jq -r '(.error // {}) | tojson')
  echo "FAIL: PLATFORM_PAY confirm should be CONFIRMED, got $confirm_state err=$err"
  exit 1
fi
# Extract the policyDecisionId from the operationRef body.
decision_id_1=$(echo "$R2" | jq -r '(.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | (.order // .) | .policyDecisionId? // empty')
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
order_id_direct=$(echo "$R3" | jq -r '(.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | .orderId? // empty')
[ -n "$order_id_direct" ] || { echo "FAIL: no order id from CreateOffer: $R3"; exit 1; }

R4=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_confirm e2e-${TS}-direct-conf e2e-${TS}-direct-conf-abcdef $agent_user_id $order_id_direct)" \
  "$BASE/v1/commands/ConfirmCooperation")
direct_state=$(echo "$R4" | jq -r '.aggregate.state? // empty')
[ "$direct_state" = "CONFIRMED" ] || { echo "FAIL: DIRECT confirm should pass: $R4"; exit 1; }
direct_decision=$(echo "$R4" | jq -r '(.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | (.order // .) | .policyDecisionId? // empty')
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
order_id_paid2=$(echo "$R5" | jq -r '(.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | .orderId? // empty')
[ -n "$order_id_paid2" ] || { echo "FAIL: no order id from second CreateOffer: $R5"; exit 1; }

R6=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_confirm e2e-${TS}-paid2-conf e2e-${TS}-paid2-conf-abcdef $agent_user_id $order_id_paid2)" \
  "$BASE/v1/commands/ConfirmCooperation")
decision_id_2=$(echo "$R6" | jq -r '(.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | (.order // .) | .policyDecisionId? // empty')
[ -n "$decision_id_2" ] || { echo "FAIL: second PLATFORM_PAY confirm should stamp a decision: $R6"; exit 1; }
if [ "$decision_id_1" != "$decision_id_2" ]; then
  echo "FAIL: expected reuse of decision id $decision_id_1, got $decision_id_2"
  exit 1
fi
echo "  OK: second PLATFORM_PAY Order reused decision id $decision_id_2"

echo ""
echo "=== 6. Material Change re-evaluates policy decision (LC-30) ==="
# Create + confirm a fresh PLATFORM_PAY Order for this test.
R7=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_create_offer e2e-${TS}-lc30 e2e-${TS}-lc30-abcdef $user_id PLATFORM_PAY "Proxy 钱包")" \
  "$BASE/v1/commands/CreateOffer")
order_id_lc30=$(echo "$R7" | jq -r 'if (.outcome // "") != "ACCEPTED" then error("create offer rejected: " + ((.error // {}) | tojson)) else ((.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | .orderId? // empty) end')
[ -n "$order_id_lc30" ] || { echo "FAIL: no order id from CreateOffer: $R7"; exit 1; }

R8=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_confirm e2e-${TS}-lc30-conf e2e-${TS}-lc30-conf-abcdef $agent_user_id $order_id_lc30)" \
  "$BASE/v1/commands/ConfirmCooperation")
decision_before=$(echo "$R8" | jq -r '(.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | .policyDecisionId? // empty')
[ -n "$decision_before" ] || { echo "FAIL: confirm should stamp a decision: $R8"; exit 1; }
echo "  OK: pre-amendment policyDecisionId=$decision_before"

# ORDER-AMEND-001: the requester proposes new terms; they take effect
# (and LC-30 re-evaluates + stamps) only when the agent accepts.
envelope_order_command() {
  local command_type="$1"
  local command_id="$2"
  local actor_id="$3"
  local order_id="$4"
  local payload="$5"
  cat <<EOF
{
  "commandType":"${command_type}",
  "commandVersion":1,
  "commandId":"${command_id}",
  "idempotencyKey":"${command_id}-abcdef",
  "actor":{"type":"USER","id":"${actor_id}"},
  "principal":{"type":"INDIVIDUAL","id":"${actor_id}"},
  "target":{"type":"Order","id":"${order_id}"},
  "authContext":{},
  "purpose":"e2e_lc30",
  "correlationId":"${command_id}",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":${payload}
}
EOF
}
R9=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" \
  -d "$(envelope_order_command RecordMaterialOrderChange e2e-${TS}-lc30-amd $user_id $order_id_lc30 '{"description":"河内西湖 → 老城区","changes":{"meetingContext":"老城区"}}')" \
  "$BASE/v1/commands/RecordMaterialOrderChange")
amendment_id=$(echo "$R9" | jq -r '((.operationRef // "") | (if . == "" then "{}" else . end) | fromjson?) as $b | if (.outcome // "") == "ACCEPTED" and ($b.status // "") == "PROPOSED" then ($b.amendmentId? // empty) else empty end')
[ -n "$amendment_id" ] || { echo "FAIL: proposal must be ACCEPTED as PROPOSED: $R9"; exit 1; }
echo "  OK: requester proposed amendment $amendment_id"

# LC30-PAYLOAD-QUOTE-001：payload 必须先落到变量里再传。
# 内联写在嵌套的 "$( … )" 里时，内层的 \" 在外层双引号里已经变成**字面量**，
# 于是 {"a":"1","b":"2"} 对 bash 来说是个**未加引号的词** —— 而 {a,b} 正是
# brace expansion 的形状，会被拆成两个词。curl 就收到两个 -d 正文，把第二个
# 当成 URL，退出码 3（URL malformat）；套件有 set -e，于是**无声退出**，
# 看起来像「服务端拒绝了」，实际请求根本没发出去。
accept_payload="{\"amendmentId\":\"${amendment_id}\",\"decision\":\"ACCEPT\"}"
R10=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_order_command RespondMaterialOrderChange e2e-${TS}-lc30-acc $agent_user_id $order_id_lc30 "$accept_payload")" \
  "$BASE/v1/commands/RespondMaterialOrderChange")
decision_after=$(echo "$R10" | jq -r '((.operationRef // "") | (if . == "" then "{}" else . end) | fromjson?) as $b | if (.outcome // "") == "ACCEPTED" and ($b.status // "") == "ACCEPTED" then ($b.policyDecisionId? // empty) else empty end')
if [ -z "$decision_after" ]; then
  echo "FAIL: agent acceptance must apply the change with a policyDecisionId (LC-30 re-eval): $R10"
  exit 1
fi
echo "  OK: agent accepted; post-amendment policyDecisionId=$decision_after (re-evaluated)"

echo ""
echo "=== 7. the parties can read the audit trail (ORDER-AUDIT-001) ==="
R11=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $agent_access_token" \
  -d "$(envelope_order_command GetOrderAuditTrail e2e-${TS}-lc30-audit $agent_user_id $order_id_lc30 '{}')" \
  "$BASE/v1/commands/GetOrderAuditTrail")
trail=$(echo "$R11" | jq -r '(.operationRef // "") | (if . == "" then "{}" else . end) | fromjson? | ([.entries[]?.commandType // empty] | join(","))')
[ "$trail" = "CreateOffer,ConfirmCooperation,RecordMaterialOrderChange,RespondMaterialOrderChange" ] || { echo "FAIL: unexpected audit trail '$trail': $R11"; exit 1; }
echo "  OK: audit trail = $trail"

echo ""
echo "=== lc28-policy-decision-e2e: ALL CASES PASSED ==="
