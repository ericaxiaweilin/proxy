#!/usr/bin/env bash
# R15.16 P3 风控策略 E2E 验证 — 11 fixture + 5 negative case
set -uo pipefail
PORT=4202
cd "$(dirname "$0")/../Users/thanhhuyennguyen/Desktop/kake" 2>/dev/null || cd /Users/thanhhuyennguyen/Desktop/kake

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

uuid() { python3 -c "import uuid; print(uuid.uuid4().hex[:16])"; }

PASS=0
FAIL=0
trap 'echo "---"; echo "  PASS: $PASS  FAIL: $FAIL"' EXIT

check() {
  local label="$1" expect="$2" got="$3"
  if [[ "$got" == *"$expect"* ]]; then
    echo "  ✓ $label: $got"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label: expected $expect, got $got"
    FAIL=$((FAIL+1))
  fi
}

echo "=== 风控策略 E2E 测试 (R15.16 P3) ==="
echo ""

# 1. 11 fixture 全部可上传 (正面 case)
echo "── 1. 11 fixture 全部可上传 (POST + Upload + Complete) ──"
SESS=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"e2e_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"e2e_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"e2e_$(uuid)\"},
  \"idempotencyKey\":\"e2e_anon_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
  \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"e2e_dev_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN=$(echo "$SESS" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")
USER_ID=$(echo "$SESS" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['userAccountId'])")

for FIX in single-portrait-half-4x5 single-portrait-full-9x16 single-landscape-half-4x3 \
  single-landscape-full-3x1 group-portrait-2-1x1 group-portrait-4-1x1 \
  landscape-skyline-16x9 object-product-4x5 object-flatlay-1x1 \
  ad-banner-text-heavy-16x9 screenshot-ui-9x19.5
do
  FIX_PATH="architecture/fixtures/social-media/matrix/${FIX}.jpg"
  W=$(sips -g pixelWidth "${FIX_PATH}" 2>/dev/null | awk '/pixelWidth/{print $2}')
  H=$(sips -g pixelHeight "${FIX_PATH}" 2>/dev/null | awk '/pixelHeight/{print $2}')
  KEY="${FIX}_$(uuid).jpg"

  INIT=$(post_cmd "CreateMediaAsset" "{
    \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CreateMediaAsset\",\"commandVersion\":1,
    \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
    \"target\":{\"type\":\"MediaAsset\",\"id\":\"e2e_$(uuid)\"},
    \"idempotencyKey\":\"e2e_$(uuid)\",\"authContext\":{},
    \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
    \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
    \"payload\":{\"mediaType\":\"IMAGE\",\"originalStorageKey\":\"$KEY\",\"mimeType\":\"image/jpeg\",\"width\":$W,\"height\":$H}
  }" "$TOKEN")
  ASSET_ID=$(echo "$INIT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('aggregate',{}).get('id',''))")

  UPL_CODE=$(curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/${ASSET_ID}" \
    -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
    -H "Authorization: Bearer $TOKEN" --data-binary "@${FIX_PATH}" \
    -o /dev/null -w "%{http_code}")

  COMP=$(post_cmd "CompleteMediaUpload" "{
    \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CompleteMediaUpload\",\"commandVersion\":1,
    \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
    \"target\":{\"type\":\"MediaAsset\",\"id\":\"$ASSET_ID\"},
    \"idempotencyKey\":\"e2e_$(uuid)\",\"authContext\":{},
    \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
    \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
    \"payload\":{\"mediaAssetId\":\"$ASSET_ID\",\"originalStorageKey\":\"$KEY\",\"contentLengthBytes\":$(stat -f%z "$FIX_PATH"),\"contentSha256\":\"e2e\"}
  }" "$TOKEN")
  OUT=$(echo "$COMP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('outcome',''))")

  if [[ "$UPL_CODE" == "204" && "$OUT" == "ACCEPTED" ]]; then
    echo "  ✓ $FIX  upload=$UPL_CODE  complete=$OUT"
    PASS=$((PASS+1))
  else
    echo "  ✗ $FIX  upload=$UPL_CODE  complete=$OUT"
    FAIL=$((FAIL+1))
  fi
done
echo ""

# 2. Negative: no auth
echo "── 2. 负面: 无 auth 上传 → 401 ──"
NO_AUTH_CODE=$(curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/ma_anything" \
  -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
  --data-binary "@architecture/fixtures/social-media/matrix/single-portrait-half-4x5.jpg" \
  -o /dev/null -w "%{http_code}")
check "no-auth upload" "401" "$NO_AUTH_CODE"

# 3. Negative: bad token
BAD_AUTH_CODE=$(curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/ma_anything" \
  -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
  -H "Authorization: Bearer pxa_fake_token" \
  --data-binary "@architecture/fixtures/social-media/matrix/single-portrait-half-4x5.jpg" \
  -o /dev/null -w "%{http_code}")
check "bad-token upload" "401" "$BAD_AUTH_CODE"

