#!/bin/bash
# R16.10-P1-F: privacy request center end-to-end test against a
# LIVE server. Run after `pnpm dev:api` and `nohup go -C
# apps/api-go run ./cmd/api &`.
#
# What it covers:
#  * /v1/privacy/* route registration (no 404)
#  * Auth is mandatory on every endpoint (401 without token)
#  * Authenticated GET /v1/privacy/me returns a data export
#  * POST /v1/privacy/export creates a 'received' request
#  * GET /v1/privacy/status returns the request status
#  * POST /v1/privacy/delete creates a delete request with
#    30-day grace window
#  * Duplicate export returns 409
#  * POST /v1/privacy/cancel withdraws the delete
#  * After cancel, a fresh delete is accepted
#  * GET /v1/privacy/requests returns the full history
set -e
BASE="${PROXY_API_BASE_URL:-http://127.0.0.1:4100}"
TS=$(date +%s)

echo "=== 0. health check ==="
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health/live")
[ "$status" = "200" ] || { echo "FAIL: server not healthy: $status"; exit 1; }
echo "  OK: /health/live 200"

echo ""
echo "=== 1. every /v1/privacy/* route is registered (expect 401, not 404) ==="
for path_method in "GET  /v1/privacy/me" "POST /v1/privacy/export" "POST /v1/privacy/delete" "POST /v1/privacy/cancel" "GET  /v1/privacy/status" "GET  /v1/privacy/requests"; do
  method=$(echo $path_method | cut -d' ' -f1)
  path=$(echo $path_method | cut -d' ' -f2)
  status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path")
  if [ "$status" = "401" ]; then
    echo "  OK: $method $path → 401"
  elif [ "$status" = "404" ]; then
    echo "  FAIL: $method $path → 404 (route missing)"
    exit 1
  else
    echo "  FAIL: $method $path → $status (expected 401)"
    exit 1
  fi
done

echo ""
echo "=== 2. unauthenticated /v1/privacy/me returns 401 with structured error ==="
body=$(curl -s -i "$BASE/v1/privacy/me" | head -10)
echo "$body" | grep -q "401 Unauthorized" || { echo "FAIL: missing 401"; exit 1; }
echo "$body" | grep -q "access_token_required" || { echo "FAIL: missing access_token_required body"; exit 1; }
echo "  OK: 401 with access_token_required body"

echo ""
echo "=== 3. run a full CreateAnonymousSession through /v1/commands/ to get a token ==="
# R16.7 payload: deviceId, platform, deviceCredential, dateOfBirth, legalDocVersion, consents.
# The command envelope has strict validation (see
# validateEnvelope in apps/api-go/internal/api/command_dispatch.go):
# every field must be present and idempotencyKey must be >= 8 chars.
requested_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
anon_payload=$(cat <<EOF
{
  "commandType": "CreateAnonymousSession",
  "commandVersion": 1,
  "commandId": "e2e-anon-${TS}",
  "idempotencyKey": "e2e-anon-${TS}-key",
  "actor": { "type": "USER", "id": "ignored" },
  "principal": { "type": "INDIVIDUAL", "id": "ignored" },
  "target": { "type": "Session", "id": "ignored" },
  "authContext": { "clientIp": "127.0.0.1" },
  "purpose": "e2e_privacy_setup",
  "correlationId": "e2e-anon-${TS}",
  "causationId": "",
  "requestedAt": "${requested_at}",
  "payload": {
    "deviceId": "e2e-privacy-${TS}",
    "platform": "IOS",
    "deviceCredential": "01234567890123456789012345678901",
    "dateOfBirth": "2000-01-01",
    "legalDocVersion": "1.1",
    "consents": { "terms": true, "privacy": true }
  }
}
EOF
)
anon_response=$(curl -s -X POST -H "Content-Type: application/json" -d "$anon_payload" "$BASE/v1/commands/CreateAnonymousSession")
outcome=$(echo "$anon_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('outcome',''))")
[ "$outcome" = "ACCEPTED" ] || { echo "FAIL: anon signup outcome=$outcome body=$anon_response"; exit 1; }
access_token=$(echo "$anon_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('auth',{}).get('accessToken',''))")
user_id=$(echo "$anon_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('auth',{}).get('userAccountId',''))")
[ -n "$access_token" ] || { echo "FAIL: no access token in response: $anon_response"; exit 1; }
[ -n "$user_id" ] || { echo "FAIL: no user id in response: $anon_response"; exit 1; }
echo "  OK: anon session created, user=$user_id"

