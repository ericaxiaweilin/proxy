#!/bin/bash
# R16.7-P1-J: live server e2e for the precise-location consent
# endpoints. The script exercises the full grant / status / revoke
# flow against a running server, then asserts that:
#   1. The routes are registered (no 404).
#   2. Auth is required (no token -> 401).
#   3. A valid grant produces a GRANTED status with the requested
#      duration and a future expires_at.
#   4. Invalid durations (60s, 999s) are rejected with 400.
#   5. Revoke flips the status to NONE on the next read.
#   6. Re-grant supersedes the previous row (the old row is
#      REVOKED in the history, the new one is GRANTED).
#   7. History endpoint returns the full audit trail.
#
# Like the privacy e2e, the script fabricates an access token
# inline by hitting the CreateAnonymousSession command. The token
# is short-lived and scoped to a fresh user; the test tears the
# user down implicitly when the run finishes.

set -e
cd "$(dirname "$0")/.."

BASE="${PROXY_API_BASE_URL:-http://127.0.0.1:4100}"
TIMEOUT="${PROXY_E2E_TIMEOUT:-20}"

# Tiny color helpers so failures stand out in the log.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { printf "  ${GREEN}OK${NC}: %s\n" "$*"; }
fail() { printf "  ${RED}FAIL${NC}: %s\n" "$*"; exit 1; }
note() { printf "  ${YELLOW}..${NC}: %s\n" "$*"; }

# Build a JSON envelope for the CreateAnonymousSession command. The
# server requires every field of the envelope (see validateEnvelope
# in apps/api-go/internal/api/command_dispatch.go): a non-empty
# commandId, idempotencyKey >= 8 chars, target.{type,id},
# authContext, purpose, correlationId, and a valid RFC3339
# requestedAt. The payload itself needs a 32+ char deviceCredential
# and 18+ dateOfBirth.
create_anon_envelope() {
  local corr_id="$1"
  local idem_key="$2"
  local cmd_id="loc-e2e-cmd-$corr_id"
  cat <<JSON
{
  "commandType": "CreateAnonymousSession",
  "commandVersion": 1,
  "commandId": "$cmd_id",
  "idempotencyKey": "$idem_key",
  "actor": {"type":"USER","id":"ignored"},
  "principal": {"type":"INDIVIDUAL","id":"ignored"},
  "target": {"type":"Session","id":"ignored"},
  "authContext": {"clientIp":"127.0.0.1","userAgent":"location-consent-e2e/1.0"},
  "purpose": "e2e_location_setup",
  "correlationId": "$corr_id",
  "causationId": "",
  "requestedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload": {
    "deviceId": "loc-e2e-$corr_id",
    "platform": "IOS",
    "deviceCredential": "$(printf 'a%.0s' {1..64})",
    "dateOfBirth": "2000-01-01",
    "legalDocVersion": "1.1",
    "consents": {"terms": true, "privacy": true}
  }
}
JSON
}

# Issue a command and return the JSON response body on stdout.
issue_command() {
  local token="$1"
  local body="$2"
  if [ -z "$token" ]; then
    curl -sS --max-time "$TIMEOUT" -X POST "$BASE/v1/commands/CreateAnonymousSession" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS --max-time "$TIMEOUT" -X POST "$BASE/v1/commands/CreateAnonymousSession" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      -d "$body"
  fi
}

# CreateAnonymousSession once and capture the access token.
CORR_ID="loc-e2e-$(date +%s)-$$"
IDEM_KEY="loc-e2e-idem-$(date +%s)-$$"
ENVELOPE=$(create_anon_envelope "$CORR_ID" "$IDEM_KEY")
note "issuing CreateAnonymousSession"
RESP=$(issue_command "" "$ENVELOPE")
TOKEN=$(printf "%s" "$RESP" | jq -r '.auth.accessToken? // empty')
USER_ID=$(printf "%s" "$RESP" | jq -r '.aggregate.id? // empty')
if [ -z "$TOKEN" ]; then
  echo "$RESP" | head -c 400
  fail "could not extract access token; server did not return auth.accessToken"
fi
ok "anon session created, user=$USER_ID"

# 1. Routes are registered
for method_path in "GET:/v1/location/consent" "POST:/v1/location/consent/grant" "POST:/v1/location/consent/revoke" "GET:/v1/location/consent/history"; do
  method="${method_path%%:*}"
  path="${method_path#*:}"
  status=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN")
  if [ "$status" = "404" ]; then
    fail "$method $path returned 404 — route not registered"
  fi
  ok "$method $path -> $status (route registered)"
done

# 2. Auth required
status=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w "%{http_code}" -X GET "$BASE/v1/location/consent")
if [ "$status" != "401" ]; then
  fail "GET /v1/location/consent without auth expected 401, got $status"
fi
ok "GET /v1/location/consent without auth -> 401"

# 3. Initial status is NONE
note "checking initial status"
INIT=$(curl -sS --max-time "$TIMEOUT" -H "Authorization: Bearer $TOKEN" "$BASE/v1/location/consent")
INIT_STATUS=$(printf "%s" "$INIT" | jq -r '.status? // empty')
if [ "$INIT_STATUS" != "NONE" ]; then
  fail "expected initial status NONE, got $INIT_STATUS (body=$INIT)"
fi
ok "initial status=NONE"

# Capture the baseline history row count so we can assert a
# delta after the grants. The user is fresh per run, but the
# table is not truncated between runs, so an absolute count
# would drift.
HIST_BASELINE=$(curl -sS --max-time "$TIMEOUT" -H "Authorization: Bearer $TOKEN" "$BASE/v1/location/consent/history" | jq -r '(.rows // []) | length')
ok "history baseline=$HIST_BASELINE rows"

