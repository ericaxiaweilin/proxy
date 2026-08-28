#!/usr/bin/env bash
# P0 audit fix: 11 fixture 走 Upload → CreatePost → ListFeedPosts 端到端
# 用途: 验 fixture asset 真正接入 feed, 不只是 media pipeline 单链路
set -uo pipefail
PORT=4202
cd /Users/thanhhuyennguyen/Desktop/kake

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
PASS=0; FAIL=0
trap 'echo ""; echo "PASS: $PASS  FAIL: $FAIL"' EXIT

echo "=== P0 audit fix: 11 fixture → Upload → CreatePost → ListFeedPosts ==="
echo ""

# Step 1: Session
SESS=$(post_cmd "CreateAnonymousSession" "{
  \"commandId\":\"p0_$(uuid)\",\"commandType\":\"CreateAnonymousSession\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"p0_$(uuid)\"},
  \"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"p0_$(uuid)\"},
  \"target\":{\"type\":\"Identity\",\"id\":\"p0_$(uuid)\"},
  \"idempotencyKey\":\"p0_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"p0-v1\"},\"purpose\":\"p0\",
  \"correlationId\":\"p0_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"deviceId\":\"p0_$(uuid)\",\"platform\":\"IOS\"}
}")
TOKEN=$(echo "$SESS" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['accessToken'])")
USER_ID=$(echo "$SESS" | python3 -c "import json,sys; print(json.load(sys.stdin)['auth']['userAccountId'])")
echo "user: $USER_ID"
echo ""

# Step 2: Upload 11 fixture, write asset IDs to tmp file
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"; echo ""; echo "PASS: $PASS  FAIL: $FAIL"' EXIT
echo "── Step 1: Upload 11 fixture (init + upload + complete) ──"
for FIX in single-portrait-half-4x5 single-portrait-full-9x16 single-landscape-half-4x3 \
  single-landscape-full-3x1 group-portrait-2-1x1 group-portrait-4-1x1 \
  landscape-skyline-16x9 object-product-4x5 object-flatlay-1x1 \
  ad-banner-text-heavy-16x9 screenshot-ui-9x19.5
do
  FIX_PATH="architecture/fixtures/social-media/matrix/${FIX}.jpg"
  W=$(sips -g pixelWidth "${FIX_PATH}" 2>/dev/null | awk '/pixelWidth/{print $2}')
  H=$(sips -g pixelHeight "${FIX_PATH}" 2>/dev/null | awk '/pixelHeight/{print $2}')
  KEY="${FIX}_p0_$(uuid).jpg"

  INIT=$(post_cmd "CreateMediaAsset" "{
    \"commandId\":\"p0_$(uuid)\",\"commandType\":\"CreateMediaAsset\",\"commandVersion\":1,
    \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
    \"target\":{\"type\":\"MediaAsset\",\"id\":\"p0_$(uuid)\"},
    \"idempotencyKey\":\"p0_$(uuid)\",\"authContext\":{},
    \"policySnapshot\":{\"version\":\"p0-v1\"},\"purpose\":\"p0\",
    \"correlationId\":\"p0_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
    \"payload\":{\"mediaType\":\"IMAGE\",\"originalStorageKey\":\"$KEY\",\"mimeType\":\"image/jpeg\",\"width\":$W,\"height\":$H}
  }" "$TOKEN")
  ASSET_ID=$(echo "$INIT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('aggregate',{}).get('id',''))")

  UPL_CODE=$(curl -sS -X PUT "http://127.0.0.1:${PORT}/v1/media/upload/${ASSET_ID}" \
    -H "Content-Type: application/octet-stream" -H "Upload-Offset: 0" \
    -H "Authorization: Bearer $TOKEN" --data-binary "@${FIX_PATH}" \
    -o /dev/null -w "%{http_code}")

  COMP=$(post_cmd "CompleteMediaUpload" "{
    \"commandId\":\"p0_$(uuid)\",\"commandType\":\"CompleteMediaUpload\",\"commandVersion\":1,
    \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
    \"target\":{\"type\":\"MediaAsset\",\"id\":\"$ASSET_ID\"},
    \"idempotencyKey\":\"p0_$(uuid)\",\"authContext\":{},
    \"policySnapshot\":{\"version\":\"p0-v1\"},\"purpose\":\"p0\",
    \"correlationId\":\"p0_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
    \"payload\":{\"mediaAssetId\":\"$ASSET_ID\",\"originalStorageKey\":\"$KEY\",\"contentLengthBytes\":$(stat -f%z "$FIX_PATH"),\"contentSha256\":\"p0\"}
  }" "$TOKEN")
  OUT=$(echo "$COMP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('outcome',''))")

  if [[ "$UPL_CODE" == "204" && "$OUT" == "ACCEPTED" ]]; then
    echo "  ✓ $FIX → $ASSET_ID"
    echo "$ASSET_ID" > "$TMPDIR/$FIX"
    PASS=$((PASS+1))
  else
    echo "  ✗ $FIX upload=$UPL_CODE complete=$OUT"
    FAIL=$((FAIL+1))
  fi