echo ""
echo "=== 4. authenticated GET /v1/privacy/me returns export data ==="
me_response=$(curl -s -H "Authorization: Bearer $access_token" "$BASE/v1/privacy/me")
me_status=$(echo "$me_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('formatVersion') else 'fail:'+str(d))")
[ "$me_status" = "ok" ] || { echo "FAIL: /v1/privacy/me: $me_response"; exit 1; }
echo "$me_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  legalBasis='+d.get('legalBasis','')); print('  accountId='+d.get('data',{}).get('account',{}).get('id','')); print('  sessions='+str(len(d.get('data',{}).get('sessions',[]))));"
echo "  OK: /v1/privacy/me returns export data"

echo ""
echo "=== 5. POST /v1/privacy/export creates a 'received' request ==="
export_response=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" -d '{"legalBasis":"PDP-91/2025/QH15-Art31"}' "$BASE/v1/privacy/export")
export_status=$(echo "$export_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request',{}).get('status',''))")
request_id=$(echo "$export_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request',{}).get('id',''))")
retention=$(echo "$export_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('retentionDays',0))")
[ "$export_status" = "received" ] || { echo "FAIL: export status=$export_status body=$export_response"; exit 1; }
[ -n "$request_id" ] || { echo "FAIL: no request id: $export_response"; exit 1; }
[ "$retention" = "7" ] || { echo "FAIL: retention=$retention, want 7"; exit 1; }
echo "  OK: status=received, requestId=$request_id, retentionDays=7"

echo ""
echo "=== 6. GET /v1/privacy/status?requestId=... returns the same request ==="
status_response=$(curl -s -H "Authorization: Bearer $access_token" "$BASE/v1/privacy/status?requestId=$request_id")
status_kind=$(echo "$status_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request',{}).get('kind',''))")
[ "$status_kind" = "export" ] || { echo "FAIL: status kind=$status_kind body=$status_response"; exit 1; }
echo "  OK: status returns kind=export"

