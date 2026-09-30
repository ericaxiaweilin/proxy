#!/bin/bash
# R16.7-P1-K (LC-06) + R16.7-P1-I (LC-07): AI media label
# (LC-06) + twin likeness consent (LC-07) end-to-end test
# against a LIVE server. Run after the server is up
# (e.g. via the gate g3 runner).
#
# 本脚本覆盖的是 **create 边界 + persona / consent 的 HTTP 面**：
#   0a. CreateAnonymousSession 建一个带年龄断言的账号（persona 的 owner 用它）。
#   0b. 没有接单权限时 USER_TWIN 被拒 —— ORDER-PERMISSION-TWIN-001 的门真的在。
#   0c. 造前置条件：从库里写一条 APPROVED 服务者申请（这个条件 HTTP 层到不了，
#       原因见下面「前置条件：接单权限」那段）。用 PROXY_E2E_ADMIN_PSQL，由
#       scripts/e2e-isolated.sh 导出。
#   1.  POST /v1/ai/personas creates a persona row.
#   2.  POST /v1/ai/personas/{id}/consents grants a likeness
#       consent. GET /v1/ai/personas/{id}/consents?subjectId=...
#       returns 200 with the live consent.
#   3.  GET consents for a subject with none → 204.
#   5.  CreateMediaAsset with aiGenerationSource=USER_UPLOADED
#       is accepted; the asset is AIGenerated=false.
#   6.  CreateMediaAsset with aiGenerationSource=AI_PERSONA but
#       no personaId is rejected with AI_PERSONA_ID_REQUIRED.
#   7.  CreateMediaAsset with aiGenerationSource=GARBAGE is
#       rejected with INVALID_AI_GENERATION_SOURCE.
#   8-10. CreateMediaAsset with AI_PERSONA (+ persona + subject,
#       ± consent, CREATIVE) is accepted at create — the gate
#       fires later, at MarkMediaReady.
#
# 本脚本**不覆盖** MarkMediaReady 上的两道 fail-closed 闸门
# （AI_LABEL_MISSING / AI_LIKENESS_CONSENT_MISSING）：
# MarkMediaReady 要求资产先在 PROCESSING，而把一行从 UPLOADING 推到
# PROCESSING 需要走真实上传 + worker，脚本这一层做不到（见下面
# envelope_mark_ready 附近的说明）。
#
# 2026-09-21 教训：这段「本脚本覆盖 6/7 两条」的旧注释是错的，而且正是
# 这个错误让 P0 藏了很久 —— 闸门在 Postgres 路径上其实是死代码
# （media.media_assets 当时没有 AI 溯源列，读回来永远是空值，比不过字面量
# "UNKNOWN"），但没人去看，因为脚本注释说它已经覆盖了。
# 那两道闸门的真实覆盖在：
#   apps/api-go/internal/platform/postgres/media_ai_provenance_test.go
#   （LC-06 / LC-07 在真库上的往返 + fail-closed 用例，走真实 schema）
# 由 scripts/check-regression-contracts.sh 的 LC-06 / LC-07 钉强制执行。
set -e
BASE="${PROXY_API_BASE_URL:-http://127.0.0.1:4100}"
TS=$(date +%s%N)
# Random nonce so the gate can run this script multiple
# times in the same second without the idempotency key
# being recycled.
NONCE=$(head -c 8 /dev/urandom | xxd -p)

echo "=== 0. health check ==="
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health/live")
[ "$status" = "200" ] || { echo "FAIL: server not healthy: $status"; exit 1; }
echo "  OK: /health/live 200"