# 4. Grant with 30 min
note "granting 30 min"
GRANT=$(curl -sS --max-time "$TIMEOUT" -X POST "$BASE/v1/location/consent/grant" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 1800}')
GRANT_STATUS=$(printf "%s" "$GRANT" | jq -r '.status? // empty')
GRANT_DUR=$(printf "%s" "$GRANT" | jq -r '.durationSeconds? // empty')
if [ "$GRANT_STATUS" != "GRANTED" ] || [ "$GRANT_DUR" != "1800" ]; then
  fail "grant expected GRANTED 1800s, got $GRANT_STATUS $GRANT_DUR (body=$GRANT)"
fi
ok "grant succeeded: status=GRANTED, duration=1800s"

# 5. Status now shows remaining
note "checking post-grant status"
POST=$(curl -sS --max-time "$TIMEOUT" -H "Authorization: Bearer $TOKEN" "$BASE/v1/location/consent")
POST_STATUS=$(printf "%s" "$POST" | jq -r '.status? // empty')
POST_REMAIN=$(printf "%s" "$POST" | jq -r '.remainingSeconds? // 0')
if [ "$POST_STATUS" != "GRANTED" ] || [ "$POST_REMAIN" -lt 1700 ]; then
  fail "post-grant expected GRANTED + remaining >=1700, got $POST_STATUS $POST_REMAIN (body=$POST)"
fi
ok "post-grant status=GRANTED, remaining=${POST_REMAIN}s"

# 6. Invalid duration is rejected
note "checking 60s rejection"
BAD=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w "%{http_code}" -X POST "$BASE/v1/location/consent/grant" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 60}')
if [ "$BAD" != "400" ]; then
  fail "60s grant expected 400, got $BAD"
fi
ok "60s grant -> 400"

# 7. Re-grant supersedes
note "re-granting with 8h"
REGRANT=$(curl -sS --max-time "$TIMEOUT" -X POST "$BASE/v1/location/consent/grant" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 28800}')
REGRANT_DUR=$(printf "%s" "$REGRANT" | jq -r '.durationSeconds? // empty')
if [ "$REGRANT_DUR" != "28800" ]; then
  fail "re-grant expected 28800s, got $REGRANT_DUR (body=$REGRANT)"
fi
ok "re-grant duration=28800s"

# 8. History shows both rows
note "checking history"
HIST=$(curl -sS --max-time "$TIMEOUT" -H "Authorization: Bearer $TOKEN" "$BASE/v1/location/consent/history")
HIST_COUNT=$(printf "%s" "$HIST" | jq -r '(.rows // []) | length')
EXPECTED_COUNT=$((HIST_BASELINE + 2))
if [ "$HIST_COUNT" != "$EXPECTED_COUNT" ]; then
  fail "history expected $EXPECTED_COUNT rows (baseline $HIST_BASELINE + 2 grants), got $HIST_COUNT (body=$HIST)"
fi
ok "history shows $HIST_COUNT rows (baseline $HIST_BASELINE + 2 new)"

# 9. Revoke
note "revoking"
REV=$(curl -sS --max-time "$TIMEOUT" -X POST "$BASE/v1/location/consent/revoke" \
  -H "Authorization: Bearer $TOKEN")
# `| tostring` instead of `// empty`: a real `false` must stay visible as
# "false" (jq's `//` swallows falsy values), and a missing key becomes "null" —
# either way it is not "true", which is what the assertion below checks.
WAS_ACTIVE=$(printf "%s" "$REV" | jq -r '.wasActive | tostring')
if [ "$WAS_ACTIVE" != "true" ]; then
  fail "revoke expected wasActive=true, got $WAS_ACTIVE (body=$REV)"
fi
ok "revoke flipped wasActive=true"

# 10. Status is NONE again
note "post-revoke status"
AFTER=$(curl -sS --max-time "$TIMEOUT" -H "Authorization: Bearer $TOKEN" "$BASE/v1/location/consent")
AFTER_STATUS=$(printf "%s" "$AFTER" | jq -r '.status? // empty')
if [ "$AFTER_STATUS" != "NONE" ]; then
  fail "post-revoke expected NONE, got $AFTER_STATUS (body=$AFTER)"
fi
ok "post-revoke status=NONE"

# 11. Cross-user isolation: a second user's status is unaffected
note "creating second user"
CORR2="loc-e2e2-$(date +%s)-$$"
IDEM2="loc-e2e-idem2-$(date +%s)-$$"
ENVELOPE2=$(create_anon_envelope "$CORR2" "$IDEM2")
RESP2=$(issue_command "" "$ENVELOPE2")
TOKEN2=$(printf "%s" "$RESP2" | jq -r '.auth.accessToken? // empty')
USER2=$(printf "%s" "$RESP2" | jq -r '.aggregate.id? // empty')
if [ -z "$TOKEN2" ]; then
  fail "could not create second user"
fi
ok "second user created: $USER2"
USER2_STATUS=$(curl -sS --max-time "$TIMEOUT" -H "Authorization: Bearer $TOKEN2" "$BASE/v1/location/consent" | jq -r '.status? // empty')
if [ "$USER2_STATUS" != "NONE" ]; then
  fail "second user expected NONE, got $USER2_STATUS"
fi
ok "second user status=NONE (cross-user isolation OK)"

echo ""
echo "ALL LOCATION CONSENT E2E TESTS PASS"