# 4. Negative: cross-user upload
echo ""
echo "── 3. 负面: 跨用户上传 → 403 ──"
SESS2=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"e2e_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"e2e_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"e2e_$(uuid)\"},
  \"idempotencyKey\":\"e2e_anon_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
  \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"e2e_dev2_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN2=$(echo "$SESS2" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")

# Init from user 1, try upload as user 2
INIT_X=$(post_cmd "CreateMediaAsset" "{
  \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CreateMediaAsset\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaAsset\",\"id\":\"e2e_$(uuid)\"},
  \"idempotencyKey\":\"e2e_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
  \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"mediaType\":\"IMAGE\",\"originalStorageKey\":\"e2e_x_$(uuid).jpg\",\"mimeType\":\"image/jpeg\",\"width\":1200,\"height\":1500}
}" "$TOKEN")
ASSET_X=$(echo "$INIT_X" | python3 -c "import json,sys; print(json.load(sys.stdin)['aggregate']['id'])")

CROSS_CODE=$(curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/${ASSET_X}" \
  -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
  -H "Authorization: Bearer $TOKEN2" \
  --data-binary "@architecture/fixtures/social-media/matrix/single-portrait-half-4x5.jpg" \
  -o /dev/null -w "%{http_code}")
check "cross-user upload" "403" "$CROSS_CODE"

# 5. Negative: nonexistent asset
GHOST_CODE=$(curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/ma_does_not_exist" \
  -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary "@architecture/fixtures/social-media/matrix/single-portrait-half-4x5.jpg" \
  -o /dev/null -w "%{http_code}")
check "ghost asset upload" "404" "$GHOST_CODE"

# 6. Negative: HTML bytes declared as image
echo ""
echo "── 4. 负面: HTML 字节伪装 image → 415 ──"
echo "<html><script>alert(1)</script></html>" > /tmp/bad.html
HTML_INIT=$(post_cmd "CreateMediaAsset" "{
  \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CreateMediaAsset\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaAsset\",\"id\":\"e2e_$(uuid)\"},
  \"idempotencyKey\":\"e2e_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
  \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"mediaType\":\"IMAGE\",\"originalStorageKey\":\"e2e_html_$(uuid).jpg\",\"mimeType\":\"image/jpeg\",\"width\":100,\"height\":100}
}" "$TOKEN")
HTML_ASSET=$(echo "$HTML_INIT" | python3 -c "import json,sys; print(json.load(sys.stdin)['aggregate']['id'])")

HTML_CODE=$(curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/${HTML_ASSET}" \
  -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
  -H "Authorization: Bearer $TOKEN" --data-binary "@/tmp/bad.html" \
  -o /dev/null -w "%{http_code}")
check "html-bytes upload" "415" "$HTML_CODE"
rm -f /tmp/bad.html

# 7. Negative: bomb dimensions (claim 100000x100000, small actual)
echo ""
echo "── 5. 负面: 炸弹图 (100k×100k 宣称 + 4 万 字节) → quarantine 拒 ──"
BOMB_INIT=$(post_cmd "CreateMediaAsset" "{
  \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CreateMediaAsset\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaAsset\",\"id\":\"e2e_$(uuid)\"},
  \"idempotencyKey\":\"e2e_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
  \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"mediaType\":\"IMAGE\",\"originalStorageKey\":\"e2e_bomb_$(uuid).jpg\",\"mimeType\":\"image/jpeg\",\"width\":100000,\"height\":100000}
}" "$TOKEN")
BOMB_ASSET=$(echo "$BOMB_INIT" | python3 -c "import json,sys; print(json.load(sys.stdin)['aggregate']['id'])")

curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/${BOMB_ASSET}" \
  -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary "@architecture/fixtures/social-media/matrix/single-portrait-half-4x5.jpg" \
  -o /dev/null -w "  bomb upload: HTTP %{http_code}\n"

post_cmd "CompleteMediaUpload" "{
  \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"CompleteMediaUpload\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaAsset\",\"id\":\"$BOMB_ASSET\"},
  \"idempotencyKey\":\"e2e_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
  \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"mediaAssetId\":\"$BOMB_ASSET\",\"originalStorageKey\":\"e2e_bomb_$(uuid).jpg\",\"contentLengthBytes\":41190,\"contentSha256\":\"x\"}
}" "$TOKEN" > /dev/null

# Try process — should fail closed at quarantine
PROC=$(post_cmd "ProcessMediaAsset" "{
  \"commandId\":\"e2e_$(uuid)\",\"commandType\":\"ProcessMediaAsset\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"MediaAsset\",\"id\":\"$BOMB_ASSET\"},
  \"idempotencyKey\":\"e2e_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"e2e-v1\"},\"purpose\":\"e2e\",
  \"correlationId\":\"e2e_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"mediaAssetId\":\"$BOMB_ASSET\"}
}" "$TOKEN")
PROC_OUT=$(echo "$PROC" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('outcome','') or d.get('state',{}))" 2>/dev/null || echo "ERR")
echo "  bomb process: $PROC_OUT"
echo ""
echo "=== 风控策略测试完毕 ==="