done
echo ""

# Step 3: CreatePost 4 个 post 用 fixture asset
echo "── Step 2: CreatePost 4 帖 (Linh/Mai/Huyen/Bonsaidon) 用 fixture asset ──"
declare -a POST_KEYS=("linh" "mai" "huyen" "bonsai")
declare -a POST_FIX=("single-portrait-half-4x5" "single-portrait-full-9x16" "group-portrait-2-1x1" "object-flatlay-1x1")
declare -a POST_SCENE=("PHOTO" "PHOTO" "COFFEE" "COFFEE")
declare -a POST_AUTHOR_TYPE=("AGENT" "AGENT" "USER" "MERCHANT")
declare -a POST_AUTHOR_NAME=("Linh" "Mai" "Huyen" "Bonsaidon")
declare -a POST_BODY=(
  "今天带第一次来河内的客人走了一条'少景点、多咖啡和拍照'的路线。"
  "明天下午 13:00-18:00 临时空出来。想轻松逛西湖、喝咖啡、拍点照片的话可以直接聊。"
  "周六下午有人想一起找家好看的咖啡店互相拍照吗？不收服务费。"
  "周末给客人准备了一桌盆景下午茶套餐，欢迎来 Bonsaidon 看实物。"
)

for i in 0 1 2 3; do
  KEY=${POST_KEYS[$i]}
  FIX=${POST_FIX[$i]}
  ASSET=$(cat "$TMPDIR/$FIX" 2>/dev/null || echo "")
  if [[ -z "$ASSET" ]]; then
    echo "  ✗ $KEY: asset not uploaded for $FIX"
    FAIL=$((FAIL+1))
    continue
  fi
  AUTHOR_TYPE=${POST_AUTHOR_TYPE[$i]}
  AUTHOR_NAME=${POST_AUTHOR_NAME[$i]}
  SCENE=${POST_SCENE[$i]}
  BODY=${POST_BODY[$i]}

  POST=$(post_cmd "CreatePost" "{
    \"commandId\":\"p0_$(uuid)\",\"commandType\":\"CreatePost\",\"commandVersion\":1,
    \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
    \"target\":{\"type\":\"Post\",\"id\":\"p0_post_$KEY\"},
    \"idempotencyKey\":\"p0_$(uuid)\",\"authContext\":{},
    \"policySnapshot\":{\"version\":\"p0-v1\"},\"purpose\":\"p0\",
    \"correlationId\":\"p0_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
    \"payload\":{
      \"authorType\":\"$AUTHOR_TYPE\",
      \"authorDisplayName\":\"$AUTHOR_NAME\",
      \"body\":\"$BODY\",
      \"mediaRefs\":[{\"mediaAssetId\":\"$ASSET\",\"sortOrder\":0}],
      \"visibility\":\"PUBLIC\",
      \"cityScope\":\"\",
      \"sceneType\":\"$SCENE\",
      \"contextRefs\":[{\"contextType\":\"SERVICE\",\"contextId\":\"p0-test\"}]
    }
  }" "$TOKEN")
  OUT=$(echo "$POST" | python3 -c "import json,sys; print(json.load(sys.stdin).get('outcome',''))" 2>/dev/null)
  ERR=$(echo "$POST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',{}).get('errorCode',''))" 2>/dev/null)
  POST_ID=$(echo "$POST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('aggregate',{}).get('id',''))" 2>/dev/null)
  if [[ "$OUT" == "ACCEPTED" && -n "$POST_ID" ]]; then
    echo "  ✓ $KEY ($AUTHOR_TYPE:$AUTHOR_NAME, $SCENE) → post=$POST_ID"
    echo "$POST_ID" > "$TMPDIR/post_$KEY"
    PASS=$((PASS+1))
  else
    echo "  ✗ $KEY: outcome=$OUT err=$ERR"
    FAIL=$((FAIL+1))
  fi
done
echo ""

