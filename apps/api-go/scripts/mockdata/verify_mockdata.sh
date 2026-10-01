#!/usr/bin/env bash
# verify_mockdata.sh — 读回验证：种进去的东西**真的能读出来**。
#
#   bash apps/api-go/scripts/mockdata/verify_mockdata.sh
#
# 为什么单独一个脚本：AGENTS.md / SOUL.md 的规矩 —— 交付前要问
# 「谁产生这个值」**和**「谁能读回它」。灌进去不等于看得到：
# 一行 READY 的媒体资产如果没有字节，客户端画黑圈；一条帖子如果
# author_id 指向不存在的账号，feed 里就是幽灵作者。
#
# 本脚本只读，不改任何数据。失败即 exit 1。

set -uo pipefail

DSN="${DATABASE_URL:-postgres://proxy:proxy@localhost:5432/proxy}"
API="${API_BASE:-http://127.0.0.1:4100}"

# psql 不一定在 PATH 上（Homebrew 装在 /opt/homebrew/opt/postgresql@15/bin）。
# 找不到就直接判失败 —— 否则下面的 `-c` 全部落进「查询失败」，看起来像库坏了。
if [ -n "${PSQL:-}" ]; then
  :
elif command -v psql >/dev/null 2>&1; then
  PSQL="$(command -v psql)"
elif [ -x /opt/homebrew/opt/postgresql@15/bin/psql ]; then
  PSQL=/opt/homebrew/opt/postgresql@15/bin/psql
else
  PSQL=""
fi