echo ""
echo "=== 7. duplicate export returns 409 PRIVACY_REQUEST_ACTIVE ==="
dup_status=$(curl -s -o /tmp/dup.json -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" -d '{}' "$BASE/v1/privacy/export")
[ "$dup_status" = "409" ] || { echo "FAIL: dup status=$dup_status, want 409"; exit 1; }
grep -q "PRIVACY_REQUEST_ACTIVE" /tmp/dup.json || { echo "FAIL: dup body missing PRIVACY_REQUEST_ACTIVE: $(cat /tmp/dup.json)"; exit 1; }
echo "  OK: duplicate returns 409 + PRIVACY_REQUEST_ACTIVE"

echo ""
echo "=== 8. POST /v1/privacy/delete creates a delete request with 30-day grace ==="
delete_response=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" -d '{"reason":"e2e_test"}' "$BASE/v1/privacy/delete")
delete_status=$(echo "$delete_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request',{}).get('status',''))")
grace=$(echo "$delete_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('gracePeriodDays',0))")
delete_id=$(echo "$delete_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request',{}).get('id',''))")
erased_at=$(echo "$delete_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('erasedAt',''))")
[ "$delete_status" = "received" ] || { echo "FAIL: delete status=$delete_status body=$delete_response"; exit 1; }
[ "$grace" = "30" ] || { echo "FAIL: grace=$grace, want 30"; exit 1; }
[ -n "$delete_id" ] || { echo "FAIL: no delete id"; exit 1; }
[ -n "$erased_at" ] || { echo "FAIL: no erasedAt"; exit 1; }
echo "  OK: delete status=received, grace=30d, erasedAt=$erased_at"

echo ""
echo "=== 9. POST /v1/privacy/cancel withdraws the delete ==="
cancel_response=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" -d "{\"requestId\":\"$delete_id\",\"reason\":\"changed mind\"}" "$BASE/v1/privacy/cancel")
cancel_status=$(echo "$cancel_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request',{}).get('status',''))")
[ "$cancel_status" = "cancelled" ] || { echo "FAIL: cancel status=$cancel_status body=$cancel_response"; exit 1; }
echo "  OK: cancel status=cancelled"

echo ""
echo "=== 10. after cancel, a fresh delete request is accepted ==="
del2_response=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access_token" -d '{}' "$BASE/v1/privacy/delete")
del2_status=$(echo "$del2_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request',{}).get('status',''))")
[ "$del2_status" = "received" ] || { echo "FAIL: post-cancel delete status=$del2_status body=$del2_response"; exit 1; }
echo "  OK: post-cancel delete accepted"

echo ""
echo "=== 11. GET /v1/privacy/requests returns full history ==="
list_response=$(curl -s -H "Authorization: Bearer $access_token" "$BASE/v1/privacy/requests")
list_count=$(echo "$list_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('count',0))")
[ "$list_count" = "3" ] || { echo "FAIL: list count=$list_count, want 3 (1 export + 1 cancelled delete + 1 new delete)"; exit 1; }
echo "  OK: list count=3"
echo "$list_response" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for req in d.get('requests', []):
    print('  - ' + req.get('kind','') + ' ' + req.get('status','') + ' @ ' + req.get('requestedAt',''))
"

echo ""
echo "=== 12. cross-user privacy isolation: a second user cannot cancel the first user's request ==="
anon2_payload=$(cat <<EOF
{
  "commandType": "CreateAnonymousSession",
  "commandVersion": 1,
  "commandId": "e2e-anon2-${TS}",
  "idempotencyKey": "e2e-anon2-${TS}-key",
  "actor": { "type": "USER", "id": "ignored" },
  "principal": { "type": "INDIVIDUAL", "id": "ignored" },
  "target": { "type": "Session", "id": "ignored" },
  "authContext": { "clientIp": "127.0.0.1" },
  "purpose": "e2e_privacy_user2",
  "correlationId": "e2e-anon2-${TS}",
  "causationId": "",
  "requestedAt": "${requested_at}",
  "payload": {
    "deviceId": "e2e-privacy2-${TS}",
    "platform": "IOS",
    "deviceCredential": "abcdefghijklmnopqrstuvwxyz123456",
    "dateOfBirth": "2000-01-01",
    "legalDocVersion": "1.1",
    "consents": { "terms": true, "privacy": true }
  }
}
EOF
)
anon2_response=$(curl -s -X POST -H "Content-Type: application/json" -d "$anon2_payload" "$BASE/v1/commands/CreateAnonymousSession")
access2=$(echo "$anon2_response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('auth',{}).get('accessToken',''))")
[ -n "$access2" ] || { echo "FAIL: no access2 token"; exit 1; }
# User 2 tries to fetch user 1's /v1/privacy/me — should succeed (own data), not user 1's data
me2=$(curl -s -H "Authorization: Bearer $access2" "$BASE/v1/privacy/me")
me2_userid=$(echo "$me2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('account',{}).get('id',''))")
[ "$me2_userid" != "$user_id" ] || { echo "FAIL: user 2 sees user 1's data (id=$me2_userid)"; exit 1; }
echo "  OK: user 2's export is their own (id=$me2_userid != $user_id)"

echo ""
echo "=== 13. user 2 cannot cancel user 1's request ==="
forbid_status=$(curl -s -o /tmp/forbid.json -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $access2" -d "{\"requestId\":\"$request_id\"}" "$BASE/v1/privacy/cancel")
[ "$forbid_status" = "403" ] || { echo "FAIL: cancel-by-other status=$forbid_status, want 403"; exit 1; }
grep -q "PRIVACY_REQUEST_FORBIDDEN" /tmp/forbid.json || { echo "FAIL: missing PRIVACY_REQUEST_FORBIDDEN: $(cat /tmp/forbid.json)"; exit 1; }
echo "  OK: cross-user cancel returns 403 + PRIVACY_REQUEST_FORBIDDEN"

echo ""
echo "ALL E2E TESTS PASS"