# Step 4: ListFeedPosts 验证
echo "── Step 3: ListFeedPosts 验证 4 帖可见 ──"
LIST=$(post_cmd "ListFeedPosts" "{
  \"commandId\":\"p0_$(uuid)\",\"commandType\":\"ListFeedPosts\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"Feed\",\"id\":\"local\"},
  \"idempotencyKey\":\"p0_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"p0-v1\"},\"purpose\":\"p0\",
  \"correlationId\":\"p0_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{}
}")
echo "$LIST" > "$TMPDIR/feed.json"
FEED_COUNT=$(python3 -c "
import json
d = json.load(open('$TMPDIR/feed.json'))
op = d.get('operationRef','{}')
if isinstance(op, str):
    op = json.loads(op)
print(len(op.get('posts',[])))
" 2>/dev/null || echo "0")
echo "  feed 包含 $FEED_COUNT 帖"

if [[ "$FEED_COUNT" -ge 4 ]]; then
  echo "  ✓ feed ≥ 4 帖"
  PASS=$((PASS+1))
  for KEY in "${POST_KEYS[@]}"; do
    PID=$(cat "$TMPDIR/post_$KEY" 2>/dev/null)
    if [[ -n "$PID" ]]; then
      FOUND=$(python3 -c "
import json
d = json.load(open('$TMPDIR/feed.json'))
op = d.get('operationRef','{}')
if isinstance(op, str):
    op = json.loads(op)
posts = op.get('posts',[])
print('YES' if any(p.get('postId','')=='$PID' for p in posts) else 'NO')
" 2>/dev/null)
      if [[ "$FOUND" == "YES" ]]; then
        echo "  ✓ $KEY post $PID 在 feed"
        PASS=$((PASS+1))
      else
        echo "  ✗ $KEY post $PID 不在 feed"
        FAIL=$((FAIL+1))
      fi
    fi
  done
else
  echo "  ✗ feed 只 $FEED_COUNT 帖, 期望 ≥4"
  FAIL=$((FAIL+1))
fi
echo ""

# Step 5: viewingCity 过滤
echo "── Step 4: viewingCity=胡志明市 过滤 (R15.14 tripwire: empty cityScope 仍可见) ──"
LIST_HCMC=$(post_cmd "ListFeedPosts" "{
  \"commandId\":\"p0_$(uuid)\",\"commandType\":\"ListFeedPosts\",\"commandVersion\":1,
  \"actor\":{\"type\":\"USER\",\"id\":\"$USER_ID\"},\"principal\":{\"type\":\"INDIVIDUAL\",\"id\":\"$USER_ID\"},
  \"target\":{\"type\":\"Feed\",\"id\":\"local\"},
  \"idempotencyKey\":\"p0_$(uuid)\",\"authContext\":{},
  \"policySnapshot\":{\"version\":\"p0-v1\"},\"purpose\":\"p0\",
  \"correlationId\":\"p0_$(uuid)\",\"requestedAt\":\"2026-08-28T00:00:00Z\",
  \"payload\":{\"viewingCity\":\"胡志明市\"}
}")
HCMC_COUNT=$(echo "$LIST_HCMC" | python3 -c "
import json, sys
d = json.load(sys.stdin)
op = d.get('operationRef','{}')
if isinstance(op, str):
    op = json.loads(op)
print(len(op.get('posts',[])))
" 2>/dev/null || echo "0")
echo "  viewingCity=胡志明市 → $HCMC_COUNT 帖"
if [[ "$HCMC_COUNT" -ge 4 ]]; then
  echo "  ✓ empty cityScope fixture post 仍过 HCMC 过滤 (R15.14 tripwire 工作)"
  PASS=$((PASS+1))
else
  echo "  ✗ HCMC 过滤下 $HCMC_COUNT 帖, 期望 ≥4"
  FAIL=$((FAIL+1))
fi
echo ""

echo "── Step 5: SceneType 验证 (R15.15 P1: listFeed 走 per-(city,sceneType) cache) ──"
echo "  4 个 post 场景:"
python3 -c "
import json
d = json.load(open('$TMPDIR/feed.json'))
op = d.get('operationRef','{}')
if isinstance(op, str):
    op = json.loads(op)
posts = op.get('posts',[])
for p in posts:
    if 'p0_post_' in p.get('postId',''):
        media = p.get('mediaRefs', [])
        print(f'    - {p[\"postId\"]} authorType={p.get(\"authorType\",\"\")} sceneType={p.get(\"sceneType\",\"\")} media={len(media)} refs')
" 2>/dev/null

echo ""
echo "=== P0 audit fix 完成 ==="