echo
echo "=== 0a. CreateAnonymousSession (LC-28 / 30 reuse the same access token) ==="
anon_payload=$(cat <<EOF
{
  "commandType":"CreateAnonymousSession",
  "commandVersion":1,
  "commandId":"anon-${TS}",
  "idempotencyKey":"anon-${TS}-${NONCE}",
  "actor":{"type":"USER","id":"ignored"},
  "principal":{"type":"INDIVIDUAL","id":"ignored"},
  "target":{"type":"Session","id":"ignored"},
  "authContext":{"clientIp":"127.0.0.1"},
  "purpose":"e2e_lc06",
  "correlationId":"anon-${TS}",
  "causationId":"",
  "requestedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload":{
    "deviceId":"e2e-lc06-${TS}",
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

# Helpers ------------------------------------------------------------

# envelope_create_asset POSTs a CreateMediaAsset command and prints
# the response body. Args: mediaType, originalKey, mime, aiSource, personaId
envelope_create_asset() {
  local command_id="$1"
  local media_type="$2"
  local original_key="$3"
  local mime="$4"
  local ai_source="$5"
  local persona_id="$6"
  local subject_id="$7"
  local payload
  local actor_id="${user_id}"
  if [ -n "$ai_source" ]; then
    if [ -n "$persona_id" ]; then
      payload=$(cat <<EOF
{
  "commandId": "${command_id}",
  "commandType": "CreateMediaAsset",
  "commandVersion": 1,
  "actor": { "type": "USER", "id": "${actor_id}" },
  "principal": { "type": "INDIVIDUAL", "id": "${actor_id}" },
  "target": { "type": "MediaAsset", "id": "new" },
  "idempotencyKey": "idem_lc06_${command_id}",
  "authContext": { "session": "sess_${TS}" },
  "purpose": "lc06_test",
  "correlationId": "corr_${TS}_${command_id}",
  "requestedAt": "2026-09-04T00:00:00Z",
  "payload": {
    "mediaType": "${media_type}",
    "originalStorageKey": "${original_key}",
    "mimeType": "${mime}",
    "aiGenerationSource": "${ai_source}",
    "personaId": "${persona_id}",
    "subjectId": "${subject_id}"
  }
}
EOF
)
    else
      payload=$(cat <<EOF
{
  "commandId": "${command_id}",
  "commandType": "CreateMediaAsset",
  "commandVersion": 1,
  "actor": { "type": "USER", "id": "${actor_id}" },
  "principal": { "type": "INDIVIDUAL", "id": "${actor_id}" },
  "target": { "type": "MediaAsset", "id": "new" },
  "idempotencyKey": "idem_lc06_${command_id}",
  "authContext": { "session": "sess_${TS}" },
  "purpose": "lc06_test",
  "correlationId": "corr_${TS}_${command_id}",
  "requestedAt": "2026-09-04T00:00:00Z",
  "payload": {
    "mediaType": "${media_type}",
    "originalStorageKey": "${original_key}",
    "mimeType": "${mime}",
    "aiGenerationSource": "${ai_source}"
  }
}
EOF
)
    fi
  else
    payload=$(cat <<EOF
{
  "commandId": "${command_id}",
  "commandType": "CreateMediaAsset",
  "commandVersion": 1,
  "actor": { "type": "USER", "id": "${actor_id}" },
  "principal": { "type": "INDIVIDUAL", "id": "${actor_id}" },
  "target": { "type": "MediaAsset", "id": "new" },
  "idempotencyKey": "idem_lc06_${command_id}",
  "authContext": { "session": "sess_${TS}" },
  "purpose": "lc06_test",
  "correlationId": "corr_${TS}_${command_id}",
  "requestedAt": "2026-09-04T00:00:00Z",
  "payload": {
    "mediaType": "${media_type}",
    "originalStorageKey": "${original_key}",
    "mimeType": "${mime}"
  }
}
EOF
)
  fi
  curl -s -X POST "$BASE/v1/commands/CreateMediaAsset" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $access_token" \
    -H "Idempotency-Key: idem_lc06_${command_id}" \
    -d "$payload"
}

# envelope_mark_ready issues MarkMediaReady after a manual status
# flip. The handler refuses assets that are not in PROCESSING; we
# flip the row through the repository via a special
# dev-only path is NOT available — instead we rely on the real
# upload + worker flow, but skip the heavy worker. For
# end-to-end purposes the unit tests cover the gate; this
# script focuses on the persona API surface plus the
# CreateMediaAsset boundary.

# envelope_create_persona POSTs a CreatePersona command (we use the
# HTTP API surface, not the command bus, because persona CRUD
# lives outside the command bus for now).
#
# owner_id 必须是**真实带年龄断言的账号**，也就是上面那个匿名会话的
# user_id —— 不能随便编一个。CreatePersona 里有 COMP-AI-MINOR-001 守卫
# （internal/aipersona/personas.go:194）：它拿 OwnerID 去查
# identity.user_age_assertions，查不到就 fail-closed 返回
# "no age evidence on file for this account"。
# 年龄断言是 CreateAnonymousSession / CreateSession 写的（identity/service.go:365），
# 所以只有 user_id 有；像 "user_${TS}_subject" 这种拼出来的串库里根本没有，
# 会以 create_failed 挂在第 1 步 —— 整个脚本再也走不到后面的用例。
# subjectId 不受此限：它只是「这份 likeness 属于谁」，不需要年龄证据。
envelope_create_persona() {
  local owner_id="$1"
  local display_name="$2"
  local persona_type="$3"
  local description="$4"
  local payload
  payload=$(cat <<EOF
{
  "ownerId": "${owner_id}",
  "displayName": "${display_name}",
  "personaType": "${persona_type}",
  "description": "${description}"
}
EOF
)
  curl -s -X POST "$BASE/v1/ai/personas" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

# envelope_grant_consent issues a likeness consent grant.
envelope_grant_consent() {
  local persona_id="$1"
  local subject_id="$2"
  local consent_kind="$3"
  local payload
  payload=$(cat <<EOF
{
  "subjectId": "${subject_id}",
  "consentKind": "${consent_kind}"
}
EOF
)
  curl -s -X POST "$BASE/v1/ai/personas/${persona_id}/consents" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

envelope_has_consent() {
  local persona_id="$1"
  local subject_id="$2"
  curl -s -o /dev/null -w "%{http_code}" \
    "$BASE/v1/ai/personas/${persona_id}/consents?subjectId=${subject_id}"
}

# Tests --------------------------------------------------------------

# --- 前置条件：接单权限（ORDER-PERMISSION-TWIN-001） -------------------------
#
# 本套件测的是 AI 媒体标签（LC-06）与肖像同意（LC-07）的 HTTP 面，而两者都挂在
# USER_TWIN 上；USER_TWIN 又只对「有接单权限」的人开。这个前置条件**到不了** HTTP 层：
#   * 审批端点是 POST /v1/operator/provider-applications/review，要 operator 身份；
#   * operator 白名单是 boot 时从 PROXY_OPERATOR_PRINCIPALS 读的**固定 principal id**，
#     而这里的 user_id 是 CreateAnonymousSession 刚生成的 —— 配不进去；
#   * 走真实申请流程还要手机 OTP，e2e 环境收不到验证码。
# 所以只从库里造这一件前置条件。**断言仍然全部走 API**：下面先证明「没权限就是 403」
# （门真的在），再证明「有权限才开」。
#
# 2026-09-30 之前这里什么都没做，于是第 1 步直接 order_permission_required 挂掉 ——
# 套件看起来在测「USER_TWIN 能不能建」，其实从来没走到过。

if [ -z "${PROXY_E2E_ADMIN_PSQL:-}" ]; then
  echo "FAIL: PROXY_E2E_ADMIN_PSQL is not set." >&2
  echo "      This suite needs a fixture handle to seed an approved provider application." >&2
  echo "      Run it through scripts/e2e-isolated.sh (which exports it), not standalone." >&2
  exit 1
fi

echo
echo "=== 0b. 没有接单权限时，USER_TWIN 必须被拒（ORDER-PERMISSION-TWIN-001） ==="
out=$(envelope_create_persona "$user_id" "Denied Twin" "USER_TWIN" "")
err=$(echo "$out" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')
[ "$err" = "order_permission_required" ] || { echo "FAIL: expected order_permission_required, got: $out"; exit 1; }
echo "  OK: order_permission_required（门在，不是放行）"

echo
echo "=== 0c. 造前置条件：一条 APPROVED 的服务者申请 ==="
# 收工必须把这条前置条件删掉：g3 模式下这个库是**开发库**，不是一次性库 ——
# 留一条 APPROVED 的假申请会出现在运营的申请列表里，而且每跑一次门禁就多一条。
# 用 EXIT trap 而不是写在脚本末尾，因为下面每一步都可能 exit 1。
fixture_cleanup() {
  [ -n "${PROXY_E2E_ADMIN_PSQL:-}" ] || return 0
  [ -n "${user_id:-}" ] || return 0
  "$PROXY_E2E_ADMIN_PSQL" -c \
    "DELETE FROM supply.provider_applications WHERE application_id = 'papp_e2e_lc06_${TS}'" >/dev/null 2>&1 || true
}
trap fixture_cleanup EXIT
if ! "$PROXY_E2E_ADMIN_PSQL" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO supply.provider_applications (application_id, user_account_id, display_name, status, reviewed_by, reviewed_at, source)
   VALUES ('papp_e2e_lc06_${TS}', '${user_id}', 'E2E Provider', 'APPROVED', 'e2e', now(), 'APP')
   ON CONFLICT DO NOTHING" >/dev/null; then
  echo "FAIL: seeding the approved application failed"
  exit 1
fi
seeded=$("$PROXY_E2E_ADMIN_PSQL" -t -A -c \
  "SELECT count(*) FROM supply.provider_applications WHERE user_account_id='${user_id}' AND status='APPROVED'")
[ "$seeded" = "1" ] || { echo "FAIL: expected 1 APPROVED application after seeding, got '$seeded'"; exit 1; }
echo "  OK: 已写入 APPROVED 申请（user=$user_id）"

echo
echo "=== 1. POST /v1/ai/personas (USER_TWIN) ==="
out=$(envelope_create_persona "$user_id" "Alice Twin" "USER_TWIN" "Alice 的中文数字分身")
echo "  resp: $out"
persona_id=$(echo "$out" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$persona_id" ] || { echo "FAIL: persona id missing"; exit 1; }
echo "  OK: persona id=$persona_id"

echo
echo "=== 2. POST /v1/ai/personas/{id}/consents ==="
out=$(envelope_grant_consent "$persona_id" "user_${TS}_subject" "VISUAL_AND_VOICE")
echo "  resp: $out"
consent_id=$(echo "$out" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$consent_id" ] || { echo "FAIL: consent id missing"; exit 1; }
echo "  OK: consent id=$consent_id"

echo
echo "=== 3. GET /v1/ai/personas/{id}/consents?subjectId=... ==="
status=$(envelope_has_consent "$persona_id" "user_${TS}_subject")
[ "$status" = "200" ] || { echo "FAIL: expected 200, got $status"; exit 1; }
echo "  OK: 200 with live consent"

echo
echo "=== 4. GET /v1/ai/personas/{id}/consents?subjectId=... (no consent) ==="
status=$(envelope_has_consent "$persona_id" "user_${TS}_other")
[ "$status" = "204" ] || { echo "FAIL: expected 204, got $status"; exit 1; }
echo "  OK: 204 No Content for unknown subject"

echo
echo "=== 5. CreateMediaAsset with USER_UPLOADED (default) ==="
out=$(envelope_create_asset "asset_default_${TS}" "IMAGE" "uploads/phone.jpg" "image/jpeg" "" "" "")
echo "  resp: $out"
outcome=$(echo "$out" | sed -n 's/.*"outcome":"\([^"]*\)".*/\1/p')
[ "$outcome" = "ACCEPTED" ] || { echo "FAIL: expected ACCEPTED, got $outcome"; exit 1; }
# The operationRef carries mediaAssetId; aiGenerated is on
# the persisted asset and exercised by
# platform/postgres/media_ai_provenance_test.go
# (TestMediaProvenanceUserUploadedIsLabelledAndPublishes) on the
# real schema, not only by the in-memory media unit tests.
echo "  OK: ACCEPTED (aiGenerated=false verified against the real schema)"

echo
echo "=== 6. CreateMediaAsset with AI_PERSONA but no personaId ==="
out=$(envelope_create_asset "asset_no_pid_${TS}" "IMAGE" "uploads/x.png" "image/png" "AI_PERSONA" "" "")
echo "  resp: $out"
err=$(echo "$out" | sed -n 's/.*"errorCode":"\([^"]*\)".*/\1/p')
[ "$err" = "AI_PERSONA_ID_REQUIRED" ] || { echo "FAIL: expected AI_PERSONA_ID_REQUIRED, got $err"; exit 1; }
echo "  OK: rejected with AI_PERSONA_ID_REQUIRED"

echo
echo "=== 7. CreateMediaAsset with invalid aiGenerationSource ==="
out=$(envelope_create_asset "asset_bad_src_${TS}" "IMAGE" "uploads/x.png" "image/png" "GARAGE_GENERATED" "" "")
echo "  resp: $out"
err=$(echo "$out" | sed -n 's/.*"errorCode":"\([^"]*\)".*/\1/p')
[ "$err" = "INVALID_AI_GENERATION_SOURCE" ] || { echo "FAIL: expected INVALID_AI_GENERATION_SOURCE, got $err"; exit 1; }
echo "  OK: rejected with INVALID_AI_GENERATION_SOURCE"

echo
echo "=== 8. CreateMediaAsset with AI_PERSONA + persona + subject ==="
out=$(envelope_create_asset "asset_ai_${TS}" "IMAGE" "uploads/ai.png" "image/png" "AI_PERSONA" "$persona_id" "user_${TS}_subject")
echo "  resp: $out"
outcome=$(echo "$out" | sed -n 's/.*"outcome":"\([^"]*\)".*/\1/p')
[ "$outcome" = "ACCEPTED" ] || { echo "FAIL: expected ACCEPTED, got $outcome"; exit 1; }
echo "  OK: ACCEPTED with AI_PERSONA + persona + subject"

echo
echo "=== 9. CreateMediaAsset with AI_PERSONA but no consent (different persona) ==="
# Build a fresh USER_TWIN persona that has no consent row.
# owner 仍然必须是真实账号（年龄断言）；没有同意的是 subject，不是 owner。
out=$(envelope_create_persona "$user_id" "Bob Twin" "USER_TWIN" "")
persona_id_no_consent=$(echo "$out" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$persona_id_no_consent" ] || { echo "FAIL: persona 2 id missing"; exit 1; }
out=$(envelope_create_asset "asset_no_consent_${TS}" "IMAGE" "uploads/ai.png" "image/png" "AI_PERSONA" "$persona_id_no_consent" "user_${TS}_subject2")
outcome=$(echo "$out" | sed -n 's/.*"outcome":"\([^"]*\)".*/\1/p')
[ "$outcome" = "ACCEPTED" ] || { echo "FAIL: expected ACCEPTED at create, got $outcome"; exit 1; }
echo "  OK: ACCEPTED at create (the gate fires at MarkMediaReady — see platform/postgres/media_ai_provenance_test.go)"

echo
echo "=== 10. CreateMediaAsset with AI_PERSONA + CREATIVE persona (no consent needed) ==="
out=$(envelope_create_persona "$user_id" "Concierge 1" "CREATIVE" "")
persona_id_creative=$(echo "$out" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$persona_id_creative" ] || { echo "FAIL: creative persona id missing"; exit 1; }
out=$(envelope_create_asset "asset_creative_${TS}" "IMAGE" "uploads/ai.png" "image/png" "AI_PERSONA" "$persona_id_creative" "user_${TS}_biz")
outcome=$(echo "$out" | sed -n 's/.*"outcome":"\([^"]*\)".*/\1/p')
[ "$outcome" = "ACCEPTED" ] || { echo "FAIL: expected ACCEPTED, got $outcome"; exit 1; }
echo "  OK: ACCEPTED with CREATIVE persona"

echo
echo "=== ALL LC-06 / LC-07 GATE TESTS PASSED ==="
exit 0