fail=0
skipped=0
note() { printf '%s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*" >&2; fail=1; }
ok()   { printf '  ok    %s\n' "$*"; }
skip() { printf '  skip  %s\n' "$*"; skipped=1; }

if [ -z "$PSQL" ]; then
  note "verify_mockdata: FAILURES PRESENT"
  printf '找不到 psql（试过 PATH 与 /opt/homebrew/opt/postgresql@15/bin）；' >&2
  printf '用 PSQL=/path/to/psql 指定。\n' >&2
  exit 2
fi
note "psql: $PSQL"

# ── 1. 计数 ─────────────────────────────────────────────────────────────────
note "── 计数 ──"
check_count() {
  local label="$1" sql="$2" want="$3"
  local got
  # capture 与 filter 拆开：命令失败要能被看见，不能和「查到 0 行」混成一样。
  if ! got=$("$PSQL" "$DSN" -At -c "$sql" 2>/dev/null); then
    bad "$label（查询失败）"
    return
  fi
  got="${got//[[:space:]]/}"
  if [ "$got" = "$want" ]; then ok "$label = $got"; else bad "$label = $got（期望 $want）"; fi
}

check_count "identity.user_accounts" "SELECT count(*) FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'" 100
check_count "identity.profiles"      "SELECT count(*) FROM identity.profiles WHERE user_account_id LIKE 'user_devseed_%'" 100
check_count "business.accounts"      "SELECT count(*) FROM business.accounts WHERE id LIKE 'biz_devseed_%'" 30
check_count "business.stores"        "SELECT count(*) FROM business.stores WHERE id LIKE 'store_devseed_%'" 30
check_count "business.store_photos"  "SELECT count(*) FROM business.store_photos WHERE id LIKE 'storephoto_devseed_%'" 40
check_count "localnet.posts"         "SELECT count(*) FROM localnet.posts WHERE id LIKE 'post_devseed_%'" 100
check_count "头像媒体资产"            "SELECT count(*) FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_%_portrait_v1'" 70
check_count "店面媒体资产"            "SELECT count(*) FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_venue_%'" 40

# ── 2. 引用完整性（全部应为 0）──────────────────────────────────────────────
note "── 引用完整性（应全为 0）──"
check_zero() {
  local label="$1" sql="$2"
  local got
  if ! got=$("$PSQL" "$DSN" -At -c "$sql" 2>/dev/null); then
    bad "$label（查询失败）"
    return
  fi
  got="${got//[[:space:]]/}"
  if [ "$got" = "0" ]; then ok "$label = 0"; else bad "$label = $got"; fi
}

check_zero "profile 指向不存在的账号" "SELECT count(*) FROM identity.profiles p LEFT JOIN identity.user_accounts u ON u.id=p.user_account_id WHERE p.user_account_id LIKE 'user_devseed_%' AND u.id IS NULL"
check_zero "帖子作者不存在"           "SELECT count(*) FROM localnet.posts p LEFT JOIN identity.user_accounts u ON u.id=p.author_id WHERE p.id LIKE 'post_devseed_%' AND u.id IS NULL"
check_zero "帖子作者名与 profile 不一致" "SELECT count(*) FROM localnet.posts p JOIN identity.profiles pr ON pr.user_account_id=p.author_id WHERE p.id LIKE 'post_devseed_%' AND p.author_display_name<>pr.name"
check_zero "头像指向不存在的资产"     "SELECT count(*) FROM identity.profiles p LEFT JOIN media.media_assets m ON m.media_asset_id=replace(p.avatar_path,'assets/','') WHERE p.user_account_id LIKE 'user_devseed_%' AND p.avatar_path<>'' AND m.media_asset_id IS NULL"
check_zero "照片指向不存在的资产"     "SELECT count(*) FROM business.store_photos sp LEFT JOIN media.media_assets m ON m.media_asset_id=sp.media_asset_id WHERE sp.id LIKE 'storephoto_devseed_%' AND m.media_asset_id IS NULL"
check_zero "store 的 business 不存在" "SELECT count(*) FROM business.stores s LEFT JOIN business.accounts a ON a.id=s.business_id WHERE s.id LIKE 'store_devseed_%' AND a.id IS NULL"
check_zero "每个用户恰好一条帖"       "SELECT count(*) FROM (SELECT user_account_id FROM identity.profiles WHERE user_account_id LIKE 'user_devseed_%' EXCEPT SELECT author_id FROM localnet.posts WHERE id LIKE 'post_devseed_%') x"

# ── 3. 媒体资产必须真有字节（MEDIA-FILE-001）────────────────────────────────
note "── 媒体资产字节（MEDIA-FILE-001：声称 READY 就必须有字节）──"
STORE="${MEDIA_STORE:-$HOME/Developer/kake-data/media_store}"
# capture 与 filter 拆开：查询失败必须报 FAIL。这里曾经写成
# `while read … done < <(psql …)` + `[ "$missing" = 0 ] && ok "110 个…"` ——
# psql 不在 PATH 时循环读到空、missing 恒为 0、还照打「110 个」的假绿。
if ! keys=$("$PSQL" "$DSN" -At -c "SELECT original_storage_key FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_%' ORDER BY 1" 2>/dev/null); then
  bad "媒体资产字节（查询失败）"
else
  total=0; missing=0
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    total=$((total + 1))
    if [ ! -s "$STORE/$key" ]; then
      bad "缺字节或为空：$key"
      missing=$((missing + 1))
    fi
  done <<<"$keys"
  if [ "$total" = "0" ]; then
    bad "没查到任何 devseed 资产（期望 110）—— 检查 \$MEDIA_STORE 与种子是否已灌"
  elif [ "$missing" = "0" ]; then
    ok "$total 个 devseed 资产的字节都在磁盘上（$STORE）"
  else
    bad "$missing/$total 个资产没有字节"
  fi
fi

# ── 4. 公开路由真的能取到（HTTP 200 + 非空 body）────────────────────────────
note "── 公开路由 /v1/media/thumb/<id> ──"
if ! curl -s -o /dev/null -m 5 "$API/healthz" && ! curl -s -o /dev/null -m 5 "$API/v1/media/thumb/x"; then
  skip "API $API 连不上（服务没起？）—— 只跑了库内检查，读回路由**未验证**"
elif ! ids=$("$PSQL" "$DSN" -At -c "SELECT media_asset_id FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_%' ORDER BY media_asset_id LIMIT 8" 2>/dev/null); then
  bad "抽样资产清单（查询失败）"
else
  served=0; tried=0
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    tried=$((tried + 1))
    code=$(curl -s -o /tmp/.verify_thumb.$$ -m 10 -w '%{http_code}' "$API/v1/media/thumb/$id" || echo 000)
    size=$(wc -c < /tmp/.verify_thumb.$$ 2>/dev/null | tr -d ' ')
    if [ "$code" = "200" ] && [ "${size:-0}" -gt 1000 ]; then
      served=$((served + 1))
    else
      bad "$id -> HTTP $code ${size:-0}B"
    fi
  done <<<"$ids"
  rm -f /tmp/.verify_thumb.$$
  if [ "$tried" = "0" ]; then
    bad "抽样 0 条 —— 没有可验证的资产"
  elif [ "$served" = "$tried" ]; then
    ok "$served/$tried 抽样资产返回 200 且字节数正常"
  fi
fi

note ""
if [ "$fail" != "0" ]; then
  note "verify_mockdata: FAILURES PRESENT" >&2
elif [ "$skipped" != "0" ]; then
  note "verify_mockdata: ALL OK（有 skip —— 上面标 skip 的那条读回路径没被验证）"
else
  note "verify_mockdata: ALL OK"
fi
exit "$fail"
