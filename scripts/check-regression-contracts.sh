#!/bin/bash
# Durable tripwires for production bugs that have already escaped once.
# A regression is closed only when its named test remains present and passes.

set -u
cd "$(dirname "$0")/.."

echo "  regression contracts: running escaped-bug tripwires..."

require_test() {
  local bug_id="$1"
  local package="$2"
  local test_name="$3"
  local test_file="$4"

  if ! grep -q "func ${test_name}(" "$test_file"; then
    echo "  FAIL [$bug_id]: required test $test_name is missing from $test_file" >&2
    return 1
  fi
  go -C apps/api-go test -count=1 -run "^${test_name}$" "$package" || return $?
  echo "    $bug_id: PASS ($test_name)"
}

# AUTH-OTP-001: EMAIL/SMS delivery silently depended on an unwired global
# recipient lookup. The address must travel service -> provider -> transport.
require_test "AUTH-OTP-001" "./internal/identity" \
  "TestRequestLoginChallengeDeliversEmailPastLookup" \
  "apps/api-go/internal/identity/otp_delivery_tripwire_test.go" || exit $?
require_test "AUTH-OTP-001" "./internal/identity" \
  "TestRequestLoginChallengeDeliversSMSToUpstream" \
  "apps/api-go/internal/identity/otp_delivery_tripwire_test.go" || exit $?

require_test "AUTH-EMAIL-LENGTH-001" "./internal/identity" \
  "TestPasswordlessEmailLengthBoundaryIsSharedByRegisterAndLogin" \
  "apps/api-go/internal/identity/service_test.go" || exit $?

# AUTH-SESSION-001: revoked sessions must delete their refresh tokens.
require_test "AUTH-SESSION-001" "./internal/identity" \
  "TestRevokeSessionDeletesTokens" \
  "apps/api-go/internal/identity/service_test.go" || exit $?

if ! grep -q 'UI-PROFILE-001' apps/mobile/src/surfaces/profile-tabs-model.test.ts ||
   ! grep -q 'UI-PROFILE-002' apps/mobile/src/surfaces/profile-tabs-model.test.ts; then
  echo "  FAIL: profile regression IDs or their focused test file are missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/surfaces/profile-tabs-model.test.ts || exit $?
echo "    UI-PROFILE-001/UI-PROFILE-002: PASS"

if ! grep -q 'AUTH-DOB-FORMAT-001' apps/mobile/src/date-of-birth-input.test.ts ||
   ! grep -q 'formatDateOfBirthInput(value)' apps/mobile/src/native-app.tsx; then
  echo "  FAIL [AUTH-DOB-FORMAT-001]: registration date auto-formatting or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/date-of-birth-input.test.ts || exit $?
echo "    AUTH-DOB-FORMAT-001: PASS (year/month/day separators + deletion)"

# AUTH-DOB-BOUNDS-001: 出生日期的月份/日期边界必须**自己判**，不能交给 Date。
# 报障原文：注册页输入 1999-99-99 判通过并发了验证码。根因是越界 ISO 串在不同
# JS 引擎上结果不一致（Node/V8 判 Invalid Date，真机 Hermes 滚月成合法日期），
# 所以边界判定不能依赖 Date。两处（注册页 gate / login-client）必须同源。
#
# 正向钉必须**先剥注释再 grep**：本文件的注释里就写着 1999-99-99 / 1999-02-31
# 这些例子，不剥的话把实现整段删掉、注释留着，钉照样 PASS。
auth_dob_bounds_code=$(grep -vE '^[[:space:]]*(//|\{/\*)' apps/mobile/src/date-of-birth-input.ts)
if ! printf '%s\n' "$auth_dob_bounds_code" | grep -qF 'month < 1 || month > 12' ||
   ! printf '%s\n' "$auth_dob_bounds_code" | grep -qF 'day < 1 || day > 31' ||
   ! printf '%s\n' "$auth_dob_bounds_code" | grep -qF 'parseDateOfBirthParts'; then
  echo "  FAIL [AUTH-DOB-BOUNDS-001]: 出生日期的月份/日期边界判定不见了 ——" >&2
  echo "        月 1-12、日 1-31 必须自己判（再用 UTC 回读确认这一天存在），" >&2
  echo "        不能只靠 new Date()：越界 ISO 串在不同 JS 引擎上行为不一致。" >&2
  exit 1
fi
if ! grep -qF 'parseDateOfBirthParts' apps/mobile/src/login-client.ts; then
  echo "  FAIL [AUTH-DOB-BOUNDS-001]: login-client 又自己写了一份出生日期判定 ——" >&2
  echo "        它必须跟注册页共用 parseDateOfBirthParts，否则一处拦一处放。" >&2
  exit 1
fi
echo "    AUTH-DOB-BOUNDS-001: PASS (month/day bounds judged without relying on Date; both gates share one parser)"
if ! grep -q 'FEED-OWN-001' apps/mobile/src/feed-author.test.ts ||
   ! grep -q 'resolveAuthorDisplayName' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-OWN-001]: viewer-relative author label or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/feed-author.test.ts src/composer-publish.test.ts || exit $?
echo "    FEED-OWN-001: PASS (own posts labeled per viewer, no stored 你)"
if ! grep -q 'PROFILE-READ-001' apps/mobile/src/profile-identity.test.ts ||
   ! grep -q 'profileKeyFor' apps/mobile/src/profile-store.ts; then
  echo "  FAIL [PROFILE-READ-001]: per-account profile hydration or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/profile-identity.test.ts src/profile-store.test.ts || exit $?
echo "    PROFILE-READ-001: PASS (fresh accounts derive identity, profiles isolated per account)"
require_test "PROFILE-READ-001" "./internal/identity" \
  "TestVerifyChallengeProvisionsInitialProfile" \
  "apps/api-go/internal/identity/service_test.go" || exit $?
require_test "PROFILE-READ-001" "./internal/localnet" \
  "TestCreatePostResolvesUserDisplayNameFromProfile" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "PROFILE-READ-001" "./internal/socialspace" \
  "TestCreateStatusResolvesDisplayNameFromProfile" \
  "apps/api-go/internal/socialspace/service_test.go" || exit $?
require_test "PROFILE-READ-001" "./internal/marketplace" \
  "TestPublishOpportunityResolvesOwnerFromProfile" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "PROFILE-READ-001" "./internal/platform/postgres" \
  "TestProfileDisplayBackfillClearsLegacyLabels" \
  "apps/api-go/internal/platform/postgres/profile_display_backfill_test.go" || exit $?
if ! grep -q 'PROFILE-READ-001' packages/contracts/src/market-opportunity.test.ts; then
  echo "  FAIL [PROFILE-READ-001]: empty-owner contract test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/contracts test --run src/market-opportunity.test.ts || exit $?
echo "    PROFILE-READ-001: PASS (empty PERSON owner parses, list stays intact)"
require_test "AUTH-LOGIN-HINT-001" "./internal/identity" \
  "TestLookupPasswordlessIdentityHintsUnregistered" \
  "apps/api-go/internal/identity/service_test.go" || exit $?
if ! grep -q 'AUTH-LOGIN-HINT-001' apps/mobile/src/login-client.test.ts ||
   ! grep -q 'lookupPasswordlessIdentity' apps/mobile/src/native-app.tsx; then
  echo "  FAIL [AUTH-LOGIN-HINT-001]: login existence probe or its wiring is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/login-client.test.ts || exit $?
echo "    AUTH-LOGIN-HINT-001: PASS (login hints unregistered instead of silent registration)"
node scripts/check-media-pipeline.mjs || exit $?
if ! grep -q 'MEDIA-PIPELINE-001' apps/mobile/src/media/asset-sources.test.ts ||
   ! grep -q 'MEDIA-PIPELINE-001' apps/mobile/src/media/author-avatar.test.ts; then
  echo "  FAIL [MEDIA-PIPELINE-001]: unified media pipeline tests are missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/media/asset-sources.test.ts src/media/author-avatar.test.ts || exit $?
echo "    MEDIA-PIPELINE-001: PASS (unified asset resolution + author avatars, feed on pipeline)"

# AVATAR-OTHER-HUMAN-002 (2026-09-21): 真实账号的服务端头像。
#
# 这条钉子的由来是一个**已经逃到真机**的 bug：动态页里「非本人、非 AI」的作者
# 一律画首字黑圈。本地库实测 69 条 PUBLISHED 里 46 条（67%）如此，其中 23 条的
# 作者在服务端**真有** avatar_path。用户原话：「怎么头像还特意保护成无头像
# 还是程序架构缺陷」。
#
# 为什么上面 MEDIA-PIPELINE-001 那条钉抓不到它：那条钉跑的两个测试文件里，
# author-avatar.test.ts 的旧断言 `falls back to initials for users without photo
# assets` 用 user_b 断言首字 —— 它把 bug 当成了**正确行为**，证明的只是「没有
# 数据源时首字」，从没覆盖「有数据源时能不能出图」。
#
# 为什么这里不再跑一次 vitest：上面第 131 行已经跑过这两个文件，重复跑只是浪费
# 门禁时间。这里负责的是**接线**，而接线是测试看不见的 —— 新测试都自己显式传
# humanAvatarsById，所以「feed.tsx 忘了传」它们照样全绿。形状和 LC-16
# 「调用点被删掉、测试依然全绿」一模一样。
if ! grep -q 'AVATAR-OTHER-HUMAN-002' apps/mobile/src/media/author-avatar.test.ts ||
   ! grep -q 'AVATAR-OTHER-HUMAN-002' apps/mobile/src/media/asset-sources.test.ts; then
  echo "  FAIL [AVATAR-OTHER-HUMAN-002]: the real-human avatar tests are missing" >&2
  exit 1
fi
# 1) 渲染点必须真的把这张表交给 resolveAuthorAvatar。
#    钉的是整段实参序列，不是 'humanAvatarsById' 子串 —— 只钉子串的话，
#    声明一个同名变量、或传个永远为空的 Map，都能让这条钉绿而动态照样全黑。
if ! grep -qF 'aiAccountsById, humanAvatarsById, displayName: name' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [AVATAR-OTHER-HUMAN-002]: feed.tsx no longer passes humanAvatarsById into resolveAuthorAvatar." >&2
  exit 1
fi
# 2) 这张表必须真的被填过：feed.tsx 要按 accountId 去查真实 profile。
#    少了这一条，把加载逻辑删掉、只留一个永远为空的 Map，第 1 条依然绿 ——
#    这正是「绿在空处」。
if ! grep -qF 'profileClient.getProfile(accountId)' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [AVATAR-OTHER-HUMAN-002]: feed.tsx no longer loads real author profiles." >&2
  echo "        humanAvatarsById would be permanently empty and every non-self," >&2
  echo "        non-AI author would go back to a black initial circle." >&2
  exit 1
fi
# 3) 反方向：'assets/<mediaId>' 是 identity.profiles.avatar_path 的真实存储格式
#    （migrations/039_profile.sql:18 的 CHECK）。解析器丢了这一支，上面两条
#    静态钉和所有测试都会绿，而真机上一张图都出不来。
if ! grep -qF 'path.startsWith("assets/")' apps/mobile/src/media/asset-sources.ts; then
  echo "  FAIL [AVATAR-OTHER-HUMAN-002]: avatarPathToInput no longer understands the server's assets/ format." >&2
  echo "        Every real profile's avatar_path would resolve to undefined." >&2
  exit 1
fi
echo "    AVATAR-OTHER-HUMAN-002: PASS (real author profiles reach the feed avatar pipeline)"
# 第二臂以前 grep 的是 merchant-me-r21.tsx（兼容 shim）里的组件名 —— 而那个名字
# 只出现在该文件的注释和一个死常量 `_tripwireMarker` 里。后果：把真链路
# （replacement 渲染 <MerchantCreatorRecommendations> → merchant-creator-
# recommendations.tsx 调 supply.querySuppliers）整段删掉，这条钉照样绿 ——
# 典型的"绿在空处"。渲染那一环已由 MERCHANT-ME-VISUAL-001 覆盖；这里补上
# **此前被 0 条钉引用的数据调用**（那个文件名在钉脚本里查无一处，
# querySuppliers 也只出现在注释里）。
if ! grep -q 'MERCHANT-CREATOR-001' apps/mobile/src/supply-client.test.ts ||
   ! grep -q 'supply.querySuppliers' apps/mobile/src/surfaces/merchant-creator-recommendations.tsx; then
  echo "  FAIL [MERCHANT-CREATOR-001]: merchant Creator 推荐的真实供给调用断了 ——" >&2
  echo "        merchant-creator-recommendations.tsx 必须真的调 supply.querySuppliers；" >&2
  echo "        只有组件名 / 注释 / 常量不算接线。" >&2
  exit 1
fi
# 反向钉：shim 里那个"让 grep 满意"的 marker 常量不许回来。
# 先剥掉 `//` 注释行再 grep —— 上面那段历史说明里就写着这个常量名，
# 不剥注释的话钉会被自己的文档喂红（这个仓里踩过同型的坑：
# 注释里重复一个 token，钉就永远红或者永远绿）。
if grep -vE '^[[:space:]]*//' apps/mobile/src/surfaces/merchant-me-r21.tsx | grep -q '_tripwireMarker'; then
  echo "  FAIL [MERCHANT-CREATOR-001]: shim 又用 marker 常量喂钉了 ——" >&2
  echo "        钉要钉真链路，不要钉一个只为 grep 存在的字符串。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/supply-client.test.ts || exit $?
require_test "MERCHANT-CREATOR-001" "./internal/supply" \
  "TestSupplyQueryReturnsOnlyEligible" \
  "apps/api-go/internal/supply/service_test.go" || exit $?

# MERCHANT-CREATOR-LIVE-002: boot seed must keep a live, photo-ready
# Creator pool so the merchant Creator rail (server-side
# MerchantCreatorRecommendations → supply.querySuppliers) is never empty.
require_test "MERCHANT-CREATOR-LIVE-002" "./cmd/api" \
  "TestMerchantCreatorLiveSeedHasFivePhotoReadyHanoiCreators" \
  "apps/api-go/cmd/api/merchant_creator_seed_test.go" || exit $?
require_test "MERCHANT-CREATOR-LIVE-002" "./cmd/api" \
  "TestMerchantCreatorAvailabilityRollsAcrossClientQuery" \
  "apps/api-go/cmd/api/merchant_creator_seed_test.go" || exit $?
echo "    MERCHANT-CREATOR-LIVE-002: PASS (live photo-ready seed + rolling availability window)"
if ! grep -q 'UI-SOCIAL-001' apps/mobile/src/social-settings-store.test.ts; then echo "  FAIL: UI-SOCIAL-001 missing" >&2; exit 1; fi
if ! grep -q 'UI-SOCIAL-002' apps/mobile/src/social-settings-client.test.ts; then echo "  FAIL: UI-SOCIAL-002 missing" >&2; exit 1; fi
if ! grep -q 'UI-SOCIAL-003' apps/mobile/src/social-settings-client.test.ts ||
   ! grep -q 'UI-SOCIAL-003' apps/api-go/internal/identity/account_preferences_test.go; then echo "  FAIL: UI-SOCIAL-003 migration/order guard missing" >&2; exit 1; fi
pnpm --filter @proxy/mobile test --run src/social-settings-store.test.ts src/social-settings-client.test.ts || exit $?
require_test "UI-SOCIAL-002" "./internal/identity" \
  "TestAccountPreferencesRoundTripUsesActorAsOwner" \
  "apps/api-go/internal/identity/account_preferences_test.go" || exit $?

# UI-SCENE-MAP-001: scene catalog, nearby recommendations and visit timeline
# must remain one server-backed pipeline. Never restore the mobile launch list.
if grep -q 'const SCENES' apps/mobile/src/surfaces/reality-scene-map.tsx || grep -q '47 - visited' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [UI-SCENE-MAP-001]: hard-coded scene catalog/count returned" >&2
  exit 1
fi
require_test "UI-SCENE-MAP-001" "./internal/realityscene" \
  "TestScenePipelineRanksNearbyAndRecordsVisitTime" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "UI-SCENE-MAP-001" "./internal/api" \
  "TestNearbyRealityScenesRequiresConsentAndUsesLocationRanking" \
  "apps/api-go/internal/api/reality_scene_test.go" || exit $?

# GEO-PRECISION-001: 定位精度只能有一套词表，且「够不够精确」必须能在代码里回答。
# 曾经同时存在四套互不兼容的精度枚举——Ch17 的 L0_AGGREGATE..L4_EXECUTION_PRECISE、
# Ch17 的 precision_level、R15 的 GeoPrecision、R8 的 CITY|COARSE_AREA——而没有任何
# 映射表，于是每个调用点只能各自猜，且猜得不一样。所有隐私门（R8 Gate E、INV-SEC-06、
# AC-MAP-32/33）都是关于精度的判断，地基裂了它们就都是空话。
# 现在唯一真源是 apps/api-go/internal/geo。映射表被刻意钉住：改 L1/L2 那一行
# 必须同时改 precision_test.go 里的 pin 与 precision.go 的 DECISION 注释，
# 不允许静默漂移。删掉 TestMappingTableIsPinned 或让 AtMost 反向升精度都会红。
require_test "GEO-PRECISION-001" "./internal/geo" \
  "TestMappingTableIsPinned" \
  "apps/api-go/internal/geo/precision_test.go" || exit $?
require_test "GEO-PRECISION-001" "./internal/geo" \
  "TestAtMostNeverEscalates" \
  "apps/api-go/internal/geo/precision_test.go" || exit $?
require_test "GEO-PRECISION-001" "./internal/geo" \
  "TestPrecisionVocabularyIsClosed" \
  "apps/api-go/internal/geo/precision_test.go" || exit $?
require_test "GEO-PRECISION-001" "./internal/geo" \
  "TestUnlockLadderMatchesChapter17" \
  "apps/api-go/internal/geo/precision_test.go" || exit $?
require_test "GEO-PRECISION-001" "./internal/supply" \
  "TestLocationPrecisionRedaction" \
  "apps/api-go/internal/supply/service_test.go" || exit $?
echo "    GEO-PRECISION-001: PASS (one precision vocabulary; mapping pinned; global context capped at CITY)"
# GEO-HONEST-001: 地图/场景域不许再有"没有来源、却长得像实测"的数字。
#
# 修之前：capacityFor() 用一张写死的 map 返回 61/39/74/81 当"容量"，
# LiveState.FreshUntil 又把这个编出来的数字声明成"5 分钟内有效"，
# humansFor() 给占位候选写上 SceneFit 96/92/88 与
# FitReason:"同类 Scene 有真实完成记录"。客户端把它们渲染成「容量 61%」
# 「数据有效至 14:32」「Scene fit 96%」—— 用户看到的是一个带保鲜期的
# 实时占用率，而它没有任何来源。
#
# 关键不是"数字是假的"，而是**假数字和真数据在接口上长得一模一样**。
# 所以修法是让"没有来源"在类型上可表达（字段省略 + source），而不是换个数字。
#
# 注意：仓库里**有**真实容量来源 —— business.scene_supply_snapshots
# (internal/business/operating_resolver.go，命令 UpsertSceneSupplySnapshot)。
# 也就是说这不是"没数据"，是"生产方存在、读取方绕过了它"。
# 接上它属于 GEO-SUPPLY-WIRE-001。
if grep -q 'func capacityFor' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [GEO-HONEST-001]: capacityFor is back — hand-written ints served as live venue capacity" >&2
  exit 1
fi
# 生产渲染路径里不许留调试输出（TEMP-DIAG-MAPDEAD-001 曾在这里挂 4 处）。
if grep -q 'console\.log' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [GEO-HONEST-001]: debug console logging is back in the map render path" >&2
  exit 1
fi
# 兜底坐标必须走具名常量：内联字面量和真实坐标在代码里长得一样，会被下一个人
# 当成实测数据。精确到 "latitude: " 前缀，避免误伤解释性注释。
if [ "$(grep -c 'latitude: 21\.036' apps/mobile/src/surfaces/reality-scene-map.tsx)" != "1" ] \
  || ! grep -q 'HANOI_CENTER_FALLBACK' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [GEO-HONEST-001]: Hanoi fallback coordinates are inlined again in reality-scene-map.tsx" >&2
  exit 1
fi
if [ "$(grep -c 'latitude: 21\.0285' apps/mobile/src/surfaces/market.tsx)" != "1" ] \
  || ! grep -q 'HANOI_VIEWPORT_FALLBACK' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [GEO-HONEST-001]: Hanoi viewport fallback is inlined again in market.tsx" >&2
  exit 1
fi
# 没有热度数据就不许自称"热门"。
if grep -q '"热门探索点"' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [GEO-HONEST-001]: market.tsx labels seeded markers as 热门 with no popularity source" >&2
  exit 1
fi
# 零调用方的死桩不许回来。
if grep -q 'function mapConfig' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [GEO-HONEST-001]: dead mapConfig() stub is back with zero callers" >&2
  exit 1
fi
require_test "GEO-HONEST-001" "./internal/realityscene" \
  "TestSceneDetailDeclaresFixtureProvenance" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
echo "    GEO-HONEST-001: PASS (伪造容量 / 占位候选 / 临时诊断 / 死桩 均未复现)"

# OPS-REAL-001（取代 OPS-TELEMETRY-001）：运营控制台 17 个 /v1/operator/* 端点
#   - 全部只给运营（会话 + PROXY_OPERATOR_PRINCIPALS + ANALYTICS scope）—— 以前任何人都能调；
#   - 没有数据源的页面只回 NOT_CONNECTED + 缺的模块，一个数字都不给 —— 以前是写死的 428K / 2.75M / 18.6M，
#     OPS-TELEMETRY-001 只让其中 3 个自报「占位」，其余 11 个假数字照样以真遥测的样子出现在控制台；
#   - 用户构成 / 行为信号是真实查询。
require_test "OPS-REAL-001" "./internal/api" "TestOperatorConsoleIsOperatorOnly" \
  "apps/api-go/internal/api/operator_console_test.go" || exit $?
require_test "OPS-REAL-001" "./internal/api" "TestOperatorConsoleNeverServesFixtureNumbers" \
  "apps/api-go/internal/api/operator_console_test.go" || exit $?
if grep -E 'mux\.HandleFunc\("/v1/operator/[a-z-]+"' apps/api-go/internal/api/server.go | grep -v '/v1/operator/legal' | grep -qvE 'operatorConsole(Method)?\('; then
  echo "  FAIL [OPS-REAL-001]: 有 /v1/operator/* 路由没走 operatorConsole —— 运营数据又能被任何人读到。" >&2
  exit 1
fi
if grep -rn 'fetch("/v1/operator' apps/market-intelligence-console/src >/dev/null; then
  echo "  FAIL [OPS-REAL-001]: 控制台页面绕过 opFetch 直接 fetch —— 不带运营会话，也不认 NOT_CONNECTED。" >&2
  exit 1
fi
# GRAVITY-001：引力状态（spec §6-§7 / §11 / §21）。规律的人在规律的时间点附近引力高；证据不足只学习；
# 久不发生降回只观察；AI / 平台账号不建模；ACTIVE_ORCHESTRATE 不会自动给（§12 / §13 未建）；引力页只给运营。
for t in TestRegularNoonChatterHasHighGravityBeforeNoonAndLowAtNight TestSparseOrStaleEvidenceDoesNotNudge TestNeverAutoActiveOrchestrate TestRecomputeSkipsNonHumansAndDowngradesPeopleWhoWentQuiet; do
  require_test "GRAVITY-001" "./internal/gravity" "$t" "apps/api-go/internal/gravity/gravity_test.go" || exit $?
done
require_test "GRAVITY-001" "./internal/api" "TestOperatorGravityIsOperatorOnlyAndLive" \
  "apps/api-go/internal/api/operator_console_test.go" || exit $?
# MATCH-RANK-001：撮合排序只用真实履约 / 需求方评价 / 经验 / 引力响应 / 预算适配；新人按先验、不编履约率；
# 响应只打破接近的平局、压不过可靠度；不读任何曝光信号（PRD R15.2 Popularity ≠ Qualification）；
# 满意度真的落库、服务者不能给自己打分。
for t in TestReliableWellRatedProviderOutranksCheaperUnreliableOne TestNewProviderGetsAPriorNotZeroNorPerfect TestResponsivenessOnlyBreaksNearTies; do
  require_test "MATCH-RANK-001" "./internal/matching" "$t" "apps/api-go/internal/matching/matching_test.go" || exit $?
done
require_test "MATCH-RANK-001" "./internal/fulfillment" "TestTraceableHumanOrder" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
# 真实供给路径必须用 supplier 算出的真实履约率（内存模式的演示种子池不在此列）。
if ! grep -qE 'FulfillmentRate: +sc\.FulfillmentRate' apps/api-go/internal/citycompanion/service.go ||
   grep -qE 'interaction_events|reactions|follows' apps/api-go/internal/matching/source.go; then
  echo "  FAIL [MATCH-RANK-001]: 城市同行又写死了履约率，或撮合排序读了曝光 / 点赞 / 粉丝信号。" >&2
  exit 1
fi
# MATCH-LIVE-001：「找人」页候选只来自后端（ListCityCompanionCandidates，已按 MATCH-RANK-001 排序），
# 演示数据不能再给任何候选人（以前写死 Linh 26 单 / Mai 12 单）；新人显示「暂无记录」而不是 0%。
pnpm --dir apps/mobile exec vitest run src/uiplan/fixtures.test.ts src/demand-client.test.ts || exit $?
if grep -qE 'agentId: "agent_(linh|mai|minh)"' apps/mobile/src/uiplan/fixtures.ts ||
   ! grep -qF 'listCityCompanionCandidates' apps/mobile/src/surfaces/fulfillment-workspace.tsx ||
   ! grep -qF 'hasTrackRecord === false' apps/mobile/src/components/registry.tsx; then
  echo "  FAIL [MATCH-LIVE-001]: 找人页又用演示候选 / 没接后端候选 / 新人被画成 0% 履约。" >&2
  exit 1
fi
# PROFILE-ENGAGEMENT-WIRE-001（P0）：MeSurface 漏传 engagement → 个人主页没有 ♡ 喜欢 / 赞数 / 评论，洞察全是 —。
# PROFILE-VIEWS-HEADER-001（P0）：个人主页「次浏览 · 最近 30 天」以前写死 —。
# AVATAR-FALLBACK-TINT-001（P0）：没头像不再是 #111 黑圆。
if ! awk '/<MeSurface/,/\/>/' apps/mobile/src/shell/app-shell.tsx | grep -qF 'engagement={engagement}' ||
   grep -qF '<Text selectable style={styles.personalStatValue}>—</Text> 次浏览' apps/mobile/src/surfaces/me.tsx ||
   grep -A3 '^  postAvatar: {' apps/mobile/src/surfaces/feed.tsx | grep -qF 'backgroundColor: "#111"' && ! grep -qF 'initialAvatarTint(post.authorId)' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [PROFILE-ENGAGEMENT-WIRE-001 / PROFILE-VIEWS-HEADER-001 / AVATAR-FALLBACK-TINT-001]: 个人主页又没有互动 / 浏览数写死 / 没头像又是黑圆。" >&2
  exit 1
fi
# AVATAR-AGENT-ALIAS-001 已撤回（2026-09-24）：agent_* 发的帖是集成测试种子，映射到本人会把测试帖显示成真人发的（P0）。
if grep -qF 'SetProfileAlias' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [OWN-NAME-001 / AVATAR-AGENT-ALIAS-001]: 又把服务者 id 映射成本人资料 —— 测试帖会冒充真人。" >&2
  exit 1
fi
# POST-PROFILE-GATE-001：真人发帖前必须有用户名 + 平台头像；生产必须接线（没接 = 门形同虚设）。
require_test "POST-PROFILE-GATE-001" "./internal/localnet" "TestCreatePostRequiresACompleteProfile" \
  "apps/api-go/internal/localnet/post_profile_gate_test.go" || exit $?
require_test "POST-PROFILE-GATE-001" "./internal/engagement" "TestReplyRequiresACompleteProfile" \
  "apps/api-go/internal/engagement/reply_profile_gate_test.go" || exit $?
if ! grep -qF 'localNetService.SetProfileCompleteness(' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'engagementService.SetProfileCompleteness(' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'PROFILE_INCOMPLETE' apps/mobile/src/command-error-message.ts; then
  echo "  FAIL [POST-PROFILE-GATE-001]: 发帖资料门没接线 / 客户端没有对应人话。" >&2
  exit 1
fi
# DATA-HYGIENE-001：集成测试不许冒用真人名字当作者、跑完必须清理自己建的帖子（以前 agent_linh / Linh 的种子帖留在开发库）。
for f in apps/api-go/internal/platform/postgres/engagement_pin_integration_test.go apps/api-go/internal/platform/postgres/engagement_replies_bookmarks_integration_test.go; do
  if grep -qF "'agent_linh'" "$f" || ! grep -qF 't.Cleanup' "$f"; then
    echo "  FAIL [DATA-HYGIENE-001]: $f 又用真人名字造种子帖 / 跑完不清理。" >&2
    exit 1
  fi
done
echo "    OPS-REAL-001: PASS (operator console is operator-only; no fixture numbers; population/behaviour live)"

require_test "UI-SOCIAL-002" "./internal/identity" \
  "TestAccountPreferencesRejectsAnonymousActorAndOversizedContact" \
  "apps/api-go/internal/identity/account_preferences_test.go" || exit $?
require_test "UI-SOCIAL-002" "./internal/identity" \
  "TestAccountPreferencesReportsMissingRecordWithoutInventingServerTruth" \
  "apps/api-go/internal/identity/account_preferences_test.go" || exit $?

# FACET-AUTH-001: facet 写路径（side-space POST/DELETE、config POST）曾经
# 全匿名可写 + UpdatedBy 客户端自填 + 无限流。写必须鉴权（401）、
# UpdatedBy 由 server 按 principal 回填、高频写 429。
#
# 状态（2026-09-04）：hardening + 命名测试已随 fix/facet-auth-001-restore
# 落地，tripwire 解锁（此前 44ebb66 因测试缺失暂时 if false 封存）。
require_test "FACET-AUTH-001" "./internal/api" \
  "TestFacetSideSpace_WriteRequiresAuth" \
  "apps/api-go/internal/api/facet_test.go" || exit $?
require_test "FACET-AUTH-001" "./internal/api" \
  "TestFacetConfig_PostStampsPrincipal" \
  "apps/api-go/internal/api/facet_test.go" || exit $?
require_test "FACET-AUTH-001" "./internal/api" \
  "TestFacetWrite_RateLimited" \
  "apps/api-go/internal/api/facet_test.go" || exit $?
if ! grep -q 'FACET-AUTH-001' apps/mobile/src/facet-client.test.ts; then
  echo "  FAIL [FACET-AUTH-001]: mobile authed-channel tests missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/facet-client.test.ts || exit $?
echo "    FACET-AUTH-001: PASS"

# AVATAR-001: 头像 hydration 用了不存在的 file.exists（恒 falsy）＋存
# 绝对 file:// URI（iOS 重装换 container UUID 即死），每次冷启动丢头像
# 只剩字母头。现只存文件名、按当前沙盒重锚＋目录 listing 校验，老绝对
# 路径后台回写自愈。
if ! grep -q 'AVATAR-001' apps/mobile/src/profile-store.test.ts; then
  echo "  FAIL [AVATAR-001]: avatar filename tests missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/profile-store.test.ts || exit $?
echo "    AVATAR-001: PASS"

# AVATAR-SAVE-001: 「个人主页头像保存不上」的守门。此前 AVATAR-001 只守
# profile-store 的文件名规范化（单元级），守不住 me.tsx 的整条保存链路——
# 而且最外层 catch 是静默 `catch { setProfileAvatarUri(selected.uri) }`：
# 相册原 URI 只在本进程有效，落盘失败时头像看着变了、离开页面即回字母头，
# 且没有任何报错，用户和测试都看不见。现在要求：
#   1) 落盘失败必须显式报出（不许静默吞错）；
#   2) 本地落盘仍是先于网络同步的一等公民（网络失败只提示同步失败，不回滚本地）。
if ! grep -q 'AVATAR-SAVE-001' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [AVATAR-SAVE-001]: avatar local-persist failure is not surfaced in me.tsx" >&2
  exit 1
fi
if ! grep -q 'AVATAR-SAVE-001' apps/mobile/src/profile-store.test.ts; then
  echo "  FAIL [AVATAR-SAVE-001]: avatar persist round-trip test missing" >&2
  exit 1
fi
if ! grep -q 'setProfileSaveError' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [AVATAR-SAVE-001]: avatar save error must reach the user" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/profile-store.test.ts || exit $?
echo "    AVATAR-SAVE-001: PASS"

# AVATAR-SAVE-002: 「换完头像被默认重置」——AVATAR-001 修的是本地文件名规范化
# （绝对沙盒 URI→文件名），但后来新增的服务端 hydration 路径又用等价方式把它抹了：
# remote.avatarPath 形如 assets/<mediaAssetId>，被直接 avatarFileName() 后写进本地
# 记录，覆盖掉 documentDirectory 里那份 avatar-<ts>.jpg 的指针 → 重启/离线回字母头。
# 守门：服务端合并必须走 mergeRemoteProfile（本地副本文件名优先），且必须有断言。
if ! grep -q 'AVATAR-SAVE-002' apps/mobile/src/profile-store.ts; then
  echo "  FAIL [AVATAR-SAVE-002]: remote profile merge must preserve the local avatar" >&2
  exit 1
fi
if ! grep -q 'mergeRemoteProfile' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [AVATAR-SAVE-002]: me.tsx must hydrate through mergeRemoteProfile" >&2
  exit 1
fi
if ! grep -q 'AVATAR-SAVE-002' apps/mobile/src/profile-store.test.ts; then
  echo "  FAIL [AVATAR-SAVE-002]: server round-trip avatar tests missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/profile-store.test.ts || exit $?
echo "    AVATAR-SAVE-002: PASS"

# AVATAR-DELIVER-001: 头像「存了但显示不出来/被重置」的服务端半边。
# 上传媒体默认 OWNER_ONLY，公开路由 /v1/media/thumb|play/{id} 要求
# APPROVED && PUBLIC（fail-closed），发帖/上架店铺会在命令事务内提权到 PUBLIC，
# 而 UpdateProfile 这条链路此前没做 → 头像 URL 恒 404，跨设备/新装直接丢头像。
# 守门：UpdateProfile 必须在落库前提权（owner=actor, PUBLIC），失败即拒绝命令；
# 且装配（SetProfileMediaAuthorizer）必须存在，否则能力被静默摘掉。
require_test "AVATAR-DELIVER-001" "./internal/identity" \
  "TestUpdateProfileAuthorizesAvatarForPublicDelivery" \
  "apps/api-go/internal/identity/profile_avatar_delivery_test.go" || exit $?
if ! grep -q 'AuthorizeForPost(ctx, \[\]string{mediaAssetID}' apps/api-go/internal/identity/service.go || \
   ! grep -q 'SetProfileMediaAuthorizer' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [AVATAR-DELIVER-001]: avatar media authorization is not wired" >&2
  exit 1
fi
echo "    AVATAR-DELIVER-001: PASS"

# IDENTITY-ID-001: mock 人物身份只允许有一处事实源（internal/mockidentity）。
# 症状回归：同一个显示名在首页/发布订单各显示一张头像、且无从判断是否同一个人 ——
# 根因就是姓名+头像被各 surface 反复硬编码（含 randomuser/unsplash 外链）。
# 守门三条：
#   1) Go 源码里除 mockidentity 外不得再出现账号/资产 id 前缀（防止再造一份映射）；
#   2) 服务端不得再出现 randomuser 外链头像；
#   3) 客户端首页 fixtures 不得再自带 unsplash 原型肖像。
if [ "$(grep -rl 'user_mockcreator_\|ma_creator_' apps/api-go --include='*.go' | grep -v 'internal/mockidentity/' | wc -l | tr -d ' ')" != "0" ]; then
  echo "  FAIL [IDENTITY-ID-001]: account/asset id literals must live only in internal/mockidentity" >&2
  grep -rl 'user_mockcreator_\|ma_creator_' apps/api-go --include='*.go' | grep -v 'internal/mockidentity/' >&2
  exit 1
fi
if grep -rq 'randomuser.me' apps/api-go --include='*.go'; then
  echo "  FAIL [IDENTITY-ID-001]: external avatar URL literal found in server source" >&2
  exit 1
fi
# HOME-RAIL-ACCOUNT-001（2026-09-23，用户报 P0）：首页 rail 上不许再出现 stock
# 外链头像。这条曾经是一条**放宽**（2026-09-18 批准：无账号的 fixture 人按 id
# 哈希落 5 张 unsplash「原型肖像」，理由是 mock 期不许灰头像）。2026-09-23 废止，
# 因为 ① 那 5 张里只有 1 张是人脸，其余是下龙湾风景 / 咖啡店室内 / 城市天际线 /
# 一盘炒河粉，正被当成「真人」头像渲染；② 放宽的前提（有人没账号）已经消失 ——
# rail 上 28 个人全部有账号和写真资产。缺图回落首字母，不许拿风景照冒充人脸。
if grep -q 'images.unsplash.com' apps/mobile/src/recommend-fixtures.ts; then
  echo "  FAIL [IDENTITY-ID-001]: 首页 rail 不许再有 stock 外链头像 ——" >&2
  echo "        rail 上每个人都必须是真实账号 + 写真资产（HOME-RAIL-ACCOUNT-001）；" >&2
  echo "        缺图时回落首字母，不许拿风景照/食物照冒充人脸。" >&2
  grep -n 'images.unsplash.com' apps/mobile/src/recommend-fixtures.ts >&2
  exit 1
fi
if ! grep -q 'withAccountPortraits' apps/mobile/src/recommend-fixtures.ts ||
   ! grep -q 'ACCOUNT_AVATAR_ASSET\[person.id\]' apps/mobile/src/recommend-fixtures.ts; then
  echo "  FAIL [IDENTITY-ID-001]: 头像必须来自账号写真资产 ——" >&2
  echo "        photoUri 只有一个来源：/v1/media/thumb/<该账号的 assetId>。" >&2
  exit 1
fi
echo "    IDENTITY-ID-001: PASS (single source of truth for mock identity, no stock fallback)"

# CREATOR-HANA-NAM-001: Hana / Nam 转正 —— facet 键、写真资产、identity 行、
# 首页映射四件齐，否则首页回落 stock / 关注落到幽灵 id。
require_test "CREATOR-HANA-NAM-001" "./internal/mockidentity" \
  "TestHanaNamKeysResolveDistinctIdentity" \
  "apps/api-go/internal/mockidentity/identity_test.go" || exit $?
if ! grep -q "'hana'), ('nam')" apps/api-go/scripts/seed_creator_portraits.sql ||
   ! grep -q 'u_hana: "ma_creator_hana_portrait_v1"' apps/mobile/src/recommend-fixtures.ts ||
   ! grep -q 'u_nam: "ma_creator_nam_portrait_v1"' apps/mobile/src/recommend-fixtures.ts; then
  echo "  FAIL [CREATOR-HANA-NAM-001]: Hana/Nam wiring incomplete ——" >&2
  echo "        seed、facet 键、首页映射缺一不可。" >&2
  exit 1
fi
echo "    CREATOR-HANA-NAM-001: PASS (Hana/Nam are real accounts with real faces)"

# HOME-RAIL-ACCOUNT-001（2026-09-23，用户报 P0）：首页「真人推荐」rail 上出现的
# 每一个人都必须有服务端账号。
#
# 此前 28 个人里只有 7 个有账号，其余 21 个点 + 只会得到「还没有账号，暂时加不了
# 好友」—— 卡片上却顶着「真人」徽标；ACTIVITY / TRIP / CREATOR / TRANSLATE /
# MEDICAL 五个场景一个真人都没有。上一版把「没账号」当成正常情况，只把错误说得
# 更礼貌；这一版改成「造 mock 人物可以，造没有账号的人不行」。
#
# 三处一起守（缺一条都能漂移回原样）：
#   ① 客户端：rail 上每个人都能解析到账号（vitest 逐个断言 accountless 为空）；
#   ② 服务端人物表与客户端 fixture 逐条一致（go test 直接读客户端文件）；
#   ③ 作者头像那第三条镜像表同步（漏一个人 = 首页有脸、动态里黑底首字）；
#   ④ 种子真的被接线（建了账号目录却不调用 = 还是没有账号）。
require_test "HOME-RAIL-ACCOUNT-001" "./internal/mockidentity" \
  "TestHomeRailFixturePeopleAllHaveServerAccounts" \
  "apps/api-go/internal/mockidentity/homerail_test.go" || exit $?
require_test "HOME-RAIL-ACCOUNT-001" "./internal/mockidentity" \
  "TestAuthorAvatarMirrorMatchesAllFacetKeys" \
  "apps/api-go/internal/mockidentity/homerail_test.go" || exit $?
require_test "HOME-RAIL-ACCOUNT-001" "./internal/mockidentity" \
  "TestHomeRailIdentitiesAreDistinct" \
  "apps/api-go/internal/mockidentity/homerail_test.go" || exit $?
if ! grep -q 'seedPostgresHomeRail(pool, mediaStoreDir)' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [HOME-RAIL-ACCOUNT-001]: 服务端 rail 账号种子没接线 ——" >&2
  echo "        mockidentity.HomeRailPeople 有表、seedPostgresHomeRail 有实现，" >&2
  echo "        但 main.go 不调用，等于 rail 上还是没有账号。" >&2
  exit 1
fi
if ! grep -q 'HOME-RAIL-ACCOUNT-001' apps/mobile/src/requester-home-friend-id.test.ts; then
  echo "  FAIL [HOME-RAIL-ACCOUNT-001]: 客户端逐个断言 rail 人物有账号的测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/requester-home-friend-id.test.ts || exit $?
echo "    HOME-RAIL-ACCOUNT-001: PASS (every rail person is a real account)"

# FRIEND-TARGET-EXISTS-001（2026-09-23）：目标账号不存在时，SendFriendRequest 必须
# 拒绝，而不是写一条永远没人能同意的 PENDING。
#
# 这是 HOME-RAIL-ACCOUNT-001 的服务端半边。客户端已经把 fixture id 解析成账号 id
# 再发，但客户端不是权限边界 —— 旧客户端 / curl 仍能直调 SendFriendRequest。
# 库里实测攒过 12 条 user_a/user_b 是 u_* 的死行（894f256 清掉的那批），
# 来源就是这里从来没校验过目标存在性：用户看到「申请已发送」，其实没有收件人。
#
# 判定必须用 identity.user_accounts 的**精确**存在性（GetUser → ErrUserNotFound），
# 不能用 AuthorNameResolver：后者要求 profile.name 非空，会把「账号存在但还没起名」
# 的人误判成不存在 —— 那会把正常申请也拒掉，比原 bug 更糟。这条 grep 就是钉这个。
require_test "FRIEND-TARGET-EXISTS-001" "./internal/relationship" \
  "TestFriendRequestToMissingAccountIsRejectedWithoutRow" \
  "apps/api-go/internal/relationship/friend_target_exists_test.go" || exit $?
require_test "FRIEND-TARGET-EXISTS-001" "./internal/relationship" \
  "TestMissingAccountAndAINonAcceptorHaveDistinctCodes" \
  "apps/api-go/internal/relationship/friend_target_exists_test.go" || exit $?
if ! grep -q 'SetTargetAccountExists' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [FRIEND-TARGET-EXISTS-001]: 生产没接线目标存在性判定 ——" >&2
  echo "        relationship 有窄函数、有检查，但 main.go 不注入，等于没修。" >&2
  exit 1
fi
if ! grep -q 'identityRepository.GetUser' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [FRIEND-TARGET-EXISTS-001]: 存在性判定必须走 identity.user_accounts 的 GetUser ——" >&2
  echo "        换成 AuthorNameResolver 会把没起名的真实账号误判为不存在。" >&2
  exit 1
fi
echo "    FRIEND-TARGET-EXISTS-001: PASS (requests to missing accounts are rejected)"

# IDENTITY-ID-001 附加：不得再按「显示名」匹配人。用户名可编辑、可重复，按名字找人在
# 改名或同名用户存在时会串人（requester-home 曾用 p.name.includes("linh") 选人）。
if grep -nE 'filteredPeople\.findIndex\(\(p\) => p\.name' apps/mobile/src/surfaces/requester-home.tsx >/dev/null 2>&1; then
  echo "  FAIL [IDENTITY-ID-001]: match people by identity id, never by display name" >&2
  grep -nE 'filteredPeople\.findIndex\(\(p\) => p\.name' apps/mobile/src/surfaces/requester-home.tsx >&2
  exit 1
fi

# HOME-AVATAR-FALLBACK-001: 首页三处真人头像（stories 圆头/选人窗/真人主页）
# 图挂了必须回落首字母，不许留白圈。旧写法 `p.photoUri ? <Image` 无 onError，
# thumb 404/断网时 expo-image 空渲染。删任一处的 onError 即红。
if grep -n 'p.photoUri ? <Image' apps/mobile/src/surfaces/requester-home.tsx >/dev/null 2>&1; then
  echo "  FAIL [HOME-AVATAR-FALLBACK-001]: home avatar must fall back to initials onError, never render blank" >&2
  grep -n 'p.photoUri ? <Image' apps/mobile/src/surfaces/requester-home.tsx >&2
  exit 1
fi
for probe in 'onError={() => markAvatarBroken(p.id)}' 'onError={() => markAvatarBroken(humanScenePreview.person.id)}'; do
  if ! grep -nF "$probe" apps/mobile/src/surfaces/requester-home.tsx >/dev/null 2>&1; then
    echo "  FAIL [HOME-AVATAR-FALLBACK-001]: missing $probe" >&2
    exit 1
  fi
done
echo "    HOME-AVATAR-FALLBACK-001: PASS (home avatars fall back to initials on error)"

# UI-HOME-DISCOVERY-001: 首页发现层级冻结。真人推荐必须在 AI 推荐之前；
# 两区都要显式标识身份。Owner 决议（旧）：一键加好友可在首页做（+ 徽标直调
# follow），发消息仍只能进主页后做。
#
# 2026-09-22 语义变更（AI-FRIEND-DEAD-PENDING-001，随在制工作落地）：
# AI 推荐卡上那个 + 号走的是真人同一套 SendFriendRequest，而平台 AI 永远不会
# accept（服务端另有 AI-FRIEND-REQUEST-001 守卫）—— 它是一条永远卡在 PENDING 的
# 死记录，UI 还诚实地说「好友申请已发送」。该位置改成「发消息」，直连已有的对话链；
# AI 主页那个「发消息」保留不动（见 PLACEHOLDER-010），所以「仍从主页进入」没被推翻。
# 钉同步从反向断言改成正向断言：必须是真对话入口，不是空按钮。
#
# ⚠️ 这次语义变更仍待 commander 确认。要退回只需两处：还原 requester-home.tsx
# 那个 onPress 回 + 徽标，并把 requester-home-discovery-contract.test.ts 里
# onMessageAI 的三条正向断言改回 `not.toContain("onMessageAI?.(account)")`。
pnpm --filter @proxy/mobile test --run src/requester-home-discovery-contract.test.ts || exit $?
echo "    UI-HOME-DISCOVERY-001: PASS"

# AI-ASSIST-001: 首页 5 小美推荐目录（公开、匿名可读）+ AI 标签 + 关注/
# 发消息。目录改名/换色必须服务端/种子/SVG 三处同步；AI 能力不得扩大
# 到接单/报名/收付款（仍由服务端门禁禁止，此处只锁目录形状）。
# Not-yet-enabled: the tests + the contracts module
# (`ai-assistants.ts` / `ai-assistants.test.ts`) are
# expected to land in a separate commit. Unblock when
# both `apps/api-go/internal/api/ai_assistants_test.go`
# and `packages/contracts/src/ai-assistants.test.ts`
# are present in the working tree.
if [ -f apps/api-go/internal/api/ai_assistants_test.go ] && [ -f packages/contracts/src/ai-assistants.test.ts ]; then
  require_test "AI-ASSIST-001" "./internal/api" \
    "TestListAIAssistantsFiveWithPhotos" \
    "apps/api-go/internal/api/ai_assistants_test.go" || exit $?
  require_test "AI-ASSIST-001" "./internal/api" \
    "TestListAIAssistantsMethodNotAllowed" \
    "apps/api-go/internal/api/ai_assistants_test.go" || exit $?
  if ! grep -q 'ListAIAssistantsPayloadSchema' packages/contracts/src/ai-assistants.test.ts; then
    echo "  FAIL [AI-ASSIST-001]: assistants contract tests missing" >&2
    exit 1
  fi
  pnpm --filter @proxy/contracts test --run src/ai-assistants.test.ts || exit $?
  echo "    AI-ASSIST-001: PASS"
else
  echo "    AI-ASSIST-001: SKIP (assistant tests not yet on disk; the tripwire is wrapped in a presence guard until the AI-ASSIST work lands)"
fi
# AI-ASSIST-001: 首页 5 小美推荐目录（公开、匿名可读）+ AI 标签 + 关注/
# 发消息。目录改名/换色必须服务端/种子/SVG 三处同步；AI 能力不得扩大
# 到接单/报名/收付款（仍由服务端门禁禁止，此处只锁目录形状）。
# 照片走服务端原文件直出（/v1/ai/personas/photo/{id}），客户端不复制
# 第二份；对外只叫“AI生成”，小美≠助手。
require_test "AI-ASSIST-001" "./internal/api" \
  "TestListAIAssistantsFiveWithPhotos" \
  "apps/api-go/internal/api/ai_assistants_test.go" || exit $?
require_test "AI-ASSIST-001" "./internal/api" \
  "TestListAIAssistantsMethodNotAllowed" \
  "apps/api-go/internal/api/ai_assistants_test.go" || exit $?
require_test "AI-ASSIST-001" "./internal/api" \
  "TestPersonaPhotoServesRealPNG" \
  "apps/api-go/internal/api/ai_assistants_test.go" || exit $?
if ! grep -q 'ListAIAssistantsPayloadSchema' packages/contracts/src/ai-assistants.test.ts; then
  echo "  FAIL [AI-ASSIST-001]: assistants contract tests missing" >&2
  exit 1
fi
pnpm --filter @proxy/contracts test --run src/ai-assistants.test.ts || exit $?
echo "    AI-ASSIST-001: PASS"

# AI-CONV-001: 小美主页发消息必须进消息模块。客户端曾传
# originType=AI_ASSISTANT，被 validOrigins 拒（INVALID_ORIGIN_TYPE），
# 用户点了等于没点。现在固定 PROFILE 来源；本测试锁死建会话成功 +
# 发起人 inbox 可见 + 首条消息在。
require_test "AI-CONV-001" "./internal/conversation" \
  "TestXiaomeiDMProfileOriginAppearsInInbox" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?

# AI-POSTS-001: 5 小美开屏帖（AI_NATIVE + 写真）。写真资产 APPROVED +
# PUBLIC + READY + AI_PERSONA provenance，帖子 Upsert 幂等；feed 卡
# AI 生成徽。测试垃圾（post_eng_*）曾淹过真机动态，测试自清理 + 门禁锁。
require_test "AI-POSTS-001" "./internal/media" \
  "TestSeedXiaomeiAssets" \
  "apps/api-go/internal/media/lc06_lc07_test.go" || exit $?
require_test "AI-POSTS-001" "./internal/localnet" \
  "TestSeedXiaomeiPosts" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?

# ACT-ATTEND-001: 考勤 cancel/checkin/noShow 曾经不验归属 + UpdateState=false
# 照样返成功（没报名也能自助 ATTENDED）。Join 必须落 participation 记录，
# 陌生人三件套一律 ACTIVITY_NOT_JOINED，已取消不能签到。
require_test "ACT-ATTEND-001" "./internal/activity" \
  "TestAttendanceRequiresParticipation" \
  "apps/api-go/internal/activity/service_test.go" || exit $?

# ACT-CONTRACT-001: 旧行缺新必填字段曾经让 mobile zod 炸（Toggle/Join
# 单条无 normalize、market lens 无兜底、Seed DO UPDATE 裸覆盖）。
# 现：单条 normalize + lens 默认 + Seed 回到 DO NOTHING（读路径 normalize
# 兜底旧行，不靠重启覆写）。
require_test "ACT-CONTRACT-001" "./internal/activity" \
  "TestStaleActivityNormalizedOnSingleResponses" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
require_test "ACT-CONTRACT-001" "./internal/marketplace" \
  "TestStaleOpportunityLensDefaultedOnList" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
if ! grep -q 'ON CONFLICT (id) DO NOTHING' apps/api-go/internal/platform/postgres/activity.go; then
  echo "  FAIL [ACT-CONTRACT-001]: activity Seed must stay DO NOTHING (no blind overwrite)" >&2
  exit 1
fi

# FRIEND-UPSERT-001: relationship.friendships（migration 040）曾缺
# (user_a, user_b) UNIQUE 约束，而 UpsertFriendship 用 ON CONFLICT
# (user_a, user_b)——PG 要求 arbiter 索引，缺失即 42P10：PG 模式下每次
# 好友写（发送/接受/屏蔽请求）全挂，8 个内存 service 测试全绿掩盖。
# Migration 076 补 UNIQUE 索引；lifecycle 测试钉死 upsert 全链路。
require_test "FRIEND-UPSERT-001" "./internal/platform/postgres" \
  "TestRelationshipPostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/relationship_integration_test.go" || exit $?
if ! grep -q 'uq_friendships_user_pair' apps/api-go/migrations/077_relationship_pair_unique.sql; then
  echo "  FAIL [FRIEND-UPSERT-001]: unique pair index migration must stay" >&2
  exit 1
fi

# FACET-KIND-ENUM-001: facet List fallback 曾经按 ID 硬编码 ken/linh/spa，
# 任何其他 PG 行（测试 seed 的 fct_* / 未来真实用户对象）recommendedKind
# 留零值 "" 违反 contracts 7 值枚举 → mobile Zod fail-closed 整页报错。
# fallback 现在把零值 signals 交 reasoner 按 relation 路由，任何行都产出
# 合法枚举值。TestList_FallbackKindAlwaysInEnum 逐 relation 钉死，
# TestList_FallbackOnMixedRows 钉混合行场景（真实事故现场）。
require_test "FACET-KIND-ENUM-001" "./internal/facet" \
  "TestList_FallbackKindAlwaysInEnum" \
  "apps/api-go/internal/facet/fallback_test.go" || exit $?
require_test "FACET-KIND-ENUM-001" "./internal/facet" \
  "TestList_FallbackOnMixedRows" \
  "apps/api-go/internal/facet/fallback_test.go" || exit $?

# TEST-HYGIENE-001: 集成测试连共享库时必须清掉自己造的行。
# 之前 mkt_op_pg_*/act_pg_*/fct_* 残留直接出现在真机市场/活动/FACET
# 列表，把真实种子淹了。测试自带 t.Cleanup；这里 pin 住它们存在且过。
require_test "TEST-HYGIENE-001" "./internal/platform/postgres" \
  "TestMarketplacePostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/marketplace_media_integration_test.go" || exit $?
require_test "TEST-HYGIENE-001" "./internal/platform/postgres" \
  "TestActivityPostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/activity_facet_integration_test.go" || exit $?
require_test "TEST-HYGIENE-001" "./internal/platform/postgres" \
  "TestFacetPostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/activity_facet_integration_test.go" || exit $?
# 第 4 个：这个 fixture 造 2 个媒体资产 + 4 条审核决定，而 media_review_decisions
# 是故意 append-only 的审计链，DELETE 自清会跟合规设计对撞。它改用 ctx 事务回滚，
# 并在回滚后**断言**共享库里没有残留（不是"我相信 t.Cleanup 写对了"）。
require_test "TEST-HYGIENE-001" "./internal/platform/postgres" \
  "TestMediaReviewDecisionPostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/marketplace_media_integration_test.go" || exit $?
# 第 5 个：payment 那条用**固定**的 providerEventId（字面量 evt_pay_pg_1 / _2）打共享库。
# payment.provider_events 是 webhook 去重表，而 confirmIntent 的第一步就是
# ProviderEventExists ⇒ 命中就返回 ALREADY_PROCESSED、**一行 ledger 都不写**。
# 第一次跑留下 evt_pay_pg_1（库里那行是 2026-09-03 的），之后每次跑都被它短路；
# 而 step 3 只断言 Outcome=="ACCEPTED"（短路也满足）⇒ 红在很后面的
# "ledger len must be 2, got 0"，完全指不到真因。临时集群每次全新，所以看不见。
require_test "TEST-HYGIENE-001" "./internal/platform/postgres" \
  "TestPaymentPostgresRoundTrip" \
  "apps/api-go/internal/platform/postgres/payment_integration_test.go" || exit $?

# PAYMENT-DEDUPE-FIXTURE-001（反向）：不许再把固定的 providerEventId 写回 fixture。
# 这是上面那条红的**唯一**根因，而正向钉（测试存在且过）挡不住它 —— 只有共享库脏了才红。
if grep -qE '"evt_pay_pg_[0-9]+"' \
    apps/api-go/internal/platform/postgres/payment_integration_test.go; then
  echo "  FAIL [PAYMENT-DEDUPE-FIXTURE-001]: payment fixture 又用了固定的 providerEventId 字面量。" >&2
  echo "        provider_events 是共享库里的去重表：固定 id 会让第二次跑被上一次的残留短路，" >&2
  echo "        Outcome 仍是 ACCEPTED 但 ledger 不写，于是红在 ledger len 断言上，指不到真因。" >&2
  echo "        事件 id 要按 run 派生（见该测试开头的 TEST-HYGIENE-001 注释）。" >&2
  exit 1
fi
if ! grep -q 'DELETE FROM payment.provider_events' \
    apps/api-go/internal/platform/postgres/payment_integration_test.go; then
  echo "  FAIL [PAYMENT-DEDUPE-FIXTURE-001]: cleanup 不再删 payment.provider_events。" >&2
  echo "        那是这条测试唯一会跨 run 残留的表（intents / ledger / payout_holds 本来就删）。" >&2
  exit 1
fi

# RLS-DRIFT-001: 库里出现过一类极难发现的漂移 —— 表被开了 ENABLE + FORCE
# ROW LEVEL SECURITY 却**零 policy**（scene.scenes / scene.invitations /
# contribution.contributions，与 065 修掉的 supply 两表同一类；032 则只给
# media.media_review_decisions 建了 SELECT policy、漏了 INSERT）。FORCE 下连表属主
# 也要过 policy ⇒ SELECT **静默返回 0 行**（"没数据"和"没权限"长得一样），
# 写入报 row-level security policy 错误，而 media/service.go 把审计写入做成软失败，
# 所以线上只表现为"审计链永远为空"。
#
# 这三个测试在临时集群里是**真空绿**的（testdb_test.go 用 `initdb -U proxy`，
# 那里的 proxy 是超级用户、绕过 RLS），所以它们断言的是**结构**（privilege +
# pg_policy），不是"插一行试试"。要在真实权限模型下验，得带 DATABASE_URL 跑。
require_test "RLS-DRIFT-001" "./internal/platform/postgres" \
  "TestNoTableHasUnusableRowLevelSecurity" \
  "apps/api-go/internal/platform/postgres/media_review_decisions_rls_test.go" || exit $?
require_test "RLS-DRIFT-001" "./internal/platform/postgres" \
  "TestMediaReviewDecisionAuditTrailIsAppendOnlyForAppRole" \
  "apps/api-go/internal/platform/postgres/media_review_decisions_rls_test.go" || exit $?
require_test "MEDIA-REVIEW-PARTITION-001" "./internal/platform/postgres" \
  "TestMediaReviewDecisionPartitionWindowCoversNow" \
  "apps/api-go/internal/platform/postgres/media_review_decisions_rls_test.go" || exit $?
# 反向：修复必须留在迁移集里，不能再靠手工 DDL（这两处漂移当年就是这么来的）。
# 042 声称建了 p2026_08..p2027_07 而实际一行没建，就是因为修法没有落在会执行的地方。
for migration in \
  111_rls_drift_off_scene_contribution \
  112_media_review_decisions_app_role_access \
  113_media_review_decisions_forward_partitions \
  114_twin_operate_actions; do
  if [ ! -f "apps/api-go/migrations/${migration}.sql" ]; then
    echo "  FAIL [RLS-DRIFT-001]: apps/api-go/migrations/${migration}.sql 不见了。" >&2
    echo "        它是把 RLS 漂移 / 审计表写路径 / 分区窗口收归迁移管理的那条迁移；" >&2
    echo "        删掉它等于把修复退回成「手工改过就算」的状态。" >&2
    exit 1
  fi
done

# ── TWIN-INSIGHT-002 ────────────────────────────────────────────────────────
# AI 分身「好友洞察」曾经是**纯虚构**：客户端 twin-insight-demo.ts 里躺着
# 6 个编造好友（Alex/Tom/Minh/Brandon/陈先生/王老板）和编造的分数、建议、
# 对话摘要；服务端 /v1/ai/twins/* **一个路由都没有** ⇒ 每次请求 404 ⇒
# 静默降级成那份假数据，屏幕上还挂一个演示角标，看起来像功能做完了。
# 用户 2026-09-22：「数据也不是真的」。
#
# 现在四个端点都接了真表（relationship.friendships + localnet.interaction_events
# + conversation.messages + engagement.reactions），假数据模块已删除。
#
# 这里钉三件事：① 端点真的存在并被门禁守着；② 假数据的入口不存在（反向钉）；
# ③ 写侧依赖没接时 fail-closed 503，绝不"点了按钮没留痕"。
require_test "TWIN-INSIGHT-002" "./internal/twininsight" \
  "TestFriendsWithNoFactsStillAppearWithZeros" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-002" "./internal/twininsight" \
  "TestScoreWeightsConversationAboveImpressions" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-002" "./internal/twininsight" \
  "TestRecordOperateRejectsNonFriendTarget" \
  "apps/api-go/internal/twininsight/operate_test.go" || exit $?
require_test "TWIN-INSIGHT-002" "./internal/twininsight" \
  "TestRefreshSummaryFailsClosedWhenModelStackUnconfigured" \
  "apps/api-go/internal/twininsight/summary_test.go" || exit $?
# HTTP 门禁：读端点**也要会话**（PRD 写的是匿名，这里刻意偏离 —— payload 是
# 第三方行为数据，匿名可读等于任何人拿一个 twinId 就能读别人好友的行为轨迹）。
require_test "TWIN-INSIGHT-002" "./internal/api" \
  "TestTwinInsightsReadRequiresSession" \
  "apps/api-go/internal/api/twin_insight_handlers_test.go" || exit $?
require_test "TWIN-INSIGHT-002" "./internal/api" \
  "TestTwinInsightsReadRejectsNonOwner" \
  "apps/api-go/internal/api/twin_insight_handlers_test.go" || exit $?
require_test "TWIN-INSIGHT-002" "./internal/api" \
  "TestTwinInsightOperateRecordsAuditableRow" \
  "apps/api-go/internal/api/twin_insight_handlers_test.go" || exit $?
require_test "TWIN-INSIGHT-002" "./internal/api" \
  "TestTwinInsightSummaryFailsClosedWhenModelStackUnwired" \
  "apps/api-go/internal/api/twin_insight_handlers_test.go" || exit $?

# 反向钉：**虚构兜底数据不许回来**。
# 为什么需要反向钉：正向的"能渲染洞察"在两种实现下都绿 —— 接真服务端绿，
# 接一份假数据也绿。只有钉住"假数据的入口不存在"才会真的失败。
if [ -f "apps/mobile/src/components/twin-insight-demo.ts" ]; then
  echo "  FAIL [TWIN-INSIGHT-002]: apps/mobile/src/components/twin-insight-demo.ts 又回来了。" >&2
  echo "        那是 6 个编造好友（Alex/Tom/Minh/Brandon/陈先生/王老板）+ 编造分数/建议，" >&2
  echo "        用户 2026-09-22 明确说「数据也不是真的」。洞察只许来自服务端真表。" >&2
  exit 1
fi
if grep -q 'DEMO_PAYLOAD\|twin-insight-demo' apps/mobile/src/components/twin-insight-section.tsx; then
  echo "  FAIL [TWIN-INSIGHT-002]: twin-insight-section.tsx 又在引用演示兜底数据。" >&2
  echo "        读不出来必须走错误态 + 重试，不许静默降级成假数据。" >&2
  exit 1
fi
# 服务端路由必须挂上（不挂 = 客户端 404 = 又一次静默降级）。
if ! grep -q '"/v1/ai/twins/"' apps/api-go/internal/api/server.go; then
  echo "  FAIL [TWIN-INSIGHT-002]: /v1/ai/twins/ 路由没挂在 server.go 上。" >&2
  echo "        客户端只会拿到 404，然后把兜底假数据显示出来。" >&2
  exit 1
fi

# ── TWIN-INSIGHT-TARGETS-001 ────────────────────────────────────────────────
# 目标集 = 好友 ∪ 有过互动的陌生人。之前只迭代 friends，facts 里聊过天 /
# 看过主页的陌生 actor 被直接丢掉 —— 明明刚说过话，洞察页却显示"还没有洞察"。
require_test "TWIN-INSIGHT-TARGETS-001" "./internal/twininsight" \
  "TestNonFriendChatterAppearsInInsights" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-TARGETS-001" "./internal/twininsight" \
  "TestNonFriendViewerAppearsInInsights" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-TARGETS-001" "./internal/twininsight" \
  "TestStrangerAppearingAsFriendAndActorIsListedOnce" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-TARGETS-001" "./internal/twininsight" \
  "TestStrangerDisplayNameResolvesOrFallsBackToNeutral" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?

# ── TWIN-INSIGHT-ENTITLEMENT-001 ────────────────────────────────────────────
# 洞察是卖小美合法时间的精准投流工具，只向实名创作者发放。
# 凭证 = 实名核验 VERIFIED 行（空有效期不算，见 889c1e6），三入口第一道闸。
require_test "TWIN-INSIGHT-ENTITLEMENT-001" "./internal/twininsight" \
  "TestListInsightsDeniedWithoutViewerGate" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-ENTITLEMENT-001" "./internal/twininsight" \
  "TestRecordOperateDeniedWithoutViewerGate" \
  "apps/api-go/internal/twininsight/operate_test.go" || exit $?
require_test "TWIN-INSIGHT-ENTITLEMENT-001" "./internal/platform/postgres" \
  "TestSellerRealNameVerifiedForAccount" \
  "apps/api-go/internal/platform/postgres/seller_identity_integration_test.go" || exit $?
require_test "TWIN-INSIGHT-ENTITLEMENT-001" "./internal/api" \
  "TestTwinInsightsListDeniedWithoutEntitlement" \
  "apps/api-go/internal/api/twin_insight_handlers_test.go" || exit $?
require_test "TWIN-INSIGHT-ENTITLEMENT-001" "./internal/api" \
  "TestTwinInsightOperateDeniedWithoutEntitlement" \
  "apps/api-go/internal/api/twin_insight_handlers_test.go" || exit $?
if ! grep -q 'SetViewerGate(newTwinInsightViewerGate(pool))' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [TWIN-INSIGHT-ENTITLEMENT-001]: 使用权门禁没接线 ——" >&2
  echo "        Service 有闸、main.go 不挂，等于没修。" >&2
  exit 1
fi

# ── TWIN-INSIGHT-AVATAR-001 ──────────────────────────────────────────────────
# 好友洞察头像恒空白：服务端 buildInsight 写死 AvatarURL: ""，客户端把相对
# 路径直接塞 <Image> 也拉不到。头像必须从 identity.profiles 解析并经
# resolveMediaUrl 拼 base；坏 URI 落回首字，不许留透明圆。
require_test "TWIN-INSIGHT-AVATAR-001" "./internal/twininsight" \
  "TestInsightAvatarURLComesFromAvatarSource" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-AVATAR-001" "./internal/twininsight" \
  "TestInsightAvatarURLStaysEmptyWithoutSource" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-AVATAR-001" "./internal/twininsight" \
  "TestWireAvatarURLOnlyEmitsDeliverableShapes" \
  "apps/api-go/internal/twininsight/insight_test.go" || exit $?
require_test "TWIN-INSIGHT-AVATAR-001" "./internal/identity" \
  "TestProfileRoundTripUsesActorAsOwner" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
if ! grep -q 'SetAvatarSource(authorNames.ResolveAuthorAvatarPath)' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [TWIN-INSIGHT-AVATAR-001]: 头像源没接线 —— Service 有闸、main.go 不挂，头像仍恒空。" >&2
  exit 1
fi
if ! grep -q 'TWIN-INSIGHT-AVATAR-001' apps/mobile/src/components/twin-insight-section.test.ts ||
   ! grep -q 'twinAvatarSource' apps/mobile/src/components/twin-avatar-source.ts ||
   ! grep -q 'twinAvatarSource' apps/mobile/src/components/twin-insight-card.tsx; then
  echo "  FAIL [TWIN-INSIGHT-AVATAR-001]: 客户端头像解析或它的回归测试丢了。" >&2
  exit 1
fi
if ! grep -q 'onError' apps/mobile/src/components/proxy-foundation.tsx; then
  echo "  FAIL [TWIN-INSIGHT-AVATAR-001]: ProxyAvatar 没有 onError 回退 —— 坏 URI 仍是空白圆。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/components/twin-insight-section.test.ts || exit $?
echo "    TWIN-INSIGHT-AVATAR-001: PASS (server avatarUrl + resolveMediaUrl + initial fallback)"

# AIBOUND-001: DismissMarketOpportunity 曾经无 aiboundary 落点（AI 可调），
# market 写曾经无 USER 主体检查（与 activity 不对称）。现 Dismiss 进 gate，
# Publish/Apply/Dismiss 必须 USER；PublishActivity 保留位仍 fail-closed。
require_test "AIBOUND-001" "./internal/marketplace" \
  "TestMarketDismissIsForbiddenForAIActor" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

# CHAT-ORDER-ATOMIC-001: opportunity confirmation and fulfillment order
# creation must not split, and owner identity must survive PostgreSQL JSON.
require_test "CHAT-ORDER-ATOMIC-001" "./internal/marketplace" \
  "TestConfirmMarketApplicationRollsBackWhenOrderMaterialisationFails" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "AIBOUND-001" "./internal/marketplace" \
  "TestMarketWritesRequireUserActor" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

# MERCHANT-PUBLISH-001: 商家发布曾经只能以个人名义（订单 Owner/OwnerType、
# 活动 Origin 硬编码 PERSON/USER）。现 client 传 merchantId → api 层验
# business 成员（OWNER/ADMIN）→ 注记进 AuthContext → 服务端只认注记盖章；
# 伪造/无成员 403，写不到 service。
require_test "MERCHANT-PUBLISH-001" "./internal/business" \
  "TestMerchantPublishIdentity" \
  "apps/api-go/internal/business/service_test.go" || exit $?
require_test "MERCHANT-PUBLISH-001" "./internal/api" \
  "TestMerchantPublishOpportunityStampsShop" \
  "apps/api-go/internal/api/merchant_identity_test.go" || exit $?
require_test "MERCHANT-PUBLISH-001" "./internal/api" \
  "TestMerchantPublishForgedMembershipForbidden" \
  "apps/api-go/internal/api/merchant_identity_test.go" || exit $?
require_test "MERCHANT-PUBLISH-001" "./internal/api" \
  "TestMerchantPublishActivityStampsMerchant" \
  "apps/api-go/internal/api/merchant_identity_test.go" || exit $?
require_test "MERCHANT-PUBLISH-001" "./internal/api" \
  "TestMerchantPublishWithoutMerchantStaysPersonal" \
  "apps/api-go/internal/api/merchant_identity_test.go" || exit $?
require_test "MERCHANT-PUBLISH-001" "./internal/marketplace" \
  "TestMerchantStampRequiresAnnotation" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "MERCHANT-PUBLISH-001" "./internal/activity" \
  "TestMerchantActivityStampRequiresAnnotation" \
  "apps/api-go/internal/activity/service_test.go" || exit $?

# AI-ACTOR-001: aiboundary — 三种 AI 主体 (PLATFORM_AI / USER_TWIN /
# USER_ASSISTANT) 都不得执行任何 Action 表中的动作; HUMAN 不被误拦。
# R16.x: 平台 "AI 不能成为活动主办方、不能接单、不能发布" 由这条闸
# 锁住。ActorKind / Action 枚举加新值时这条仍必过。
require_test "AI-ACTOR-001" "./internal/aiboundary" \
  "TestAIEconomicAndParticipationBoundary" \
  "apps/api-go/internal/aiboundary/policy_test.go" || exit $?

# ACT-PUBLISH-001: 原型中的发起活动必须落真实仓储，并保持活动免费、
# 到店消费分离；AI 不得成为发布主体。
require_test "ACT-PUBLISH-001" "./internal/activity" \
  "TestPublishActivityCreatesFreeUserActivity" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
require_test "ACT-PUBLISH-001" "./internal/activity" \
  "TestPublishActivityRejectsAIAndInvalidVenueBoundary" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
pnpm --dir apps/mobile exec vitest run src/activity-client.test.ts || exit $?
echo "    ACT-PUBLISH-001: PASS (mobile publish + offline write guard)"

# ACT-MY-ACTIVITIES-001: “我的活动” 物化路径。ListMyActivities
# 返回 actor-scoped created + joined 两个数组; 匿名 / 空 actor
# 必须被 server 拒绝 (R17.x). 防“我的活动”页面重新退回 hardcoded mock.
require_test "ACT-MY-ACTIVITIES-001" "./internal/activity" \
  "TestListMyActivitiesByActor" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
# ACT-MY-ACTIVITIES-002: PG ListByOwner / ListByParticipant
# 在真 PG 上跳. 防 “仅以内存仓储跳” 在生产出现 “我的活动” 空表.
require_test "ACT-MY-ACTIVITIES-002" "./internal/platform/postgres" \
  "TestActivityPostgresListByOwnerAndParticipant" \
  "apps/api-go/internal/platform/postgres/activity_facet_integration_test.go" || exit $?
pnpm --dir packages/contracts exec vitest run src/activity.test.ts || exit $?
echo "    ACT-MY-ACTIVITIES-001: PASS (mobile wire schema round-trip)"

# AI-PERSONA-PHOTO-001: 平台 AI 5 角色 (ai_001-ai_005) 冷启动
# 活动必须携带 aiPersonaPhoto 资产引用 (ai-personas/ai_00X.svg)。
# 防 “photo 字段从 seed 被丢掉” 造成 "看起来像真人" 的
# avatar 退回. path 在 apps/mobile/assets/ai-personas/ 下.
require_test "AI-PERSONA-PHOTO-001" "./internal/activity" \
  "TestPlatformAIPersonaPhotoRequiredOnColdStart" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
pnpm --dir packages/contracts exec vitest run src/activity.test.ts || exit $?
echo "    AI-PERSONA-PHOTO-001: PASS (mobile wire schema round-trip)"

# CHAT-PROXY-ACTIVITY-001: conversation sendProxyObject 必须
# 使用 server 真 activityId, 不允许 hardcoded "act_westlake"
# 等不存在的 ID. 防 "聊天发活动 ≠ 我的活动页有活动" 的两路径
# 不对齐. mobile test 拒绝任何隐性 fallback 到 hardcoded ID.
pnpm --dir apps/mobile exec vitest run src/conversation-client.test.ts || exit $?
echo "    CHAT-PROXY-ACTIVITY-001: PASS (real activityId round-trip)"

# PERF-001: ListConversationMessages 必须封顶（200 条，尾部保留，
# truncated 置位），防止无界历史压垮序列化与设备内存。
require_test "PERF-001" "./internal/conversation" \
  "TestListMessagesCapsHistoryAt200" \
  "apps/api-go/internal/conversation/history_cap_test.go" || exit $?

# CHAT-ORDER-MATERIALISATION-001: chat → order 派生. marketplace
# ConfirmMarketApplication 必须派生真 Order (server-unique ord_
# 前缀), 调用注入的 OrderCreator (production: fulfillment adapter)
# 让“我的订单”页能看到. 不再有 fake "order_" + applicationID
# 拼接. Idempotency: 重复 confirm 不创建第二 Order.
require_test "CHAT-ORDER-MATERIALISATION-001" "./internal/marketplace" \
  "TestConfirmMarketApplicationMaterialisesRealOrder" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

# OPPORTUNITY-DEAL-001: 真人申请 -> 发布者选择 -> 被选真人确认；候选列表
# 来自仓储，不允许把平台 AI 或硬编码人物当作可直接购买的库存。
require_test "OPPORTUNITY-DEAL-001" "./internal/marketplace" \
  "TestOpportunityApplicationSelectionAndBilateralConfirmation" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "OPPORTUNITY-DEAL-001" "./internal/marketplace" \
  "TestOpportunitySelectionAndConfirmationAreForbiddenForAIActors" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "OPPORTUNITY-DEAL-001" "./internal/platform/postgres" \
  "TestMarketplacePostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/marketplace_media_integration_test.go" || exit $?
if ! grep -q 'marketplace.listApplications(opportunity.id)' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [OPPORTUNITY-DEAL-001]: owner candidate workbench is not repository-backed" >&2
  exit 1
fi
echo "    OPPORTUNITY-DEAL-001: PASS (real applications + bilateral confirmation)"
require_test "AI-ACTOR-001" "./internal/aiboundary" \
  "TestHumanActionsAreOpen" \
  "apps/api-go/internal/aiboundary/policy_test.go" || exit $?
require_test "AI-ACTOR-001" "./internal/aiboundary" \
  "TestFromCommandIdentityClassification" \
  "apps/api-go/internal/aiboundary/policy_test.go" || exit $?

# AI-ACTOR-002: service 闸 — marketplace service 必须拒绝 PLATFORM_AI
# / USER_TWIN / USER_ASSISTANT 发出的 PublishMarketOpportunity 与
# ApplyToMarketOpportunity; activity service 必须拒绝这三个主体发出的
# ToggleActivityInterest / JoinActivity / CancelActivity / CheckinActivity
# / MarkNoShow。该 tripwire 防止未来重构不知情地拆除 aiboundary 闸。
require_test "AI-ACTOR-002" "./internal/marketplace" \
  "TestMarketApplyIsForbiddenForAIActor" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "AI-ACTOR-002" "./internal/marketplace" \
  "TestMarketPublishIsForbiddenForAIActor" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "AI-ACTOR-002" "./internal/activity" \
  "TestActivityActionsAreForbiddenForAIActor" \
  "apps/api-go/internal/activity/service_test.go" || exit $?

# MONEYFLOW-001: 服务端 MoneyFlow/PriceLabel normalize — 机会的金额必须
# 带资金方向; 价格与 MoneyFlow 一致性 (FREE/TBD 不允许非零 Price);
# 纯函数 normalizeOpportunityMoney 必须公开合法 MoneyFlow 输入。
require_test "MONEYFLOW-001" "./internal/marketplace" \
  "TestOpportunityMoneyFlowNormalize" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "MONEYFLOW-001" "./internal/marketplace" \
  "TestMarketPublishRejectsFreeWithNonZeroPrice" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

# MONEYFLOW-002: 冷启动 5 条活动必须 FREE + aiStatus=AI_GENERATED +
# aiActorKind=PLATFORM_AI; 平台不能借冷启动活动赚钱、不能让 AI 看似
# “主办方”。
require_test "MONEYFLOW-002" "./internal/activity" \
  "TestColdStartActivitiesArePlatformAIGeneratedAndFree" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
require_test "MONEYFLOW-002" "./internal/activity" \
  "TestNormalizeActivityMoneyAndAIDefaults" \
  "apps/api-go/internal/activity/service_test.go" || exit $?

# MONEYFLOW-003: PG JSONB round-trip 不能丢 MoneyFlow / PriceLabel /
# aiStatus / aiActorKind / origin='TEST' 过滤。这是真 PostgreSQL
# 集成 tripwire (apps/api-go/internal/platform/postgres/...) — in-memory
# mock 不复现 JSONB 列序列化边缘问题。
require_test "MONEYFLOW-003" "./internal/platform/postgres" \
  "TestActivityPostgresJSONBRoundTripPreservesMoneyFlowAndAI" \
  "apps/api-go/internal/platform/postgres/activity_facet_integration_test.go" || exit $?
require_test "MONEYFLOW-003" "./internal/platform/postgres" \
  "TestMarketplacePostgresJSONBRoundTripPreservesMoneyFlow" \
  "apps/api-go/internal/platform/postgres/marketplace_media_integration_test.go" || exit $?

# MONEYFLOW-004: PriceLabel 是 server-authoritative。client 传任何
# PriceLabel（空 / 错位 / 调试占位）都必须被 server normalize 推
# opportunityPriceLabel(MoneyFlow) 覆盖，防止 mobile 本地文案 drift。
require_test "MONEYFLOW-004" "./internal/marketplace" \
  "TestOpportunityNormalizeAlwaysOverwritesClientPriceLabel" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

# MONEYFLOW-005: client publish 可以不传 PriceLabel，server 仍下发
# 正确中文文案。这是 MONEYFLOW-004 的 client-side 承诺：wire
# PublishMarketOpportunityInputSchema  PriceLabel 设为 optional。
# 四种 MoneyFlow × 三种 client PriceLabel input 状态（缺省 / 空白 /
# 错位），server response 必须都推成 opportunityPriceLabel(MoneyFlow)。
require_test "MONEYFLOW-005" "./internal/marketplace" \
  "TestMarketPublishOmitsClientPriceLabel" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

# STORE-PHOTO-001: 店铺相册 必须 走 server 侧 AddStorePhoto / ListStorePhotos。
# 'merchant-me-r21.tsx' 有 hardcoded "48 张" "不响应点击" 的相册块。
# 这个 tripwire 确保: (a) 拒接外部 URL (INVALID_ASSET_PATH);
# (b) uploader 只能删自己上传的 (防御性).
require_test "STORE-PHOTO-001" "./internal/business" \
  "TestStoreAlbumRoundTrip" \
  "apps/api-go/internal/business/service_test.go" || exit $?

# STORE-LINES-001: 店铺信息 (Logo / 营业时间 / 联系方式) 必须可写可读。
# 'me.tsx > merchantstorefront > storeLines' tile 是非点击 View。
# tripwire 验证 UpsertStoreLines 拒接外部 logo URL, GetStoreLines
# 返回上传的 logoAssetPath / description。
require_test "STORE-LINES-001" "./internal/business" \
  "TestStoreLinesUpsertAndRead" \
  "apps/api-go/internal/business/service_test.go" || exit $?

# MERCHANT-DIRECTORY-001: 'Creator 经营' / 客户列表不能是 hardcoded 数组。
# member_directory 提供显示名 (Linh / Bao / Khoa) 投影; OWNER+ADMIN
# upsert, 业务成员读; 入侵者被 BUSINESS_ADMIN_REQUIRED 拒。
require_test "MERCHANT-DIRECTORY-001" "./internal/business" \
  "TestMemberDirectoryUpsertAndList" \
  "apps/api-go/internal/business/service_test.go" || exit $?

# MERCHANT-SPEND-DAILY-001: 销售中心 12.6tr / 148 订单 / 85K 客单
# 全部 hardcoded 是不诚实的. tripwire 验证 spend_daily upsert +
# 窗口读取, plus 入侵者被 BUSINESS_FINANCE_REQUIRED 拒。
require_test "MERCHANT-SPEND-DAILY-001" "./internal/business" \
  "TestSpendDailyUpsertAndList" \
  "apps/api-go/internal/business/service_test.go" || exit $?

# PRODUCT-001: 店铺菜单 / 价格表是 store 维度的真 CRUD (R36.x MENU-001)。
# 创建/列表/更新/上下架 round-trip, 入侵者被 BUSINESS_WRITE_REQUIRED 拒,
# 空列表下发 []。mobile 经 BusinessClient 走命令, 不走本地假菜单。
require_test "PRODUCT-001" "./internal/business" \
  "TestStoreProductCrudRoundTrip" \
  "apps/api-go/internal/business/product_test.go" || exit $?
require_test "PRODUCT-001" "./internal/business" \
  "TestStoreProductListEmptyIsArray" \
  "apps/api-go/internal/business/product_test.go" || exit $?
require_test "PRODUCT-001" "./internal/platform/postgres" \
  "TestStoreProductPostgresRoundTrip" \
  "apps/api-go/internal/platform/postgres/business_product_integration_test.go" || exit $?

# STORE-PHOTO-001 mobile half: 店铺相册 + 上传 + 详情 + 删除 全部走
# BusinessClient (不是 hardcoded '48 张')。'me.tsx > merchantstorefront'
# route 之前是 Bonsaidon 假数据, 现在路由到 MerchantStorefrontSurface
# + 真接 BusinessClient. tripwire 验证 client 能 round-trip photos。
pnpm --dir apps/mobile exec vitest run src/business-client.test.ts || exit $?
if ! grep -q 'MerchantStorefrontSurface' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [STORE-PHOTO-001 mobile]: me.tsx lost the MerchantStorefrontSurface wire" >&2
  exit 1
fi
if ! grep -q 'pickAndUploadPhoto\|addStorePhoto' apps/mobile/src/surfaces/merchant-storefront.tsx; then
  echo "  FAIL [STORE-PHOTO-001 mobile]: MerchantStorefrontSurface lost the photo upload flow" >&2
  exit 1
fi
echo "    STORE-PHOTO-001 (mobile): PASS (client + surface wire)"

# MERCHANT-STOREFRONT-R21-001: real Business Workspace wiring must stay inside
# the established R21 operating-store shell, not replace it with a raw admin list.
if ! grep -q '菜单 / 服务' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '照片与视频' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '活动 / Offer' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q 'Creator 权益' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '营业资料' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '店铺二维码' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '店铺资产' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '菜单与价格' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '照片与内容' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '当前礼券' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q 'onStartStoreSetup' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q '线上店铺只负责对外展示' apps/mobile/src/surfaces/merchant-storefront.tsx || \
   ! grep -q 'header={detailHead' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx; then
  echo "  FAIL [MERCHANT-STOREFRONT-R21-001]: storefront lost the stable R21 operating shell" >&2
  exit 1
fi
if grep -q '营业时间 (JSON\|Logo 资产路径\|照片资产路径' apps/mobile/src/surfaces/merchant-storefront.tsx; then
  echo "FAIL: merchant storefront exposed developer-only storage fields"
  exit 1
fi
if grep -q 'creationOpen ?' apps/mobile/src/surfaces/merchant-storefront.tsx; then
  echo "FAIL: storefront setup regressed to an inline manual creation form"
  exit 1
fi
echo "    MERCHANT-STOREFRONT-R21-001: PASS (R21 operating shell + real store data/actions)"

# MERCHANT-R21-001: R21 商家身份 (me.tsx > context === 'BUSINESS')
# 之前走 merchant-me-r21.tsx 1250 行 @ts-nocheck hardcoded mock
# (Linh / Bao / Khoa / 12.6tr / Bonsaidon / 48 张相册 全部 inline).
# 现在 merchant-me-r21.tsx 是 thin shim, 只 re-export
# MerchantMeR21Replacement; me.tsx 必须 wire 它.
if grep -q '@ts-nocheck' apps/mobile/src/surfaces/merchant-me-r21.tsx; then
  echo "  FAIL [MERCHANT-R21-001]: merchant-me-r21.tsx is back to a @ts-nocheck mock" >&2
  exit 1
fi
if ! grep -q 'MerchantMeR21Replacement' apps/mobile/src/surfaces/merchant-me-r21.tsx; then
  echo "  FAIL [MERCHANT-R21-001]: merchant-me-r21.tsx lost the re-export" >&2
  exit 1
fi
if ! grep -q 'MerchantMeR21Replacement' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [MERCHANT-R21-001]: me.tsx lost the MerchantMeR21Replacement wire" >&2
  exit 1
fi
echo "    MERCHANT-R21-001: PASS (hardcoded merchant-me-r21.tsx replaced with thin shim; replacement wires real BusinessClient + SupplyClient)"

# MERCHANT-ME-VISUAL-001: replacing the old hardcoded R21 surface must not
# flatten the merchant module architecture into anonymous text-only cards.
# Keep the established icon/logo affordances while all counts remain server-backed.
if ! grep -q 'OTTER_LOGO' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'function IconBox' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '<ProxyIcon' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'style={styles.moduleGrid}' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'MerchantCreatorRecommendations' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'style={styles.today}' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'style={styles.kpis}' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '智能匹配' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'listMyActivities' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'function SimpleRows' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '活动导流' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '平台结算' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx; then
  echo "  FAIL [MERCHANT-ME-VISUAL-001]: merchant Me lost its branded logo/icon module shell" >&2
  exit 1
fi
echo "    MERCHANT-ME-VISUAL-001: PASS (merchant Me keeps R21 recommendations/today/KPI/logo/icon shell over server-backed data)"

# BIZ-HOME-WIRE-001: 商家 Home tab 之前是 242 行 hardcoded mock
# (Bonsaidon / 今天要推进什么? / Rooftop Photo Afternoon /
# Aster Coffee Sunset / 场景结果 Invite Sent 12 全部 inline)。
# 这个 tripwire 确保: (a) business-home.tsx 不再 hardcode 这些;
# (b) 它消费 business / activities props (不是只接收 onOpenMarket 等)。
# (Caveat: comment block in the file may mention these names
# historically; we strip line-leading '//' before grepping.)
BIZ_HOME_NON_COMMENT=$(grep -v '^[[:space:]]*//' apps/mobile/src/surfaces/business-home.tsx || true)
if echo "$BIZ_HOME_NON_COMMENT" | grep -qE '"Bonsaidon"|Rooftop Photo Afternoon|Aster Coffee Sunset|Invite Sent 12'; then
  echo "  FAIL [BIZ-HOME-WIRE-001]: BusinessHome still hardcodes mock identity or scene packages" >&2
  exit 1
fi
if ! grep -q 'business: BusinessClient\|business?: BusinessClient' apps/mobile/src/surfaces/business-home.tsx; then
  echo "  FAIL [BIZ-HOME-WIRE-001]: BusinessHome does not accept business prop" >&2
  exit 1
fi
echo "    BIZ-HOME-WIRE-001: PASS (Home tab wired to real business + activities clients)"

require_test "R35-OPERATING-HOME-001" "./internal/business" \
  "TestMerchantOperatingHomeDoesNotInventDemandOrForecast" \
  "apps/api-go/internal/business/service_test.go" || exit $?
require_test "R35-OPERATING-HOME-001" "./internal/business" \
  "TestR35ResolverFailsClosedBelowPrivacyThreshold" \
  "apps/api-go/internal/business/operating_resolver_test.go" || exit $?
require_test "R35-OPERATING-HOME-001" "./internal/business" \
  "TestR35ResolverStopsTrafficFromFutureCapacity" \
  "apps/api-go/internal/business/operating_resolver_test.go" || exit $?
require_test "R35-OPERATING-HOME-001" "./internal/business" \
  "TestR35OperatingHomeUsesPersistedSignals" \
  "apps/api-go/internal/business/operating_resolver_test.go" || exit $?
if ! grep -q 'getMerchantOperatingHome' apps/mobile/src/surfaces/business-home.tsx || \
   ! grep -q 'merchant-demand-supply' apps/mobile/src/surfaces/business-home.tsx || \
   ! grep -q 'merchant-best-next-decision' apps/mobile/src/surfaces/business-home.tsx; then
  echo "  FAIL [R35-OPERATING-HOME-001]: merchant Home lost server truth projection" >&2
  exit 1
fi
if ! grep -q 'supply={supply}' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [R35-OPERATING-HOME-001]: merchant Home lost eligible Creator supply" >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/business-client.test.ts || exit $?
echo "    R35-OPERATING-HOME-001: PASS (real outcome; unknown demand/forecast; conservative NO_ACTION)"

# R35-HOME-BOUNDARY-001: Operating Home belongs only to the BUSINESS Home tab.
# Merchant "我的" keeps its established account/store/operations module.
if grep -qE 'merchant-demand-supply|merchant-best-next-decision|merchant-future-demand|GetMerchantOperatingHome' \
  apps/mobile/src/surfaces/me.tsx apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx; then
  echo "  FAIL [R35-HOME-BOUNDARY-001]: R35 Operating Home leaked into merchant Me" >&2
  exit 1
fi
if ! grep -q 'tab === "HOME"' apps/mobile/src/shell/app-shell.tsx || \
   ! grep -q '<BusinessHome' apps/mobile/src/shell/app-shell.tsx || \
   ! grep -q '<MeSurface' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [R35-HOME-BOUNDARY-001]: Home/Me routing boundary is missing" >&2
  exit 1
fi
echo "    R35-HOME-BOUNDARY-001: PASS (Operating Home stays out of merchant Me)"

# PROFILE-001: 编辑主页 之前只写 local SecureStore, 不发 server.
# UpdateProfile / GetProfile 必须存在 + actor-scoped + 拒外部 URL.
require_test "PROFILE-001" "./internal/identity" \
  "TestProfileRoundTripUsesActorAsOwner" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
require_test "PROFILE-001" "./internal/identity" \
  "TestUpdateProfileRejectsAnonymousActorAndBadAvatar" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
if ! grep -q 'profileClient\.updateProfile\|profileClient\.getProfile' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-001 mobile]: me.tsx saveProfile never calls profileClient.updateProfile" >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/profile-client.test.ts || exit $?
echo "    PROFILE-001: PASS (server + mobile half wired to UpdateProfile / GetProfile)"

# CANCEL-001: Order lifecycle enum included CANCELLED, but no
# command ever wrote it. Either party (Requester or Agent) can
# now cancel an OFFERED / CONFIRMED / EXECUTING order. The
# me-orders surface shows a destructive outline button on every
# pre-terminal row; COMPLETED / CANCELLED rows hide it.
require_test "CANCEL-001" "./internal/fulfillment" \
  "TestCancelOrderRequesterCanCancelOffered" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
require_test "CANCEL-001" "./internal/fulfillment" \
  "TestCancelOrderAgentCanCancelExecuting" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
require_test "CANCEL-001" "./internal/fulfillment" \
  "TestCancelOrderOutsiderForbidden" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
require_test "CANCEL-001" "./internal/fulfillment" \
  "TestCancelOrderTerminalStatesRejected" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
require_test "CANCEL-001" "./internal/fulfillment" \
  "TestCancelOrderNotFound" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
pnpm --dir apps/mobile exec vitest run src/fulfillment-client.test.ts >/dev/null || exit $?
if ! grep -q 'cancelOrder' apps/mobile/src/surfaces/me-orders.tsx; then
  echo "  FAIL [CANCEL-001 mobile]: me-orders surface never calls client.cancelOrder" >&2
  exit 1
fi
echo "    CANCEL-001: PASS (server CancelOrder + mobile cancelOrder + UI button)"

# 订单管线审计（2026-09-28）。
# ORDER-CONFIRM-AGENT-001: 需求方能自己「确认合作」，一个人把订单从 OFFERED 走到
# COMPLETED 再打满分（满意度进撮合排序 / 店铺统计）。确认合作只能由服务方做。
require_test "ORDER-CONFIRM-AGENT-001" "./internal/fulfillment" \
  "TestConfirmCooperationRequiresAgent" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
# ORDER-OFFER-COMP-001: 档位报价金额校验完就丢，接单订单金额 0、现金资格为空、
# 直接 CONFIRMED 绕过 R8 现金门。金额随 Offer 落库进快照，超限报价创建即拒。
require_test "ORDER-OFFER-COMP-001" "./internal/fulfillment" \
  "TestSlotOfferCarriesCompensationIntoOrder" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
require_test "ORDER-OFFER-COMP-001" "./internal/fulfillment" \
  "TestTopicInviteOrderHasAllowCashEligibility" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
# ORDER-SETTLE-GUARD-001: 一方能同时勾付款方 / 收款方确认、金额不对快照、结算后
# 还能取消。每一方只确认自己那一侧，金额对快照 / 对方登记额，双方确认后不可取消。
require_test "ORDER-SETTLE-GUARD-001" "./internal/fulfillment" \
  "TestDirectSettlementEachPartyConfirmsOwnSide" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
require_test "ORDER-SETTLE-GUARD-001" "./internal/fulfillment" \
  "TestOneSidedSettlementDoesNotLockCancellation" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
# ORDER-OFFER-READ-001: GetOffer 不校验身份，任何人拿 offerId 能读留言和需求方 id。
require_test "ORDER-OFFER-READ-001" "./internal/fulfillment" \
  "TestGetOfferOnlyVisibleToParties" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
# ORDER-CONFLICT-CODE-001: 订单版本冲突被报成 INTERNAL，客户端无法区分「刷新重试」。
require_test "ORDER-CONFLICT-CODE-001" "./internal/fulfillment" \
  "TestOrderVersionConflictIsReportedAsConcurrency" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
# TOPIC-INVITE-PERSIST-001: PG 的 CreateOfferAndPublish 漏写 topic_key / note，主题邀约
# 落成空主题（内存仓没这个问题）。需要 postgres；没有库时该测试 SKIP。
require_test "TOPIC-INVITE-PERSIST-001" "./internal/platform/postgres" \
  "TestOfferPersistsTopicAndCompensationPostgres" \
  "apps/api-go/internal/platform/postgres/fulfillment_offer_persistence_integration_test.go" || exit $?
if ! grep -q 'ORDER-CONFIRM-AGENT-001' apps/mobile/src/order-actions.test.ts ||
   ! grep -q 'ORDER-SETTLE-GUARD-001' apps/mobile/src/order-actions.test.ts ||
   ! grep -q 'canConfirmCooperation(detail)' apps/mobile/src/surfaces/me-orders.tsx ||
   ! grep -q 'settlementView(detail)' apps/mobile/src/surfaces/me-orders.tsx; then
  echo "  FAIL [ORDER-CONFIRM-AGENT-001/ORDER-SETTLE-GUARD-001 mobile]: 订单详情又给需求方摆确认按钮 / 让一方勾双方结算。" >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/order-actions.test.ts >/dev/null || exit $?
echo "    ORDER-CONFIRM-AGENT-001/ORDER-OFFER-COMP-001/ORDER-SETTLE-GUARD-001/ORDER-OFFER-READ-001/ORDER-CONFLICT-CODE-001/TOPIC-INVITE-PERSIST-001: PASS"

# 订单严格机制（2026-09-28 第二轮：状态机 / 回滚 / 存储 / 审计）。
# ORDER-FSM-001: 状态机只有一张迁移表，所有订单写入走 commitOrder 校验。
require_test "ORDER-FSM-001" "./internal/fulfillment" \
  "TestOrderTransitionGuard" \
  "apps/api-go/internal/fulfillment/order_amendment_test.go" || exit $?
# ORDER-AMEND-001: 条款变更以前只记描述、快照原样复制；现在一方提出、另一方接受才生效，历史可还原。
require_test "ORDER-AMEND-001" "./internal/fulfillment" \
  "TestMaterialChangeRequiresCounterpartyAndKeepsHistory" \
  "apps/api-go/internal/fulfillment/order_amendment_test.go" || exit $?
require_test "ORDER-AMEND-001" "./internal/fulfillment" \
  "TestMaterialChangeGuardsMoneyAndLapsesOnTerminal" \
  "apps/api-go/internal/fulfillment/order_amendment_test.go" || exit $?
require_test "ORDER-AMEND-001" "./internal/fulfillment" \
  "TestLC30MaterialChangeFailsClosedWhenGateUnconfigured" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
# ORDER-STORE-STATS-AUTHZ-001 / ORDER-SLOT-OWNER-001: 店铺统计与档位报价以前谁都能调；现在 fail closed。
require_test "ORDER-STORE-STATS-AUTHZ-001" "./internal/fulfillment" \
  "TestStoreStatsRequireStoreMembership" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
require_test "ORDER-STORE-STATS-AUTHZ-001" "./internal/business" \
  "TestStoreMemberAccess" \
  "apps/api-go/internal/business/store_access_test.go" || exit $?
require_test "ORDER-SLOT-OWNER-001" "./internal/fulfillment" \
  "TestSlotOfferRequiresOwnership" \
  "apps/api-go/internal/fulfillment/order_state_machine_test.go" || exit $?
require_test "ORDER-SLOT-OWNER-001" "./internal/demand" \
  "TestTaskSlotOwnedBy" \
  "apps/api-go/internal/demand/slot_owner_test.go" || exit $?
require_test "ORDER-SLOT-OWNER-001" "./internal/marketplace" \
  "TestOfferEligibility" \
  "apps/api-go/internal/marketplace/offer_eligibility_test.go" || exit $?
if ! grep -qF 'fulfillmentService.SetStoreAccess(' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'fulfillmentService.SetSlotOfferAuthorizer(' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [ORDER-STORE-STATS-AUTHZ-001/ORDER-SLOT-OWNER-001]: main.go 没接权限校验，两个命令会全部 fail closed。" >&2
  exit 1
fi
# ORDER-MATERIALIZE-AUDIT-001: 市场 / 场景物化订单以前不过现金门、不发出生事件。
require_test "ORDER-MATERIALIZE-AUDIT-001" "./internal/fulfillment" \
  "TestMaterializedOrderGatesCashAndPublishesOnce" \
  "apps/api-go/internal/fulfillment/order_materialize_test.go" || exit $?
require_test "ORDER-MATERIALIZE-AUDIT-001" "./internal/scene" \
  "TestRespondInvitation_IneligibleOrderIsBusinessState" \
  "apps/api-go/internal/scene/invitation_order_eligibility_test.go" || exit $?
# ORDER-SLOT-RELEASE-001: 内存仓取消订单后档位不释放（PG 释放），两边语义不一致。
require_test "ORDER-SLOT-RELEASE-001" "./internal/fulfillment" \
  "TestCancelledSlotOrderReleasesSlot" \
  "apps/api-go/internal/fulfillment/order_materialize_test.go" || exit $?
# POLICY-STAMP-DURABLE-001: LC-28 决策生产接的是内存仓（重启即丢），盖章在事务外且错误被丢弃。
require_test "POLICY-STAMP-DURABLE-001" "./internal/fulfillment" \
  "TestStampFailureRejectsConfirmation" \
  "apps/api-go/internal/fulfillment/order_amendment_test.go" || exit $?
if ! grep -qF 'postgres.NewPolicyDecisionRepository(pool)' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [POLICY-STAMP-DURABLE-001]: 有数据库时 LC-28 策略决策必须落 Postgres，不能接内存仓。" >&2
  exit 1
fi
# ORDER-AUDIT-001: 订单 / 报价写入由数据库触发器写只追加审计；守卫拒绝非法迁移与删除。
# 以下 Postgres 测试没有库时 SKIP（与其它集成测试一致）。
require_test "ORDER-AUDIT-001" "./internal/fulfillment" \
  "TestOrderAuditTrailForParties" \
  "apps/api-go/internal/fulfillment/order_amendment_test.go" || exit $?
for audit_test in TestOrderTransitionIsStampedAndAuditedPostgres TestStampFailureRollsBackTransitionPostgres \
  TestOrderGuardAndAppendOnlyAuditPostgres TestFullLifecyclePassesGuardPostgres TestMaterializedOrderEventOnceAndAuditTrailPostgres; do
  require_test "ORDER-AUDIT-001" "./internal/platform/postgres" "$audit_test" \
    "apps/api-go/internal/platform/postgres/order_audit_integration_test.go" || exit $?
done
if ! grep -qF 'CREATE TRIGGER orders_guard' apps/api-go/migrations/135_order_audit_and_guard.sql ||
   ! grep -qF 'CREATE TRIGGER audit_log_append_only' apps/api-go/migrations/135_order_audit_and_guard.sql; then
  echo "  FAIL [ORDER-AUDIT-001]: 订单守卫 / 审计只追加触发器从迁移里消失了。" >&2
  exit 1
fi
echo "    ORDER-FSM-001/ORDER-AMEND-001/ORDER-STORE-STATS-AUTHZ-001/ORDER-SLOT-OWNER-001/ORDER-MATERIALIZE-AUDIT-001/ORDER-SLOT-RELEASE-001/POLICY-STAMP-DURABLE-001/ORDER-AUDIT-001: PASS"

# 订单编号与 For You 可用插槽（2026-09-29，用户：「for you 的新订单编号没有用上……点击圆圈就是
# 刷新全部可用插槽……插槽资源冲突……编号更新全数字」）。
# ORDER-NO-001: 全数字订单编号（yyMMdd + 全局序号 + Luhn），履约订单与活动报名共用一个分配器。
require_test "ORDER-NO-001" "./internal/ordernumber" \
  "TestOrderNumberFormatAndUniqueness" \
  "apps/api-go/internal/ordernumber/ordernumber_test.go" || exit $?
require_test "ORDER-NO-001" "./internal/fulfillment" \
  "TestEveryOrderGetsAnAllDigitOrderNumber" \
  "apps/api-go/internal/fulfillment/order_number_test.go" || exit $?
# ACT-ORDER-NO-001 / ACT-SEAT-RELEASE-001: 报名有自己的编号；取消释放名额，再报名沿用原编号。
require_test "ACT-ORDER-NO-001" "./internal/activity" \
  "TestJoinReturnsOwnAllDigitOrderNumber" \
  "apps/api-go/internal/activity/participation_order_test.go" || exit $?
require_test "ACT-SEAT-RELEASE-001" "./internal/activity" \
  "TestCancelReleasesSeatAndRejoinKeepsNumber" \
  "apps/api-go/internal/activity/participation_order_test.go" || exit $?
# ACT-PARTICIPATION-DURABLE-001 / ORDER-NO-001（Postgres；没有库时 SKIP）。
for number_test in TestOrderNumberSQLMatchesGo TestParticipationDurableSeatReleasePostgres TestFulfillmentOrderNumberPersistedAndImmutablePostgres \
  TestPostgresBackedServicesDefaultToSharedSequence; do
  require_test "ACT-PARTICIPATION-DURABLE-001/ORDER-NO-001" "./internal/platform/postgres" "$number_test" \
    "apps/api-go/internal/platform/postgres/order_number_integration_test.go" || exit $?
done
if grep -qF 'NewParticipationStore' apps/api-go/internal/activity/*.go; then
  echo "  FAIL [ACT-PARTICIPATION-DURABLE-001]: 报名状态又回到进程内存了（重启即丢、取消不释放名额）。" >&2
  exit 1
fi
if ! grep -qF 'activityService.SetOrderNumbers(orderNumbers)' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'fulfillmentService.WithOrderNumbers(orderNumbers)' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [ORDER-NO-001]: 履约与活动必须共用同一个订单编号分配器。" >&2
  exit 1
fi
# HOME-FORYOU-REFRESH-001 / HOME-FORYOU-ORDER-005（移动端纯逻辑 + 契约不剥字段）。
pnpm --dir apps/mobile exec vitest run src/for-you-slots.test.ts src/for-you-order-number.test.ts >/dev/null || exit $?
echo "    ORDER-NO-001/ACT-ORDER-NO-001/ACT-SEAT-RELEASE-001/ACT-PARTICIPATION-DURABLE-001/HOME-FORYOU-REFRESH-001: PASS"

# 第四轮（2026-09-29，用户「有问题就修」）。
# PUBLIC-NO-001: 需求 / 邀约 / 活动编号由服务端共享序列分配、全数字（以前成功页是客户端随机
# 生成的 PX-N / PX-O / PX-A，服务端查不到；活动编码是哈希取模 9000，会撞号）。
require_test "PUBLIC-NO-001" "./internal/marketplace" \
  "TestPublishedOpportunityHasServerNumber" \
  "apps/api-go/internal/marketplace/public_number_test.go" || exit $?
require_test "PUBLIC-NO-001" "./internal/activity" \
  "TestPublishActivityR58Fields" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
require_test "PUBLIC-NO-001" "./internal/platform/postgres" \
  "TestPublicNumbersFromSharedSequencePostgres" \
  "apps/api-go/internal/platform/postgres/order_number_integration_test.go" || exit $?
if grep -qF 'activityDisplayCode' apps/api-go/internal/activity/service.go ||
   ! grep -qF 'marketplaceService.SetNumbers(orderNumbers)' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [PUBLIC-NO-001]: 活动哈希编码回来了，或市场没接共享编号分配器。" >&2
  exit 1
fi
# OUTBOX-TEST-ISOLATION-001: outbox 生命周期测试以前固定领 50 条并断言 claimed[0]（可能是别的
# 测试留下的行），共享库里残留一多就随机失败。改为「领完为止」，断言不变。
require_test "OUTBOX-TEST-ISOLATION-001" "./internal/platform/postgres" \
  "TestOutboxPostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/outbox_integration_test.go" || exit $?
if grep -qF 'claimed[0].Status' apps/api-go/internal/platform/postgres/outbox_integration_test.go; then
  echo "  FAIL [OUTBOX-TEST-ISOLATION-001]: 又在断言别的测试留下的 outbox 行。" >&2
  exit 1
fi
# ORDER-AMEND-UI-001 / ORDER-AUDIT-UI-001: 我的订单里能提出 / 接受 / 拒绝 / 撤回条款变更，能看变更记录。
if ! grep -qF 'client.respondTermChange(detail.orderId, pending.amendmentId, "ACCEPT")' apps/mobile/src/surfaces/me-orders.tsx ||
   ! grep -qF 'client.getAuditTrail(detail.orderId)' apps/mobile/src/surfaces/me-orders.tsx; then
  echo "  FAIL [ORDER-AMEND-UI-001/ORDER-AUDIT-UI-001]: 订单详情丢了条款变更或变更记录入口。" >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/order-actions.test.ts src/public-number.test.ts >/dev/null || exit $?
echo "    PUBLIC-NO-001/OUTBOX-TEST-ISOLATION-001/ORDER-AMEND-UI-001/ORDER-AUDIT-UI-001: PASS"

# 第五轮（2026-09-29，用户「没做的就做」）：客服按编号反查 + 数据库角色分离。
# PUBLIC-NO-LOOKUP-001: 用户把订单 / 报名 / 需求邀约 / 活动编号念给客服，运营命令
# LookupPublicNumber 按全数字编号找回实体（校验位先行：抄错一位报「校验位不对」，不是「查无此单」；
# 一个号查到多个实体拒绝返回；反查 SQL 走索引）。
require_test "PUBLIC-NO-LOOKUP-001" "./internal/numberlookup" \
  "TestLookupResolvesEveryPublicNumberKind" \
  "apps/api-go/internal/numberlookup/service_test.go" || exit $?
require_test "PUBLIC-NO-LOOKUP-001" "./internal/numberlookup" \
  "TestLookupDistinguishesTypoFromUnknownNumber" \
  "apps/api-go/internal/numberlookup/service_test.go" || exit $?
require_test "PUBLIC-NO-LOOKUP-001" "./internal/numberlookup" \
  "TestLookupNeverReportsNotFoundWhenADomainCouldNotBeSearched" \
  "apps/api-go/internal/numberlookup/service_test.go" || exit $?
require_test "PUBLIC-NO-LOOKUP-001" "./internal/platform/postgres" \
  "TestPublicNumberLookupPostgres" \
  "apps/api-go/internal/platform/postgres/number_lookup_integration_test.go" || exit $?
require_test "PUBLIC-NO-LOOKUP-001" "./internal/platform/postgres" \
  "TestNumberLookupQueriesUseTheirIndexesPostgres" \
  "apps/api-go/internal/platform/postgres/number_lookup_integration_test.go" || exit $?
# PUBLIC-NO-LOOKUP-AUDIT-001: 每次反查（找到 / 没找到 / 号码不对）都在只追加的
# operator.number_lookups 留一行，与命令同一事务；留痕写不进去就不返回任何数据。
require_test "PUBLIC-NO-LOOKUP-AUDIT-001" "./internal/numberlookup" \
  "TestEveryLookupIsAudited" \
  "apps/api-go/internal/numberlookup/service_test.go" || exit $?
require_test "PUBLIC-NO-LOOKUP-AUDIT-001" "./internal/numberlookup" \
  "TestLookupFailsClosedWhenAuditCannotBeWritten" \
  "apps/api-go/internal/numberlookup/service_test.go" || exit $?
require_test "PUBLIC-NO-LOOKUP-AUDIT-001" "./internal/platform/postgres" \
  "TestNumberLookupAuditIsAppendOnlyPostgres" \
  "apps/api-go/internal/platform/postgres/number_lookup_integration_test.go" || exit $?
require_test "PUBLIC-NO-LOOKUP-AUDIT-001" "./internal/platform/postgres" \
  "TestNumberLookupAuditSharesTheCommandTransactionPostgres" \
  "apps/api-go/internal/platform/postgres/number_lookup_integration_test.go" || exit $?
# PUBLIC-NO-LOOKUP-GATE-001: 反查是跨当事人读，只给运营且要 CASE scope。
require_test "PUBLIC-NO-LOOKUP-GATE-001" "./internal/api" \
  "TestPublicNumberLookupIsOperatorOnlyAndNeedsCaseScope" \
  "apps/api-go/internal/api/number_lookup_test.go" || exit $?
if ! grep -qF '"LookupPublicNumber": true' apps/api-go/internal/api/security.go ||
   ! grep -qF '"LookupPublicNumber": ScopeCase' apps/api-go/internal/api/operator_scopes.go ||
   ! grep -qF 'server.NumberLookup = numberlookup.New(lookupRecorder' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'opCommand("LookupPublicNumber"' apps/market-intelligence-console/src/pages/NumberLookup.tsx; then
  echo "  FAIL [PUBLIC-NO-LOOKUP-GATE-001]: 编号反查丢了 operator 门 / CASE scope / 服务端接线 / 控制台入口。" >&2
  exit 1
fi
# ORDER-BREAKGLASS-ROLE-001: proxy.guard_override 只有 proxy_breakglass 成员（含超级用户）才生效，
# 其他角色设了开关再写订单直接报错；成员身份本身不放行任何东西。
require_test "ORDER-BREAKGLASS-ROLE-001" "./internal/platform/postgres" \
  "TestGuardOverrideRequiresBreakGlassRolePostgres" \
  "apps/api-go/internal/platform/postgres/order_role_integration_test.go" || exit $?
# AUDIT-PRIVILEGE-001: 四张只追加审计表对 PUBLIC / 属主 / proxy 撤销 UPDATE / DELETE / TRUNCATE，
# 用非超级用户属主的临时表实测「权限被拒」（触发器之外的第二层）。
require_test "AUDIT-PRIVILEGE-001" "./internal/platform/postgres" \
  "TestHardenAppendOnlyRevokesRewritePrivilegesPostgres" \
  "apps/api-go/internal/platform/postgres/order_role_integration_test.go" || exit $?
require_test "AUDIT-PRIVILEGE-001" "./internal/platform/postgres" \
  "TestAuditTablesAreHardenedByMigrationPostgres" \
  "apps/api-go/internal/platform/postgres/order_role_integration_test.go" || exit $?
# DB-ROLE-POSTURE-001: 启动姿态检查（超级用户 / 破窗成员 / 能改审计表 / 属主）；
# PROXY_ENFORCE_DB_ROLE_SEPARATION=true 时任何一条不满足都拒绝启动。
require_test "DB-ROLE-POSTURE-001" "./internal/platform/postgres" \
  "TestRolePostureFindingsPostgres" \
  "apps/api-go/internal/platform/postgres/order_role_integration_test.go" || exit $?
if ! grep -qF 'enforceDBRolePosture(ctx, pool)' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'PROXY_ENFORCE_DB_ROLE_SEPARATION' apps/api-go/PRODUCTION.md; then
  echo "  FAIL [DB-ROLE-POSTURE-001]: 启动姿态检查没接进 main.go，或 PRODUCTION.md 没写。" >&2
  exit 1
fi
echo "    PUBLIC-NO-LOOKUP-001/PUBLIC-NO-LOOKUP-AUDIT-001/PUBLIC-NO-LOOKUP-GATE-001/ORDER-BREAKGLASS-ROLE-001/AUDIT-PRIVILEGE-001/DB-ROLE-POSTURE-001: PASS"

# 第六轮（2026-09-29，用户「下单接单的流程 还有页面很多废话 一起修改优化」）。
# ORDER-FLOW-COPY-001: 下单 / 接单 / 订单页不许再印开发口吻（「报价 UI 不在这屏」「活动读模型」）、
# 复述页面上已有内容的说明盒、不真实的说明（对线下结算单写「平台托管付款」）和结算方式原始枚举；
# 到场登记一个输入一次点击。
pnpm --dir apps/mobile exec vitest run src/order-flow-copy.test.ts src/order-actions.test.ts src/market-fake-judgment.test.ts >/dev/null || exit $?
echo "    ORDER-FLOW-COPY-001: PASS"

# LINES-EDITOR-001: the server has had UpsertStoreLines
# since R18.x b77187a, but the storefront surface was
# read-only: business owners saw their old lines but had
# no way to edit description / contact / hours / logo.
# This tripwire asserts the inline edit form is wired
# (startEditLines + saveLines + client.upsertStoreLines)
# and that the createBtnBusy style exists so the saving
# state has a visible disabled cue.
if ! grep -q 'startEditLines\|saveLines' apps/mobile/src/surfaces/merchant-storefront.tsx; then
  echo "  FAIL [LINES-EDITOR-001]: storefront has no inline edit form for store lines" >&2
  exit 1
fi
if ! grep -q 'client.upsertStoreLines' apps/mobile/src/surfaces/merchant-storefront.tsx; then
  echo "  FAIL [LINES-EDITOR-001]: saveLines never calls client.upsertStoreLines" >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/business-client.test.ts >/dev/null || exit $?
echo "    LINES-EDITOR-001: PASS (inline edit form wires to UpsertStoreLines)"

# FRIEND-001: 我的 → 好友与关系 之前是 4 行 hardcoded CRM_FRIENDS
# + PENDING_REQUESTS + CONTACT_MATCHES + SOCIAL_MATCHES, 所有
# 添加/接受/忽略 动作都只 setSentIds / setRequests local state.
# 现在 friendcrm sub-page 接 RelationshipClient, 列表/pending 都
# 走 server, 接受/忽略 调 Accept/IgnoreFriendRequest.
require_test "FRIEND-001" "./internal/relationship" \
  "TestListMyFriendshipsSplitsActiveAndPending" \
  "apps/api-go/internal/relationship/service_test.go" || exit $?
require_test "FRIEND-001" "./internal/relationship" \
  "TestSendFriendRequestIsPairCanonical" \
  "apps/api-go/internal/relationship/service_test.go" || exit $?
require_test "FRIEND-001" "./internal/relationship" \
  "TestAcceptFriendRequestRequiresReceiver" \
  "apps/api-go/internal/relationship/service_test.go" || exit $?
require_test "FRIEND-001" "./internal/relationship" \
  "TestIgnoreFriendRequestTombstonesRow" \
  "apps/api-go/internal/relationship/service_test.go" || exit $?
require_test "FRIEND-001" "./internal/relationship" \
  "TestBlockFriendHidesFromList" \
  "apps/api-go/internal/relationship/service_test.go" || exit $?
require_test "FRIEND-001" "./internal/relationship" \
  "TestSendFriendRequestRejectsSelf" \
  "apps/api-go/internal/relationship/service_test.go" || exit $?
pnpm --dir apps/mobile exec vitest run src/relationship-client.test.ts >/dev/null || exit $?
if ! grep -q 'relationship\.listMyFriendships\|relationship\.acceptFriendRequest' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [FRIEND-001 mobile]: friend-crm surface never calls RelationshipClient" >&2
  exit 1
fi
echo "    FRIEND-001: PASS (server + mobile wire end-to-end)"

# PLACEHOLDER-001: friend-crm / messages / tasks / ProfileTabs / me-wallet
# 曾有 20+ 个占位按钮与编造字段（假扫码结果、假邀请身份、假匹配人、
# 假发送 toast、假余额）。修复后：有后端能力的走真接线（Share /
# BlockFriend / 接受忽略请求 / 点赞），无后端能力的删假按钮并诚实
# 说明，未知金额画"—"不编数。 tripwire 见
# apps/mobile/src/surfaces/placeholder-honest-actions.test.ts。
if ! grep -q 'PLACEHOLDER-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-001]: placeholder tripwire test file is missing" >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts >/dev/null || exit $?
echo "    PLACEHOLDER-001: PASS (no placeholder buttons / invented fields)"

# PLACEHOLDER-002: 每条交互链必须走完（出图分享之后不断线）。
# 四路审计扫出的断链：市场搜索/自定义报价/活动图钉、场景三态静默、
# 活动报名不刷新、会话发送假气泡/转发空壳、权限不进包、偏好存了不用、
# 自定频道不过滤、助手 pill 导错航、建连失败无重试、资料/邀请/外链静默、
# 主页搜索丢词、店铺素材假计数、状态点打不开、安全区死按钮、候选不落盘、
# 权益目录空屏、Creator 输入不进 Review 且接受不持久、联系人空且不可达。
if ! grep -q 'PLACEHOLDER-002' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-002]: exhaustive-chain tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-002: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-003: 死 prop 与死查看器（MarketSurface.onOpenActivity 全链
# 无人调用、shell 传空函数；他人主页 onOpenMedia 空函数致图片点不开）。
if ! grep -q 'PLACEHOLDER-003' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-003]: dead-prop tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-003: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-004: 邀约 Moment 发布到动态走真发帖管线。
if ! grep -q 'PLACEHOLDER-004' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-004]: moment-publish tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-004: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-005: 动态本人头像与个人总管理同源；Moment 发布成功直达动态。
if ! grep -q 'PLACEHOLDER-005' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-005]: avatar/jump tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-005: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-006: checklist 走查补漏（进行中重试、活动列表拆嵌套）。
if ! grep -q 'PLACEHOLDER-006' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-006]: checklist-walk tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-006: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-007: 横滑 rail 必须手指 1:1（grant 快照基准）。
if ! grep -q 'PLACEHOLDER-007' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-007]: rail-tracking tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-007: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-008: 头像统一正圆。
if ! grep -q 'PLACEHOLDER-008' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-008]: avatar-circle tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-008: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-009: 对话头像落盘缓存。
if ! grep -q 'PLACEHOLDER-009' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-009]: avatar-cache tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-009: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-010: AI 主页只留真有结果的动作（AI-FRIEND-DEAD-PENDING-001）。
# 旧的语义是「AI 添加待同意显示添加中」—— 那个 PENDING 是死记录，已删除。
if ! grep -q 'PLACEHOLDER-010' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-010]: ai-honest-actions tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-010: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-011: 那条 添加中/PENDING 死状态不许回来（含它的样式）。
if ! grep -q 'PLACEHOLDER-011' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-011]: dead-pending tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-011: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-012: AI 三液态玻璃按钮 + 查看主页进动态。
if ! grep -q 'PLACEHOLDER-012' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-012]: ai-glass-actions tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-012: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-013: 对话左滑两段删除。
if ! grep -q 'PLACEHOLDER-013' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-013]: swipe-delete tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-013: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-014: 消息页禁左滑跳页（留给行内删除），右滑保留。
if ! grep -q 'PLACEHOLDER-014' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-014]: swipe-direction tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-014: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-015: 对话列表无多余“最近”分区头。
if ! grep -q 'PLACEHOLDER-015' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-015]: no-recent-header tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-015: PASS (tripwire present; covered by the vitest run above)"

# MSG-GROUPS-TAB-001: 消息模块只有对话/群组两页（自建文件夹与 Convo 列表页
# 已摘，聊天 app 不是办公软件）。旧 PLACEHOLDER-016/018（文件夹媒体墙 +
# 行内新建）钉的是已删除的东西，整段替换。
if ! grep -q 'MSG-GROUPS-TAB-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [MSG-GROUPS-TAB-001]: dialogs-plus-groups tripwire is missing" >&2
  exit 1
fi
if ! grep -q 'setPanel("groups")' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -q 'name="group"' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -q 'case "group"' apps/mobile/src/components/proxy-icon.tsx; then
  echo "  FAIL [MSG-GROUPS-TAB-001]: groups tab or group logo missing ——" >&2
  echo "        对话/群组两页 + 群组 logo 缺一不可。" >&2
  exit 1
fi
if grep -q 'setPanel("folders")' apps/mobile/src/surfaces/messages.tsx ||
   grep -q 'setPanel("convos")' apps/mobile/src/surfaces/messages.tsx ||
   [ -f apps/mobile/src/components/folder-manager.tsx ]; then
  echo "  FAIL [MSG-GROUPS-TAB-001]: folders/convos remnants back ——" >&2
  echo "        文件夹与 Convo 列表页不许回来。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts || exit $?
echo "    MSG-GROUPS-TAB-001: PASS (dialogs plus real groups, group logo)"

# PLACEHOLDER-017: 筛选只在对话页，文件夹页有归档统计。
if ! grep -q 'PLACEHOLDER-017' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-017]: folder-scope tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-017: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-018: 新建按钮在类型行内 —— 已摘（文件夹功能整体移除，
# 见 MSG-GROUPS-TAB-001），此门禁退役，不再要求该 tripwire 存在。

# HUB-PROFILE-001: '我的' top profile card + identity card used
# to render the hardcoded persona.name ('Huyen' / 'Bonsaidon')
# regardless of who was signed in, and a fake '已验证 · 准时 98%'
# stat. resolveHubProfile now projects profileStore + the live
# avatar onto both cards. The me.tsx render path is the
# canonical consumer — confirm it uses hubProfile, not the
# raw persona name.
pnpm --dir apps/mobile exec vitest run src/surfaces/hub-profile.test.ts >/dev/null || exit $?
if ! grep -q 'resolveHubProfile' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [HUB-PROFILE-001]: me.tsx never resolves the live profile for the hub card" >&2
  exit 1
fi
if grep -q 'profileAvatarText' apps/mobile/src/surfaces/me.tsx && grep -q '{persona.avatarText}' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [HUB-PROFILE-001]: me.tsx still renders {persona.avatarText} (should be hubProfile.initial)" >&2
  exit 1
fi
if grep -q 'profileMetaText}>已验证' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [HUB-PROFILE-001]: me.tsx still hardcodes '已验证 · 准时 98%'" >&2
  exit 1
fi
echo "    HUB-PROFILE-001: PASS (hub card + identity card both read live profile; no fake verify stat)"

# HUB-SOCIAL-001: me-hub top card used to render the
# hardcoded persona.profileCard.social (["TT","Z","IG","in"])
# no matter what the user actually configured in the
# social accounts editor. resolveHubSocials projects the
# live socialAccounts (handle set + visibility public) and
# the me.tsx render path uses it. Tripwire: the helper is
# imported, the render path uses it, and the old hardcoded
# "TT" "Z" "IG" "in" array literal is gone.
pnpm --dir apps/mobile exec vitest run src/surfaces/hub-profile.test.ts >/dev/null || exit $?
if ! grep -q 'resolveHubSocials' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [HUB-SOCIAL-001]: me.tsx never resolves the live social accounts for the hub card" >&2
  exit 1
fi
if grep -q 'persona\.profileCard\.social\.map' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [HUB-SOCIAL-001]: me.tsx still renders persona.profileCard.social" >&2
  exit 1
fi
echo "    HUB-SOCIAL-001: PASS (hub card shows only live socialAccounts with public visibility; no hardcoded persona.profileCard.social)"

# FAKE-STATS-001: the me hub used to hardcode fake
# "已验证 · 准时 98%" / "主体已验证" / "真实性已校验" /
# "已完成 42 / 复购 7 / 98% 准时" stats across the profile
# card, identity card, bdash hero, personalhub about card,
# and personalmanage subpage. None of these are computed;
# they fabricated a reputation score the system has never
# recorded. Tripwire: any live surface must not contain
# these literal fake-stat strings.
LIVE_SURFACES="apps/mobile/src/surfaces/me.tsx apps/mobile/src/surfaces/ProfileTabs.tsx"
if echo "$LIVE_SURFACES" | xargs grep -E '已验证 · 准时 98|主体已验证|真实性已校验' 2>/dev/null | grep -v "// "; then
  echo "  FAIL [FAKE-STATS-001]: live surface still renders a fabricated verification stat" >&2
  exit 1
fi
echo "    FAKE-STATS-001: PASS (no fabricated '已验证 · 准时 98%' / '主体已验证' / '真实性已校验' in live surfaces)"

# DEAD-SUBPAGE-001: 3 dead subPages that used to ship
# hardcoded mock data have been removed from me.tsx +
# me-sub-pages.ts. The dead routes were 'messages',
# 'requestermemory', and 'businessdiagnostic'. None of
# these are reachable from any menu row, from
# meOwnedRouteForLabel, or from any setSubPage call in
# the codebase, so deleting them is a pure cleanup.
# Tripwire: no surface may set the subPage to one of
# the deleted routes, and me-sub-pages.ts must not
# re-introduce the entries.
if grep -rn 'setSubPage.*"messages"\|setSubPage.*"requestermemory"\|setSubPage.*"businessdiagnostic"\|openSubPage.*"messages"\|openSubPage.*"requestermemory"\|openSubPage.*"businessdiagnostic"' apps/mobile/src/ 2>/dev/null | grep -v ".test."; then
  echo "  FAIL [DEAD-SUBPAGE-001]: a deleted dead subPage is being routed to again" >&2
  exit 1
fi
if grep -E '^  messages:|^  requestermemory:|^  businessdiagnostic:' apps/mobile/src/surfaces/me-sub-pages.ts 2>/dev/null; then
  echo "  FAIL [DEAD-SUBPAGE-001]: me-sub-pages.ts re-introduced a dead entry" >&2
  exit 1
fi
echo "    DEAD-SUBPAGE-001: PASS (messages / requestermemory / businessdiagnostic dead subPages are gone)"

# UI-CHAT-001: 会话图片必须走媒体上传后的 storageKey，不能只在本地显示
# 假预览；输入区必须保留安全区布局。
pnpm --dir apps/mobile exec vitest run src/conversation-client.test.ts || exit $?
if ! grep -q 'Math.max(insets.bottom, 16)' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [UI-CHAT-001]: conversation composer lost bottom safe-area spacing" >&2
  exit 1
fi
echo "    UI-CHAT-001: PASS (image wire + composer safe area)"

# DEAD-MARKET-001: 3 dead sub-views in market.tsx and
# 2 dead top-level surfaces have been removed:
#   * ApplicantDetail / SubmissionDetail / CompareScene
#     were 3 hardcoded mock-data sub-views reachable only
#     via setApplicantName / setSubmissionName /
#     setCompareOpen, all of which were only set to
#     null inside the corresponding onBack. No code path
#     ever set the state to a non-null value, so the 3
#     sub-views were unreachable. The 3 states, the 3
#     back handlers, the 3 JSX usages, and the 3 function
#     bodies are all gone.
#   * MarketExperienceSurface (the 体验 tab) was wired in
#     app-shell.tsx behind an `openExperience` state that
#     was only ever set to undefined. The 体验 tab was
#     removed at R15.13. The surface, the state, the
#     conditional JSX, and the dead MarketSurface
#     `onOpenExperience` prop are all gone. The
#     MarketSurface `onOpenExperience` prop type is now
#     optional, and the prop is no longer passed by
#     app-shell.
#   * TasksSurface (the workspace entry points with 2
#     hardcoded "进行中 / 已完成" rows) was exported but
#     never imported. tasks.tsx is now the
#     ActivityFeedCard + ActivityDetail shared module.
# Tripwire: any re-introduction of these symbols /
# states / props is a regression.
DEAD_MARKET_GUARDS=(
  "apps/mobile/src/surfaces/market.tsx:ApplicantDetail"
  "apps/mobile/src/surfaces/market.tsx:SubmissionDetail"
  "apps/mobile/src/surfaces/market.tsx:CompareScene"
  "apps/mobile/src/surfaces/market.tsx:setApplicantName"
  "apps/mobile/src/surfaces/market.tsx:setSubmissionName"
  "apps/mobile/src/surfaces/market.tsx:compareOpen"
  "apps/mobile/src/shell/app-shell.tsx:MarketExperienceSurface"
  "apps/mobile/src/shell/app-shell.tsx:openExperience"
  "apps/mobile/src/shell/app-shell.tsx:setOpenExperience"
  "apps/mobile/src/surfaces/tasks.tsx:TasksSurface"
  "apps/mobile/src/surfaces/tasks.tsx:TaskServiceRow"
  "apps/mobile/src/surfaces/tasks.tsx:IN_PROGRESS"
  "apps/mobile/src/surfaces/tasks.tsx:TaskRow"
  "apps/mobile/src/surfaces/tasks.tsx:useMerchantIdentity"
)
for guard in "${DEAD_MARKET_GUARDS[@]}"; do
  file="${guard%%:*}"
  sym="${guard##*:}"
  if [ -f "$file" ] && grep -E "(\\b$sym\\b|\\b$sym\\(|\\b$sym:)" "$file" 2>/dev/null | grep -v "^\\s*//" >/dev/null; then
    echo "  FAIL [DEAD-MARKET-001]: $file still references dead $sym" >&2
    exit 1
  fi
done
if [ -f "apps/mobile/src/surfaces/market-experience.tsx" ]; then
  echo "  FAIL [DEAD-MARKET-001]: apps/mobile/src/surfaces/market-experience.tsx is still present" >&2
  exit 1
fi
echo "    DEAD-MARKET-001: PASS (no dead sub-views in market.tsx, no MarketExperienceSurface, no TasksSurface)"

# DEAD-FIXTURES-001: 3 hardcoded fixture arrays +
# 2 lookup helpers in market-fixtures.ts have been
# removed. Each one shipped mock data with
# fabricated reputation strings (fulfill: 99% / 95% /
# 98% / 99% for MARKET_HOSTS) or hardcoded "现
# 在" / "附近" lens labels. None of the 3 arrays
# (MARKET_EXPERIENCES, MARKET_HOSTS,
# MARKET_OPPORTUNITIES) or the 2 helpers (marketHost,
# marketExperience) was referenced by any production
# code path. The 2 dead interfaces MarketHost and
# MarketExperience are also gone. Tripwire: no
# re-introduction of these symbols.
DEAD_FIXTURES_GUARDS=(
  "MARKET_EXPERIENCES"
  "MARKET_HOSTS"
  "MARKET_OPPORTUNITIES"
  "marketHost"
  "marketExperience"
  "interface MarketHost"
  "interface MarketExperience"
)
for sym in "${DEAD_FIXTURES_GUARDS[@]}"; do
  if grep -rE "(\\b$sym\\b|\\b$sym\\(|\\b$sym:)" apps/mobile/src/ 2>/dev/null | grep -v "^\\s*//" | grep -v "apps/mobile/src/market-fixtures.ts:" >/dev/null; then
    echo "  FAIL [DEAD-FIXTURES-001]: $sym still referenced outside market-fixtures.ts" >&2
    exit 1
  fi
done
echo "    DEAD-FIXTURES-001: PASS (no dead fixture arrays / lookup helpers / dead interfaces)"

require_test "POST-REACTION-TRUTH-001" "./internal/engagement" \
  "TestPostReactionTruthToggleAndRemountHydration" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
require_test "POST-COMMENT-VISIBILITY-001" "./internal/engagement" \
  "TestPostCommentVisibilityRefreshesListAndCount" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
pnpm --dir apps/mobile exec vitest run src/post-engagement-model.test.ts src/engagement-client.test.ts || exit $?
echo "    POST-REACTION-TRUTH-001/POST-COMMENT-VISIBILITY-001: PASS"

require_test "SCENE-DYNAMIC-CONTEXT-001" "./internal/realityscene" \
  "TestR27DynamicSceneSwitchesWholeContext" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-DYNAMIC-CONTEXT-001" "./internal/api" \
  "TestR27SceneReadSurface" \
  "apps/api-go/internal/api/reality_scene_test.go" || exit $?
echo "    SCENE-DYNAMIC-CONTEXT-001: PASS (variant switches human/menu/live context; action truth boundaries pinned)"
pnpm --dir apps/mobile exec vitest run src/surfaces/dynamic-scene-actions.test.ts || exit $?
echo "    SCENE-ACTION-MATERIALIZATION-001: PASS (invite/opportunity/activity use independent domain commands)"

# SCENE-MEDIA-001: 场景详情必须永远带图（hero/菜单/真人头像），否则
# 移动端 validator 整页拒绝，用户看到空白场景。按 variant 全覆盖。
require_test "SCENE-MEDIA-001" "./internal/realityscene" \
  "TestSceneDetailAlwaysCarriesImagery" \
  "apps/api-go/internal/realityscene/scene_media_test.go" || exit $?

# WATERMARK-001: 店铺/菜单照片远端展示必须带保密暗水印（统一管线）。
# 变体生成时烧录 Proxy 短 ID + 日期；无 ffmpeg 环境跳过 e2e。
require_test "WATERMARK-001" "./internal/media" \
  "TestWatermarkRenderDeterministic" \
  "apps/api-go/internal/media/watermark_test.go" || exit $?
require_test "WATERMARK-001" "./internal/media" \
  "TestWatermarkBurnedIntoVariant" \
  "apps/api-go/internal/media/watermark_test.go" || exit $?
require_test "WATERMARK-001" "./internal/media" \
  "TestWatermarkBurnedIntoVariantV2" \
  "apps/api-go/internal/media/watermark_test.go" || exit $?

# PREFS-001: 推荐偏好设置落本地，退出重进保留；损坏文件回退默认。
pnpm --dir apps/mobile exec vitest run src/expo-feed-prefs-store.test.ts || exit $?

# AI-PERSONA-PERSIST-001: AI 小美账户和肖像授权不能只活在 API 进程
# 内存里；撤回后同条款重新授权必须追加新审计行，而不是撞唯一约束。
require_test "AI-PERSONA-PERSIST-001" "./internal/platform/postgres" \
  "TestAIPersonaPostgresPersistsPersonaAndReconsent" \
  "apps/api-go/internal/platform/postgres/aipersona_test.go" || exit $?
require_test "JURISDICTION-PERSIST-001" "./internal/platform/postgres" \
  "TestJurisdictionPostgresSurvivesServiceRestart" \
  "apps/api-go/internal/platform/postgres/jurisdiction_test.go" || exit $?

# MUTED-AUTHORS-001: engagement.muted_authors 表从未被任何迁移建过，但
# MuteAuthor 是完整功能链（service 命令 + Repository 接口 + network.go
# SQL 实现 + main.go 生产接线）。PG 模式每次 mute 42P01（relation does
# not exist），service 吞成 MUTE_AUTHOR_FAILED；IsMuted feed 过滤同样挂。
# 内存 service 测试全绿掩盖——dialog/voucher 42601、friendship 42P10
# 同 class。Migration 078 建表（UNIQUE pair 既是幂等键也是 arbiter）；
# lifecycle 测试钉死插入 + 幂等重 mute + IsMuted 全链路。
require_test "MUTED-AUTHORS-001" "./internal/platform/postgres" \
  "TestMutedAuthorsPostgresLifecycle" \
  "apps/api-go/internal/platform/postgres/muted_authors_integration_test.go" || exit $?
require_test "MUTED-AUTHORS-002" "./internal/platform/postgres" \
  "TestMutedAuthorsFeedFilterLifecycle" \
  "apps/api-go/internal/platform/postgres/muted_feed_filter_integration_test.go" || exit $?
if ! grep -q 'NOT EXISTS' apps/api-go/internal/platform/postgres/network.go || \
   ! grep -q 'engagement.muted_authors' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [MUTED-AUTHORS-002]: feed mute filter must stay in ListFeedPage SQL" >&2
  exit 1
fi
if ! grep -q 'engagement.muted_authors' apps/api-go/migrations/078_muted_authors.sql; then
  echo "  FAIL [MUTED-AUTHORS-001]: muted_authors migration must stay" >&2
  exit 1
fi

# SYNC-FS-001: File.json() 在 Expo 57 返回 Promise——同步消费拿到 Promise
# 对象，Array.isArray 恒 false，五个本地持久化读路径全部静默回退默认
# （左滑删掉的会话重进复活、偏好/自定频道/创作者草稿永不恢复）。
# 修复 = 全部读入口 await 化 + 纯解析层 local-snapshot.ts（单测覆盖）+
# mock 如实模拟 async 形态。supersedes HIDDEN-CHATS-001（同一 bug 的
# 全类收网版；hidden-chats 分支只修了 hidden 一点且已被本修复覆盖）。
pnpm --dir apps/mobile exec vitest run src/local-snapshot.test.ts src/sync-fs-persist.test.ts || exit $?
if ! grep -q 'await hiddenChatsFile.json()' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [SYNC-FS-001]: hidden chats read must await json()" >&2
  exit 1
fi
# MSG-GROUPS-TAB-001: foldersFile 读入口已随自建文件夹一起摘掉 ——
# 不再要求它存在（剩下的读入口照旧全 await）。
if grep -q 'foldersFile' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [SYNC-FS-001]: folders persistence remnants back" >&2
  exit 1
fi
if ! grep -q 'await creatorFile.json()' apps/mobile/src/surfaces/creator-application.tsx; then
  echo "  FAIL [SYNC-FS-001]: creator draft read must await json()" >&2
  exit 1
fi
if ! grep -q 'await snapshotFile.json()' apps/mobile/src/expo-feed-prefs-store.ts; then
  echo "  FAIL [SYNC-FS-001]: feed prefs read must await json()" >&2
  exit 1
fi
if ! grep -q 'await snapshotFile.json()' apps/mobile/src/expo-custom-feed-store.ts; then
  echo "  FAIL [SYNC-FS-001]: custom feeds read must await json()" >&2
  exit 1
fi
if ! grep -q 'async json(): Promise<unknown>' apps/mobile/src/expo-feed-prefs-store.test.ts; then
  echo "  FAIL [SYNC-FS-001]: mocks must model the real async File.json()" >&2
  exit 1
fi
echo "    SYNC-FS-001: PASS (5 read paths await json() + pure parse layer + honest mocks)"
# OPP-TEMPLATE-001: 发布需求目录（热门/主题/更多）。PublishDemand 原是
# 自由文本编辑器；R49 原型要求"选场景卡 → 确认服务"三段式。目录是
# server 内置静态读模型（16 卡：HOT=6 THEME=4 MORE=6），每卡带发布
# 表单默认值（tags/参考价/参考区间/合规服务标准——公共场所+现场消费
# 自结口径）。ListOpportunityTemplates 只读匿名可调（与
# ListMarketOpportunities 同层）；PublishMarketOpportunity wire 契约
# 零改动——卡片只做 prefill，写路径单一 choke point 不变。
require_test "OPP-TEMPLATE-001" "./internal/marketplace" \
  "TestListOpportunityTemplates" \
  "apps/api-go/internal/marketplace/templates_test.go" || exit $?
require_test "OPP-TEMPLATE-002" "./internal/marketplace" \
  "TestOpportunityTemplatesArePublishableAsIs" \
  "apps/api-go/internal/marketplace/templates_test.go" || exit $?
if ! grep -q 'ListOpportunityTemplates' apps/api-go/internal/api/command_dispatch.go; then
  echo "  FAIL [OPP-TEMPLATE-001]: anonymous dispatch registration must stay" >&2
  exit 1
fi
if ! grep -q 'ListOpportunityTemplatesPayloadSchema' packages/contracts/src/index.ts; then
  echo "  FAIL [OPP-TEMPLATE-001]: contracts wire schema must stay" >&2
  exit 1
fi
if ! grep -q 'listTemplates' apps/mobile/src/marketplace-client.ts; then
  echo "  FAIL [OPP-TEMPLATE-001]: mobile client method must stay" >&2
  exit 1
fi

# OPP-TARGETED-001/002: 定向邀约（选人 → 向 TA 发出邀约）。R49 原型
# 的"邀约给 TA"：发布 payload 带 targetUserId 时 server 把机会快照为
# targetAccountId 非空 — List 只对目标人和 owner 可见，Apply 只收
# 目标人（旁路拿 id 打命令也拒）；禁止定向给自己。缺省 = 公开卡，
# 老行为零变化（Go 守护测试 + Zod 老 payload 向后兼容测试钉死）。
# PG 无迁移：Opportunity 走 payload JSONB，targetAccountId 落在快照里。
require_test "OPP-TARGETED-001" "./internal/marketplace" \
  "TestTargetedOpportunityVisibilityAndApply" \
  "apps/api-go/internal/marketplace/targeted_test.go" || exit $?
require_test "OPP-TARGETED-002" "./internal/marketplace" \
  "TestPublicOpportunityUnchangedBesideTargeted" \
  "apps/api-go/internal/marketplace/targeted_test.go" || exit $?
if ! grep -q 'targetAccountId' packages/contracts/src/index.ts; then
  echo "  FAIL [OPP-TARGETED-001]: contracts wire field must stay" >&2
  exit 1
fi
if ! grep -q 'targetUserId' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [OPP-TARGETED-001]: mobile publish wiring must stay" >&2
  exit 1
fi

# OPP-SUGGEST-001: 发布搜索"生成" — 语义层把自由文本映射到目录卡。
# SuggestOpportunityTemplate 走 modelstack.Port（与 conversation 同一
# 适配器），fail-closed：未配置 AI_NOT_CONFIGURED、LLM 幻觉 id 服务端
# 白名单拒（SUGGESTION_MALFORMED）、无匹配 SUGGESTION_NO_MATCH —
# 不许正则硬解。命中返回目录卡原文（零编造字段）。
require_test "OPP-SUGGEST-001" "./internal/marketplace" \
  "TestSuggestOpportunityTemplate" \
  "apps/api-go/internal/marketplace/suggest_test.go" || exit $?
if ! grep -q 'SuggestOpportunityTemplate' apps/api-go/internal/api/command_dispatch.go; then
  echo "  FAIL [OPP-SUGGEST-001]: anonymous dispatch registration must stay" >&2
  exit 1
fi
if ! grep -q 'SuggestOpportunityTemplatePayloadSchema' packages/contracts/src/index.ts; then
  echo "  FAIL [OPP-SUGGEST-001]: contracts wire schema must stay" >&2
  exit 1
fi
if ! grep -q 'suggestTemplate' apps/mobile/src/marketplace-client.ts; then
  echo "  FAIL [OPP-SUGGEST-001]: mobile client method must stay" >&2
  exit 1
fi

# OPP-CATALOG-001/002 (R58): 目录引擎 — 分类轨道 + Moment 规格/比例
# 政策/动态定价 + 活动预设，全部服务端数据源（客户端不硬编码词表）。
# 一次匿名读命令 ListOpportunityTemplates 全量下发；跨引用坏链 =
# 目录 bug，Go 守护测试钉死。
require_test "OPP-CATALOG-001" "./internal/marketplace" \
  "TestCatalogCategoriesResolveToRealTemplates" \
  "apps/api-go/internal/marketplace/catalog_engine_test.go" || exit $?
require_test "OPP-CATALOG-001" "./internal/marketplace" \
  "TestCatalogSpecsAndPoliciesCoverEveryTemplate" \
  "apps/api-go/internal/marketplace/catalog_engine_test.go" || exit $?
require_test "OPP-CATALOG-001" "./internal/marketplace" \
  "TestCatalogPricingRulesMatchSpecDimensions" \
  "apps/api-go/internal/marketplace/catalog_engine_test.go" || exit $?
require_test "OPP-CATALOG-002" "./internal/marketplace" \
  "TestCatalogSnapshotSerializesWholeEngine" \
  "apps/api-go/internal/marketplace/catalog_engine_test.go" || exit $?
require_test "OPP-CATALOG-002" "./internal/marketplace" \
  "TestListOpportunityTemplatesShipsWholeEngine" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
if ! grep -q 'buildCatalogSnapshot' apps/api-go/internal/marketplace/service.go; then
  echo "  FAIL [OPP-CATALOG-001]: service dispatch must serve the engine snapshot" >&2
  exit 1
fi
if ! grep -q 'activityPresets' apps/api-go/internal/marketplace/service.go; then
  echo "  FAIL [OPP-CATALOG-002]: wire payload must forward activity presets (R58 activity line)" >&2
  exit 1
fi
if ! grep -q 'activityPresets' packages/contracts/src/index.ts; then
  echo "  FAIL [OPP-CATALOG-002]: contracts activity presets schema must stay" >&2
  exit 1
fi
if ! grep -q 'listCatalog' apps/mobile/src/marketplace-client.ts; then
  echo "  FAIL [OPP-CATALOG-001]: mobile catalog client must stay" >&2
  exit 1
fi
if ! grep -q 'momentPriceQuote' apps/mobile/src/market-template-price.ts; then
  echo "  FAIL [OPP-CATALOG-001]: dynamic pricing math must stay unit-tested" >&2
  exit 1
fi
if ! grep -q 'formatTraceId' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [R58-TRACE]: success-screen trace id must stay" >&2
  exit 1
fi

# CHROME-PARITY-001: HOME / MESSAGES 主信息流的滑动显隐从未接线——
# RequesterHome 内部 handler 代码就绪但壳没传 onChromeVisibilityChange
# （死代码），MessagesSurface prop 声明在类型里但收不到信号。四主信息流
# （FEED/MARKET/HOME/MESSAGES）统一上滑藏、下滑/回顶显（阈值 -18/+28，
# 回顶 48px 强制显）。selectors 的 home/message 信号是 optional——未接线
# 的调用方保持常显（向后兼容）。MARKET 走共享 feedChromeVisible 是
# commander 09-10 的简化设计，保留不动。
if ! grep -q 'lets the %s stream hide chrome like Feed (chrome-parity)' apps/mobile/src/shell/app-shell.test.ts; then
  echo "  FAIL [CHROME-PARITY-001]: selector parity test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/shell/app-shell.test.ts || exit $?
if ! grep -q 'onChromeVisibilityChange={setHomeChromeVisible}' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [CHROME-PARITY-001]: HOME chrome signal wiring must stay" >&2
  exit 1
fi
if ! grep -q 'onChromeVisibilityChange={setMessageChromeVisible}' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [CHROME-PARITY-001]: MESSAGES chrome signal wiring must stay" >&2
  exit 1
fi
if ! grep -q 'onScroll={onInboxScroll}' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [CHROME-PARITY-001]: messages inbox scroll handler must stay" >&2
  exit 1
fi
echo "  CHROME-PARITY-001: PASS (HOME/MESSAGES scroll chrome parity + optional legacy fallback)"

echo "  regression contracts: OK"

# ACCOUNT-SWITCH-001: same-phone account switch (logout A -> login B) was
# REJECTED forever: revokeSession never released the device row and
# upsertDevice's owner guard was absolute ("device belongs to another user").
# The memory repo had NO guard on the fresh-identity path, so in-memory
# service tests stayed green while PG mode rejected every switch — the same
# class as friendship 42P10 / muted_authors 42P01. Fix: takeover device
# binding — a different account may claim the device only when it has no
# ACTIVE session; one-active-account-per-device stays intact (pinned by
# the same test, step 2). Full 8-step chain incl. switch-back round-trip.
require_test "ACCOUNT-SWITCH-001" "./internal/platform/postgres" \
  "TestAccountSwitchSameDeviceLifecycle" \
  "apps/api-go/internal/platform/postgres/account_switch_integration_test.go" || exit $?

# ACCOUNT-MULTIDEVICE-001: same account on multiple real phones — pinned
# end-to-end (Begin -> Verify -> CreateSession): two devices coexist ACTIVE
# (MaxConcurrentSessions=2), tokens are per-device distinct, and the THIRD
# login FIFO-evicts the OLDEST session (AUTO_EVICT_NEW_LOGIN, the
# WhatsApp "logged in on another device" behavior). The evicted token must
# be dead; the surviving device's token keeps resolving to the account.
require_test "ACCOUNT-MULTIDEVICE-001" "./internal/platform/postgres" \
  "TestAccountMultiDeviceSameAccount" \
  "apps/api-go/internal/platform/postgres/account_multidevice_integration_test.go" || exit $?

# OTP-BRUTEFORCE-001: a single challenge locks after MaxAttempts=5 wrong
# codes (5th wrong -> LOCKED, correct code then REJECTED) and an expired
# challenge (5-minute TTL) rejects even the correct code — both verifications
# and CreateSession check status/attempt count and expiry. Industry-standard
# bounded-attempt defense, pinned so nobody lifts the caps.
require_test "OTP-BRUTEFORCE-001" "./internal/platform/postgres" \
  "TestLoginChallengeBruteForceLockout" \
  "apps/api-go/internal/platform/postgres/otp_protection_integration_test.go" || exit $?

# OTP-SINGLE-CODE-001: a fresh code supersedes every PENDING one — only the
# MOST RECENT code per identifier is verifiable (WhatsApp / Telegram /
# Twilio Verify). Previously an identity could hold unlimited concurrent
# PENDING codes, each with its own 5 attempts. Supersede + insert + events
# happen in one transaction (CreateLoginChallengeSupersedingPending), and
# the superseded code rejects even the CORRECT code afterwards.
require_test "OTP-SINGLE-CODE-001" "./internal/platform/postgres" \
  "TestLoginChallengeSingleActiveCode" \
  "apps/api-go/internal/platform/postgres/otp_protection_integration_test.go" || exit $?

# OTP-THROTTLE-001: code DELIVERY is throttled per identifier (Twilio
# Verify ladder: 1/min, 10/hour) — peek before the provider is charged,
# record only after the provider accepted, so a rejected begin (device
# guard) never burns the user's resend allowance. Without this a caller
# could mint unlimited fresh codes, each with 5 attempts, resetting the
# brute-force cap forever.
require_test "OTP-THROTTLE-001" "./internal/platform/postgres" \
  "TestLoginChallengeRequestThrottle" \
  "apps/api-go/internal/platform/postgres/otp_protection_integration_test.go" || exit $?

# OTP-RESEND-COOLDOWN-001: 服务端限流了，客户端却还摆着一个按下去必然失败的按钮。
#
# OTP-THROTTLE-001 只管服务端（1/min、10/hour），拒绝时把还要等多久放在
# safeDetails.retryAfterSeconds。客户端此前完全不读它：native-app.tsx 的「重新发送」
# 只按 busy 置灰，用户点下去拿到一句错误，按钮立刻又能点 —— 冷却期内反复点、反复错。
#
# 这里钉四件事：协议层真的解析了 safeDetails、界面层**真的调了**解析函数（不是只
# import 了它）、解析结果真的喂给了冷却状态、以及重发按钮真的被冷却禁用。
# 另外反向钉禁止把秒数写死 —— 写死等于把服务端常量抄一份，改一边就漂。
#
# 钉调用点而不是函数名：只 `grep otpRetryAfterSeconds` 会被 import 行喂绿
# （第一版就这么写的，注入删掉调用点后照样绿）。
if ! grep -q 'OTP-RESEND-COOLDOWN-001' apps/mobile/src/login-client.test.ts ||
   ! grep -q 'export function otpRetryAfterSeconds' apps/mobile/src/login-client.ts ||
   ! grep -q 'otpRetryAfterSeconds(err)' apps/mobile/src/native-app.tsx ||
   ! grep -q 'setResendCooldown(wait)' apps/mobile/src/native-app.tsx ||
   ! grep -q 'disabled={busy || resendCoolingDown}' apps/mobile/src/native-app.tsx; then
  echo "  FAIL [OTP-RESEND-COOLDOWN-001]: OTP 重发冷却没接上 ——" >&2
  echo "        服务端限流拒绝后，客户端必须按 safeDetails.retryAfterSeconds 倒计时并禁用重发。" >&2
  exit 1
fi
# 反向钉：不许把服务端的限流窗口抄进客户端。匹配"直接传字面量"和"先赋给变量再传"
# 两种写法 —— 只匹配前者的话，把解析换成 `const wait = 60;` 就能绕过（第一版实测漏了）。
# 用 [1-9] 而不是 [0-9]：「更换手机号/邮箱」里那句重置是合法的 setResendCooldown(0)，
# 写成 [0-9] 会把它一起误伤（第二版实测基线直接红了）。
if grep -qE 'setResendCooldown\([1-9]' apps/mobile/src/native-app.tsx ||
   grep -qE '(const|let) wait = [1-9]' apps/mobile/src/native-app.tsx; then
  echo "  FAIL [OTP-RESEND-COOLDOWN-001]: 冷却秒数被写死在客户端 ——" >&2
  echo "        要读 safeDetails.retryAfterSeconds，别抄一份服务端常量。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/login-client.test.ts || exit $?
echo "    OTP-RESEND-COOLDOWN-001: PASS (client honours the server's retryAfterSeconds instead of leaving a dead resend button)"

# AUTH-CODE-LABEL-001: 验证码按钮文案只有「获取验证码」一种。
#
# 注册页此前按渠道拆成两个按钮（「获取邮箱验证码」+「获取手机验证码」），登录页的
# EMAIL 分支也单独叫「获取邮箱验证码」。设计标准
# docs/design/references/Proxy_Auth_Standard_UI_v7.html 里只有「获取验证码」一种叫法。
# 按渠道拆开会让同一个动作在界面上有两个名字，也把「到底该按哪个」变成用户要自己
# 判断的事 —— 而渠道本来就该由「填了哪个标识」决定。
#
# 现在三处（注册 / 登录邮箱 / 登录手机）统一为一个叫法；注册页邮箱与手机之间用
# OR 分隔，两栏都可以填，都填了以邮箱为准。
#
# 钉两件事：正向钉「按钮和 OR 分隔都还在」，反向钉「不许再出现按渠道分开的叫法」。
# 反向钉只扫 apps/mobile/src —— 不能扫全仓，否则本文件自己就是一处命中（自喂红）。
#
# 正向钉必须**先剥注释再 grep**。native-app.tsx 的注释里就有「获取验证码」四个字
# （说明设计标准那段），不剥的话正向钉是空的：实测把三处按钮文案全换成「继续」，
# 钉照样 PASS，因为注释里还剩 3 处命中。剥两类注释：`//` 整行 与 JSX 的 `{/* */}` 整行。
auth_code_label_code=$(grep -vE '^[[:space:]]*(//|\{/\*)' apps/mobile/src/native-app.tsx)
if ! printf '%s\n' "$auth_code_label_code" | grep -qF '获取验证码' ||
   ! printf '%s\n' "$auth_code_label_code" | grep -qF 'styles.orRow'; then
  echo "  FAIL [AUTH-CODE-LABEL-001]: 认证页的「获取验证码」按钮或 OR 分隔不见了 ——" >&2
  echo "        注册页邮箱/手机共用一个按钮、中间用 OR 分隔（见 Proxy_Auth_Standard_UI_v7）。" >&2
  exit 1
fi
auth_code_label_offenders=$(grep -rnE '获取邮箱验证码|获取手机验证码' apps/mobile/src 2>/dev/null || true)
if [ -n "$auth_code_label_offenders" ]; then
  echo "  FAIL [AUTH-CODE-LABEL-001]: 又出现了按渠道分开的验证码按钮叫法 ——" >&2
  echo "$auth_code_label_offenders" | sed 's/^/    - /' >&2
  echo "        设计标准里只有「获取验证码」一种；渠道由填了哪个标识决定，不要拆成两个按钮。" >&2
  exit 1
fi
echo "    AUTH-CODE-LABEL-001: PASS (single code-button label; channel decided by which identifier is filled)"

# DEVICE-METROHOST-001: a `MetroHost` key committed into the *versioned*
# apps/mobile/ios/Proxy/Info.plist pins every device to one LAN IP and
# COMPLETELY bypasses AppDelegate.bundleURL()'s Bonjour fallback — so the next
# DHCP lease change leaves the phone stuck on "Could not connect to the
# development server" with no recovery short of a native rebuild.
# Escaped 2026-09-12: commit d4dadba baked in the then-current 192.168.115.138
# to work around a stale on-device mDNS cache; hours were lost before anyone
# thought to read the plist.
#
# The escape hatch is now a *launch-time* environment variable, which needs no
# file edit and no rebuild:
#   METRO_HOST=192.168.1.23 ./scripts/dev-ios-device.sh install
# So the tracked plist must stay clean. Three pins: the key stays absent, the
# env override stays wired, and the Bonjour fallback is not deleted in a
# misguided attempt to "fix" the plist.
if grep -q '<key>MetroHost</key>' apps/mobile/ios/Proxy/Info.plist; then
  echo "  FAIL [DEVICE-METROHOST-001]: apps/mobile/ios/Proxy/Info.plist hardcodes MetroHost." >&2
  echo "        That bypasses AppDelegate's Bonjour fallback and pins every device to one LAN IP." >&2
  echo "        Delete the <key>MetroHost</key> / <string>...</string> pair." >&2
  echo "        For an emergency override use: METRO_HOST=<ip> ./scripts/dev-ios-device.sh install" >&2
  echo "        See docs/development/SOP_DYNAMIC_IP_DEVICES.md §7.1." >&2
  exit 1
fi
if ! grep -q 'environment\["METRO_HOST"\]' apps/mobile/ios/Proxy/AppDelegate.swift; then
  echo "  FAIL [DEVICE-METROHOST-001]: AppDelegate.swift no longer honours the METRO_HOST env override." >&2
  echo "        Without it there is no rebuild-free way to point a device at Metro," >&2
  echo "        which is exactly what tempted someone into committing MetroHost." >&2
  exit 1
fi
if ! grep -qE '"[A-Za-z0-9._-]+\.local"' apps/mobile/ios/Proxy/AppDelegate.swift; then
  echo "  FAIL [DEVICE-METROHOST-001]: AppDelegate.swift lost its Bonjour (.local) host fallback." >&2
  echo "        Removing the fallback re-breaks every device the moment the Mac IP changes." >&2
  exit 1
fi
echo "    DEVICE-METROHOST-001: PASS (no committed MetroHost; env override + Bonjour fallback intact)"

# ---------------------------------------------------------------------------
# Escaped 2026-09-12 — three P0s that no gate covered. They are recorded here
# in the order they were reported: the messages-list oscillation, the missing
# feed posts, and the black images.
# ---------------------------------------------------------------------------

# SCROLL-CHROME-001: hiding the shell chrome while scrolling used to feed back
# into the scroll itself. Hiding unmounts the shell Header (the Otter logo
# lives there) and shrinks several surfaces' bottom padding, so the scroll
# container's content height drops; the current offset is then past the end, RN
# clamps it, and the clamp arrives as a NEGATIVE-delta scroll event — which the
# same controller reads as "user scrolling up" and shows the chrome again.
# Infinite oscillation: the messages list snapped back to the middle and the
# logo blinked on and off. Six surfaces each carried their own copy of the
# rule, so the fix is a shared controller that ignores scroll events until the
# layout has settled.
for surface in messages feed market me requester-home business-home; do
  if ! grep -q 'useScrollChrome' "apps/mobile/src/surfaces/${surface}.tsx"; then
    echo "  FAIL [SCROLL-CHROME-001]: apps/mobile/src/surfaces/${surface}.tsx does not use the shared scroll-chrome controller." >&2
    echo "        A hand-rolled copy re-introduces the hide/show feedback loop." >&2
    echo "        Use useScrollChrome() from apps/mobile/src/shell/scroll-chrome.ts." >&2
    exit 1
  fi
done
if ! grep -q 'SCROLL-CHROME-001' apps/mobile/src/shell/scroll-chrome.test.ts; then
  echo "  FAIL [SCROLL-CHROME-001]: the scroll-chrome regression test is missing." >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/shell/scroll-chrome.test.ts || exit $?
echo "    SCROLL-CHROME-001: PASS (settle guard kills the clamp echo; all 6 surfaces on the shared controller)"

# FEED-SCOPE-001: the feed's default time scope was "7D", a window that rolls
# against Date.now(). Posts silently aged out of the timeline — measured at
# 24 of 39 posts (62%) hidden — with no indicator anywhere that a filter was
# active, so it read as "the data is gone". The API was never at fault.
if ! grep -q 'FEED-SCOPE-001' apps/mobile/src/expo-feed-prefs-store.test.ts ||
   ! grep -q 'scope: "PERSISTENT"' apps/mobile/src/expo-feed-prefs-store.ts; then
  echo "  FAIL [FEED-SCOPE-001]: the feed default scope regressed to a rolling window." >&2
  echo "        A rolling default hides posts silently; time range is a user choice, not a default." >&2
  exit 1
fi
# The filter itself must be the shared, tested predicate — not a second inline
# copy in the surface. Two copies had already drifted (the banner over-counted).
if ! grep -q 'isPostWithinScope' apps/mobile/src/surfaces/feed.tsx ||
   ! grep -q 'FEED-SCOPE-001' apps/mobile/src/feed-scope-filter.test.ts; then
  echo "  FAIL [FEED-SCOPE-001]: feed.tsx no longer uses the shared, tested scope predicate." >&2
  echo "        Inline copies of this filter drift apart and silently hide content." >&2
  exit 1
fi
if ! grep -q 'feed-scope-banner-v1' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-SCOPE-001]: the feed no longer tells the user that a time filter is active." >&2
  echo "        Silent filtering is what made this look like data loss." >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/expo-feed-prefs-store.test.ts src/feed-scope-filter.test.ts || exit $?
echo "    FEED-SCOPE-001: PASS (default is long-lived; explicit 7D/30D still honoured; shared predicate; filter is visible)"

# MEDIA-FILE-001: the read model advertised URLs for media whose bytes were
# gone. 104 of 528 READY variants (19.7%, across 27 assets) had no file behind
# them; expo-image renders a failed request as nothing, so the parent's dark
# background showed through as a black rectangle — indistinguishable from "this
# post has no image".
require_test "MEDIA-FILE-001" "./internal/media" \
  "TestPostMediaLookupDoesNotAdvertiseMissingFiles" \
  "apps/api-go/internal/media/media_file_gating_test.go" || exit $?
require_test "MEDIA-FILE-001" "./internal/media" \
  "TestMediaFilePresenceRejectsMissingAndTraversalKeys" \
  "apps/api-go/internal/media/media_file_gating_test.go" || exit $?
# MEDIA-FILE-001 (second instance): static repo assets resolved from a bare
# relative path. The AI persona photos are not media_variants rows, so the DB
# sweep cannot see them — they 404'd from the API's real working directory
# (apps/api-go) and the home screen rendered five empty frames.
require_test "MEDIA-FILE-001" "./internal/api" \
  "TestResolveRepoDirFindsAssetsFromNestedWorkingDir" \
  "apps/api-go/internal/api/aipersona_assets_test.go" || exit $?
for client_file in media-fallback.tsx AdaptiveMediaCollection.tsx SocialMediaFrame.tsx; do
  if ! grep -q 'media-unavailable-v1\|isMediaUnavailable\|UnavailableMedia' "apps/mobile/src/media/${client_file}"; then
    echo "  FAIL [MEDIA-FILE-001]: apps/mobile/src/media/${client_file} lost the labelled media placeholder." >&2
    echo "        Without it a failed image renders as a black frame again." >&2
    exit 1
  fi
done
if ! grep -q 'media object MISSING' apps/api-go/internal/api/media_handlers.go; then
  echo "  FAIL [MEDIA-FILE-001]: serving a missing media object no longer logs distinctly." >&2
  echo "        Success and failure used to log the identical line, which is why 104 dead URLs went unnoticed." >&2
  exit 1
fi
# Live DB <-> disk sweep. The unit test pins the code contract; this pins the
# data. It needs the dev postgres, so it skips loudly rather than lie.
if curl -sf --noproxy '*' --max-time 3 http://127.0.0.1:4100/health/ready >/dev/null 2>&1; then
  (cd apps/api-go && PROXY_MEDIA_STORE_DIR="${PROXY_MEDIA_STORE_DIR:-$HOME/Developer/kake-data/media_store}" \
    go run ./cmd/media-audit --check-files) || exit $?
  echo "    MEDIA-FILE-001: PASS (live store sweep: no READY object without bytes)"
  # And the end-to-end view: every media URL the feed actually hands out must
  # resolve. A 404 here is precisely the black frame the user reported.
  # NO_PROXY: some dev shells export an HTTP_PROXY that blackholes 127.0.0.1.
  NO_PROXY='*' no_proxy='*' node scripts/check-feed-media-urls.mjs || exit $?
  echo "    MEDIA-FILE-001: PASS (feed media URLs all resolve)"
else
  echo "    MEDIA-FILE-001: SKIP (dev API is down — live checks need postgres; run go -C apps/api-go run ./cmd/media-audit --check-files and node scripts/check-feed-media-urls.mjs)"
fi

# AI-ROW-DUPE-001: Home rendered the same AI catalogue twice. The upper AI
# assistants row and the lower "AI 推荐" row both read /v1/ai/assistants, so the
# screen showed two identical horizontal rails both labelled AI 生成. Reading
# the same server data twice is invisible in code review — it only shows up on
# the device — so the gate pins the single-row contract in the discovery test
# instead of trusting the deletion.
if ! grep -q 'AI-ROW-DUPE-001' apps/mobile/src/requester-home-discovery-contract.test.ts; then
  echo "  FAIL [AI-ROW-DUPE-001]: the single-AI-row regression test is missing." >&2
  exit 1
fi
if grep -q '<AIAssistantsRow' apps/mobile/src/surfaces/requester-home.tsx; then
  echo "  FAIL [AI-ROW-DUPE-001]: requester-home mounts a second AI row again." >&2
  echo "        Both rows read /v1/ai/assistants, so the screen shows the same five AI twice." >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/requester-home-discovery-contract.test.ts || exit $?
echo "    AI-ROW-DUPE-001: PASS (home renders exactly one AI row)"

# COMP-CHAT-001: a paid engagement must keep an auditable thread. The chat was
# modelled on a privacy messenger, so every DM defaults to burn-after-read,
# view caps and screenshot blocking. On a marketplace where users pay each
# other to meet, that combination is the fact pattern used to argue the
# platform knowingly facilitated brokering — a criminal exposure for the
# operators, not a fine. Anti-leak stays for social conversations and is
# locked off wherever money moves (OriginType TASK/SERVICE/ACTIVITY/NEED/
# OFFER/ORDER), with the server — not the client — doing the refusing.
require_test "COMP-CHAT-001" "./internal/conversation" \
  "TestTransactionLinkedProtectionIsAuditable" \
  "apps/api-go/internal/conversation/message_protection_compliance_test.go" || exit $?
require_test "COMP-CHAT-001" "./internal/conversation" \
  "TestApplyWithPolicyRefusesEphemeralOverridesOnTransaction" \
  "apps/api-go/internal/conversation/message_protection_compliance_test.go" || exit $?
require_test "COMP-CHAT-001" "./internal/conversation" \
  "TestPolicyForOriginLocksEveryPaidOrigin" \
  "apps/api-go/internal/conversation/message_protection_compliance_test.go" || exit $?
# Enforcement has to live in the send path. A client-side check can be
# patched out of an installed build in minutes.
if ! grep -q 'ApplyWithPolicy' apps/api-go/internal/conversation/service.go ||
   ! grep -q 'IsTransactionLinkedOrigin' apps/api-go/internal/conversation/service.go; then
  echo "  FAIL [COMP-CHAT-001]: the send path no longer routes protection through the compliance policy." >&2
  echo "        Only a server-side refusal holds; a client-side check can be patched out." >&2
  exit 1
fi
# Wording matters as much as code. The original spec named its acceptance
# scenarios after pimps, sex workers and "running away"; a document that
# describes a criminal trade as the target reads as a statement of intent
# and is more damaging than any single code path. Removed on purpose.
# Extension allowlist, not a directory scan: design HTML embeds base64
# blobs that randomly contain these byte sequences and would fail the
# build on a false positive.
if git grep -niI -e 'pimp' -e '鸡头' -e '跑路' -e '小妹' -- \
     '*.go' '*.ts' '*.tsx' '*.md' '*.sql' | grep -q .; then
  echo "  FAIL [COMP-CHAT-001]: the repository names a criminal trade as a target scenario." >&2
  echo "        In an investigation this reads as a statement of intent, not an accident." >&2
  git grep -niI -e 'pimp' -e '鸡头' -e '跑路' -e '小妹' -- \
    '*.go' '*.ts' '*.tsx' '*.md' '*.sql' >&2
  exit 1
fi
echo "    COMP-CHAT-001: PASS (paid threads stay auditable; social privacy untouched)"

# COMP-ID-001: a self-destructing persona is incompatible with selling.
# E-commerce Law 122/2025 (in force 2026-07-01) bans anonymous selling, and
# burning an identity also destroyed every conversation, message and media
# conducted under it — the record of the paid engagements. Personas stay as a
# presentation layer; the self-destructing variant is refused for any account
# that has transacted, and refused outright when we cannot tell, because
# "could not check" must never become "allowed".
require_test "COMP-ID-001" "./internal/identity" \
  "TestBurnerRefusedForAccountThatTransacted" \
  "apps/api-go/internal/identity/display_identity_compliance_test.go" || exit $?
require_test "COMP-ID-001" "./internal/identity" \
  "TestBurnerRefusedWhenLookupIsMissing" \
  "apps/api-go/internal/identity/display_identity_compliance_test.go" || exit $?
require_test "COMP-ID-001" "./internal/identity" \
  "TestNonBurnerPersonasRemainAvailableToTransactingAccounts" \
  "apps/api-go/internal/identity/display_identity_compliance_test.go" || exit $?
# The guard must sit in the command handlers, not only in the helper: a
# caller that reaches Create/Burn directly would bypass a helper-only check.
if ! grep -q 'BurnerAllowedFor' apps/api-go/internal/identity/service.go ||
   ! grep -q 'BURN_FORBIDDEN_FOR_TRANSACTING_ACCOUNT' apps/api-go/internal/identity/service.go; then
  echo "  FAIL [COMP-ID-001]: persona create/burn no longer enforces the compliance guard." >&2
  echo "        A self-destructing seller identity defeats real-name selling rules." >&2
  exit 1
fi
echo "    COMP-ID-001: PASS (self-destructing personas refused once an account has transacted)"

# COMP-ID-002: the burner guard is only as strong as its answer to "has this
# account transacted?". COMP-ID-001 refuses self-destructing personas to
# accounts with money history; if the lookup behind it is a stub that always
# answers "no transactions", every seller looks clean and Vietnam's
# E-commerce Law 122/2025 (in force 2026-07-01, anonymous selling banned) is
# defeated by nothing more than a one-line shortcut. The opposite stub
# ("always yes") is just as bad: it turns the guard into a blanket refusal
# that the team learns to route around. Both directions are pinned here.
require_test "COMP-ID-002" "./internal/platform/postgres" \
  "TestTransactionHistoryRefusesEmptyAccountID" \
  "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?
require_test "COMP-ID-002" "./internal/platform/postgres" \
  "TestTransactionHistoryRefusesWhenPoolMissing" \
  "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?

# The lookup must actually query the money tables — not short-circuit.
transaction_history_file=apps/api-go/internal/platform/postgres/transaction_history.go
if ! grep -qF 'queryerForContext(ctx, r.pool).QueryRow(ctx, hasTransactedSQL' "$transaction_history_file" ||
   ! grep -qF 'payment.payment_intents' "$transaction_history_file" ||
   ! grep -qF 'payment.payout_holds' "$transaction_history_file" ||
   ! grep -qF 'payment.ledger_entries' "$transaction_history_file" ||
   ! grep -qF 'fulfillment.orders' "$transaction_history_file"; then
  echo "  FAIL [COMP-ID-002]: HasTransacted no longer reads the payment ledger." >&2
  echo "        A lookup that skips the money tables makes the burner guard decorative." >&2
  exit 1
fi
# A signature drift must break the build here, not fail open at runtime.
if ! grep -qF 'var _ identity.TransactionHistoryLookup = (*TransactionHistoryRepository)(nil)' "$transaction_history_file"; then
  echo "  FAIL [COMP-ID-002]: TransactionHistoryRepository is no longer pinned to the" >&2
  echo "        identity.TransactionHistoryLookup contract." >&2
  exit 1
fi
# Wiring: without this the lookup stays nil, which fails closed — meaning
# "nobody may use a burner" instead of "sellers may not", and the real check
# silently never runs.
if ! grep -qF 'SetTransactionHistoryLookup' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'NewTransactionHistoryRepository' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [COMP-ID-002]: the money-side lookup is no longer wired in cmd/api/main.go." >&2
  exit 1
fi
# The database-backed half runs whenever a Postgres is reachable. Locally the
# test helper boots its own throwaway cluster, so an unset DATABASE_URL is
# fine; with no cluster and no DATABASE_URL those tests skip rather than fail
# a developer's machine.
if [ -n "${DATABASE_URL:-}" ] || command -v pg_ctl >/dev/null 2>&1; then
  require_test "COMP-ID-002" "./internal/platform/postgres" \
    "TestTransactionHistoryDetectsPayingRequester" \
    "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?
  require_test "COMP-ID-002" "./internal/platform/postgres" \
    "TestTransactionHistoryDetectsEarningAgent" \
    "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?
  require_test "COMP-ID-002" "./internal/platform/postgres" \
    "TestTransactionHistoryDetectsHeldPayout" \
    "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?
  require_test "COMP-ID-002" "./internal/platform/postgres" \
    "TestTransactionHistoryDetectsLedgerEntryOnOrder" \
    "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?
  require_test "COMP-ID-002" "./internal/platform/postgres" \
    "TestBurnerRefusedForAccountWithRealPaymentIntent" \
    "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?
  require_test "COMP-ID-002" "./internal/platform/postgres" \
    "TestTransactionHistoryAllowsBurnerForAccountWithNoMoney" \
    "apps/api-go/internal/platform/postgres/transaction_history_compliance_test.go" || exit $?
fi
echo "    COMP-ID-002: PASS (burner guard reads the real payment tables, both stub directions pinned)"

# LC-06 / LC-07: AI 生成溯源必须真的落库 —— 否则 MarkMediaReady 上那两道
# fail-closed 合规闸门是死代码。
#
# 2026-09-21 发现：闸门本身早就写好了（internal/media/service.go）：
#   aiGenerationSource == "UNKNOWN"                 → AI_LABEL_MISSING
#   AI_PERSONA 查不到活体 likeness 同意             → AI_LIKENESS_CONSENT_MISSING
# 但 media.media_assets 当时没有这 5 列，platform/postgres/media.go 的
# INSERT / SELECT / UPDATE 也从来没提过它们。后果是双向的：
# 写入侧静默丢弃，读取侧永远是 Go 零值 ""，而闸门比的是字面量 "UNKNOWN" ——
# "" 比不过，直接放行。越南 AI 法 134/2025/QH15 第 12 条要求的
# 「AI 生成内容必须可标注、无法标注则不得发布」在生产上没有任何数据在支撑。
#
# 为什么之前没被抓住（两个盲区叠加，缺一个都会更早暴露）：
#   - media/lc06_lc07_test.go 用的是 MemoryRepository（整个结构体存 map），
#     内存路径一直是绿的；
#   - g3 的 scripts/lc06-ai-media-e2e.sh 在第 1 步就挂了（fixture 给
#     CreatePersona 编了一个没有年龄断言的 owner），走不到闸门，
#     而它的注释还声称覆盖了这两条。
#
# 所以这里钉三层，少一层洞就会回来：
#   1. 静态：三个 SQL 写点（SELECT / INSERT / UPDATE）都带这些列 ——
#      不需要数据库，任何一次重构都会被立刻拦下。
#   2. 静态：迁移必须真的 ADD COLUMN。列不存在，代码写得再对也存不进去。
#   3. 动态：真库上的往返 + 两道闸门的红→绿用例。
lc06_repo_file=apps/api-go/internal/platform/postgres/media.go
# 先剥行首注释再断言：这个文件里有一行注释正好把这几个列名列了一遍，
# 不剥的话「SELECT/INSERT 把列删了」也能被那行注释喂绿。
lc06_repo_code=$(grep -vE '^[[:space:]]*//' "$lc06_repo_file")
# SELECT：mediaAssetColumns 常量，GetAsset / GetAssets / Snapshot 三条读路径共用。
# 用 COALESCE 那一行做判据 —— 它是 SELECT 独有的，不会和 INSERT 撞。
if ! printf '%s\n' "$lc06_repo_code" | grep -qF "COALESCE(persona_id,''), COALESCE(subject_id,''), COALESCE(likeness_consent_id,'')"; then
  echo "  FAIL [LC-06]: the SELECT column list dropped the AI provenance columns." >&2
  echo "        Read paths would hand back empty provenance, so the MarkMediaReady gate fails open." >&2
  exit 1
fi
# INSERT：CreateAsset。用完整的 5 列名做判据，它是 INSERT 独有的。
if ! printf '%s\n' "$lc06_repo_code" | grep -qF 'ai_generation_source, ai_generated, persona_id, subject_id, likeness_consent_id,'; then
  echo "  FAIL [LC-06]: the INSERT column list dropped the AI provenance columns." >&2
  echo "        createAsset computes the AI label correctly and the write path throws it away." >&2
  exit 1
fi
# UPDATE：MarkMediaReady 在这里给 likeness consent 盖章。
if ! printf '%s\n' "$lc06_repo_code" | grep -qF 'likeness_consent_id=$'; then
  echo "  FAIL [LC-07]: UpdateAsset no longer persists likeness_consent_id." >&2
  echo "        MarkMediaReady stamps the consent id and the UPDATE drops it, so the audit trail is empty." >&2
  exit 1
fi
# 迁移：列必须真的加进 schema。
lc06_migration=apps/api-go/migrations/108_media_ai_provenance.sql
if [ ! -f "$lc06_migration" ]; then
  echo "  FAIL [LC-06]: $lc06_migration is missing." >&2
  echo "        Without the columns the repository code above cannot store anything." >&2
  exit 1
fi
for lc06_col in ai_generation_source ai_generated persona_id subject_id likeness_consent_id; do
  if ! grep -qF "ADD COLUMN IF NOT EXISTS $lc06_col" "$lc06_migration"; then
    echo "  FAIL [LC-06]: $lc06_migration no longer adds $lc06_col." >&2
    exit 1
  fi
done
# g3 的 e2e fixture：persona 的 owner 必须是那个带年龄断言的会话账号。
# 编一个假 id 会让 CreatePersona 撞上 COMP-AI-MINOR-001 守卫并 fail-closed
# （"no age evidence on file for this account"），脚本挂在第 1 步，
# 后面所有用例都跑不到 —— 这正是这个洞能藏住的原因之一。
if grep -qE 'envelope_create_persona "user_\$\{TS\}' scripts/lc06-ai-media-e2e.sh; then
  echo "  FAIL [LC-06]: lc06-ai-media-e2e.sh fabricates a persona owner id again." >&2
  echo "        CreatePersona looks up user_age_assertions for OwnerID and refuses accounts it cannot find." >&2
  exit 1
fi
echo "    LC-06 / LC-07: PASS (provenance columns present in SELECT / INSERT / UPDATE / migration)"
# 闸门必须挡在「实际跑的那条路」上（2026-09-21，同一类问题的第二处）。
#
# 上面那几层钉的是「溯源有没有落库」；这一层钉的是「判定有没有被调用」。
# LC-06 / LC-07 原先只写在 markReady 里，而 markReady 是 operator 专属命令
# （API 边界限定；PROXY_OPERATOR_PRINCIPALS 未配置时整条被拒）。真正把资产
# 推到 READY 的是 worker 的 ProcessAssetNow —— 它从不调用那段判定。
# 实测（真库 + 真 repository）：挂了 USER_TWIN 分身、没有任何 likeness 同意的
# AI_PERSONA 资产走完 worker 之后 status=READY、moderationStatus=APPROVED，
# consent 全程为空。也就是说闸门在「实际跑的那条路」上不存在。
#
# 这三个用例跑 MemoryRepository，不依赖数据库 —— 不存在 SKIP 冒充 PASS 的问题。
require_test "LC-06" "./internal/media" \
  "TestLC06WorkerPathRefusesUnknownLabel" \
  "apps/api-go/internal/media/worker_publish_gate_test.go" || exit $?
require_test "LC-07" "./internal/media" \
  "TestLC07WorkerPathRefusesAIPersonaWithoutConsent" \
  "apps/api-go/internal/media/worker_publish_gate_test.go" || exit $?
require_test "LC-06" "./internal/media" \
  "TestWorkerPathStillPublishesPlainUploadAndCreativePersona" \
  "apps/api-go/internal/media/worker_publish_gate_test.go" || exit $?
# 两条发布路径必须共用同一份判定，否则又会漂移成「一条有闸门、一条没有」——
# 这正是这次出问题的形状。任何一条掉了就红。
for lc06_publish_path in \
  apps/api-go/internal/media/worker.go \
  apps/api-go/internal/media/service.go; do
  # 钉**整条守卫**（含 v != nil 条件），不是子串。只钉子串的话，
  # 把条件改成 'false && v != nil' 就能让闸门失效而钉照样绿 ——
  # 2026-09-21 在 LC-16 的同类钉上实测踩到过这个洞，两处一起收紧。
  if ! grep -qF 'if v := s.enforceAIPublishGates(ctx, &asset); v != nil {' "$lc06_publish_path"; then
    echo "  FAIL [LC-06/LC-07]: $lc06_publish_path no longer runs the AI publish gates." >&2
    echo "        markReady is operator-only; the worker is what actually promotes assets to READY." >&2
    echo "        Both publish paths must share enforceAIPublishGates or they drift apart again." >&2
    exit 1
  fi
done
echo "    LC-06 / LC-07: PASS (gates run on BOTH publish paths: markReady + worker)"
# 动态层：真库往返。这里不用 require_test —— 每个 require_test 都是一次独立的
# go test 进程（各自起一个一次性集群），7 条就是 7 次 initdb；而且它无法区分
# 「跑了并通过」和「被 SKIP 了」，后者会让钉在没验过任何东西的情况下报 PASS。
# 一次跑完 + 数 PASS 条数，SKIP 也数得出来。
lc06_pg_dir=""
for lc06_p in /opt/homebrew/opt/postgresql@15/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql/bin \
               /usr/local/opt/postgresql@15/bin /usr/local/opt/postgresql@16/bin \
               /usr/lib/postgresql/15/bin /usr/lib/postgresql/16/bin; do
  if [ -x "$lc06_p/pg_ctl" ]; then lc06_pg_dir="$lc06_p"; break; fi
done
if [ -n "${DATABASE_URL:-}" ] || [ -n "$lc06_pg_dir" ] || command -v pg_ctl >/dev/null 2>&1; then
  lc06_pg_re='^(TestMediaProvenanceAIPersonaRoundTrip|TestMediaProvenanceBatchReadKeepsPersonaAndSubjectApart|TestMediaProvenanceUserUploadedIsLabelledAndPublishes|TestMediaUnknownProvenanceFailsClosedAtMarkReady|TestMediaAIPersonaWithoutLiveConsentFailsClosedAtMarkReady|TestMediaAIPersonaWithLiveConsentStampsConsentID|TestMediaCreativePersonaPublishesWithoutConsent)$'
  lc06_pg_out=$(go -C apps/api-go test -count=1 -v -run "$lc06_pg_re" ./internal/platform/postgres 2>&1)
  lc06_pg_rc=$?
  if [ "$lc06_pg_rc" -ne 0 ]; then
    printf '%s\n' "$lc06_pg_out" | grep -E -- '--- FAIL|_test\.go:[0-9]+:' >&2
    echo "  FAIL [LC-06/LC-07]: the AI-provenance round-trip tests failed." >&2
    echo "        These are the only tests that prove the fail-closed gates fire on the real schema." >&2
    exit 1
  fi
  lc06_pg_pass=$(printf '%s\n' "$lc06_pg_out" | grep -c -- '^--- PASS' || true)
  if [ "$lc06_pg_pass" -ne 7 ]; then
    lc06_pg_skip=$(printf '%s\n' "$lc06_pg_out" | grep -c -- '^--- SKIP' || true)
    echo "  FAIL [LC-06/LC-07]: expected 7 passing round-trip tests, got $lc06_pg_pass (skipped=$lc06_pg_skip)." >&2
    echo "        A skipped test proves nothing — LC-06/LC-07 must be verified against a real schema." >&2
    exit 1
  fi
  echo "    LC-06 / LC-07: PASS (real-schema round-trip: label + persona + consent survive, both gates fire closed)"
else
  echo "    LC-06 / LC-07: SKIP (no postgres cluster found — the round-trip tests did NOT run; install postgresql@15 or set DATABASE_URL)" >&2
fi

# LC-06 的**显示侧**（2026-09-21 产品决定：补上）。
#
# 上面那几条钉证明的是存储侧：溯源列在 migration / SELECT / INSERT / UPDATE 里活着，
# 两道闸门（markReady + worker）都开火，真实 schema 上 7 条往返测试全过。
#
# 在这条钉最初写下的时候（2026-09-21 早些时候），显示侧是**空的**，当时的读数是：
#
#   grep -c  "aiGenerationSource" packages/contracts/src/index.ts            # → 0
#   grep -rn "aiGenerationSource" apps/api-go/internal/api/ --include=*.go   # → 0
#   grep -c  "ai_generation_source\|ai_generated" \
#        apps/api-go/internal/platform/postgres/network.go                   # → 0（feed 四条查询都不选）
#   grep -rn "aiBadge: true" apps/mobile/src/surfaces/feed.tsx               # → 1（只有 AI_NATIVE）
#
# 即：**按资产**的 AI 溯源（LC-06 的交付物本体）对任何用户都不可见。
# 当时这条钉钉的是「缺口」，不是「决定」——它不判定该不该显示，只逼出那个决定。
#
# 同一天用户定了口径（原话）：「ai做的 就标注 法规要求要满足」。
# 于是缺口被补上，链变成五跳，每一跳都有钉：
#
#   media_assets.ai_generation_source          （migration 108，存储侧，已有）
#     → GetAssets 选列 + 扫进 MediaAsset        （已有，未改动）
#     → mediaAssetInfo() 带出 media 包          ← 第①跳，曾缺
#     → hydratePostMedia() 放进 PostMediaItem   ← 第②跳，曾缺
#     → FeedMediaItemSchema.aiGenerationSource  ← 第③跳，曾缺
#     → AIMediaBadge 画「AI 生成」               ← 第④跳，曾缺
#     → **每一种媒体形状都挂了它**                ← 第⑤跳，曾缺（见下面的更正）
#
# 任何一跳掉了都是「标注静默消失」且编译不报错，所以五跳各有各的钉：
#   ① TestPostMediaLookup_PropagatesAIGenerationSource      (internal/media)
#   ② TestListFeedPosts_PropagatesAIGenerationSourceToMediaWire (internal/localnet)
#   ③ 下面这条契约钉
#   ④⑤ mobile 的 ai-media-label.test.ts + 下面的挂点覆盖钉
#
# **仍然没有被判定的事**：134/2025/QH15 第 12 条要求的是「记录」还是「向终端用户
# 显示」，需要法务确认 —— docs/design/references/ 那份对齐文档里「法务 review」
# 至今未勾选。我们选的是**更严的那一边**（显示），所以这个未决项不构成合规风险，
# 但也别把「法务已确认」写进任何文档：那是我们主动多做的，不是法务签过字的。
#
# 另外，`MODEL_API` 这个枚举值仍然**没有任何生产者** —— 全仓非测试代码里只有校验
# 白名单、注释和 normalize 的透传，没有哪条管线会写它。所以「平台的 MODEL_API 资产
# 被 USER 作者发布、界面无标注」这个形状**不存在**；客户端对它的处理属于预先接线，
# 不是当前在跑的行为。
if ! grep -qE 'aiGenerationSource' packages/contracts/src/index.ts; then
  echo "  FAIL [LC-06-display]: contracts no longer carry per-asset AI provenance." >&2
  echo "        Without this field the client cannot label AI-generated media." >&2
  echo "        产品决定 2026-09-21：「AI 做的就标注」。撤字段 = 撤标注，请显式面对。" >&2
  exit 1
fi
# 只钉契约不够：字段在 wire 上、渲染那一行被删掉，照样「没有标注」。
#
# ⚠️ 2026-09-21 更正（第一次的钉**绿着**却漏了三条路）：
# 原来这里钉的是「AdaptiveMediaCollection.tsx 里出现 aiMediaLabel」。它一直是绿的，
# 因为标注确实被内联进了那个文件的**单图分支** —— 于是这些形状全都没标注：
#   - 多图帖：mediaCollectionMode() 判成 RAIL → AdaptiveMediaRail → SocialMediaFrame
#     （根本不经过单图分支）
#   - AI 视频：renderKindAwareStage 的 VIDEO 分支在算 aiLabel **之前**就 return 了
#   - 个人主页 / 他人主页：直接调 SinglePostImage / ThreadsPostMedia
# 教训：**钉「某行代码在某个文件里」会漏掉"这条渲染路径根本没走到那里"。**
# 现在钉的是**覆盖**：每个「画媒体」的形状都必须挂 AIMediaBadge，
# 而且判定口径只允许一条链（renderer → ai-media-badge → ai-media-label）。
if ! grep -qE 'export function aiMediaLabel\(' apps/mobile/src/media/ai-media-label.ts; then
  echo "  FAIL [LC-06-display]: the single AI-label rule is gone." >&2
  exit 1
fi
if ! grep -qE 'from "\./ai-media-label"' apps/mobile/src/media/ai-media-badge.tsx; then
  echo "  FAIL [LC-06-display]: the badge no longer asks the single rule." >&2
  echo "        A second copy of the rule will drift from ai-media-label.ts." >&2
  exit 1
fi
# 每种媒体形状的挂点。少一个 = 那一类 AI 媒体对用户可见但没标注。
if ! grep -qE '<AIMediaBadge' apps/mobile/src/media/AdaptiveMediaCollection.tsx; then
  echo "  FAIL [LC-06-display]: single-image / single-video posts lost the AI label." >&2
  exit 1
fi
if ! grep -qE '<AIMediaBadge' apps/mobile/src/media/SocialMediaFrame.tsx; then
  echo "  FAIL [LC-06-display]: multi-image posts (RAIL cards) lost the AI label." >&2
  echo "        A post with 2+ images renders through SocialMediaFrame, not the single branch." >&2
  exit 1
fi
if ! grep -qE '<AIMediaBadge' apps/mobile/src/components/threads-post-media.tsx; then
  echo "  FAIL [LC-06-display]: profile post media lost the AI label." >&2
  exit 1
fi
# 全屏查看器（点开原图）：跟 feed 里是同一张图，放大了反而没标注 = 用户当成真人拍的。
# 它用**行内**变体（顶栏是 flex row，absolute 会压住关闭按钮），所以钉的是带 inline
# 的那一处 —— 文件级 `grep '<AIMediaBadge'` 对这一处被删是无感的。
# 注：VIDEO 的全屏态是原生播放器，没有 React 挂点，标注只挂在进入全屏之前的视频卡上。
if ! grep -qF '<AIMediaBadge item={current} inline />' apps/mobile/src/media/AdaptiveMediaCollection.tsx; then
  echo "  FAIL [LC-06-display]: the fullscreen viewer (MediaViewer) lost the AI label." >&2
  echo "        Opening an AI image full-screen must still label it — same image, bigger." >&2
  exit 1
fi
# 渲染分支不许自己判来源 —— 把判定内联进某一个分支，正是第一次漏掉三条路的原因。
if grep -rnE 'aiGenerationSource' apps/mobile/src/media/AdaptiveMediaCollection.tsx apps/mobile/src/media/SocialMediaFrame.tsx apps/mobile/src/components/threads-post-media.tsx; then
  echo "  FAIL [LC-06-display]: a renderer judges AI provenance itself instead of mounting the badge." >&2
  echo "        Inlining the decision into one branch is exactly how 3 shapes got missed." >&2
  exit 1
fi
# 作者级徽标仍只覆盖 AI_NATIVE（小美）一档 —— 那是 feed **身份轴**上唯一的 AI 作者。
# AGENT / MERCHANT / USER 的帖若带 AI 生成的图，现在由上面的**资产轴**标注覆盖，
# 所以这里保持 1 是自洽的，不是漏标。
if [ "$(grep -c 'aiBadge: true' apps/mobile/src/surfaces/feed.tsx)" != "1" ]; then
  echo "  FAIL [LC-06-display]: the set of author types that render an AI badge changed." >&2
  echo "        Today exactly one does (AI_NATIVE / 小美). If AGENT or another type was added," >&2
  echo "        that is a labelling decision — confirm it, then update this pin." >&2
  exit 1
fi
require_test "LC-06" "./internal/media" "TestPostMediaLookup_PropagatesAIGenerationSource" "apps/api-go/internal/media/postmedia_lookup_test.go" || exit $?
require_test "LC-06" "./internal/localnet" "TestListFeedPosts_PropagatesAIGenerationSourceToMediaWire" "apps/api-go/internal/localnet/service_test.go" || exit $?
pnpm --dir apps/mobile exec vitest run src/media/ai-media-label.test.ts || exit $?
echo "    LC-06-display: PASS (per-asset AI provenance reaches the client; every media shape — single image, single video, RAIL card, profile cell, fullscreen viewer — is labelled)"

# AI-DISCLOSURE-001：activity 面上的 AI 标注**不能**挂在 persona 名字上。
#
# 契约（packages/contracts/src/index.ts 的 ActivitySchema 注释）承诺的是
#   「aiStatus != NONE 时客户端**必**显示 AI 标注 + persona 头像 + 名字」。
# 注意主语：必显示的是**标注**；persona 名字是补充信息 —— schema 里是
# `z.string().min(1).optional()`，服务端 `omitempty`，wire 允许缺名字。
#
# 2026-09-21 修之前的三个列表渲染点写的是
#   {item.aiStatus !== "NONE" && item.aiPersonaName ? (…) : null}
# 名字一缺，标注**整块消失** —— 界面把 AI 生成的活动当成人做的呈现。
#
# 这是漏接线，不是产品决定，证据在同一个文件里：tasks.tsx 的 footer
# 免责声明（aiPersonaDisclaimerFooter，grep 得到）当时**已经**是无条件标注
#   aiStatus === "AI_GENERATED" || aiStatus === "AI_ASSISTED"
# 并且自己写了 `?? "用户分身"` / `?? "AI 助理"` 兜底。同一份数据、两种口径，
# 同一个文件内自相矛盾 —— 所以判定为 bug。
#
# 现在归属名的兜底只有一处：activityAIPersonaName()（activity-detail-model.ts），
# 只做**事实级**归因，不编造 persona：
#   PLATFORM_AI → 「平台 AI 小美」（平台 AI 角色，assets/ai-personas/INDEX.md）
#   USER_TWIN   → 「用户分身」（是**本人**的分身，不是平台的人）
#   其余/未知    → 「AI 助理」（中性，不指认任何具体角色）
#
# 为什么钉在 mobile 而不是服务端：服务端**不能**替客户端编名字。`AIActorKind`
# 有 USER_TWIN / USER_ASSISTANT 两档，给它们回填「平台 AI 小美」是把发布者
# 说成平台 —— 那是比漏标更糟的假陈述。所以服务端的责任是「该带的带出来」，
# 客户端必须有「名字缺失也照样标」的路径。
if ! grep -qE 'export function activityAIPersonaName\(' apps/mobile/src/surfaces/activity-detail-model.ts; then
  echo "  FAIL [AI-DISCLOSURE-001]: the shared persona-name fallback is gone." >&2
  echo "        Without it every surface re-invents its own fallback and they drift." >&2
  exit 1
fi
# 反回归 ①：任何 surface 再把标注挂回名字上 → 名字一缺标注就消失。
if grep -rnE 'aiStatus !== "NONE"[[:space:]]*&&[[:space:]]*[A-Za-z_]+\.aiPersonaName' apps/mobile/src/surfaces/; then
  echo "  FAIL [AI-DISCLOSURE-001]: an AI label is gated on aiPersonaName again." >&2
  echo "        aiStatus != NONE must disclose on its own; the name is supplementary." >&2
  echo "        名字一缺，标注就整块消失 —— 界面把 AI 生成的内容当成人做的。" >&2
  exit 1
fi
# 反回归 ②：绕过共享助手自己写兜底 → 两套口径迟早漂移。
if grep -rnE 'aiPersonaName[[:space:]]*\?\?' apps/mobile/src/surfaces/; then
  echo "  FAIL [AI-DISCLOSURE-001]: a surface hand-rolls its own persona-name fallback." >&2
  echo "        Use activityAIPersonaName() from ./activity-detail-model instead." >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/surfaces/activity-detail.test.ts || exit $?
echo "    AI-DISCLOSURE-001: PASS (AI activity content discloses on aiStatus alone; a missing persona name never hides the label)"

# LC-07 活动侧：PRD 与 activity/service.go 的注释都声称
#   「USER_TWIN 角色 photo 必须先有 LikenessConsent LIVE 才会下发」
# 但 activity 包里除了那行注释没有任何 consent 判定（grep HasLiveConsent/Likeness
# → 只有注释本身），服务也没注入 persona/consent 依赖。也就是说这句承诺**无法被执行**。
#
# 它今天不是线上风险，只因为 USER_TWIN 活动压根不存在：AIPersonaPhoto 只在
# SeedDefaults 里被写成 PLATFORM_AI 的打包资源路径，没有任何命令能写这个字段。
# 而 media 侧那道 LC-07 闸门覆盖不到这里 —— 它只管 media.media_assets 行，
# aiPersonaPhoto 是打包资源路径而不是 mediaAssetId。
#
# 所以这条钉子的作用不是「禁止这个功能」，而是「不许悄悄把路打通」：
# 一旦有人让活动带上 USER_TWIN 的 photo，测试立刻红，逼出「先接 consent 还是
# 先下线该字段」的决定。测试同时拒绝空转 —— 如果 aiPersonaPhoto 整个字段被丢掉，
# 它会报「观测不到任何带 photo 的活动」而不是空跑一遍算通过。
#
# 用 require_test 是因为这个用例跑 MemoryRepository（New()），不碰数据库，
# 因此不存在 SKIP 冒充 PASS 的问题。
require_test "LC-07" "./internal/activity" \
  "TestLC07ActivityNeverServesUserTwinPersonaPhoto" \
  "apps/api-go/internal/activity/lc07_activity_photo_gate_test.go" || exit $?

# LC-16 (R16.7-P1-G) 远程法律 kill switch 的**执行路径**。
#
# `Server.enforceKillSwitch` 是唯一真正拦住命令的地方（command_dispatch.go 在鉴权
# 之后、业务分发之前调用它），但在这条钉之前它**一个测试都没有**：
#
#   grep -rn 'SERVICE_DISABLED\|enforceKillSwitch' apps/api-go --include=*.go
#   # → 只有定义本身和那一处调用点，没有任何 _test.go 引用
#
# 而 internal/compliance 的 13 个测试全都只测 Service 自己（Kill/Rearm/IsEnabled/
# GlobalStatus），没有一个穿过 dispatch 那一层。「拨下开关 -> 命令真的被 503 拦掉」
# 这条不变量从来没被验证过：它今天是对的，但没有任何东西阻止它变成错的。
#
# 两条测试都带反向配重（Rearm 后必须重新放行、不相关命令必须不受影响），
# 否则「一律拒绝」这种最省事的改法会让它们假绿。
require_test "LC-16" "./internal/api" \
  "TestKillSwitchBlocksTheCommandsItsCategoriesCover" \
  "apps/api-go/internal/api/kill_switch_dispatch_test.go" || exit $?
require_test "LC-16" "./internal/api" \
  "TestKillSwitchLeavesUnrelatedCommandsAlone" \
  "apps/api-go/internal/api/kill_switch_dispatch_test.go" || exit $?
# 上面两条直接调 enforceKillSwitch，所以「调用点被删掉」它们抓不到 —— 补一条静态钉。
# 没有这一条，把 dispatch 里那两行删掉、闸门彻底不接线，上面两条依然全绿。
if ! grep -qF 'if blocked, blockedStatus := s.enforceKillSwitch(envelope); blocked != nil {' apps/api-go/internal/api/command_dispatch.go; then
  echo "  FAIL [LC-16]: command_dispatch.go no longer calls enforceKillSwitch." >&2
  echo "        The kill switch would be dead code: operator can arm it, the client shows" >&2
  echo "        '服务暂停', and nothing is actually blocked." >&2
  echo "        注意这里钉的是**整条守卫**（含 blocked != nil 条件），不是子串 ——" >&2
  echo "        只钉子串的话，把条件改成 'false && blocked != nil' 就能让闸门失效而钉照样绿。" >&2
  exit 1
fi
echo "    LC-16: PASS (armed switch blocks its commands; call site still wired)"

# LC-16 (2026-09-21) —— 「可拨的类别」和「真的会拦的类别」必须是同一个集合。
#
# 这条钉子的由来：AllowedCategories 有 5 个类别（GLOBAL / AI_MEDIA / MARKETPLACE /
# LOCATION_CONSENT / PAYMENTS，与 migration 064 的 CHECK 一致），但
# commandKillSwitchCategory 只给 2 个类别接上了执行点。运营拨下另外三个时：
#
#   POST /v1/operator/legal/kill-switch {"category":"PAYMENTS", ...}
#   -> 201 Created，审计表写一行，然后**没有任何命令被拦**
#
# 一条假的合规记录比「没有这个开关」更糟 —— 运营以为自己已经止住了，
# 事故复盘时会照着这行记录说「我们已经关掉了」。
#
# 处置方式刻意选了「说出来」而不是「拒绝」：宣布事件、留审计记录本身是
# kill switch 的正当用途（真正的缓解可能在负载均衡或别处），所以 Kill 照常成功，
# 但响应体必须自报 enforced=false。下面四条钉分别守四个点。
#
# 为什么这里需要静态钉、而不是只靠 Go 测试：Go 测试只能探针「已知的命令」——
# 全仓没有命令类型注册表（dispatch 是各域 service.go 里的 switch），所以
# 「有人给一条新命令接上了一个从没声明过的类别」它看不见。静态钉看的是函数体。
if sed -n '/^func commandKillSwitchCategory/,/^}/p' apps/api-go/internal/api/command_dispatch.go \
     | grep -qE '"(GLOBAL|LOCATION_CONSENT|PAYMENTS)"'; then
  echo "  FAIL [LC-16]: commandKillSwitchCategory now returns a category with no declared enforcement point." >&2
  echo "        If you really wired it, add it to compliance.EnforceableCategories and extend" >&2
  echo "        TestEveryEnforceableCategoryHasAnEnforcementPoint. If you did not, drop the mapping." >&2
  exit 1
fi

# EnforceableCategories 必须**恰好**是那两个真的会拦的类别。operator 响应里的
# enforced 字段读的就是它，所以它被改宽 = 把空转的开关报成有效。
ENFORCEABLE_BLOCK=$(sed -n '/^var EnforceableCategories = \[\]Category{/,/^}/p' apps/api-go/internal/compliance/killswitch.go)
if ! printf '%s' "$ENFORCEABLE_BLOCK" | grep -qF 'CategoryAIMedia,'; then
  echo "  FAIL [LC-16]: compliance.EnforceableCategories no longer lists CategoryAIMedia." >&2
  exit 1
fi
if ! printf '%s' "$ENFORCEABLE_BLOCK" | grep -qF 'CategoryMarketplace,'; then
  echo "  FAIL [LC-16]: compliance.EnforceableCategories no longer lists CategoryMarketplace." >&2
  exit 1
fi
if printf '%s' "$ENFORCEABLE_BLOCK" | grep -qE 'CategoryGlobal|CategoryLocationConsent|CategoryPayments'; then
  echo "  FAIL [LC-16]: compliance.EnforceableCategories gained a category." >&2
  echo "        GLOBAL / LOCATION_CONSENT / PAYMENTS have no enforcement point, so the operator" >&2
  echo "        response would report enforced=true for a switch that blocks nothing." >&2
  echo "        Wire the enforcement point first (see the note above EnforceableCategories)." >&2
  exit 1
fi

# 唯一消除「运营以为自己关掉了」这个误解的地方：响应体里的 enforced 字段。
# 只钉子串，不钉整个 map 字面量，免得别人加个字段就要改钉。
if ! grep -qF '"enforced": compliance.IsEnforceable(k.Category),' apps/api-go/internal/api/kill_switch.go; then
  echo "  FAIL [LC-16]: the operator kill-switch response no longer reports whether the switch is enforced." >&2
  echo "        Without it, arming GLOBAL/LOCATION_CONSENT/PAYMENTS silently returns 201 and blocks nothing." >&2
  exit 1
fi

require_test "LC-16" "./internal/api" \
  "TestEveryEnforceableCategoryHasAnEnforcementPoint" \
  "apps/api-go/internal/api/kill_switch_dispatch_test.go" || exit $?
require_test "LC-16" "./internal/api" \
  "TestUnenforcedCategoryIsReportedAsUnenforced" \
  "apps/api-go/internal/api/kill_switch_dispatch_test.go" || exit $?
echo "    LC-16: PASS (enforceable set == wired set; unenforced categories self-report)"

# LC-15 (R16.7-P1-F) 个人数据擦除的**执行者**。
#
# 这条钉子的由来是一个"定义了但没人调用"的 P0，形状和 LC-16 一模一样：
#
#   POST /v1/privacy/delete  ->  requestPrivacyDelete 写一行 status='received'
#   ...然后什么都没有。没有东西把它推到 in_progress，更没有东西执行擦除。
#   而 apps/mobile/src/components/privacy-settings.tsx 明着承诺
#   「30 天后，你的个人数据将被永久删除」。
#
# 证据链（2026-09-21）：
#   grep -rn 'PrivacyRequestStatusCompleted' apps/api-go --include=*.go
#   # -> 只有常量定义那一处，没有任何写入点
#   grep -rn 'ErasedAt *=' apps/api-go --include=*.go
#   # -> 服务端零赋值（只有 struct 字段和 scan）
#   grep -rn 'privacy' apps/api-go/cmd/worker/main.go
#   # -> 零命中：worker 的 sweep 只清消息和 burner，从来没有 privacy
#
# 所以下面三条 require_test 只证明"决策逻辑对"，证明不了"有人跑它" ——
# 这正是当初那个 bug 的形状（代码在，接线不在）。因此必须补一条静态钉钉住
# worker 的调用点，而且钉的是**调用次数 >= 2**：只在启动时扫一次、把 ticker
# 里的那次删掉，用户等 30 天也等不到擦除，但钉调用点存在的话照样绿。
require_test "LC-15" "./internal/identity" \
  "TestPrivacyDeleteErasureExecutorRunsTheFullLifecycle" \
  "apps/api-go/internal/identity/privacy_erasure_sweep_test.go" || exit $?
require_test "LC-15" "./internal/identity" \
  "TestPrivacyDeleteErasureSkipsCancelledRequests" \
  "apps/api-go/internal/identity/privacy_erasure_sweep_test.go" || exit $?
require_test "LC-15" "./internal/identity" \
  "TestErasedStatusIsNotSessionCapable" \
  "apps/api-go/internal/identity/privacy_erasure_sweep_test.go" || exit $?
# 这一条才是「数据真的没了」对**正在运行的客户端**的含义：擦除前签发的
# access token 必须失效。只删行不够 —— 旧 token 是个 bearer 凭据，它要是
# 还能用，用户就还在一个资料/设备/登录标识都已不存在的账号里，而
# canHoldSession 只在**新建**会话时被查，根本拦不到它。
require_test "LC-15" "./internal/identity" \
  "TestErasureInvalidatesOutstandingAccessTokens" \
  "apps/api-go/internal/identity/privacy_erasure_sweep_test.go" || exit $?
# 收据必须落到审计流水里（privacy_request_events.notes），否则「擦了哪些、留了哪些、
# 依据是什么」只能靠再查一遍库反推 —— 合规流程要的恰恰是一行可读的凭证。
require_test "LC-15" "./internal/identity" \
  "TestErasureReceiptReachesTheAuditTrail" \
  "apps/api-go/internal/identity/privacy_erasure_sweep_test.go" || exit $?

lc15_worker_calls="$(grep -cF 'sweepPrivacyDeletions(ctx, privacyService)' apps/api-go/cmd/worker/main.go || true)"
if [ "${lc15_worker_calls:-0}" -lt 2 ]; then
  echo "  FAIL [LC-15]: cmd/worker/main.go runs the erasure executor ${lc15_worker_calls:-0} time(s), expected >= 2 (startup + hourly ticker)." >&2
  echo "        The executor can be perfectly correct and still never run — that IS the" >&2
  echo "        original bug: the delete request was recorded and nothing actioned it." >&2
  echo "        只在启动时扫一次不够：30 天宽限期到点时进程早就重启过了。" >&2
  exit 1
fi
# 擦除必须走 PersonalDataEraser 这条边界，而不是在 service 里手写 DELETE。
# 没有这条，把 ErasePersonalData 换成一句 return 就能让上面三条测试里的
# 「收据非零」断言失去意义（memory 仓的实现在测试里）。
if ! grep -qF 'var _ identity.PersonalDataEraser = (*IdentityRepository)(nil)' apps/api-go/internal/platform/postgres/identity.go; then
  echo "  FAIL [LC-15]: postgres IdentityRepository no longer implements PersonalDataEraser." >&2
  echo "        A deployment whose repository cannot erase must refuse to sweep" >&2
  echo "        (ErrPersonalDataEraserUnavailable), never mark requests completed without erasing." >&2
  exit 1
fi
echo "    LC-15: PASS (erasure executor runs on a timer; account becomes unauthenticatable)"

# LC-15-CROSS: 擦除必须擦到**别的聚合里去**，而不只是 identity 自己。
#
# 上面那组钉子证明 identity 聚合被清空了。但用户的显示身份早就被复制到了
# 别处 —— 而且都是写时快照，不是活连接：
#
#   localnet.posts.author_display_name      发布时把 profile.name 抄了一份
#   socialspace.statuses.author_display_name  同上
#   marketplace.opportunities.payload.owner  同上（权威 id 在 owner_id）
#   business.member_directory.display_name   同上
#   identity.profiles.avatar_path -> media.media_assets 的一个资产，
#     而 /v1/media/play/<id> 是**公开无鉴权**的（见 media_handlers.go 的注释）
#
# 删掉 identity.profiles 这一行，上面每一样都原地不动。于是 app 里写着
# 「头像会被永久删除」，而那张脸还能被任何人按 id 拉走。这就是这组钉子要
# 守住的东西：**收据说擦了，就得真擦了。**
#
# 2026-09-21 取证（对着活库读的，不是推断）：
#   SELECT author_type, author_id, author_display_name FROM localnet.posts
#   # -> USER 行带着真名（'Mai' / 'Hana' / ...）
#   SELECT owner_principal_type, owner_principal_id, visibility_class
#     FROM media.media_assets WHERE media_asset_id = 'ma_9b85...'
#   # -> INDIVIDUAL / user_5fbe... / PUBLIC，playback_url=/v1/media/play/<id>
#   SELECT pg_get_constraintdef(oid) FROM pg_constraint
#     WHERE conrelid='media.media_assets'::regclass AND contype='c'
#   # -> visibility_class IN (OWNER_ONLY, PUBLIC, FOLLOWERS, AGENT_ONLY)
#      => 把头像降级成 OWNER_ONLY 即可让 ResolveServingPath 拒绝它
#         （该方法显式要求 PUBLIC），不必删行、不必发明新枚举值。
require_test "LC-15-CROSS" "./internal/platform/postgres" \
  "TestEraseCrossAggregateIdentityScrubsEveryCopy" \
  "apps/api-go/internal/platform/postgres/privacy_cross_aggregate_integration_test.go" || exit $?
# 媒体那一半必须按**真实下发路径**验证，而不是读回列值：要紧的不是
# visibility_class 变了，而是 /v1/media/play/<id> 不再能解析。同一个测试里
# 还有反向断言 —— 同属主、但只是普通帖子配图的那个资产必须**继续可下发**，
# 这条专门打「用 owner_principal_id 找头像」的实现（media_assets 没有
# purpose 列，按属主找会把用户的全部媒体一起扫进去）。
require_test "LC-15-CROSS" "./internal/platform/postgres" \
  "TestEraseCrossAggregateIdentityUnservesTheAvatar" \
  "apps/api-go/internal/platform/postgres/privacy_cross_aggregate_integration_test.go" || exit $?
# 顺序不是风格问题：头像是**只能**通过 identity.profiles.avatar_path 认出来的
# （media_assets 没有 purpose 列），所以先跑 identity 擦除就会永久销毁这个
# 引用，让头像公开可下发到天荒地老。这条测试故意用错顺序，把后果钉出来。
require_test "LC-15-CROSS" "./internal/platform/postgres" \
  "TestAvatarUnservingRequiresTheProfileRowToStillExist" \
  "apps/api-go/internal/platform/postgres/privacy_cross_aggregate_integration_test.go" || exit $?
# 上面那条钉的是后果，这条钉的是**服务端真的按那个顺序调**。少了它，一次
# 重构把两个调用对调，后果测试照样绿（它自己调 eraser，不经过 service）。
require_test "LC-15-CROSS" "./internal/identity" \
  "TestSweepErasesCrossAggregateBeforeIdentity" \
  "apps/api-go/internal/identity/privacy_erasure_sweep_test.go" || exit $?
# 缺了跨聚合擦除能力时必须**拒绝清扫**，而不是照常标 completed：那会让用户
# 的名字继续挂在他的帖子上，而 app 告诉他数据已经没了。和 identity 侧那条
# ErrPersonalDataEraserUnavailable 是同一个形状。
require_test "LC-15-CROSS" "./internal/identity" \
  "TestSweepRefusesToEraseWithoutACrossAggregateEraser" \
  "apps/api-go/internal/identity/privacy_erasure_sweep_test.go" || exit $?

lc15c_impl="apps/api-go/internal/platform/postgres/privacy_cross_aggregate.go"
if ! grep -qF 'var _ identity.CrossAggregateEraser = (*IdentityRepository)(nil)' "$lc15c_impl"; then
  echo "  FAIL [LC-15-CROSS]: postgres IdentityRepository no longer implements CrossAggregateEraser." >&2
  echo "        Without it the sweep refuses to run at all, so this shows up as an outage" >&2
  echo "        rather than as silently-retained names — but the pin is here because the" >&2
  echo "        assertion is one line and its absence is invisible in review." >&2
  exit 1
fi
# 头像必须降级成 OWNER_ONLY（服务端拒绝下发的那个值），并且必须是**按
# avatar_path 关联**出来的。两条一起钉，因为改掉任何一条都能让上面那条
# 集成测试从「精确擦一个资产」退化成「把用户的媒体全扫了」。
if ! grep -qF "SET visibility_class = 'OWNER_ONLY'" "$lc15c_impl"; then
  echo "  FAIL [LC-15-CROSS]: the avatar is no longer demoted to visibility_class='OWNER_ONLY'." >&2
  echo "        That value is what makes ResolveServingPath refuse it (/v1/media/play/<id>" >&2
  echo "        requires PUBLIC). Removing the demotion leaves the photo publicly fetchable." >&2
  exit 1
fi
if ! grep -qF "AND profile.avatar_path = 'assets/' || asset.media_asset_id" "$lc15c_impl"; then
  echo "  FAIL [LC-15-CROSS]: the avatar is no longer identified through identity.profiles.avatar_path." >&2
  echo "        media.media_assets has no purpose/kind column, so any other join (by owner," >&2
  echo "        by media_type) sweeps in the user's ordinary post media as well." >&2
  exit 1
fi
# 顺序的静态兜底：行为钉在 identity 包里，这里再按行号确认一次调用次序。
# 行号比较很脆，所以它只作为**额外**一层，不是唯一证据。
lc15c_cross_line="$(grep -nF 'cross.EraseCrossAggregateIdentity(ctx, req.UserID)' apps/api-go/internal/identity/service.go | head -1 | sed 's/:.*//')"
lc15c_identity_line="$(grep -nF 'eraser.ErasePersonalData(ctx, req.UserID)' apps/api-go/internal/identity/service.go | head -1 | sed 's/:.*//')"
if [ -z "$lc15c_cross_line" ] || [ -z "$lc15c_identity_line" ]; then
  echo "  FAIL [LC-15-CROSS]: service.go no longer calls both erasers from the sweep." >&2
  echo "        cross=${lc15c_cross_line:-<missing>} identity=${lc15c_identity_line:-<missing>}" >&2
  exit 1
fi
if [ "$lc15c_cross_line" -ge "$lc15c_identity_line" ]; then
  echo "  FAIL [LC-15-CROSS]: the identity erasure is called first (line $lc15c_identity_line) and the" >&2
  echo "        cross-aggregate one second (line $lc15c_cross_line). The avatar is only" >&2
  echo "        identifiable while identity.profiles exists, so this order strands it." >&2
  exit 1
fi
# 反向钉：这一轮刻意**不删内容**。用户的帖子和他的普通配图都不是这次擦除的
# 对象 —— 擦的是个人数据，不是撤回内容；别人对他的回复/收藏还挂着这些行。
# 谁要是把 SET ... = '' 换成 DELETE，这几条会先响。
for lc15c_forbidden in \
  'DELETE FROM localnet.posts' \
  'DELETE FROM socialspace.statuses' \
  'DELETE FROM marketplace.opportunities' \
  'DELETE FROM media.media_assets'; do
  if grep -qF "$lc15c_forbidden" "$lc15c_impl"; then
    echo "  FAIL [LC-15-CROSS]: '$lc15c_forbidden' found in $lc15c_impl." >&2
    echo "        This pass de-attributes content; it does not delete it. The rows are" >&2
    echo "        referenced by other users' replies/bookmarks, and the request was for" >&2
    echo "        erasure of personal data — not withdrawal of content." >&2
    echo "        For the avatar specifically the chosen shape is the OWNER_ONLY demotion." >&2
    exit 1
  fi
done
echo "    LC-15-CROSS: PASS (display-name snapshots scrubbed; avatar un-served before the profile row goes)"

# TEST-ABSDATE-001: 测试里写死绝对日期 = 定时炸弹。
# 2026-09-13 全仓库 g2 变红：business/service_test.go 把 bucketDate 写成
# "2026-09-06"，7 天滚动窗口一过就查不到它，OrderCount 恒为 0，测试自己
# 就红了 —— 而代码一行没动。同一个坑 2026-09-12 已经在这文件的另一个测试
# 里修过一次（见 TestSpendDailyUpsertAndList 的注释），这次是漏网的那个。
# 凡是「相对现在的滚动窗口」的入参，都必须用 time.Now() 现算。
if grep -rn '"bucketDate": *"20[0-9][0-9]-' apps/api-go --include='*_test.go' | grep -q .; then
  echo "  FAIL [TEST-ABSDATE-001]: 测试里出现了写死的 bucketDate 日期：" >&2
  grep -rn '"bucketDate": *"20[0-9][0-9]-' apps/api-go --include='*_test.go' >&2
  echo "        滚动窗口会把旧日期滚出去，测试会在几天后无缘无故变红。" >&2
  exit 1
fi
echo "    TEST-ABSDATE-001: PASS (no hardcoded bucket dates in api-go tests)"

# TEST-ABSDATE-002: 同一个坑的移动端版本。
# SecureSessionStore.write() 会拒掉 refreshExpiresAt 不在未来的 session，
# 所以测试夹具里的 refreshExpiresAt 天生就必须是「未来」。写死成
# "2026-09-13T00:00:00.000Z" 这种字面量，到了那天就自己过期：
# 2026-09-13 全仓库 mobile 测试变红，而代码一行没动。
# 夹具里的时间必须用 Date.now() 现算（+30d 对测试中注入的所有假时钟都是未来）。
if grep -rn 'refreshExpiresAt: *"' apps/mobile/src --include='*.test.ts' --include='*.test.tsx' | grep -q .; then
  echo "  FAIL [TEST-ABSDATE-002]: 移动端测试夹具里出现了写死的 refreshExpiresAt：" >&2
  grep -rn 'refreshExpiresAt: *"' apps/mobile/src --include='*.test.ts' --include='*.test.tsx' >&2
  echo "        它必须是相对现在的未来时间，写死就会过期，整个 mobile 测试会自己变红。" >&2
  exit 1
fi
echo "    TEST-ABSDATE-002: PASS (mobile session fixtures use relative refresh expiry)"

# COMP-SELLER-001: 供给侧实名 —— 能收钱的人必须可识别。
# 越南电商法 122/2025 + NĐ 248/2026（2026-07-01 生效）禁止匿名销售：平台上
# 卖出服务的人必须可识别、且绑定税务身份。此前 supply 侧只有「能力验证」
# （会不会中文），完全没有「是谁」的证据 —— 那正是法条要禁的形态。
# 能力验证不能替代实名：一个回答「会不会」，一个回答「是谁」。
# 守卫 fail-closed：没接查询 / 查询报错 = 撮合停摆，不是照常放行。
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestSellerRealNameRefusedWhenLookupMissing" \
  "apps/api-go/internal/supply/seller_identity_compliance_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestSellerRealNameRefusedWhenLookupErrors" \
  "apps/api-go/internal/supply/seller_identity_compliance_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestEligibilityRequiresSellerRealName" \
  "apps/api-go/internal/supply/seller_identity_compliance_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestCandidateBatchEmptyWhenRealNameLookupUnwired" \
  "apps/api-go/internal/supply/seller_identity_compliance_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestEligibilitySnapshotExposesRealName" \
  "apps/api-go/internal/supply/seller_identity_compliance_test.go" || exit $?

# 实名必须真的参与准入判定，不能只是写进快照给人看。
if ! grep -qF 'snap.AvailabilityOK && snap.MarketOK && snap.RealNameVerified' \
     apps/api-go/internal/supply/service.go; then
  echo "  FAIL [COMP-SELLER-001]: real-name no longer gates eligibility." >&2
  echo "        A snapshot field that nobody reads is not a compliance control." >&2
  exit 1
fi
if ! grep -qF 'RealNameVerified bool `json:"realNameVerified"`' \
     apps/api-go/internal/supply/service.go; then
  echo "  FAIL [COMP-SELLER-001]: EligibilitySnapshot no longer exposes real-name status." >&2
  exit 1
fi
# 生产实现必须查真实名表，且签名漂移要在编译期炸。
if ! grep -qF 'supply.seller_real_name_verifications' apps/api-go/internal/platform/postgres/seller_identity.go ||
   ! grep -qF 'var _ supply.SellerIdentityLookup = (*SellerRealNameRepository)(nil)' apps/api-go/internal/platform/postgres/seller_identity.go; then
  echo "  FAIL [COMP-SELLER-001]: the seller real-name store no longer reads the" >&2
  echo "        verification table, or is no longer pinned to the domain contract." >&2
  exit 1
fi
# 不接线 = 候选集为空（fail-closed）。这里钉的是「接线」本身。
if ! grep -qF 'SetSellerIdentityLookup' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'NewSellerRealNameRepository' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [COMP-SELLER-001]: the seller real-name lookup is no longer wired in cmd/api/main.go." >&2
  exit 1
fi
# --- COMP-SELLER-001 写侧：实名核验必须有受控写入口 ---
#
# 上面钉的是读侧（已核验才准撮合）。但「已核验」这个状态本身当时没有来源：
# `INSERT INTO supply.seller_real_name_verifications` 全仓零命中，于是表里的行
# 只能靠手写 SQL 产生 —— verified_by 可填任意字符串（084 要求「具名运营人员」）、
# expires_at 可留空（084 要求「必须重新核」）、id_number_hash 可以是字面量。
# 读侧全绿，而「已实名」可以凭空出现。下面钉住写侧的四个不变量。
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestAttestSellerRealNameStoresHashNotTheNumber" \
  "apps/api-go/internal/supply/seller_real_name_attestation_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestAttestSellerRealNameVerifiedCarriesAnExpiry" \
  "apps/api-go/internal/supply/seller_real_name_attestation_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestAttestSellerRealNameSupersedesThePriorVerification" \
  "apps/api-go/internal/supply/seller_real_name_attestation_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestAttestSellerRealNameRejectionSupersedesThePriorVerification" \
  "apps/api-go/internal/supply/seller_real_name_attestation_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestAttestSellerRealNameRejectsUnknownAgent" \
  "apps/api-go/internal/supply/seller_real_name_attestation_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/supply" \
  "TestMemoryRepositoryRefusesVerifiedWithoutExpiry" \
  "apps/api-go/internal/supply/seller_real_name_attestation_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/platform/postgres" \
  "TestSellerRealNameAttestationRoundTrip" \
  "apps/api-go/internal/platform/postgres/seller_real_name_attestation_integration_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/platform/postgres" \
  "TestSellerRealNameReadRefusesMissingExpiry" \
  "apps/api-go/internal/platform/postgres/seller_real_name_attestation_integration_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/platform/postgres" \
  "TestSellerRealNameMigrationGuardsAreEnforced" \
  "apps/api-go/internal/platform/postgres/seller_real_name_attestation_integration_test.go" || exit $?
require_test "COMP-SELLER-001" "./internal/api" \
  "TestSellerRealNameAttestationRequiresOperator" \
  "apps/api-go/internal/api/server_test.go" || exit $?

# 写入口必须是契约的一部分：接口上没有它，就没有任何实现会被要求提供它。
if ! grep -qF 'AttestSellerRealName(ctx context.Context, v SellerRealNameVerification) error' \
     apps/api-go/internal/supply/service.go; then
  echo "  FAIL [COMP-SELLER-001]: the supply repository no longer declares a real-name write path." >&2
  echo "        Without it the verification table has no producer again." >&2
  exit 1
fi
# 明文证件号必须在命令边界上就地变成哈希。
if ! grep -qF 'IDNumberHash: HashIDNumber(p.IDNumber),' \
     apps/api-go/internal/supply/service.go; then
  echo "  FAIL [COMP-SELLER-001]: the raw id number is no longer hashed at the command boundary" >&2
  echo "        (PDP 91/2025 + NĐ 356/2025 forbid storing the document number in the clear)." >&2
  exit 1
fi
# 入库语句必须写 id_number_hash（哈希列），而不是任何明文列。
if ! grep -qF 'id_number_hash' apps/api-go/internal/platform/postgres/supply.go; then
  echo "  FAIL [COMP-SELLER-001]: the real-name insert no longer writes id_number_hash." >&2
  exit 1
fi
# 写入口必须走 operator 门 + IDENTITY scope。
# ⚠️ 用 [[:space:]]+ 而不是字面一个空格：这两张 map 是 gofmt 对齐的，加一个更长的
# key 就会把这一行的冒号后重排成 N 个空格。原先写成字面 "…": true 的 -qF 在
# b82602e（VOUCHER-PURCHASE 合入，Rev283）被 gofmt 重排后**假红**了 —— 而钉脚本
# 在第一个红钉就 exit，于是 3144 行之后的钉全部没跑过（2026-09-24 修）。
# 钉的是不变量（这条命令在受门集合里且为 true），空格不属于不变量。
if ! grep -qE '"AttestSellerRealName":[[:space:]]+true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [COMP-SELLER-001]: AttestSellerRealName is no longer operator-gated —" >&2
  echo "        a seller could sign their own real-name verification." >&2
  exit 1
fi
if ! grep -qE '"AttestSellerRealName":[[:space:]]+ScopeIdentity' apps/api-go/internal/api/operator_scopes.go; then
  echo "  FAIL [COMP-SELLER-001]: AttestSellerRealName no longer requires the IDENTITY scope." >&2
  exit 1
fi
# DB 层必须自己拦「VERIFIED 没有有效期」与「没有归属人」——不能只靠 Go 侧。
if [ ! -f apps/api-go/migrations/118_seller_real_name_attestation_guards.sql ] ||
   ! grep -qF 'seller_real_name_verified_has_expiry' apps/api-go/migrations/118_seller_real_name_attestation_guards.sql ||
   ! grep -qF 'seller_real_name_attestor_named' apps/api-go/migrations/118_seller_real_name_attestation_guards.sql; then
  echo "  FAIL [COMP-SELLER-001]: migration 118 no longer enforces expiry + named attestor at the DB level." >&2
  exit 1
fi
# 读侧不得把空有效期读成「永不过期」—— 这是 118 之前的写法，也是「漏填一次
# 就等于永久放行」的来源。反向钉住，防止它被写回去。
# 匹配串带上别名与左括号（`(v.expires_at IS NULL OR`），这样它是代码形状而不是
# 一句话 —— 否则解释「不要这样写」的注释会把自己钉红（本次已经踩过一次）。
# 行为侧另有 TestSellerRealNameReadRefusesMissingExpiry 兜底。
if grep -qF '(v.expires_at IS NULL OR' apps/api-go/internal/platform/postgres/seller_identity.go; then
  echo "  FAIL [COMP-SELLER-001]: the reader treats a NULL expiry as 'never expires' again." >&2
  echo "        084 promises '到点即失效，必须重新核'; a missing value must mean unverified." >&2
  exit 1
fi

echo "    COMP-SELLER-001: PASS (sellers must be real-name verified before they can be matched, and only a named operator can record that verification)"

# COMP-AGE-001: 注册时判过的 18+ 必须留下证据。
# 此前 CreateAnonymousSession 在服务端做了 18+ 判定，判完就把 dateOfBirth 丢了 ——
# identity.user_accounts 里没有任何年龄字段。于是「这个用户满 18 岁」只在注册
# 那一瞬间成立：无法复查、无法举证，而 AI 法 134/2025（2026-03-01 生效）要求的
# 未成年人保护也因为没有年龄信号而无从做起。判定和留痕是两个动作，两个都要有。
require_test "COMP-AGE-001" "./internal/identity" \
  "TestAnonymousSessionPersistsTheAgeItJustVerified" \
  "apps/api-go/internal/identity/age_assertion_compliance_test.go" || exit $?
require_test "COMP-AGE-001" "./internal/identity" \
  "TestAgeAssertionIsNotWrittenWhenTheAgeGateRejects" \
  "apps/api-go/internal/identity/age_assertion_compliance_test.go" || exit $?
require_test "COMP-AGE-001" "./internal/identity" \
  "TestAgeAssertionUsesTheSameDateTheGateAccepted" \
  "apps/api-go/internal/identity/age_assertion_compliance_test.go" || exit $?

# 判定之后必须真的写，不能只在内存里判完就算了。
if ! grep -qF 'RecordAgeAssertionDetached(context.WithoutCancel(ctx), session.UserAccountID, p.DateOfBirth, e)' \
     apps/api-go/internal/identity/service.go; then
  echo "  FAIL [COMP-AGE-001]: the date of birth is no longer persisted after the 18+ gate." >&2
  echo "        A gate that leaves no record cannot be re-checked or evidenced." >&2
  exit 1
fi
# 生产实现必须写进真表，且按 asserted_at 取最新（append-only）。
if ! grep -qF 'INSERT INTO identity.user_age_assertions' apps/api-go/internal/platform/postgres/identity.go ||
   ! grep -qF 'ORDER BY asserted_at DESC' apps/api-go/internal/platform/postgres/identity.go; then
  echo "  FAIL [COMP-AGE-001]: the age assertion store no longer reads/writes" >&2
  echo "        identity.user_age_assertions as an append-only log." >&2
  exit 1
fi
echo "    COMP-AGE-001: PASS (the 18+ decision leaves an auditable age assertion)"

# COMP-AI-MINOR-001: AI 伴侣 / 数字分身不对未成年人开放。
# 越南 AI 法 134/2025/QH15（2026-03-01 生效）要求对未成年人采取保护措施。
# 陪伴型 AI（数字分身、平台 AI 角色）是点名场景：未成年人可以全天候和一个
# 不会拒绝、还带着真人 likeness 的对象建立情感依赖。
# 前置的年龄信号由 COMP-AGE-001 提供；这里钉的是守卫本身。
# fail-closed 三个方向：没接查询 / 没有年龄证据 / 查询报错，全部拒绝。
require_test "COMP-AI-MINOR-001" "./internal/aipersona" \
  "TestCompanionRefusedForConfirmedMinor" \
  "apps/api-go/internal/aipersona/minor_protection_test.go" || exit $?
require_test "COMP-AI-MINOR-001" "./internal/aipersona" \
  "TestCompanionRefusedWhenNoAgeEvidence" \
  "apps/api-go/internal/aipersona/minor_protection_test.go" || exit $?
require_test "COMP-AI-MINOR-001" "./internal/aipersona" \
  "TestCompanionRefusedWhenAgeLookupUnwired" \
  "apps/api-go/internal/aipersona/minor_protection_test.go" || exit $?
require_test "COMP-AI-MINOR-001" "./internal/aipersona" \
  "TestCreatePersonaBlockedForMinor" \
  "apps/api-go/internal/aipersona/minor_protection_test.go" || exit $?
require_test "COMP-AI-MINOR-001" "./internal/aipersona" \
  "TestCreatePersonaBlockedWhenAgeLookupUnwired" \
  "apps/api-go/internal/aipersona/minor_protection_test.go" || exit $?
# 反向也钉：成年人必须还能建，否则守卫就退化成「关掉这个功能」。
require_test "COMP-AI-MINOR-001" "./internal/aipersona" \
  "TestCreatePersonaAllowedForAdult" \
  "apps/api-go/internal/aipersona/minor_protection_test.go" || exit $?

# 年龄检查必须发生在「建」之前 —— 建了再删没用，孩子已经和它说过话了。
if ! grep -qF 'CompanionAllowedFor(ctx, s.ageLookup, p.OwnerID, s.now().UTC())' \
     apps/api-go/internal/aipersona/personas.go; then
  echo "  FAIL [COMP-AI-MINOR-001]: CreatePersona no longer checks age." >&2
  echo "        Deleting a persona after the fact does not undo the conversation." >&2
  exit 1
fi
# 不接线 = 谁都建不了（fail-closed）。
if ! grep -qF 'personaSvc.SetAgeLookup(' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [COMP-AI-MINOR-001]: the age lookup is no longer wired in cmd/api/main.go." >&2
  exit 1
fi

# COMP-AI-MINOR-001（聊天侧）：上面那道门只守在「建分身」上。平台 AI 伴侣
# （ai_001..005）是平台自带账号 —— 带 assistantMode 建会话就能直接拿到开场白，
# 一条用户消息都不用发。所以聊天入口必须再拦一道，否则「未成年人不发消息也
# 拿不到 AI」是假的。判定复用同一个 CompanionAllowedFor，不另写一套年龄规则。
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestCompanionGateUnwiredDeniesEveryone" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestCompanionGateDenialReportsGatedWithoutWelcome" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestCompanionGateBlocksTheModelCallWhenDenied" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?
# 反向也钉：允许时必须真的通。没有这一条，上面几条拒绝断言可能只是因为门禁
# 永远返回 false —— 那测的是「功能被关掉了」，不是「门禁接上了」。
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestCompanionGateApprovalKeepsTheCompanionAlive" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?

# assistantMode 是**调用方自愿提供的**参数，而客户端有好几条路不带它 ——
# 活动卡片、位置卡片压根不带，名片和语音曾经连回包都不看。
# 所以「这条会话对面是不是平台 AI 伴侣」必须能从会话成员认出来，
# 不能只信 assistantMode。否则两个后果同时发生：
#   1. 合规：被建分身门禁拦掉的账号，发送时不带 assistantMode 就完全不受门禁约束
#      （活动卡片就是这么发的）—— 门禁形同虚设；
#   2. 功能：模型拿到**需求助手**的 system prompt、回复署名 proxy_ai，
#      而客户端按 sender 回退渲染成「AI 虚拟女孩」在说话 ——
#      女孩的脸配需求助手的口吻（"有没有预算范围？"）。
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestCompanionVoiceSurvivesAMissingAssistantMode" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestCompanionGateHoldsWhenTheSendOmitsAssistantMode" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?
# 开场白和门禁必须是同一个判断。门禁认了「这是伴侣会话」而开场白不认的话，
# 会话建好了、一条问候都没有、assistantStatus 整个字段缺席 ——
# 用户进到一间空房间，客户端连"为什么没消息"都拿不到。
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestCompanionWelcomeDoesNotDependOnAssistantMode" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?
# 负向对照：真人 DM 不能被这个兜底误伤。
# 没有这一条，上面两条可能只是因为**所有**会话都拿到了伴侣人设 ——
# 那样首页 / 需求助手全废，而测试还是绿的。
# AI-MANAGE-003/008 起真人 DM 由对面真人的代回复（stand-in）回，测试随之改名；负向对照的本意不变：绝不落到伴侣人设。
require_test "COMP-AI-MINOR-001" "./internal/conversation" \
  "TestHumanDirectMessageGetsTheStandInNotTheCompanion" \
  "apps/api-go/internal/conversation/companion_gate_test.go" || exit $?

# 接线点必须存在。companion_gate 是 fail-closed 的：没接 = 对所有账号关闭，
# 而「忘了接线」和「故意关掉」在测试里长得一模一样 —— 只有这条能分辨。
# 这里踩过一次：门禁定义好了、注释还写着「生产实现见 cmd/api 的接线」，
# 但真正接上的是 twininsight.Service，conversation.Service 一直没接。
if ! grep -qF 'conversationService.SetCompanionGate(' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [COMP-AI-MINOR-001]: the companion gate is no longer wired onto the" >&2
  echo "        conversation service in cmd/api/main.go. A nil gate denies everyone," >&2
  echo "        so platform AI companion chat is dead for 100% of users." >&2
  exit 1
fi
# 两个入口都要拦：开新会话（带 assistantMode 就有开场白）和发消息。
# 只拦一个的话，另一条路照样能跟 AI 伴侣聊。
gate_calls=$(grep -cF 's.companionAllowedFor(ctx, e.Actor.ID)' apps/api-go/internal/conversation/service.go)
if [ "$gate_calls" -lt 2 ]; then
  echo "  FAIL [COMP-AI-MINOR-001]: the chat-entry gate fires at $gate_calls of the 2 entry" >&2
  echo "        points (StartConversation + SendMessage). One unguarded path is enough" >&2
  echo "        for an account that should have been refused to keep chatting." >&2
  exit 1
fi
# GATED 不许被折叠成 FAILED/UNAVAILABLE —— 那是把「依法不提供」说成「服务坏了」，
# 用户会一直重试一个永远不会成功的东西。契约放 contracts，两端一起认。
if ! grep -qF '"GATED"' packages/contracts/src/conversation.ts; then
  echo "  FAIL [COMP-AI-MINOR-001]: the GATED assistant status is gone from the contracts." >&2
  exit 1
fi
if ! grep -qF 'parseAssistantStatus' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-AI-MINOR-001]: the client no longer reads assistantStatus, so GATED" >&2
  echo "        renders as silence — 'no access' would look like 'no reply'." >&2
  exit 1
fi
# 会渲染 AI 状态的表面必须真的分支到 GATED —— 否则服务端说「依法不提供」，
# 这一屏什么都不说，又变回沉默。
#
# 会话页是**活路径**：开场白 / 文字 / 图片 / 视频四条都带 assistantMode=AI_PERSONA，
# 门禁一拦就是 GATED，所以这里要真钉住。
if ! grep -qF '"GATED"' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-AI-MINOR-001]: conversation.tsx does not branch on GATED — the" >&2
  echo "        server says 'not provided by policy' and this surface says nothing." >&2
  exit 1
fi
# 首页助手（HomeAssistantSurface）**今天不是伴侣表面**：它的 HomeIntentMode 只有
# SERVICE / ORDER / ACTIVITY，没有一个带 AI_PERSONA 前缀（只有 HomeChatBox 能
# 产生 mode，也只有这三个值），所以服务端永远不会对它回 GATED。
# 那句 GATED 文案留着是对的 —— 将来首页对话真加了伴侣入口时，它必须已经在；
# 但它**不能算「GATED 已被覆盖」的证据**（原来这条钉就是这么写的，等于拿一句
# 到不了的话冒充覆盖）。所以改成守**边界**：一旦这个表面开始说 AI_PERSONA，
# 这条钉就红，逼那个人去把 GATED 这条路真的走一遍。
if grep -qF 'AI_PERSONA' apps/mobile/src/surfaces/home-assistant.tsx; then
  echo "  FAIL [COMP-AI-MINOR-001]: home-assistant.tsx now speaks to an AI companion" >&2
  echo "        (AI_PERSONA showed up in it), but this surface has never been shown to" >&2
  echo "        render GATED. Its HomeIntentMode set was SERVICE/ORDER/ACTIVITY — a" >&2
  echo "        companion mode here makes the gate reachable on an unverified path." >&2
  exit 1
fi
# 光有「分支到 GATED」不够 —— 还得保证那句提示进的是**不会被轮询擦掉**的槽。
# 这里踩过一次（2026-09-22）：上面那 4 个入口全都把 assistantStatusNotice 的
# 返回值塞进 setError，而会话页每 3 秒轮询一次、hydrateMessages 结尾有一句
# setError(undefined)（那是给「这次请求失败了」这种瞬时态收尾的）—— 结果是
# 门禁提示闪一下就被清掉，用户回到一个空会话，跟没提示一模一样。GATED 是
# 账号级状态（"重试无效"），不是一次失败，它必须有自己的槽。
if ! grep -qF 'companionGatedNotice ?' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-AI-MINOR-001]: the gated notice is no longer rendered in its own" >&2
  echo "        slot. In the transient error slot it is wiped by the 3s message poll," >&2
  echo "        so the user sees it flash once and is left staring at an empty chat." >&2
  exit 1
fi
if ! grep -qF 'persistent: true' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-AI-MINOR-001]: GATED is no longer classified as a persistent notice," >&2
  echo "        so it will be routed back into the self-clearing error slot." >&2
  exit 1
fi
# 分类对了还不够 —— 得真的写进那个槽。有人把 setCompanionGatedNotice 改回
# setError 的话，上面几条（槽存在、有渲染、4 个入口都走分派器）全都照样绿，
# 而用户看到的又变成闪一下就没。这条钉的就是那一行本身。
if ! grep -qF 'setCompanionGatedNotice(notice.text)' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-AI-MINOR-001]: the persistent notice is no longer written to its" >&2
  echo "        own slot — someone routed it back through setError. The slot, the" >&2
  echo "        render and the 4 dispatch sites all still look fine, but the 3s poll" >&2
  echo "        clears it and the gated user is back to an unexplained empty chat." >&2
  exit 1
fi
# 伴侣入口的个数**不能写死**。凡是往服务端发 AI_PERSONA 的调用点，都必须消费回包里的
# assistantStatus —— GATED 只活在那条回包里（不落库、下次刷新拿不到），漏一个，
# 那条路上的「依法不提供」就是彻底沉默。
# 这里踩过：我先按「4 个入口（开场白/文字/图片/视频）」写死，而实际有 6 个
# （还有名片和语音）—— 钉照样绿，那两条路照样哑。所以让两个数自己对上。
# 注意计数用 `applyAssistantNotice(` —— 定义那行是 `applyAssistantNotice = useCallback(`，
# 名字后面跟的是空格不是括号，不会被算进来。
persona_sends=$(grep -cF 'AI_PERSONA:${aiAccount.personaId}' apps/mobile/src/surfaces/conversation.tsx)
notice_calls=$(grep -cF 'applyAssistantNotice(' apps/mobile/src/surfaces/conversation.tsx)
if [ "$notice_calls" -lt "$persona_sends" ]; then
  echo "  FAIL [COMP-AI-MINOR-001]: $persona_sends companion send paths but only" >&2
  echo "        $notice_calls of them dispatch the returned assistantStatus through" >&2
  echo "        applyAssistantNotice. GATED travels only in the command response — it" >&2
  echo "        is never persisted, so an entry that ignores it is silent forever." >&2
  exit 1
fi
# 任何一处直接消费 assistantStatusNotice 的返回值，都等于绕开「持久态 vs 瞬时态」
# 这个判断 —— 正是上面那次翻车的样子。
if grep -qF 'assistantStatusNotice(payload' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-AI-MINOR-001]: a call site consumes assistantStatusNotice directly" >&2
  echo "        instead of going through applyAssistantNotice — that bypasses the" >&2
  echo "        persistent-vs-transient decision and GATED can silently go back to" >&2
  echo "        being rendered in the slot the poll clears." >&2
  exit 1
fi
echo "    COMP-AI-MINOR-001: PASS (AI companions are refused to minors and to accounts with no age evidence)"

# COMP-E2EE-001: 不许宣称做不到的加密。
# EndToEndEncrypted 此前恒为 true，理由写的是「transport TLS + at-rest KMS」——
# 那不是端到端加密，两种情况服务端都能读到明文。对用户挂一把兑现不了的锁是
# 虚假安全声明（他会以为连平台都看不到，从而说出他不会说的话），而且与
# COMP-CHAT-001 冲突：付费会话必须保留可审计记录，本来就不能是 E2EE。
# 三条出口都要钉：默认值、发送路径、序列化边界（库里的旧消息带着 true）。
require_test "COMP-E2EE-001" "./internal/conversation" \
  "TestNoDefaultProtectionClaimsEndToEndEncryption" \
  "apps/api-go/internal/conversation/message_protection_e2ee_test.go" || exit $?
require_test "COMP-E2EE-001" "./internal/conversation" \
  "TestWithoutUnbackedClaimsStripsEndToEndClaim" \
  "apps/api-go/internal/conversation/message_protection_e2ee_test.go" || exit $?
require_test "COMP-E2EE-001" "./internal/conversation" \
  "TestMarshalledProtectionNeverClaimsEndToEndEncryption" \
  "apps/api-go/internal/conversation/message_protection_e2ee_test.go" || exit $?
# 去掉恒真条件后行为不能变（以前实际生效的一直是 ScreenshotProtected）。
require_test "COMP-E2EE-001" "./internal/conversation" \
  "TestSecurityModeStillKeyedOnScreenshotProtection" \
  "apps/api-go/internal/conversation/message_protection_e2ee_test.go" || exit $?

# 序列化兜底必须在：改默认值管不到库里已有的旧消息。
if ! grep -qF 'func (p MessageProtection) MarshalJSON()' \
     apps/api-go/internal/conversation/message_protection.go; then
  echo "  FAIL [COMP-E2EE-001]: protection is no longer sanitized at the serialization" >&2
  echo "        boundary, so stale rows still advertise end-to-end encryption." >&2
  exit 1
fi
# 发送路径必须再抹一次，调用方不能自称端到端加密。
if ! grep -qF 'protection.WithoutUnbackedClaims()' apps/api-go/internal/conversation/service.go; then
  echo "  FAIL [COMP-E2EE-001]: the send path no longer strips the end-to-end claim." >&2
  exit 1
fi
# app.json 的出口申报必须与代码一致：没有 E2EE 就写 false。
if ! grep -qF '"usesNonExemptEncryption": false' apps/mobile/app.json; then
  echo "  FAIL [COMP-E2EE-001]: app.json now declares non-exempt encryption while the" >&2
  echo "        code has no end-to-end encryption to declare." >&2
  exit 1
fi
echo "    COMP-E2EE-001: PASS (no unbacked end-to-end encryption claim on any egress)"

# COMP-E2EE-002: 用户真正看得到的地方，不许出现做不到的加密承诺。
# 001 只钉住了后端字段，但对用户作出承诺的其实是 UI 文案和法律文件：
#   - 设置页卡片原文「🔒 端到端加密 / 军用级 AES-256 / 已开启 · 始终保护」；
#   - ToS §16 把端到端加密列进 Secure Chat 功能清单；
#   - 隐私政策原文「如果 Proxy 明确标记某会话为端到端加密 Secure Chat…」。
# 平台没有 E2EE，这些全是虚假陈述（RFC 里更直白地写着「这是让人觉得安全」）。
# 钉法两条：
#   1) 法律文件里不许把它当功能列出来（`- 端到端加密`），并且必须明确写
#      「目前不提供端到端加密」——只删不管会让人以为是我们漏写了。
#   2) 移动端源码里这个能力名一律不许出现（含注释）。要留免责说明就用
#      「E2EE（端到端）加密」的写法，这样「出现即为违规」这条铁律才成立。
for f in apps/api-go/internal/api/legal_docs/terms_v1.1.txt \
         apps/api-go/internal/api/legal_docs/privacy_v1.1.txt \
         docs/legal/vietnam/Proxy_Terms_CN_v1.1_Vietnam_2026-08-31.txt \
         docs/legal/vietnam/Proxy_Privacy_CN_v1.1_Vietnam_2026-08-31.txt \
         docs/legal/vietnam/Proxy_Terms_Privacy_CN_v1.1_Vietnam_2026-08-31.txt; do
  if [ ! -f "$f" ]; then
    echo "  FAIL [COMP-E2EE-002]: legal document $f is missing." >&2
    exit 1
  fi
  if grep -qF -- '- 端到端加密' "$f"; then
    echo "  FAIL [COMP-E2EE-002]: $f still lists 端到端加密 as a feature." >&2
    exit 1
  fi
  if ! grep -qF -- '目前不提供端到端加密' "$f"; then
    echo "  FAIL [COMP-E2EE-002]: $f no longer states that Proxy does not provide" >&2
    echo "        end-to-end encryption." >&2
    exit 1
  fi
done
if grep -rqF -- '端到端加密' apps/mobile/src; then
  echo "  FAIL [COMP-E2EE-002]: mobile UI copy still names 端到端加密." >&2
  grep -rlF -- '端到端加密' apps/mobile/src >&2
  exit 1
fi
# 设计稿长什么样，UI 就会长成什么样：原型里不许再画这个徽标。
if grep -rqF --include='*.html' -- '端到端加密' docs/design/references; then
  echo "  FAIL [COMP-E2EE-002]: a design prototype still renders an 端到端加密 badge:" >&2
  grep -rlF --include='*.html' -- '端到端加密' docs/design/references >&2
  exit 1
fi
echo "    COMP-E2EE-002: PASS (no end-to-end encryption claim in UI copy, prototypes or legal docs)"

# COMP-REPORT-001: 法律文件 §38 承诺可举报的八类目标，必须真的都能报。
# 之前只有 engagement.ReportPost（POST）一个入口 —— 承诺 8 类，接得上 1 类。
# 这不是功能缺失那么简单：
#   1. 电商法 122/2025 与 NĐ 147/2024 都要求平台提供举报受理渠道；
#   2. 我们最重的刑事风险（刑法 327 条介绍卖淫）恰恰发生在 MESSAGE /
#      ACCOUNT / TRANSACTION 上 —— 没有入口，平台既收不到线索，也拿不出
#      「收到过、处理过」的证据；
#   3. 原接口只有 SPAM / HARASSMENT / UNSAFE / OTHER 四种理由，涉未成年人
#      与线下招嫖只能塞进 UNSAFE，运营看不出该优先处理哪一条。
# 「建了包」不等于「接得上」—— 服务没挂到调度器上，命令会落到 501。
# 所以除了用例，还要静态钉住调度器与 main 的接线。
require_test "COMP-REPORT-001" "./internal/moderation" \
  "TestReportableTargetTypesMatchTermsSection38" \
  "apps/api-go/internal/moderation/report_compliance_test.go" || exit $?
require_test "COMP-REPORT-001" "./internal/moderation" \
  "TestReportAcceptedForEveryTargetPromisedInTerms" \
  "apps/api-go/internal/moderation/report_compliance_test.go" || exit $?
require_test "COMP-REPORT-001" "./internal/moderation" \
  "TestReportRejectedForUnknownTargetType" \
  "apps/api-go/internal/moderation/report_compliance_test.go" || exit $?
require_test "COMP-REPORT-001" "./internal/moderation" \
  "TestReportRejectedWhenActorMissing" \
  "apps/api-go/internal/moderation/report_compliance_test.go" || exit $?
require_test "COMP-REPORT-001" "./internal/moderation" \
  "TestReportFailedWhenRepositoryDown" \
  "apps/api-go/internal/moderation/report_compliance_test.go" || exit $?
# 命令必须真的接到调度器上，否则一切用例都是自娱自乐。
if ! grep -qF 's.Moderation != nil && s.Moderation.Supports' \
     apps/api-go/internal/api/command_dispatch.go; then
  echo "  FAIL [COMP-REPORT-001]: ReportTarget is no longer routed by the" >&2
  echo "        dispatcher, so users would get 501 instead of a report." >&2
  exit 1
fi
# 没接数据库实现的话，开发模式下内存仓储会静默吞掉举报。
if ! grep -qF 'moderation.NewWithRepository(postgres.NewModerationRepository(pool))' \
     apps/api-go/cmd/api/main.go; then
  echo "  FAIL [COMP-REPORT-001]: the Postgres report repository is no longer" >&2
  echo "        wired, so reports would only live in memory." >&2
  exit 1
fi
if ! grep -qF 'server.Moderation = moderationService' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [COMP-REPORT-001]: the moderation service is no longer attached" >&2
  echo "        to the HTTP server." >&2
  exit 1
fi
# 表没了，接口接得再好也是往空气里写。
if [ ! -f apps/api-go/migrations/086_moderation_reports.sql ]; then
  echo "  FAIL [COMP-REPORT-001]: migration 086_moderation_reports.sql is missing." >&2
  exit 1
fi
echo "    COMP-REPORT-001: PASS (every target promised in the terms is reportable and persisted)"

# COMP-REPORT-002: 举报入口必须真的能被用户点到。
# 001 把服务端接上了（八类目标全部受理），但移动端只有一个入口 ——
# feed 帖子菜单里的「举报」。用户能碰到的仍然只有 1/8，而招嫖揽客、
# 人身威胁、涉未成年人这些恰恰发生在**消息**里。
# 上一笔我自己在 commit message 里写了「无视觉改动，另开」，如果不另开，
# 就又犯一次「改了后端就宣称解决了」的错 —— 那是我在 COMP-E2EE-002
# 里刚批评过的同一个毛病。所以这里把「用户点得到」也钉住。
if ! grep -q 'COMP-REPORT-002' apps/mobile/src/moderation-client.test.ts ||
   ! grep -q 'targetType="MESSAGE"' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-REPORT-002]: the message report entry point is gone —" >&2
  echo "        the API accepts reports but users can no longer file one." >&2
  exit 1
fi
# 客户端要真的造出来并传进会话页，否则按钮点了也是 undefined。
if ! grep -q 'new ModerationClient(' apps/mobile/src/native-app.tsx ||
   ! grep -q 'moderationClient={moderation}' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [COMP-REPORT-002]: ModerationClient is no longer constructed and" >&2
  echo "        passed into the conversation surface." >&2
  exit 1
fi
# 理由清单里必须有 SOLICITATION 与 MINOR_SAFETY —— 这两类风险最高，
# 只能塞进「其他」等于没有信号。
if ! grep -q 'SOLICITATION' apps/mobile/src/moderation-client.ts ||
   ! grep -q 'MINOR_SAFETY' apps/mobile/src/moderation-client.ts; then
  echo "  FAIL [COMP-REPORT-002]: the report reason list lost SOLICITATION or" >&2
  echo "        MINOR_SAFETY, so the highest-risk reports carry no signal." >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/moderation-client.test.ts || exit $?
# 账号与交易入口：这两类和「消息」一样是高风险面 —— 冒充身份是看整个账号
# 看出来的，诈骗与招嫖揽客落在订单上。只做消息入口仍然只覆盖了 2/8。
if ! grep -q 'targetType="ACCOUNT"' apps/mobile/src/surfaces/other-profile.tsx; then
  echo "  FAIL [COMP-REPORT-002]: the account report entry point is gone." >&2
  exit 1
fi
if ! grep -q 'targetType="TRANSACTION"' apps/mobile/src/surfaces/me-orders.tsx; then
  echo "  FAIL [COMP-REPORT-002]: the transaction report entry point is gone." >&2
  exit 1
fi
# 原因选择抽成了共用组件：三个入口各自抄一份，迟早有一份忘了更新理由清单。
if ! grep -q 'REPORT_REASONS' apps/mobile/src/components/report-sheet.tsx; then
  echo "  FAIL [COMP-REPORT-002]: ReportSheet no longer uses the shared reason list." >&2
  exit 1
fi
# 活动 / 商家 / 机会 / 邀约 四类入口。
#
# 这里钉的是**判定函数**而不是 JSX 里的 targetType="ACTIVITY" —— 上次
# 把内联弹层抽成 ReportSheet 时，钉字符串的那条 pin 直接误报（能力还在，
# 实现挪了位置）。判定逻辑抽成纯函数后，pin 住函数就同时钉住了能力和测试。
if ! grep -q 'activityReportTargets' apps/mobile/src/surfaces/activity-detail.tsx; then
  echo "  FAIL [COMP-REPORT-002]: the activity / merchant report entry point is gone." >&2
  exit 1
fi
if ! grep -q 'opportunityReportTarget' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [COMP-REPORT-002]: the opportunity / invite report entry point is gone." >&2
  exit 1
fi
# 客户端必须真的造出来并传进市场页，否则按钮点了也是 undefined。
if ! grep -q 'moderation={moderation}' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [COMP-REPORT-002]: ModerationClient is no longer threaded into the market surface." >&2
  exit 1
fi
# 四类判定都要有具名测试（require_test 由上面的 vitest run 覆盖，这里
# 再钉一次文件，避免有人把 describe 块整段删掉而测试文件还在）。
for t in "always offers the activity itself, and the host merchant only when it is merchant-run" \
         "reports a targeted opportunity as INVITE and a public one as OPPORTUNITY" \
         "sends every target the new entry points offer"; do
  if ! grep -q "$t" apps/mobile/src/moderation-client.test.ts; then
    echo "  FAIL [COMP-REPORT-002]: missing named test for the new entry points: $t" >&2
    exit 1
  fi
done
echo "    COMP-REPORT-002: PASS (message, account, transaction, activity, merchant, opportunity and invite are all reportable from the UI)"

# COMP-REPORT-003: 举报的**处置**留痕。
# 001/002 解决了「收得到、点得到」，但 reports 表把 state 钉死在 SUBMITTED
# 且整表 append-only —— 平台能证明「收到过」，证明不了「处理过」。
# 服务条款承诺了举报与申诉渠道，并承诺「依法要求删除违法信息：最迟 24 小时
# 内处理」。收进来却没有处置记录，等于书面承认收到、却拿不出处理痕迹；
# 在刑法 327 条的语境下，MINOR_SAFETY / SOLICITATION 两类举报查不到处置，
# 姿态就是「知情不办」。
require_test "COMP-REPORT-003" "./internal/moderation" \
  "TestDispositionAcceptedAndAttributed" \
  "apps/api-go/internal/moderation/disposition_compliance_test.go" || exit $?
require_test "COMP-REPORT-003" "./internal/moderation" \
  "TestReportStateFollowsDispositions" \
  "apps/api-go/internal/moderation/disposition_compliance_test.go" || exit $?
require_test "COMP-REPORT-003" "./internal/moderation" \
  "TestDispositionRejectedWhenActionTakenWithoutOutcome" \
  "apps/api-go/internal/moderation/disposition_compliance_test.go" || exit $?
require_test "COMP-REPORT-003" "./internal/moderation" \
  "TestDispositionRejectedWhenDismissedWithoutReason" \
  "apps/api-go/internal/moderation/disposition_compliance_test.go" || exit $?
require_test "COMP-REPORT-003" "./internal/moderation" \
  "TestDispositionRejectedForUnknownReport" \
  "apps/api-go/internal/moderation/disposition_compliance_test.go" || exit $?
# 处置是 operator-only：普通用户能给自己写「已处置」，这条留痕就一文不值。
if ! grep -qF '"RecordReportDisposition": true' \
     apps/api-go/internal/api/security.go; then
  echo "  FAIL [COMP-REPORT-003]: RecordReportDisposition is no longer operator-only," >&2
  echo "        so anyone could write a fake disposition onto their own report." >&2
  exit 1
fi
# 命令必须真被 moderation 服务受理，否则命令面写了也走不到。
if ! grep -qF 'case "RecordReportDisposition"' \
     apps/api-go/internal/moderation/service.go; then
  echo "  FAIL [COMP-REPORT-003]: the disposition command is no longer handled by" >&2
  echo "        the moderation service, so it would 501." >&2
  exit 1
fi
# 落库实现：只有内存仓储的话，重启一次处置记录就没了。
if ! grep -qF 'func (r *ModerationRepository) AddDisposition' \
     apps/api-go/internal/platform/postgres/moderation.go; then
  echo "  FAIL [COMP-REPORT-003]: the Postgres disposition repository is missing," >&2
  echo "        so dispositions would not survive a restart." >&2
  exit 1
fi
if [ ! -f apps/api-go/migrations/087_moderation_dispositions.sql ]; then
  echo "  FAIL [COMP-REPORT-003]: migration 087_moderation_dispositions.sql is missing." >&2
  exit 1
fi
echo "    COMP-REPORT-003: PASS (handled reports leave an attributable, append-only trail)"

# COMP-REPORT-004: 申诉机制（§37 第 693 行、§38 第 709 行承诺的「恢复或申诉
# 机制」，NĐ 147/2024 把社交网络的投诉 / 申诉渠道列为硬性要求）。
#
# 003 让举报闭环到「收到 → 处理」，但没有申诉渠道，被处理方无从申辩 ——
# 平台能证明自己处理了举报，却证明不了「被处理方有救济途径」。
require_test "COMP-REPORT-004" "./internal/moderation" \
  "TestAppealAcceptedAndAttributed" \
  "apps/api-go/internal/moderation/appeal_compliance_test.go" || exit $?
require_test "COMP-REPORT-004" "./internal/moderation" \
  "TestAppealStateFollowsDecisions" \
  "apps/api-go/internal/moderation/appeal_compliance_test.go" || exit $?
require_test "COMP-REPORT-004" "./internal/moderation" \
  "TestAppealRejectedForUnknownReport" \
  "apps/api-go/internal/moderation/appeal_compliance_test.go" || exit $?
require_test "COMP-REPORT-004" "./internal/moderation" \
  "TestAppealDecisionRejectedWhenRejectedWithoutNote" \
  "apps/api-go/internal/moderation/appeal_compliance_test.go" || exit $?
require_test "COMP-REPORT-004" "./internal/moderation" \
  "TestAppealDecisionsCoverUpheldAndRejected" \
  "apps/api-go/internal/moderation/appeal_compliance_test.go" || exit $?
# 复核是 operator-only：普通用户能给自己写「申诉成立 / 驳回」，这个渠道的
# 制衡意义就归零了。
if ! grep -qF '"RecordAppealDecision": true' \
     apps/api-go/internal/api/security.go; then
  echo "  FAIL [COMP-REPORT-004]: RecordAppealDecision is no longer operator-only," >&2
  echo "        so anyone could write a fake review onto their own appeal." >&2
  exit 1
fi
# 反向钉：提交申诉**不能**变成 operator-only —— 否则普通用户根本够不到申诉
# 入口，§38 承诺的申诉渠道在界面上消失（与 002 同一类：承诺了但点不到）。
if grep -qF '"FileAppeal": true' \
    apps/api-go/internal/api/security.go; then
  echo "  FAIL [COMP-REPORT-004]: FileAppeal became operator-only, so ordinary" >&2
  echo "        logged-in users can no longer reach the appeal channel at all." >&2
  exit 1
fi
# 命令必须真被 moderation 服务受理，否则命令面写了也走不到。
if ! grep -qF 'case "FileAppeal"' \
     apps/api-go/internal/moderation/service.go; then
  echo "  FAIL [COMP-REPORT-004]: the appeal command is no longer handled by" >&2
  echo "        the moderation service, so it would 501." >&2
  exit 1
fi
# 落库实现：只有内存仓储的话，重启一次申诉记录就没了。
if ! grep -qF 'func (r *ModerationRepository) AddAppeal' \
     apps/api-go/internal/platform/postgres/moderation.go; then
  echo "  FAIL [COMP-REPORT-004]: the Postgres appeal repository is missing," >&2
  echo "        so appeals would not survive a restart." >&2
  exit 1
fi
if [ ! -f apps/api-go/migrations/088_moderation_appeals.sql ]; then
  echo "  FAIL [COMP-REPORT-004]: migration 088_moderation_appeals.sql is missing." >&2
  exit 1
fi
echo "    COMP-REPORT-004: PASS (the appeal channel exists, is attributable, and is operator-reviewed)"

# COMP-REPORT-005: 举报的处置时限 + **读出口**。
#
# 001/002 解决了「收得到」，003 解决了「处置留痕」—— 但 003 只做了写侧：
# Repository 只有 AddReport / FindReport，而 FindReport 只被写入口当作
# 「对象是否存在」的校验用。**没有任何一条查询能列出举报**。087 甚至替
# 「运营队列」建好了 idx_moderation_dispositions_action 索引，那条查询从来
# 没被写出来 —— 实现存在 ≠ 生效。
#
# 结果：举报只进不出。平台收得下举报，却没有任何路径把它交到人手上。
# 实测证据：库里唯一一条举报 reason='SOLICITATION'（2026-09-15 18:59 受理）
# 到 2026-09-22 已 7 天、处置记录 0 条 —— 不是没人处理，是没人能发现它存在。
# 而 SOLICITATION 恰是刑法 327 条（介绍卖淫）那类风险所在。
#
# 同时补上时限：服务条款 §58 承诺「建立举报、核查、限制传播、纠正、移除和
# 账号处置流程」，Decree 328/2026 §4 把时限钉成「一般 24h、紧急 6h」
# （口径见 docs/legal/vietnam/Proxy_Operating_Terms_Supplement_2026-08-31.md）。
# 没有截止时刻，平台既做不到、也证明不了自己按时处理过。
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestEverySupportedReasonHasAnSLA" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestReportSLAUrgentClassCoversMinorAndSolicitation" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestAcceptedReportCarriesAFixedDueAt" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestReportQueueSurfacesTheStaleSolicitation" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestReportQueueFailsClosedWhenRepositoryIsDown" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
# 超时判定的对象是「有没有在时限内处理完」，不是「现在是否晚于截止时刻」——
# 后者会把按时处置完的举报在几天后显示成超时（假警报），而假警报会让人
# 整体忽略这个字段，真超时的那条也跟着被忽略。
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestReportQueueDoesNotCallAPromptResolutionOverdue" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestReportQueueFlagsALateResolution" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
# 迁移里的 SQL CASE 与 Go 的时限表必须一致 —— 两边各写一遍，改一边不改另一边
# 会把历史举报的时限算错。
require_test "COMP-REPORT-005" "./internal/moderation" \
  "TestMigrationBackfillMatchesGoMapping" \
  "apps/api-go/internal/moderation/queue_test.go" || exit $?
# 队列与处置必须走 operator 门。这条独立钉的必要性：operator_scopes_test.go
# 的 completeness 只保证两张表**互相**一致 —— 同时删掉一条命令时它依然绿，
# 而命令就此对所有人敞开。
require_test "COMP-REPORT-005" "./internal/api" \
  "TestModerationReportCommandsRequireOperator" \
  "apps/api-go/internal/api/server_test.go" || exit $?
# 真库往返：单测跑的是内存仓储，证明不了 SQL（两个 LEFT JOIN LATERAL、
# 「没有处置时 last_disposition_at 是 NULL」、以及 outcome 空串撞 CHECK）。
require_test "COMP-REPORT-005" "./internal/platform/postgres" \
  "TestModerationReportQueueRoundTrip" \
  "apps/api-go/internal/platform/postgres/moderation_integration_test.go" || exit $?
# 反向：队列命令必须真被 moderation 服务受理，否则命令面写了也走不到（501）。
if ! grep -qF 'case "ListReportQueue"' apps/api-go/internal/moderation/service.go; then
  echo "  FAIL [COMP-REPORT-005]: ListReportQueue is no longer handled by the" >&2
  echo "        moderation service, so the report queue would 501 and reports" >&2
  echo "        would go back to being write-only." >&2
  exit 1
fi
if ! grep -qF '"ListReportQueue": true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [COMP-REPORT-005]: ListReportQueue is no longer operator-only, so" >&2
  echo "        any logged-in user could enumerate who reported whom." >&2
  exit 1
fi
# 反向：dispositions 的 outcome 必须走 NULLIF。空串撞
# dispositions_outcome_check 会让五种处置动作里四种
# （TRIAGE / ESCALATE / DISMISS / REOPEN）在生产路径上全部失败，而内存仓储
# 不校验 outcome，单测照样全绿 —— 典型的「内存绿、生产红」。
if ! grep -qF "NULLIF(\$4, '')" apps/api-go/internal/platform/postgres/moderation.go; then
  echo "  FAIL [COMP-REPORT-005]: the dispositions INSERT no longer nulls an empty" >&2
  echo "        outcome. Postgres then rejects every disposition without an outcome" >&2
  echo "        (TRIAGE/ESCALATE/DISMISS/REOPEN) with dispositions_outcome_check." >&2
  exit 1
fi
# 反向：举报必须带处置截止时刻，且截止列必须是 NOT NULL —— 一条没有时限的
# 举报正是本笔要消灭的状态。
if ! grep -qF 'due_at' apps/api-go/internal/platform/postgres/moderation.go; then
  echo "  FAIL [COMP-REPORT-005]: AddReport no longer writes due_at, so new reports" >&2
  echo "        would have no disposition deadline." >&2
  exit 1
fi
if [ ! -f apps/api-go/migrations/117_moderation_reports_due_at.sql ]; then
  echo "  FAIL [COMP-REPORT-005]: migration 117_moderation_reports_due_at.sql is missing." >&2
  exit 1
fi
if ! grep -qF 'ALTER COLUMN due_at SET NOT NULL' \
     apps/api-go/migrations/117_moderation_reports_due_at.sql; then
  echo "  FAIL [COMP-REPORT-005]: 117 no longer makes due_at NOT NULL, so a report" >&2
  echo "        without a deadline could be written again." >&2
  exit 1
fi
echo "    COMP-REPORT-005: PASS (reports carry a statutory deadline and are actually reachable)"

# COMP-AUTHORITY-001: 有权机关请求的受理留痕与响应时限（§55 + 网安法
# 116/2025 + 333/2026/NĐ-CP）。代码里 REFERRED_TO_AUTHORITY 曾是 087 里
# 一个从未被写入路径使用的枚举值 —— 平台证明不了自己在法定时限内响应过，
# 也证明不了核验过请求的合法性。本条锁死：受理/响应必须 append-only 且可
# 归因；四项核验（主体/权限/范围/合法性）缺一不得受理；请求种类不认识
# → 拿不到时限 → 拒绝写入（不能悄悄按 24h 兜底，那会把 3 小时的生命安全
# 紧急请求拖成 24 小时）；两个写入命令必须 operator-only；PG 仓储与迁移
# 089 必须存在。
require_test "COMP-AUTHORITY-001" "./internal/moderation" \
  "TestAuthorityRequestAcceptedAndAttributed" \
  "apps/api-go/internal/moderation/authority_compliance_test.go" || exit $?
require_test "COMP-AUTHORITY-001" "./internal/moderation" \
  "TestAuthoritySLAMatchesStatutoryDeadlines" \
  "apps/api-go/internal/moderation/authority_compliance_test.go" || exit $?
require_test "COMP-AUTHORITY-001" "./internal/moderation" \
  "TestAuthorityMetDeadlineDistinguishesOnTimeAndLate" \
  "apps/api-go/internal/moderation/authority_compliance_test.go" || exit $?
require_test "COMP-AUTHORITY-001" "./internal/moderation" \
  "TestAuthorityRequestRejectedWhenVerificationIncomplete" \
  "apps/api-go/internal/moderation/authority_compliance_test.go" || exit $?
require_test "COMP-AUTHORITY-001" "./internal/moderation" \
  "TestAuthorityRequestRejectsFutureReceivedAt" \
  "apps/api-go/internal/moderation/authority_compliance_test.go" || exit $?
if ! grep -qF '"RecordAuthorityRequest":  true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [COMP-AUTHORITY-001]: RecordAuthorityRequest is no longer operator-only," >&2
  echo "        so anyone could forge an authority request record." >&2
  exit 1
fi
if ! grep -qF '"RecordAuthorityResponse": true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [COMP-AUTHORITY-001]: RecordAuthorityResponse is no longer operator-only," >&2
  echo "        so anyone could forge an authority response record." >&2
  exit 1
fi
if ! grep -qF 'func (r *ModerationRepository) AddAuthorityRequest' apps/api-go/internal/platform/postgres/moderation.go; then
  echo "  FAIL [COMP-AUTHORITY-001]: the Postgres authority repository is missing," >&2
  echo "        so authority requests would not survive a restart." >&2
  exit 1
fi
if [ ! -f apps/api-go/migrations/089_moderation_authority_requests.sql ]; then
  echo "  FAIL [COMP-AUTHORITY-001]: migration 089_moderation_authority_requests.sql is missing." >&2
  exit 1
fi
echo "    COMP-AUTHORITY-001: PASS (authority requests are attributable, SLA-tracked, and operator-only)"

# STORE-REC-001: 推荐商铺进体系（原始设计：企业/店铺是独立模块，体系增长靠
# 发展 builder + 小美/用户推荐商铺进入体系）。本条锁死：RecommendStore 命令
# 必须被 storeonboarding 服务受理（匿名不可用——推荐人必须是鉴权账号）；记录
# 必须 append-only（无 UPDATE/DELETE 路径）；PG 仓储与迁移 090 必须存在；
# 移动端必须有「推荐商铺进体系」入口（me.tsx 企业/店铺组，独立于账户）。
require_test "STORE-REC-001" "./internal/storeonboarding" \
  "TestRecommendStoreAcceptedAndAttributed" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-001" "./internal/storeonboarding" \
  "TestRecommendStoreRejectedWhenActorMissing" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-001" "./internal/storeonboarding" \
  "TestRecommendStoreAIOriginAccepted" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
if ! grep -qF 'case "RecommendStore"' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-001]: the RecommendStore command is no longer handled" >&2
  echo "        by the storeonboarding service, so it would 501." >&2
  exit 1
fi
if ! grep -qF 'AddRecommendation(ctx context.Context, r StoreRecommendation) error' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-001]: the Repository interface no longer carries" >&2
  echo "        AddRecommendation (append-only write would not compile)." >&2
  exit 1
fi
if ! grep -qF 'func (r *StoreOnboardingRepository) AddRecommendation' apps/api-go/internal/platform/postgres/storeonboarding.go; then
  echo "  FAIL [STORE-REC-001]: the Postgres store-onboarding repository is missing," >&2
  echo "        so recommendations would not survive a restart." >&2
  exit 1
fi
if [ ! -f apps/api-go/migrations/092_store_recommendations.sql ]; then
  echo "  FAIL [STORE-REC-001]: migration 090_store_recommendations.sql is missing." >&2
  exit 1
fi
if ! grep -qF 'label: "推荐商铺进体系"' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [STORE-REC-001]: the recommend-store entry is no longer on the" >&2
  echo "        Me surface (企业/店铺 standalone group)." >&2
  exit 1
fi
echo "    STORE-REC-001: PASS (store recommendations are attributable, append-only, and independently reachable)"

# FEED-REPLY-001: 评论必须显示作者名，而不是把 actorId 当成名字渲染给用户。
# 服务端 ListPostReplies 之前只下发 actorId，feed 直接把它当作者名显示 ——
# 用户看到的是一串账号 ID。名字必须来自 profile（权威）、不接受客户端提供
# （ReplyToPost 里塞什么都不作数）、读时解析（存量评论不用迁移也能改名）；
# 解析不到时保持空串，由客户端降级成中性标签，绝不能退回 ID。
require_test "FEED-REPLY-001" "./internal/engagement" \
  "TestListPostRepliesResolvesActorDisplayNameFromProfile" \
  "apps/api-go/internal/engagement/reply_author_name_test.go" || exit $?
require_test "FEED-REPLY-001" "./internal/engagement" \
  "TestListPostRepliesLeavesUnresolvedActorNameBlank" \
  "apps/api-go/internal/engagement/reply_author_name_test.go" || exit $?
require_test "FEED-REPLY-001" "./internal/engagement" \
  "TestListPostRepliesNamesLegacyRepliesWrittenBeforeWiring" \
  "apps/api-go/internal/engagement/reply_author_name_test.go" || exit $?
require_test "FEED-REPLY-001" "./internal/engagement" \
  "TestListPostRepliesRejectsPoisonedYouDisplayName" \
  "apps/api-go/internal/engagement/reply_author_name_test.go" || exit $?
require_test "FEED-REPLY-001" "./internal/engagement" \
  "TestReplyActorDisplayNameIsNeverClientSupplied" \
  "apps/api-go/internal/engagement/reply_author_name_test.go" || exit $?
if ! grep -qF 'func (s *Service) withReplyActorNames' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [FEED-REPLY-001]: profile-backed reply author resolution is gone," >&2
  echo "        so comments can only render raw account ids." >&2
  exit 1
fi
if ! grep -qF 'engagementService.SetAuthorNameResolver(authorNames)' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [FEED-REPLY-001]: the engagement service is no longer wired to the profile" >&2
  echo "        resolver, so production would keep returning unnamed comments." >&2
  exit 1
fi
# 只匹配到第二个实参为止、不写右括号：Rev276（自己的帖子显示用户名而不是「你」）给这个
# 调用加了第三个实参（本人的资料名，仅在该评论确实属于观察者时才会被采用），原先的整串
# 匹配当场变红 —— 而它位于钉脚本前段，红一次就把它后面所有钉一起挡住。这里断言的不变
# 量是「评论作者标签仍然走观察者相对的解析器、并且带上观察者的账号 id」，多出来的实参
# 不归本钉管。
# 注意：本注释刻意不复述那段调用文本。反向/正向 grep 命中的是文件全文（含注释），一旦
# 注释里出现同样的字符串，删掉真正的调用后这行注释会继续让钉保持绿色。
if ! grep -qF 'resolveReplyAuthorDisplayName(reply, viewerAccountId' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-REPLY-001]: the feed stopped resolving the comment author label." >&2
  exit 1
fi
if grep -qF '{reply.actorId}' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-REPLY-001]: the feed renders the raw account id as the comment author again." >&2
  exit 1
fi
if ! grep -qF 'FEED-REPLY-001' apps/mobile/src/feed-author.test.ts; then
  echo "  FAIL [FEED-REPLY-001]: the comment author label regression ID or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/feed-author.test.ts || exit $?
echo "    FEED-REPLY-001: PASS (comment authors are named from the profile, never by account id)"

# FEED-REPLY-002: 评论不能被全部折叠 —— 默认显示前 5 条，超出才折叠。
# 之前不点「回复 N」就一条评论都看不到（全折叠），点开了又把全部评论一次性
# 铺开。Threads 的做法是首屏固定给几条，剩下的收进「查看全部」。
# SEARCH-CORPUS-003 之后调用点改名（replies → orderedReplies，搜索命中排前），
# 函数和语义没变 —— 钉只认函数 + 展开态，不认局部变量名，否则重构必误报
# （同 HANDLE-LOOKUP-001 那颗 lookupScannedHandle 钉的教训）。
if ! grep -qF 'REPLY_PREVIEW_LIMIT = 5' apps/mobile/src/reply-preview.ts; then
  echo "  FAIL [FEED-REPLY-002]: the comment preview limit is no longer 5," >&2
  echo "        so comments are either fully collapsed or fully expanded again." >&2
  exit 1
fi
if ! grep -qF 'visibleReplies(orderedReplies, repliesExpanded)' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-REPLY-002]: the feed no longer renders the comment preview," >&2
  echo "        so comments collapse entirely until the reader taps through." >&2
  exit 1
fi
if ! grep -qF 'hydrateReplyPreviews(item.postId)' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-REPLY-002]: comments are not hydrated with the post list," >&2
  echo "        so the feed would only ever show a reply count." >&2
  exit 1
fi
if ! grep -qF 'FEED-REPLY-002' apps/mobile/src/reply-preview.test.ts; then
  echo "  FAIL [FEED-REPLY-002]: the comment preview regression ID or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/reply-preview.test.ts || exit $?
echo "    FEED-REPLY-002: PASS (5 comments show inline, only the overflow collapses)"

# PROFILE-TABS-001: 收藏是私库，不是他人主页的一栏。
# 之前 ProfileTabs 无条件渲染 IG/Threads 那 5 个 tab，SAVED 也在里面 —— 别人的
# 主页上摆一个「收藏」tab，等于把他的私人书签当成公开内容展示（就算当时数据是
# 空的，接口也随时可能接上）。同时 other-profile.tsx 把 REPLIES 硬编码成 []，
# 5 个 tab 里有 3 个永远是空态。本条锁死：SAVED 只在 viewerMode === "SELF" 时
# 出现（身份未知 = 不给，fail-closed），他人主页的 REPLIES 必须拉真数据。
if ! grep -qF 'function visibleProfileTabs' apps/mobile/src/surfaces/profile-tabs-model.ts; then
  echo "  FAIL [PROFILE-TABS-001]: the profile tab visibility rule is gone," >&2
  echo "        so SAVED can render on somebody else's profile again." >&2
  exit 1
fi
if ! grep -qF 'visibleProfileTabs(props.viewerMode)' apps/mobile/src/surfaces/ProfileTabs.tsx; then
  echo "  FAIL [PROFILE-TABS-001]: ProfileTabs renders a hardcoded tab list again," >&2
  echo "        so the private SAVED tab is no longer gated on the viewer." >&2
  exit 1
fi
if ! grep -qF 'viewerMode=' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-TABS-001]: the own profile no longer declares viewerMode," >&2
  echo "        so the fail-closed rule would hide the owner's own SAVED tab." >&2
  exit 1
fi
if ! grep -qF 'engagement.listUserReplies(target.userId' apps/mobile/src/surfaces/other-profile.tsx; then
  echo "  FAIL [PROFILE-TABS-001]: the other-profile REPLIES tab no longer fetches real" >&2
  echo "        replies, so it is back to being permanently empty." >&2
  exit 1
fi
# REPLY-TARGET-001 之后回复不再伪装成 FeedPost，prop 也从 replyPosts 换成了
# replies —— pin 跟着改成「拉回来的回复真的接到了 tabs 上」，语义不变。
if ! grep -qF 'replies={replyEntries}' apps/mobile/src/surfaces/other-profile.tsx; then
  echo "  FAIL [PROFILE-TABS-001]: the fetched replies are no longer wired into the" >&2
  echo "        other-profile tabs." >&2
  exit 1
fi
if grep -qF 'replies={[]}' apps/mobile/src/surfaces/other-profile.tsx; then
  echo "  FAIL [PROFILE-TABS-001]: the other-profile REPLIES tab is hardcoded empty again." >&2
  exit 1
fi
if ! grep -qF 'PROFILE-TABS-001' apps/mobile/src/surfaces/profile-tabs-model.test.ts; then
  echo "  FAIL [PROFILE-TABS-001]: the profile tab regression ID or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/profile-tabs-model.test.ts || exit $?
echo "    PROFILE-TABS-001: PASS (SAVED stays private; other profiles show real replies)"

# PROFILE-SAVED-001: 收藏夹只存 postId，必须能按 ID 直取。
# 之前客户端把动态流（默认一页 25 条）按 bookmark id 过滤 —— 收藏一条不在这一页
# 里的帖子就等于丢了，用户会以为收藏被吞。本条锁死：服务端提供 ListPostsByIds，
# 可见性口径与动态流一致且 fail-closed（FOLLOWERS 只有作者本人可见，不能因为
# 「谁收藏了」就漏出来），取不到的 ID 跳过而不是整条失败；客户端收藏走这条直取，
# 不再从 feed 里捞。
require_test "PROFILE-SAVED-001" "./internal/localnet" \
  "TestListPostsByIdsReturnsRequestedPostsInOrder" \
  "apps/api-go/internal/localnet/posts_by_ids_test.go" || exit $?
require_test "PROFILE-SAVED-001" "./internal/localnet" \
  "TestListPostsByIdsSkipsUnknownIDsInsteadOfFailing" \
  "apps/api-go/internal/localnet/posts_by_ids_test.go" || exit $?
require_test "PROFILE-SAVED-001" "./internal/localnet" \
  "TestListPostsByIdsDeduplicatesAndTrimsIDs" \
  "apps/api-go/internal/localnet/posts_by_ids_test.go" || exit $?
require_test "PROFILE-SAVED-001" "./internal/localnet" \
  "TestListPostsByIdsKeepsVisibilityFailClosed" \
  "apps/api-go/internal/localnet/posts_by_ids_test.go" || exit $?
require_test "PROFILE-SAVED-001" "./internal/localnet" \
  "TestListPostsByIdsReturnsEmptyArrayNotNull" \
  "apps/api-go/internal/localnet/posts_by_ids_test.go" || exit $?
require_test "PROFILE-SAVED-001" "./internal/localnet" \
  "TestListPostsByIdsCapsTheBatch" \
  "apps/api-go/internal/localnet/posts_by_ids_test.go" || exit $?
if ! grep -qF 'func (s *Service) listPostsByIds' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [PROFILE-SAVED-001]: the by-id post reader is gone," >&2
  echo "        so saved posts can only be scraped from one feed page again." >&2
  exit 1
fi
if ! grep -qF 'func (s *Service) hydratePostMedia' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [PROFILE-SAVED-001]: feed and by-id reads no longer share one media" >&2
  echo "        contract, so the same post renders differently in each surface." >&2
  exit 1
fi
if ! grep -qF 'ListPostsByIds' apps/api-go/openapi.commands.generated.yaml; then
  echo "  FAIL [PROFILE-SAVED-001]: ListPostsByIds is missing from the generated" >&2
  echo "        command registry (run go run ./cmd/openapi-commands)." >&2
  exit 1
fi
if ! grep -qF 'localNet.listPostsByIds(b.bookmarks)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-SAVED-001]: the saved tab no longer fetches bookmarks by id." >&2
  exit 1
fi
if grep -qF 'bookmarkedSet' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-SAVED-001]: the saved tab filters one feed page by bookmark id" >&2
  echo "        again, so bookmarks outside that page silently disappear." >&2
  exit 1
fi
if ! grep -qF 'PROFILE-SAVED-001' apps/mobile/src/localnet-client.test.ts; then
  echo "  FAIL [PROFILE-SAVED-001]: the saved-posts regression ID or its test is missing" >&2
  exit 1
fi
# 信封必须真的能被服务端 dispatch。validateEnvelope 在 dispatch **之前**就要求
# target.id 非空，空串会被拒成 INVALID_COMMAND_ENVELOPE —— 收藏 tab 每次加载都
# 抛错，而且因为拒绝早于 dispatch，日志里和「命令不存在」长得一模一样。
# 批量读没有单一聚合，必须用显式哨兵 by_ids，不能图省事发空串。
if ! grep -qF '{ type: "Post", id: "by_ids" }' apps/mobile/src/localnet-client.ts; then
  echo "  FAIL [PROFILE-SAVED-001]: the batch reader no longer sends the by_ids" >&2
  echo "        sentinel, so its envelope may be rejected before dispatch." >&2
  exit 1
fi
if grep -qF '{ type: "Post", id: "" }' apps/mobile/src/localnet-client.ts; then
  echo "  FAIL [PROFILE-SAVED-001]: an empty target id is back in a command" >&2
  echo "        envelope. The server rejects that before dispatch with" >&2
  echo "        INVALID_COMMAND_ENVELOPE, so the saved tab always throws." >&2
  exit 1
fi
# 拒绝信息必须指名出错的字段，否则「信封不合法」和「命令不存在」无法区分。
if ! grep -qF 'func missingEnvelopeField' apps/api-go/internal/api/command_dispatch.go; then
  echo "  FAIL [PROFILE-SAVED-001]: envelope rejections no longer name the" >&2
  echo "        offending field, so a bad envelope is indistinguishable from an" >&2
  echo "        unknown command in the logs." >&2
  exit 1
fi
require_test "PROFILE-SAVED-001" "./internal/api" \
  "TestMissingEnvelopeFieldNamesTheEmptyTargetID" \
  "apps/api-go/internal/api/envelope_field_test.go" || exit $?
require_test "PROFILE-SAVED-001" "./internal/api" \
  "TestValidateEnvelopeStillRejectsBlankTargetID" \
  "apps/api-go/internal/api/envelope_field_test.go" || exit $?
pnpm --filter @proxy/mobile exec vitest run src/localnet-client.test.ts || exit $?
echo "    PROFILE-SAVED-001: PASS (saved posts are read by id, with the feed's visibility rules)"

# MENTION-001: 个人主页 TAGGED tab 必须是「完整的、口径正确的提及列表」。
# 之前它有三个毛病叠在一起：
#   1. 客户端拿**一页**动态（默认 25 条）做 strings.Contains —— 更早的提及直接
#      消失，用户被提到 50 次也只看到 2 次；
#   2. 子串匹配 —— "@thanh2" 被算成提到了 "@thanh"，看到与自己无关的帖子；
#   3. `contextType === "MENTION"` 那一支是死代码：服务端任何地方都没有写过
#      MENTION 这种 contextRef（分类器只产出 DEMAND/VENUE/ACTIVITY/...），
#      所以那个条件永远为假，却被当成「另一条能用的路径」。
# 现在由服务端扫全量已发布帖子，可见性/静音口径与动态流完全一致。
require_test "MENTION-001" "./internal/localnet" \
  "TestContainsMentionHandleRequiresAWholeHandle" \
  "apps/api-go/internal/localnet/posts_mentioning_test.go" || exit $?
require_test "MENTION-001" "./internal/localnet" \
  "TestListPostsMentioningFindsMentionsBeyondTheFirstFeedPage" \
  "apps/api-go/internal/localnet/posts_mentioning_test.go" || exit $?
require_test "MENTION-001" "./internal/localnet" \
  "TestListPostsMentioningKeepsVisibilityFailClosed" \
  "apps/api-go/internal/localnet/posts_mentioning_test.go" || exit $?
require_test "MENTION-001" "./internal/localnet" \
  "TestListPostsMentioningWithoutAHandleReturnsEmptyNotNull" \
  "apps/api-go/internal/localnet/posts_mentioning_test.go" || exit $?
require_test "MENTION-001" "./internal/localnet" \
  "TestListPostsMentioningExcludesMyOwnPosts" \
  "apps/api-go/internal/localnet/posts_mentioning_test.go" || exit $?
require_test "MENTION-001" "./internal/localnet" \
  "TestMentionRegexEscapesRegexMetacharacters" \
  "apps/api-go/internal/localnet/posts_mentioning_test.go" || exit $?
if ! grep -qF 'func (s *Service) listPostsMentioning' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [MENTION-001]: the mention reader is gone, so TAGGED can only be" >&2
  echo "        scraped from one feed page again." >&2
  exit 1
fi
# 提及匹配必须是「整 handle」，不是子串。SQL 与 Go 两条路径共用 MentionRegex。
if ! grep -qF 'func MentionRegex' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [MENTION-001]: there is no single definition of what counts as a" >&2
  echo "        mention, so the SQL and Go paths can silently disagree." >&2
  exit 1
fi
if ! grep -qF 'func (r *LocalNetRepository) ListPostsMentioning' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [MENTION-001]: the store can no longer answer 'who mentioned me'," >&2
  echo "        so TAGGED is back to scanning a single page." >&2
  exit 1
fi
if ! grep -qF 'ListPostsMentioning' apps/api-go/openapi.commands.generated.yaml; then
  echo "  FAIL [MENTION-001]: ListPostsMentioning is missing from the generated" >&2
  echo "        command registry (run go run ./cmd/openapi-commands)." >&2
  exit 1
fi
if ! grep -qF 'localNet.listPostsMentioning(profileDraft.handle)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [MENTION-001]: the tagged tab no longer asks the server for mentions." >&2
  exit 1
fi
if grep -qF 'p.body.includes(myHandle)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [MENTION-001]: the tagged tab is substring-matching a single feed" >&2
  echo "        page again, so older mentions vanish and '@thanh2' counts as '@thanh'." >&2
  exit 1
fi
if grep -qF 'ref.contextType === "MENTION"' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [MENTION-001]: the dead MENTION contextRef branch is back. No writer" >&2
  echo "        has ever produced that ref, so the condition is always false." >&2
  exit 1
fi
if ! grep -qF 'MENTION-001' apps/mobile/src/localnet-client.test.ts; then
  echo "  FAIL [MENTION-001]: the mention regression ID or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/localnet-client.test.ts || exit $?
echo "    MENTION-001: PASS (mentions are complete, whole-handle, and visibility-safe)"

# REPLY-TARGET-001: 个人主页 REPLIES tab 必须能回答「我回复了谁的帖子」。
# 之前这一栏有三个毛病叠在一起：
#   1. 服务端一直在发 parentPostId（就是这条回复挂在哪条帖子下面），但客户端
#      从来没读它 —— 于是这一栏唯一有用的信息被丢掉，只剩一句光秃秃的
#      「你回复了」；而且旁边那行注释还断言「server 没有 parentPostId 字段」，
#      让这个降级看起来是永久性的（实测服务端每条 reply 都带这个字段）；
#   2. 「你回复了」是写死的 —— 看**别人**的主页时，别人的回复也在说「你回复了」；
#   3. React key 用了 reply.postId。同一条帖子可以被同一个人回复多次（真实数据
#      里就是这样：两行 postId 相同、replyId 不同），两行于是撞成同一个 key。
# 现在父帖用 PROFILE-SAVED-001 的 ListPostsByIds 回查（同一条可见性口径，取不
# 回来的帖子退化成中性文案），名字走 feed-author 的 resolveAuthorDisplayName，
# key 改用 replyId。
if ! grep -qF 'export function replyEntriesFromReplies' apps/mobile/src/reply-target.ts; then
  echo "  FAIL [REPLY-TARGET-001]: there is no reply-entry builder, so replies are" >&2
  echo "        reshaped into fake FeedPosts again (losing replyId)." >&2
  exit 1
fi
if ! grep -qF 'export function parentPostIdsForReplies' apps/mobile/src/reply-target.ts; then
  echo "  FAIL [REPLY-TARGET-001]: the parent-post id collector is gone, so nothing" >&2
  echo "        resolves which post a reply answered." >&2
  exit 1
fi
if ! grep -qF 'export function replyTargetsFromPosts' apps/mobile/src/reply-target.ts; then
  echo "  FAIL [REPLY-TARGET-001]: resolved parent posts are no longer turned into" >&2
  echo "        reply targets." >&2
  exit 1
fi
if ! grep -qF 'export function replyTargetLabel' apps/mobile/src/reply-target.ts; then
  echo "  FAIL [REPLY-TARGET-001]: there is no single definition of the reply-target" >&2
  echo "        label, so SELF and OTHER can drift apart again." >&2
  exit 1
fi
if ! grep -qF 'localNet.listPostsByIds(parentIds)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: my-profile replies no longer resolve the post they" >&2
  echo "        answered, so the tab degrades back to a bare label." >&2
  exit 1
fi
if ! grep -qF 'replyEntriesFromReplies(r.replies)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: my-profile replies are no longer built from the" >&2
  echo "        server rows (replyId/parentPostId)." >&2
  exit 1
fi
if ! grep -qF 'localNet.listPostsByIds(parentIds)' apps/mobile/src/surfaces/other-profile.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: other-profile replies no longer resolve their" >&2
  echo "        parent post." >&2
  exit 1
fi
# 同一条帖子可以被回复多次 —— key 必须是 replyId，不是父帖 id。
if ! grep -qF 'key={reply.replyId}' apps/mobile/src/surfaces/ProfileTabs.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: the replies list is not keyed by replyId, so two" >&2
  echo "        replies to the same post collide." >&2
  exit 1
fi
# 同 FEED-REPLY-001：Rev276 也给这个调用加了第四个实参（观察者本人的资料名，供
# resolveAuthorDisplayName 的 isOwnAuthorId 分支使用），整串匹配于是过期。收窄到
# 「仍然调用同一个共享标签、并带上观察者的账号 id」为止 —— 这正是本钉要守的东西
# （tab 不许自己拼标签、从而和 feed 对「谁是谁」的说法不一致）。注释同样不复述
# 那段调用文本，否则删掉真正的调用后这行注释会让钉继续变绿。
if ! grep -qF 'replyTargetLabel(props.viewerMode, target, props.viewerAccountId' apps/mobile/src/surfaces/ProfileTabs.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: the replies tab no longer uses the shared label," >&2
  echo "        so it can disagree with the feed about who someone is." >&2
  exit 1
fi
# 反向 pin：下面这几个写法就是当初那三个 bug，任何一个回来都要拦住。
if grep -qF 'key={reply.postId}' apps/mobile/src/surfaces/ProfileTabs.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: replies are keyed by parent post id again — two" >&2
  echo "        replies to one post then share a key." >&2
  exit 1
fi
if grep -qF 'styles.replyTarget}>你回复了<' apps/mobile/src/surfaces/ProfileTabs.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: the hardcoded label is back, so other people's" >&2
  echo "        replies are attributed to the viewer." >&2
  exit 1
fi
if grep -qF 'authorId: target.userId' apps/mobile/src/surfaces/other-profile.tsx; then
  echo "  FAIL [REPLY-TARGET-001]: replies are authored by the profile owner again —" >&2
  echo "        that is what made the old '回复 @{authorId} 的帖子' show yourself." >&2
  exit 1
fi
if ! grep -qF 'REPLY-TARGET-001' apps/mobile/src/reply-target.test.ts; then
  echo "  FAIL [REPLY-TARGET-001]: the reply-target regression ID or its test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/reply-target.test.ts || exit $?
echo "    REPLY-TARGET-001: PASS (replies name the post they answered, keyed by replyId)"

# SEARCH-CORPUS-001: 动态搜索必须真的搜到「整个 feed」，而不是你已经滚过的那几页。
#
# 坏掉的形态很隐蔽 —— 每一块单看都像是对的：
#   1. server 端 R15.94 建好了 search 通道（feed_handlers 读 ?search=，
#      listFeed 按关键词过滤），但 listFeedPosts 的 searchQuery 参数**全仓无人传**，
#      于是这条通道没有任何 caller，搜索退化成「在已加载的那一页里做本地子串匹配」；
#   2. localnet-client 里还留着 R15.94 之前写的注释「server ListFeedPosts 暂不接
#      search params, Phase 2 …」，让人以为这条通道本来就不通，于是没人去接线；
#   3. server 只匹配 Body，客户端两处 filter 却都 OR 了 authorDisplayName ——
#      server 先把正文不含关键词的帖子全丢掉，客户端再 OR 也永远匹配不到东西。
#      表现就是：搜索框写着「搜索人、机会、活动、情报…」，搜人恒返回 0 条。
# 现在两端共用同一份字段语义（正文 / 作者展示名 / 城市；派生 contextRefs 不算），
# 且两条读取分支都把查询交给服务端。
require_test "SEARCH-CORPUS-001" "./internal/localnet" \
  "TestListFeedPosts_SearchMatchesAuthorNameAndCity" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "SEARCH-CORPUS-001" "./internal/localnet" \
  "TestPostMatchesSearch_ExcludesDerivedContextRefs" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
if ! grep -qF 'func postMatchesSearch(p Post, loweredQuery string, replyHit bool) bool {' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-001]: the single search predicate is gone from the server," >&2
  echo "        so the matched field set can drift again." >&2
  exit 1
fi
if ! grep -qF 'if p.AuthorDisplayName != "" && strings.Contains(strings.ToLower(p.AuthorDisplayName), loweredQuery) {' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-001]: server search no longer matches the author display" >&2
  echo "        name, so searching for a person returns nothing." >&2
  exit 1
fi
if ! grep -qF 'if p.CityScope != "" && strings.Contains(strings.ToLower(p.CityScope), loweredQuery) {' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-001]: server search no longer matches the city scope." >&2
  exit 1
fi
if ! grep -qF 'if !postMatchesSearch(p, search, replyHits[p.ID]) {' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-001]: listFeed no longer routes through postMatchesSearch." >&2
  exit 1
fi
if ! grep -qF 'export function normalizeFeedSearchQuery(' apps/mobile/src/feed-search.ts; then
  echo "  FAIL [SEARCH-CORPUS-001]: the shared query normaliser is gone, so the client" >&2
  echo "        and the server can disagree about what a query even is." >&2
  exit 1
fi
if ! grep -qF 'export function postMatchesFeedSearch(' apps/mobile/src/feed-search.ts; then
  echo "  FAIL [SEARCH-CORPUS-001]: the shared client-side predicate is gone." >&2
  exit 1
fi
if ! grep -qF 'query.push(`search=${encodeURIComponent(search)}`);' apps/mobile/src/localnet-client.ts; then
  echo "  FAIL [SEARCH-CORPUS-001]: the public feed projection no longer forwards the" >&2
  echo "        query, so search degrades back to 'only what you already scrolled'." >&2
  exit 1
fi
if ! grep -qF 'search === "" ? { cursor, limit } : { cursor, limit, search },' apps/mobile/src/localnet-client.ts; then
  echo "  FAIL [SEARCH-CORPUS-001]: the authenticated feed branch no longer sends the" >&2
  echo "        query, so logged-in search only filters one page locally." >&2
  exit 1
fi
if ! grep -qF 'const read = await localNet.listFeedPosts(undefined, searching ? 50 : 25, searching ? search : undefined' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: the feed surface stopped passing its query to the" >&2
  echo "        server — this is the exact dead-parameter bug that was fixed." >&2
  exit 1
fi
# FEED-FRESH-001 在后面多带了一个 fresh 穿透参数（发布后重载清 HTTP 缓存），
# query 照传不误 —— 上面不断言右括号和分号，免得加参就红。要钉的是传 query 本身。
if ! grep -qF 'const timer = setTimeout(() => void loadFeed(query), query === "" ? 0 : 250);' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: nothing re-runs the feed load when the query changes," >&2
  echo "        so the search box only filters whatever is already loaded." >&2
  exit 1
fi
# SEARCH-CORPUS-003 把评论接进了搜索，这一条必须**反过来**钉：
# 客户端一次只拉到前 20 条评论，服务端看的是全部，所以搜索态下本地再跑一遍
# 谓词只会比服务端更窄 —— 靠第 21 条评论命中的帖子会被客户端丢掉，正是
# SEARCH-CORPUS-001 修的那个病换了个地方复发。搜索结果由服务端单独判定。
if grep -qF 'if (!postMatchesFeedSearch(post, normalizeFeedSearchQuery(searchQuery))) return false;' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: the feed surface re-filters locally again while" >&2
  echo "        searching. The client only holds the first 20 replies while the server" >&2
  echo "        sees all of them, so a local pass is strictly narrower and silently" >&2
  echo "        drops posts the server matched through reply #21." >&2
  exit 1
fi
if ! grep -qF '// SEARCH-CORPUS-003: 搜索结果**由服务端判定**，本地不再重跑谓词。' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-003]: the comment explaining why the feed must NOT" >&2
  echo "        re-filter locally is gone, so the next person will put it back." >&2
  exit 1
fi
# 两处都要有：backgroundRefresh 的「新动态」合并 + showLatest 的刷入。
# 注释锚点说清意图，计数保证行为行真的还在两处（单看一处会漏掉另一处）。
if ! grep -qF '// SEARCH-CORPUS-001: 搜索中不做「N 条新动态」合并' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: the background 'new posts' merge is no longer" >&2
  echo "        suppressed while searching, so unfiltered posts leak into results." >&2
  exit 1
fi
if ! grep -qF '// SEARCH-CORPUS-001: 搜索中不存在「展示最新」' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: 'show latest' can be pressed mid-search again, which" >&2
  echo "        silently replaces the results with the unfiltered feed." >&2
  exit 1
fi
search_guards=$(grep -cF 'if (lastSearchRef.current !== "") return;' apps/mobile/src/surfaces/feed.tsx)
if [ "${search_guards:-0}" -lt 2 ]; then
  echo "  FAIL [SEARCH-CORPUS-001]: expected the search guard in BOTH the background" >&2
  echo "        refresh and 'show latest' paths, found ${search_guards:-0}." >&2
  exit 1
fi
# 反向 pin：下面这些就是当初那几个 bug，任何一个回来都要拦住。
if grep -qF 'if search != "" && !strings.Contains(strings.ToLower(p.Body), search) {' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-001]: server search is body-only again — searching for a" >&2
  echo "        person or a city then returns nothing." >&2
  exit 1
fi
if grep -qF 'server ListFeedPosts 暂不接 search params' apps/mobile/src/localnet-client.ts; then
  echo "  FAIL [SEARCH-CORPUS-001]: the stale comment claiming the server takes no" >&2
  echo "        search params is back — it is what made the channel look unwired." >&2
  exit 1
fi
if grep -qF 'p.authorDisplayName?.toLowerCase().includes(q)' apps/mobile/src/localnet-client.ts; then
  echo "  FAIL [SEARCH-CORPUS-001]: the client-side re-filter is back; it is strictly" >&2
  echo "        narrower than the server and can only drop rows the server accepted." >&2
  exit 1
fi
if grep -qF 'post.cityScope, ...post.contextRefs.map' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: the feed is searching its own ad-hoc haystack again," >&2
  echo "        including derived contextRefs the user never typed." >&2
  exit 1
fi
if ! grep -qF 'SEARCH-CORPUS-001' apps/mobile/src/feed-search.test.ts; then
  echo "  FAIL [SEARCH-CORPUS-001]: the regression ID or its mobile test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/feed-search.test.ts || exit $?
echo "    SEARCH-CORPUS-001: PASS (feed search reaches the server and matches name/city)"

# SEARCH-CORPUS-002：每个模块**有什么数据域就搜什么**。
#
# 个人主页这一屏的数据域是「我的动态」（正文 / 作者展示名 / 城市）+「我的回复」。
# 以前 `runProfileSearch` 只滤 `post.body` —— 同一份数据在**动态流**里能按作者名和
# 城市搜到（SEARCH-CORPUS-001），到主页这一屏却搜不到，等于一份数据两套口径；
# 回复更是完全搜不到。现在复用 feed-search 那份**共享字段语义**，不另写一份。
#
# 注意别钉裸符号：`personalReplyEntries` 在 state 声明里就出现了，只 grep 它
# 在删掉搜索链路后照样绿（和 buildContactCard 被 import 行满足是同一个坑）。
# 所以钉的是**搜索接线**上的形状。
# SEARCH-CORPUS-002 订正（2026-09-22）：原来钉的是 `filterPostsByFeedSearch(profilePosts, q)`
# —— 把**变量名**也钉进去了，自己违反了上面「别钉裸符号」那条。在制的个人主页把
# 搜索域收窄成「排除 TARGETED 的帖文」（searchablePosts），共享谓词没换、语义没坏，
# 但字面量对不上就红了。改成钉**调用形状**（共享谓词 + 查询变量 q），不钉数据源叫什么：
# 契约是「用同一份共享字段语义」，不是「变量必须叫 profilePosts」。
if ! grep -qE 'filterPostsByFeedSearch\([A-Za-z_$][A-Za-z0-9_$]*, q\)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [SEARCH-CORPUS-002]: the profile search re-implements its own haystack" >&2
  echo "        instead of using the shared SEARCH-CORPUS-001 predicate, so the same" >&2
  echo "        data is searchable in the feed but not on the profile." >&2
  exit 1
fi
if ! grep -qF 'function replyMatchesProfileSearch(' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'replyMatchesProfileSearch(reply, q)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [SEARCH-CORPUS-002]: profile search no longer covers replies, which are" >&2
  echo "        part of this screen's data domain." >&2
  exit 1
fi
# 命中项有两种东西，不许把回复显示成帖子 —— 用户点进去会发现「这上面没我搜的那句话」。
if ! grep -qF 'hit.kind === "reply" ? "我的回复" : "动态"' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [SEARCH-CORPUS-002]: search hits no longer say whether they are a post" >&2
  echo "        or a reply, so a reply can be presented as a post." >&2
  exit 1
fi
# 反向 pin：当初那个「只搜正文」的实现不许回来。
if grep -qF 'profilePosts.filter((post) => post.body.toLowerCase().includes(q))' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [SEARCH-CORPUS-002]: profile search is body-only again — author name," >&2
  echo "        city and replies are all part of this screen's data domain." >&2
  exit 1
fi
echo "    SEARCH-CORPUS-002: PASS (profile search covers posts by body/author/city + replies)"

# SEARCH-CORPUS-003：**动态流**这一屏的搜索也要覆盖评论。
#
# 同一个原则（每个模块有什么数据域就搜什么）在动态流上的那一半。评论就显示在
# 动态卡片里，是这一屏数据域的一部分 —— 只看正文 / 作者名 / 城市，等于
# 「评论里明明有这个词，搜索却说没有」。
#
# 难点（也是这次真正容易做假的地方）：**评论根本不在 Post 上**。它存在
# engagement 里（engagement.replies），localnet 的 Repository 一条评论都没有。
# 所以要么服务端真的能读到评论，要么客户端加了也是白加 —— 服务端先把帖子丢掉，
# 客户端再怎么 OR 评论都永远匹配不到东西，正是 SEARCH-CORPUS-001 那个病。
#
# 所以钉的是「评论语料真的接进了服务端的判定」：
#   - engagement 侧给出判定（只有它持有评论）
#   - localnet 侧真的去问，并把结果喂给唯一谓词
#   - NewServer 真的把两边接起来（接在 NewServerWithRuntime 里，所有构造路径都过）
# 客户端这一侧则反过来：不能再本地重跑谓词，因为它只看得到前 20 条评论。
require_test "SEARCH-CORPUS-003" "./internal/localnet" \
  "TestListFeedPosts_SearchMatchesReplyBodies" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "SEARCH-CORPUS-003" "./internal/localnet" \
  "TestPostMatchesSearch_MatchesReplyHit" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "SEARCH-CORPUS-003" "./internal/engagement" \
  "TestListPostIDsWithMatchingReplyIsLiteralSubstring" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
# 判定必须长在持有评论的那一侧。放进 localnet.Repository 会逼着每个实现去编一份
# 自己没有的评论数据 —— 结果就是「接口上有、实际恒空」的静默降级。
if ! grep -qF 'ListPostIDsWithMatchingReply(ctx context.Context, postIDs []string, loweredQuery string) (map[string]bool, error)' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [SEARCH-CORPUS-003]: the reply-corpus predicate is gone from engagement." >&2
  echo "        It is the only side that actually holds replies, so feed search would" >&2
  echo "        silently stop matching comments." >&2
  exit 1
fi
if ! grep -qF 'func (s *Service) ListPostIDsWithMatchingReply(ctx context.Context, postIDs []string, loweredQuery string) (map[string]bool, error) {' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [SEARCH-CORPUS-003]: engagement no longer exposes the reply corpus to" >&2
  echo "        other services, so localnet cannot ask it anything." >&2
  exit 1
fi
# PG 分支：strpos 而不是 LIKE —— 查询串是字面子串（PROFILE-SEARCH-001 的教训）。
if ! grep -qF 'SELECT DISTINCT post_id FROM engagement.replies' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [SEARCH-CORPUS-003]: the PostgreSQL reply search is gone, so production" >&2
  echo "        feed search never matches a comment (memory-only feature)." >&2
  exit 1
fi
# localnet 侧：真的去问，而不是把端口供起来。
if ! grep -qF 's.replySearch.ListPostIDsWithMatchingReply(ctx, candidates, search)' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-003]: listFeed no longer asks for reply hits, so the" >&2
  echo "        reply corpus is wired but unread — the dead-channel bug again." >&2
  exit 1
fi
if ! grep -qF 'if replyHit {' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-003]: the single search predicate no longer takes the" >&2
  echo "        reply hit into account, so comments are searched nowhere." >&2
  exit 1
fi
# 接线：接在 NewServerWithRuntime 里，所有 NewServer* 变体和测试都从这一个函数过，
# 不存在「某条路径忘了接线」的分支。
if ! grep -qF 'localNetService.SetReplySearch(engagementService)' apps/api-go/internal/api/server.go; then
  echo "  FAIL [SEARCH-CORPUS-003]: nothing wires the reply corpus into the localnet" >&2
  echo "        service, so feed search degrades back to body/author/city only —" >&2
  echo "        silently, because the port is optional." >&2
  exit 1
fi
# 客户端：命中的评论要排到前面，否则「这条为什么在结果里」没有答案。
if ! grep -qF 'repliesMatchingFirst(replies,' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-003]: search results no longer surface the matching" >&2
  echo "        comment first, so a post matched by reply #17 looks like a wrong result." >&2
  exit 1
fi
# 反向 pin：评论不参与的旧谓词不许回来。
if grep -qF 'func postMatchesSearch(p Post, loweredQuery string) bool {' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [SEARCH-CORPUS-003]: postMatchesSearch lost its reply-hit argument, so" >&2
  echo "        feed search is body/author/city only again." >&2
  exit 1
fi
if ! grep -qF 'SEARCH-CORPUS-003' apps/mobile/src/reply-preview.test.ts; then
  echo "  FAIL [SEARCH-CORPUS-003]: the regression ID or its mobile test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/reply-preview.test.ts || exit $?
echo "    SEARCH-CORPUS-003: PASS (feed search reaches the reply corpus on the server)"

# MUTE-REVERSIBLE-001: 屏蔽必须是「能进也能出」的。
#
# 坏掉的形态：服务端只有 AddMutedAuthor / IsMuted —— 没有 UnmuteAuthor，也没有
# ListMutedAuthors。MuteAuthor 一发出去，被屏蔽者的帖子被 feed 永久过滤（PG 侧是
# NOT EXISTS 子查询），于是你**再也点不到** Ta 的帖子菜单或头像，也就没有任何入口
# 能撤销这次屏蔽。客户端那句「不可逆：当前 client 不提供 unmute；Phase 2 在 '我屏蔽
# 的人' 列表里做」把「服务端缺命令」说成了「产品分期」，进一步掩盖了它。一个只能
# 进不能出的关系操作不是功能，是陷阱。
#
# 还有第二个同样致命的点：列出屏蔽的人时必须给出**可展示的名字**。屏蔽列表恰恰是
# 「帖子全被 feed 过滤掉」的一群人，客户端没法像 feed 那样从帖子读模型里借名字，
# 它手里只有一个 authorId。服务端不回填名字，用户就只能对着一串账号 id 猜该解除
# 谁 —— 那这个解除入口等于还是没做。
require_test "MUTE-REVERSIBLE-001" "./internal/engagement" \
  "TestUnmuteAuthorMakesMuteReversible" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
require_test "MUTE-REVERSIBLE-001" "./internal/engagement" \
  "TestUnmuteAuthorIdempotent" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
require_test "MUTE-REVERSIBLE-001" "./internal/engagement" \
  "TestListMutedAuthorsIsScopedToActor" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
require_test "MUTE-REVERSIBLE-001" "./internal/engagement" \
  "TestListMutedAuthorsResolvesAuthorDisplayName" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
require_test "MUTE-REVERSIBLE-001" "./internal/engagement" \
  "TestListMutedAuthorsIgnoresPoisonedName" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
# 命令必须真的挂在 dispatch 上（openapi 注册表是自动生成的，漏挂载会在 CI 报警）。
if ! grep -qF '  - command: UnmuteAuthor' apps/api-go/openapi.commands.generated.yaml; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: UnmuteAuthor is not a dispatched command anymore," >&2
  echo "        so mute is one-way again." >&2
  exit 1
fi
if ! grep -qF '  - command: ListMutedAuthors' apps/api-go/openapi.commands.generated.yaml; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: ListMutedAuthors is not a dispatched command" >&2
  echo "        anymore, so there is no way to enumerate who you muted." >&2
  exit 1
fi
if ! grep -qF '"UnmuteAuthor", "ListMutedAuthors",' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: engagement.Supports() no longer advertises both" >&2
  echo "        commands, so they are rejected before reaching the handlers." >&2
  exit 1
fi
if ! grep -qF 'func (s *Service) unmuteAuthor(ctx context.Context, e command.Envelope) command.Result {' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the UnmuteAuthor handler is gone." >&2
  exit 1
fi
if ! grep -qF 'func (s *Service) listMutedAuthors(ctx context.Context, e command.Envelope) command.Result {' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the ListMutedAuthors handler is gone." >&2
  exit 1
fi
if ! grep -qF 'INVALID_UNMUTE_PAYLOAD' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: unmute no longer validates a missing authorId, so" >&2
  echo "        a blank payload can silently 'succeed' without unmuting anyone." >&2
  exit 1
fi
# 名字必须读时用**同一个** profile 解析器填（跟评论同一条链），不能另起一套。
if ! grep -qF 'func (s *Service) withMutedAuthorNames(ctx context.Context, rows []MutedAuthorView) []MutedAuthorView {' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the muted-author list no longer resolves display" >&2
  echo "        names at read time, so the UI can only show raw account ids." >&2
  exit 1
fi
# 分成两半钉：gofmt 会在字段名与 tag 之间塞对齐空格，钉整行会白白变红。
if ! grep -qF 'AuthorDisplayName string' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: MutedAuthorView lost its display-name field." >&2
  exit 1
fi
if ! grep -qF 'json:"authorDisplayName,omitempty"' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the muted list no longer publishes a display name" >&2
  echo "        on the wire, so the UI can only show raw account ids." >&2
  exit 1
fi
# 生产路径是 Postgres，不是内存仓 —— 内存仓绿了不代表用户能解除屏蔽。
if ! grep -qF 'func (r *EngagementRepository) RemoveMutedAuthor(ctx context.Context, actorID, authorID string) (bool, error) {' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the Postgres repository lost RemoveMutedAuthor," >&2
  echo "        so unmute does not persist in production." >&2
  exit 1
fi
if ! grep -qF 'func (r *EngagementRepository) ListMutedAuthors(ctx context.Context, actorID string) ([]engagement.MutedAuthor, error) {' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the Postgres repository lost ListMutedAuthors." >&2
  exit 1
fi
if ! grep -qF 'RemoveMutedAuthor(ctx context.Context, actorID, authorID string) (bool, error)' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: Repository no longer requires RemoveMutedAuthor." >&2
  exit 1
fi
if ! grep -qF 'ListMutedAuthors(ctx context.Context, actorID string) ([]MutedAuthor, error)' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: Repository no longer requires ListMutedAuthors." >&2
  exit 1
fi
# ---------- 客户端：命令名、解析、界面接线 ----------
if ! grep -qF 'public async unmuteAuthor(authorId: string): Promise<"UNMUTED" | "NOT_MUTED"> {' apps/mobile/src/engagement-client.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: EngagementClient lost unmuteAuthor." >&2
  exit 1
fi
if ! grep -qF 'public async listMutedAuthors(limit?: number): Promise<MutedAuthorsList> {' apps/mobile/src/engagement-client.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: EngagementClient lost listMutedAuthors." >&2
  exit 1
fi
if ! grep -qF '"UnmuteAuthor", { type: "Profile", id: authorId }, { authorId }' apps/mobile/src/engagement-client.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: unmuteAuthor no longer sends the authorId it was" >&2
  echo "        given — that is the dead-parameter class of bug again." >&2
  exit 1
fi
if ! grep -qF '"ListMutedAuthors",' apps/mobile/src/engagement-client.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: listMutedAuthors no longer calls the server." >&2
  exit 1
fi
if ! grep -qF 'export const MutedAuthorsListSchema = z.object({' packages/contracts/src/engagement.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the shared MutedAuthorsList contract is gone." >&2
  exit 1
fi
if ! grep -qF 'export function parseMutedAuthorsList(' packages/contracts/src/engagement.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the MutedAuthorsList parser is gone, so the client" >&2
  echo "        would trust an unvalidated server payload." >&2
  exit 1
fi
if ! grep -qF 'export function mutedAuthorLabel(' apps/mobile/src/muted-authors.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: muted-author labels stopped going through the single" >&2
  echo "        identity chain, so a muted person can be shown as a raw account id." >&2
  exit 1
fi
if ! grep -qF 'export function removeMutedAuthor(' apps/mobile/src/muted-authors.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: unmuting no longer removes the row locally, so the" >&2
  echo "        list keeps showing someone who is already unmuted." >&2
  exit 1
fi
# 界面必须真的接上（「通道建好了但没人接线」这个仓库出过一次，见 SEARCH-CORPUS-001）。
if ! grep -qF 'await engagement.listMutedAuthors();' apps/mobile/src/surfaces/feed-prefs.tsx; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the feed-prefs surface never reads the muted list," >&2
  echo "        so the section is an empty shell." >&2
  exit 1
fi
if ! grep -qF 'await engagement.unmuteAuthor(authorId);' apps/mobile/src/surfaces/feed-prefs.tsx; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the feed-prefs surface has no working unmute" >&2
  echo "        action, so mute is one-way again in practice." >&2
  exit 1
fi
if ! grep -qF '{mutedAuthorLabel(row)}' apps/mobile/src/surfaces/feed-prefs.tsx; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the muted-author rows stopped rendering a resolved" >&2
  echo "        display name." >&2
  exit 1
fi
if ! grep -qF 'removeMutedAuthor(prev, authorId)' apps/mobile/src/surfaces/feed-prefs.tsx; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: unmuting does not update the local list." >&2
  exit 1
fi
# 反向 pin：下面这些就是当初的 bug 本身，任何一个回来都要拦住。
if grep -qF '不可逆：当前 client 不提供 unmute' apps/mobile/src/engagement-client.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the stale 'mute is irreversible, do it in phase 2'" >&2
  echo "        comment is back — it is what dressed up a missing command as a plan." >&2
  exit 1
fi
if grep -qF 'MutedAuthors []MutedAuthor `json:"mutedAuthors"`' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the muted list is back to shipping the raw" >&2
  echo "        aggregate rows, which carry no display name." >&2
  exit 1
fi
if ! grep -qF 'MUTE-REVERSIBLE-001' apps/mobile/src/muted-authors.test.ts; then
  echo "  FAIL [MUTE-REVERSIBLE-001]: the regression ID or its mobile test is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/muted-authors.test.ts || exit $?
pnpm --filter @proxy/mobile exec vitest run src/engagement-client.test.ts || exit $?
echo "    MUTE-REVERSIBLE-001: PASS (mute is reversible end to end, and names people)"

# REPLY-INLINE-001: 回复输入框必须内联在帖子下方，且键盘不能盖住它。
#
# 坏掉的形态：回复框曾经是一个 `<Modal transparent>` + `justifyContent:"flex-end"`
# 的底部白卡（还带「回复帖文」标题、取消/回复按钮），点「回复」时它从屏幕底部
# 弹上来；而 feed 整屏**没有任何键盘避让**（全文没有 KeyboardAvoidingView，
# ScrollView 也没开 automaticallyAdjustKeyboardInsets）。两条叠在一起的后果是：
# 键盘一弹起，正好压在那个贴在底部的输入框上 —— 用户是在盲打。
# 现在的形态：点「回复」→ 在那条帖子正下方就地展开一行输入框，无遮罩、无上滑
# 动画，键盘弹起时由 ScrollView 的 inset 调整把它顶进可见区。
# 这两颗 pin 用行锚定（^空白+prop+空白$）而不是裸 grep -qF：feed.tsx 的注释里
# 原样写着这两个 prop 的名字来解释它们各自解决什么，裸 grep 会被注释满足 ——
# 把真正的 prop 从 ScrollView 上删掉，pin 照样是绿的，等于没设防。锚定之后
# 注释行（以 // 开头）匹配不上，只有货真价实的 JSX 属性行才算数。
if ! grep -qE '^[[:space:]]+automaticallyAdjustKeyboardInsets[[:space:]]*$' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [REPLY-INLINE-001]: the feed ScrollView no longer adjusts for the" >&2
  echo "        keyboard, so an inline reply box gets covered again." >&2
  exit 1
fi
if ! grep -qE '^[[:space:]]+keyboardShouldPersistTaps="handled"[[:space:]]*$' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [REPLY-INLINE-001]: keyboardShouldPersistTaps is gone — with the" >&2
  echo "        keyboard up, the first tap on 发送 only dismisses it and the" >&2
  echo "        reply can never be submitted." >&2
  exit 1
fi
if ! grep -qF 'replyTargetId === post.postId ? (' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [REPLY-INLINE-001]: the reply composer is no longer anchored to the" >&2
  echo "        post you tapped — either it shows on every post or on none." >&2
  exit 1
fi
if ! grep -qF 'styles.inlineReplyInput' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [REPLY-INLINE-001]: the inline reply input style is gone." >&2
  exit 1
fi
# 反向 pin：底部白卡那套东西一个都不许回来。
if grep -qF 'styles.replyOverlay' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [REPLY-INLINE-001]: the bottom-sheet reply overlay is back — that is" >&2
  echo "        the modal that slid up from the bottom and got covered by the keyboard." >&2
  exit 1
fi
if grep -qF 'styles.replySheet' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [REPLY-INLINE-001]: the reply bottom sheet is back." >&2
  exit 1
fi
# 注意这里 pin 的是 `>回复帖文<` 而不是裸的「回复帖文」：裸字符串会命中
# feed.tsx 里解释这段历史的注释本身（注释里写了「还带「回复帖文」标题」），
# 于是这颗 pin 会永远红、且排查时看不出是注释在触发。加上 JSX 的尖括号后
# 只有真正的 `<Text …>回复帖文</Text>` 能命中。
if grep -qF '>回复帖文<' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [REPLY-INLINE-001]: the '回复帖文' sheet title is back — an inline" >&2
  echo "        composer does not need a modal title." >&2
  exit 1
fi
echo "    REPLY-INLINE-001: PASS (reply composer is inline and keyboard-safe)"

# GHOST-24H-001: 「24h 临时动态」必须真的会消失。
#
# 坏掉的样子：ephemeralUntil 只存在于 packages/contracts 的 zod schema 和
# mobile 的发布 payload 里，**api-go 一次都没出现过** —— Post 没这个字段、
# createPostPayload 不解析它、数据库没列、feed 没过期条件。Go 的 JSON 解码
# 静默忽略未知字段，所以客户端算好 now+24h 发上来、弹 toast「24h 动态已发布」，
# 而这条帖子**永久存在**。这不是少做功能，是一条对用户撒谎的路径：用户正是
# 因为相信它会消失才发的（越南 PDP 91/2025 下这属于对数据留存期的承诺）。
#
# 关键约束：过期写在 SQL 谓语里（`ephemeral_until IS NULL OR ephemeral_until >
# now()`），不是查完在 Go 里过滤 —— 先 LIMIT 再过滤会让一页少给好几条，往下
# 翻还会重复或漏帖。而且是**读时过滤**：行留着，才能举证「这条确实到期了」
# 而不是被谁偷偷删掉的。
require_test "GHOST-24H-001" "./internal/localnet" \
  "TestEphemeralPostDisappearsFromFeedWhenExpired" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "GHOST-24H-001" "./internal/localnet" \
  "TestCreatePostRejectsPastEphemeralUntil" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "GHOST-24H-001" "./internal/localnet" \
  "TestPostIsExpiredBoundaries" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "GHOST-24H-001" "./internal/localnet" \
  "TestCreatePostPersistsEphemeralUntil" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
# 这条是 PG 集成测试：没有 DATABASE_URL 时它会 SKIP（起不了临时集群），
# 但仍然钉住「文件 + 函数名」存在，并且是唯一能抓到 SELECT/scan 列数漂移的
# 防线（见下面那条结构性 pin 的注释）。
require_test "GHOST-24H-001" "./internal/platform/postgres" \
  "TestEphemeralPostFeedFilterLifecycle" \
  "apps/api-go/internal/platform/postgres/posts_ephemeral_integration_test.go" || exit $?

if ! grep -qF 'EphemeralUntil *time.Time' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [GHOST-24H-001]: localnet.Post lost its EphemeralUntil field —" >&2
  echo "        the 24h expiry has nowhere to live again." >&2
  exit 1
fi
if ! grep -qF 'func postIsExpired(' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [GHOST-24H-001]: postIsExpired is gone — nothing decides when an" >&2
  echo "        ephemeral post has expired." >&2
  exit 1
fi
if ! grep -qF 'INVALID_POST_EPHEMERAL_UNTIL' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [GHOST-24H-001]: an expiry in the past is no longer rejected, so a" >&2
  echo "        post can be created already-expired: published OK, visible to no one." >&2
  exit 1
fi
# 过期谓语必须同时在 feed 和「提到我」两条查询里。只写 feed 的话，一条已经
# 「消失」的 24h 帖会因为提到了谁而从 TAGGED 后门复活。
feed_predicates=$(grep -cF 'AND (ephemeral_until IS NULL OR ephemeral_until > now())' apps/api-go/internal/platform/postgres/network.go)
if [ "$feed_predicates" -lt 2 ]; then
  echo "  FAIL [GHOST-24H-001]: the expiry predicate is missing from a read path" >&2
  echo "        (found $feed_predicates, want >= 2: feed + mentions)." >&2
  exit 1
fi
# 结构性 pin：每一行帖子 SELECT 都必须在列清单里带上 ephemeral_until，且每一条
# 读它的扫描路径都必须真的扫这一列。
#
# 为什么需要这条：给 4 个 rows.Scan 加了 &post.EphemeralUntil、却忘了给其中
# 3 条 SELECT 的列清单加 ephemeral_until，结果**任何真实数据库上的 feed 读取
# 全部失败**（number of field descriptions must equal number of destinations），
# 而 `go test ./...` 因为全跑在内存 fake 上，绿得发亮。这个 bug 只有真机联调
# 才暴露 —— 所以这里用源码结构做个廉价守门。
#
# 只对行尾匹配（`ephemeral_until$`）：INSERT 的列清单以 `)` 结尾，不会被算进来。
#
# ⚠️ 比的是**扫描路径数**，不是扫描点数。5aa88a8（SCENE-PHOTO-WALL-001，Rev289）
# 把三条一模一样的 rows.Scan 抽成了共享的 scanPostRows：一条 scan 服务三个
# SELECT，于是扫描点从 4 掉到 3、SELECT 涨到 5，原先 `scans == selected` 的 1:1
# 假设当场失效 —— **代码是对的，红的是这条 pin**。（当时 pin 脚本已经因为
# COMP-SELLER-001 的 gofmt 假红停在 3144 行，所以这条红没人看见；2026-09-24 修。）
# 现在按路径数：共享扫描器只算一条定义，它的每个调用点各算一条路径。
scans=$(grep -cF '&post.EphemeralUntil' apps/api-go/internal/platform/postgres/network.go)
selected=$(grep -cE 'context_refs, created_at, ephemeral_until[[:space:]]*$' apps/api-go/internal/platform/postgres/network.go)
shared_scanner_defs=$(grep -cF 'func scanPostRows(' apps/api-go/internal/platform/postgres/network.go)
shared_scanner_calls=$(grep -cF 'scanPostRows(rows, limit)' apps/api-go/internal/platform/postgres/network.go)
scan_paths=$((scans - shared_scanner_defs + shared_scanner_calls))
if [ "$scan_paths" != "$selected" ]; then
  echo "  FAIL [GHOST-24H-001]: SELECT/scan drift on ephemeral_until —" >&2
  echo "        $selected SELECT list(s) vs $scan_paths scan path(s)" >&2
  echo "        ($scans rows.Scan destination(s) − $shared_scanner_defs shared scanner" >&2
  echo "        definition(s) + $shared_scanner_calls call site(s))." >&2
  echo "        A pgx scan-count mismatch fails every feed read on a real DB" >&2
  echo "        while the in-memory tests stay green." >&2
  exit 1
fi
# 反向 pin：别把同一列写两遍（一次 substring 替换就造得出来，见 2026-09-13）。
if grep -qF 'ephemeral_until, ephemeral_until' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [GHOST-24H-001]: ephemeral_until is listed twice in the same" >&2
  echo "        column list — that breaks the INSERT/SELECT arity." >&2
  exit 1
fi
if [ ! -f apps/api-go/migrations/090_post_ephemeral_until.sql ]; then
  echo "  FAIL [GHOST-24H-001]: migration 090 (post ephemeral_until) is missing." >&2
  exit 1
fi
# 反向 pin：注释不许再宣称「服务端尚未持久化」—— 那句话正是这个 bug 当年的遮羞布。
if grep -qF '服务端尚未持久化' apps/mobile/src/composer-body.ts; then
  echo "  FAIL [GHOST-24H-001]: composer-body.ts claims the server still does not" >&2
  echo "        persist ephemeralUntil. Either implement it or fix the comment." >&2
  exit 1
fi
echo "    GHOST-24H-001: PASS (24h posts really expire, in SQL, at read time)"

# POLL-VOTE-001: 投票必须真的能投、真的能数票。
#
# 坏掉的样子：投票的 UI 是完整的（ComposerV2Screen 的「添加投票」、增删选项、
# 选时长），发布时客户端也老老实实把 `payload.poll` 发上来了 —— 但 api-go
# 里 5 处 `poll` 全是不相干的同名东西（outbox poll / poll for completion /
# message kind），服务端一个投票字段都没有。Go 的 JSON 解码静默忽略未知字段，
# 于是产出一条「正文里躺着一段看起来像投票的文本」的帖子：谁都投不了，也没有
# 任何票数。跟 GHOST-24H-001 是同一类缺陷（写出来像有、实际没有），只是更尴尬
# —— 「投票」这个词本身就在承诺「能投」和「有结果」。
#
# 口径（迁移 091 里有完整论证）：投票是帖子的附属物 1:1 并级联删除；一人一票
# （再投 = 改票）；票数永远 COUNT(*) 现算不落计数字段；到期只关闭投票、不隐藏
# 结果；multiSelect 明确不支持且**显式拒绝**，绝不静默降级成单选。
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestCreatePostWithPollExposesOptionsWithZeroVotes" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestVotePostPollCountsVotes" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestVotePostPollIsOneVotePerUserAndSwitchable" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestVotePostPollRejectsOptionBelongingToAnotherPost" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestVotePostPollRejectedAfterExpiryButResultsStayVisible" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestPollWithoutExpiryNeverCloses" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestCreatePostRejectsMultiSelectPollInsteadOfDowngrading" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestCreatePostRejectsPollThatExpiresInThePast" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
require_test "POLL-VOTE-001" "./internal/localnet" \
  "TestVotePostPollRequiresAUserActor" \
  "apps/api-go/internal/localnet/poll_test.go" || exit $?
# PG 集成测试（无 DATABASE_URL 时 SKIP，但仍钉住文件 + 函数名存在）。
# 它是唯一能抓到「写子表没加入环境事务」这条链路的防线，见下面那条 pin。
require_test "POLL-VOTE-001" "./internal/platform/postgres" \
  "TestSavePostPollJoinsAmbientTransaction" \
  "apps/api-go/internal/platform/postgres/posts_poll_integration_test.go" || exit $?

if [ ! -f apps/api-go/migrations/091_post_polls.sql ]; then
  echo "  FAIL [POLL-VOTE-001]: migration 091 (post polls) is missing." >&2
  exit 1
fi
if ! grep -qF 'Poll *PostPollView' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [POLL-VOTE-001]: localnet.Post lost its Poll field — the poll" >&2
  echo "        read model has nowhere to travel to the client." >&2
  exit 1
fi
if ! grep -qF '"VotePostPoll"' apps/api-go/internal/localnet/service.go; then
  echo "  FAIL [POLL-VOTE-001]: VotePostPoll is no longer a supported command —" >&2
  echo "        nobody can vote again." >&2
  exit 1
fi
# 三条「说不」的路径。少一条就会退化成静默接受一条没人能投 / 永远截止 / 选项
# 不属于本贴的票 —— 而静默接受正是 GHOST-24H-001 的病根。
for code in POLL_NOT_FOUND POLL_CLOSED POLL_OPTION_NOT_FOUND POLL_MULTISELECT_UNSUPPORTED POLL_VOTE_NOT_ALLOWED; do
  if ! grep -qF "$code" apps/api-go/internal/localnet/service.go; then
    echo "  FAIL [POLL-VOTE-001]: error code $code is gone — a bad vote would" >&2
    echo "        now be silently accepted instead of refused with a reason." >&2
    exit 1
  fi
done
# 反向 pin：SavePostPoll 不许自己 r.pool.Begin 开第二个连接。
#
# 为什么这条必须存在：命令处理跑在一个挂在 ctx 上的环境事务里，CreatePost 写
# 进去的帖子行在提交前**别的连接看不见**。自己新开事务去写 post_polls 就会撞上
# post_id → posts(id) 的外键（真实报错：violates foreign key constraint
# "post_polls_post_id_fkey"），于是「建一条带投票的帖子」100% 失败 —— 而内存仓
# 根本没有外键，所有 service 层单测绿得发亮。这个是真机联调才炸出来的。
if grep -qF 'r.pool.Begin(ctx)' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [POLL-VOTE-001]: a repository method opens its own connection" >&2
  echo "        instead of joining the ambient transaction — writing a child" >&2
  echo "        row right after its parent will fail the foreign key." >&2
  exit 1
fi
if ! grep -qF 'runInTransaction(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [POLL-VOTE-001]: runInTransaction is no longer used — the poll" >&2
  echo "        write lost its transaction." >&2
  exit 1
fi
# 客户端：votePostPoll 必须真的发命令，并且用服务端返回的权威票数。
if ! grep -qF 'public async votePostPoll(' apps/mobile/src/engagement-client.ts; then
  echo "  FAIL [POLL-VOTE-001]: EngagementClient.votePostPoll is gone — the UI" >&2
  echo "        cannot submit a vote." >&2
  exit 1
fi
if ! grep -qF 'PostPollViewSchema.parse(raw.poll)' apps/mobile/src/engagement-client.ts; then
  echo "  FAIL [POLL-VOTE-001]: votePostPoll no longer returns the server's" >&2
  echo "        authoritative tally (a client-side +1 drifts on re-votes)." >&2
  exit 1
fi
# 契约：读模型必须是带票数的 PostPollView，不是只有结构的写模型。
if ! grep -qF 'poll: PostPollViewSchema.optional()' packages/contracts/src/index.ts; then
  echo "  FAIL [POLL-VOTE-001]: FeedPost.poll no longer uses the read model —" >&2
  echo "        vote counts would never reach the client." >&2
  exit 1
fi
if ! grep -qF 'export const PostPollViewSchema' packages/contracts/src/index.ts; then
  echo "  FAIL [POLL-VOTE-001]: PostPollViewSchema is missing from contracts." >&2
  exit 1
fi
# 反向 pin：注释不许再宣称「服务端尚无对应字段」—— 那句话正是这个 bug 的遮羞布。
if grep -qF '服务端尚无对应字段' packages/contracts/src/index.ts; then
  echo "  FAIL [POLL-VOTE-001]: contracts claim the server still has no poll" >&2
  echo "        field. Either implement it or fix the comment." >&2
  exit 1
fi
echo "    POLL-VOTE-001: PASS (polls are really votable and really counted)"

# POLL-OPTION-SCOPE-001: 投票选项的身份是 (post_id, option_id)，不是 option_id。
#
# 坏掉的样子：post_poll_options 一开始把 option_id 单独设成了 PRIMARY KEY。
# optionId 是客户端生成的（`opt_<ts>_<idx>`），两条帖子完全可能用同一批 id
# （重发草稿、重试发布、硬编码）。于是第二条帖子的 INSERT 撞上
# ON CONFLICT (option_id) —— 它只改写 label/sort_order，**不改写 post_id** ——
# 结果第二条帖子的选项整批消失（投票渲染不出来），第一条帖子的选项被悄悄改标签。
#
# 同一处设计错误还有第二个后果：数票的子查询如果只按 option_id 分组，A 帖子的
# 票会被算到 B 帖子同名选项的头上。两条 pin 一起钉。
require_test "POLL-OPTION-SCOPE-001" "./internal/platform/postgres" \
  "TestPollOptionsAreScopedToTheirPost" \
  "apps/api-go/internal/platform/postgres/posts_poll_integration_test.go" || exit $?
if ! grep -qF 'ON CONFLICT (post_id, option_id)' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [POLL-OPTION-SCOPE-001]: options are upserted by option_id alone" >&2
  echo "        — two posts sharing an option id will steal each other's options." >&2
  exit 1
fi
if ! grep -qF 'GROUP BY post_id, option_id' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [POLL-OPTION-SCOPE-001]: votes are aggregated by option_id alone" >&2
  echo "        — counts leak across posts that reuse an option id." >&2
  exit 1
fi
# 反向 pin：option_id 不许再单独当主键。
if grep -qE '^[[:space:]]*option_id[[:space:]]+TEXT[[:space:]]+PRIMARY KEY' apps/api-go/migrations/091_post_polls.sql; then
  echo "  FAIL [POLL-OPTION-SCOPE-001]: option_id is a global primary key again" >&2
  echo "        — options must be scoped to their post." >&2
  exit 1
fi
echo "    POLL-OPTION-SCOPE-001: PASS (poll options belong to their own post)"

# FEED-NULL-CITY-001: 一行 city_scope 为 NULL 的帖子不许打挂所有人的动态流。
#
# 坏掉的样子：city_scope 是可空列，但 4 条读路径都把它直接扫进 `post.CityScope`
# —— 一个普通 `string`。pgx 拒绝把 NULL 扫进 *string 目标（cannot scan NULL into
# *string），ListFeedPage 直接把这个错误往上抛，于是**整页 feed 读取失败**，
# 不是「这一条渲染怪」，是「所有人的动态流都打不开」。
#
# 为什么 `go test ./...` 抓不到：内存仓里根本没有 NULL，而 Go 的写路径永远绑 ""
# 而不是 NULL。能造出这种行的只有裸 INSERT（迁移、回填、手工修复、seed 脚本）
# 或将来某个漏了这一列的代码路径 —— 恰恰都是上线前最不会被跑到、凌晨最可能
# 发生的情况。
require_test "FEED-NULL-CITY-001" "./internal/platform/postgres" \
  "TestFeedReadsSurviveNullCityScope" \
  "apps/api-go/internal/platform/postgres/posts_null_city_integration_test.go" || exit $?
# 反向 pin：不许再把可空的 city_scope 直接扫进 string。
if grep -qF '&post.CityScope' apps/api-go/internal/platform/postgres/network.go; then
  echo "  FAIL [FEED-NULL-CITY-001]: city_scope is scanned straight into a" >&2
  echo "        string again — one NULL row will fail every feed read." >&2
  exit 1
fi
# 每条读路径都要判空。⚠️ 同样按**路径数**算，不能按 guard 点数：5aa88a8
# （SCENE-PHOTO-WALL-001，Rev289）把三条相同的判空抽进共享的 scanPostRows
# （一条 guard 服务三个 SELECT），guard 点数从 4 掉到 3、读路径反而涨到 5
# （新增 ListPostsAtScene）—— 代码是对的，红的是这条钉。它当时被
# COMP-SELLER-001 的 gofmt 假红静音（脚本卡在 3144 行），2026-09-24 修。
# 5 条 = GetPost / Snapshot / ListFeedPage / ListPostsMentioning / ListPostsAtScene。
city_guards=$(grep -cF 'cityScope != nil' apps/api-go/internal/platform/postgres/network.go)
city_shared_defs=$(grep -cF 'func scanPostRows(' apps/api-go/internal/platform/postgres/network.go)
city_shared_calls=$(grep -cF 'scanPostRows(rows, limit)' apps/api-go/internal/platform/postgres/network.go)
city_paths=$((city_guards - city_shared_defs + city_shared_calls))
if [ "$city_paths" -lt 5 ]; then
  echo "  FAIL [FEED-NULL-CITY-001]: only $city_paths read path(s) guard the" >&2
  echo "        nullable city_scope, want 5" >&2
  echo "        ($city_guards guard(s) − $city_shared_defs shared scanner definition(s)" >&2
  echo "        + $city_shared_calls call site(s))." >&2
  exit 1
fi
echo "    FEED-NULL-CITY-001: PASS (one NULL city_scope no longer kills the feed)"

# OPENAPI-DOMAIN-001: 域漏登记进 openapicmds.DomainDir 的后果是「命令能 dispatch、
# 跑得好好的，却永远不在 OpenAPI 契约里」，而且漂移检查发现不了 —— 它比对的是
# 「重新生成 vs 已提交」，两边缺的是同一个命令，于是 221 对 221 一路绿灯。
# 2026-09-14 实测：storeonboarding / benefit / location / marketplace / profile /
# realityscene / relationship 七个域都是这样隐身的（契约里少了 25 条命令）。
# 所以这里不 pin 某个具体域，而是**结构性地**遍历 internal/*/service.go：
# 凡是有 `case "` 命令分支的域，必须出现在 DomainDir 里。新域只要漏登记就红。
unlisted_domain=""
for svc in apps/api-go/internal/*/service.go; do
  domain=$(basename "$(dirname "$svc")")
  if ! grep -qE '^[[:space:]]*case "' "$svc"; then
    continue
  fi
  if ! grep -qF "{\"$domain\"," apps/api-go/internal/openapicmds/openapicmds.go; then
    unlisted_domain="$domain"
    break
  fi
done
if [ -n "$unlisted_domain" ]; then
  echo "  FAIL [OPENAPI-DOMAIN-001]: domain '$unlisted_domain' dispatches commands" >&2
  echo "        but is not listed in openapicmds DomainDir, so its commands can never" >&2
  echo "        reach the OpenAPI contract (and the drift check stays green)." >&2
  exit 1
fi
echo "    OPENAPI-DOMAIN-001: PASS (every command-dispatching domain reaches the contract)"

# STORE-REC-002: 运营评估队列必须存在。STORE-REC-001 只做了受理 —— 记录写进
# business.store_recommendations 之后**没有任何读路径**，运营在 bdash 里评估
# 这件事在数据层根本做不到，于是「推荐商铺进体系」变成只进不出的黑洞，
# 写进去的举证材料谁也看不到。这是本仓库反复踩的那一类坑：
# **通道建好了，但没有调用方**（SEARCH-CORPUS-001 的 server search 就是同一个形状）。
# 顺带钉死两件事：读路径必须 operator-only（记录含推荐人账号与理由，属个人信息），
# 且必须自带 LIMIT（否则「拉全表」迟早变成一次把整张表读进内存的运维事故）。
require_test "STORE-REC-002" "./internal/storeonboarding" \
  "TestListStoreRecommendationsNewestFirst" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-002" "./internal/storeonboarding" \
  "TestListStoreRecommendationsRejectsUnknownOriginInsteadOfReturningEverything" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-002" "./internal/storeonboarding" \
  "TestListStoreRecommendationsReturnsArrayWhenEmpty" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
if ! grep -qF 'ListRecommendations(ctx context.Context, filter RecommendationFilter)' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-002]: the Repository interface no longer carries" >&2
  echo "        ListRecommendations, so the operator queue has no read path." >&2
  exit 1
fi
if ! grep -qF 'func (r *StoreOnboardingRepository) ListRecommendations' apps/api-go/internal/platform/postgres/storeonboarding.go; then
  echo "  FAIL [STORE-REC-002]: the Postgres read path is gone, so recommendations" >&2
  echo "        can be written but never read back." >&2
  exit 1
fi
if ! grep -qF '"ListStoreRecommendations": true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [STORE-REC-002]: ListStoreRecommendations is no longer operator-only," >&2
  echo "        so any user could enumerate who recommended what." >&2
  exit 1
fi
if ! grep -qF 'LIMIT $3' apps/api-go/internal/platform/postgres/storeonboarding.go; then
  echo "  FAIL [STORE-REC-002]: the queue query lost its LIMIT, so one request can" >&2
  echo "        pull the whole table into memory." >&2
  exit 1
fi
echo "    STORE-REC-002: PASS (operator queue can read recommendations back, gated and bounded)"

# STORE-REC-003: 小美（AI）推荐必须能产生数据。
#
# origin 字段区分「真人用户推荐」与「AI（小美）推荐」，运营队列也有「小美推荐」
# 筛选与徽章 —— 但落地时 RecommendStore 唯一的调用点写死 origin="USER"，从来
# 没有一个能写入 AI 推荐的地方。schema、服务、筛选、UI 徽章全都在，通道却是死的：
# 队列里那个「小美推荐」筛选永远筛不出任何东西。**又是同一类坑：通道建好了，
# 但没有调用方。**
#
# 钉死四件事：
#   ① 命令存在且有测试；
#   ② 底座未配置时以 AI_NOT_CONFIGURED fail-closed（这是「前端隐藏入口」的依据，
#      绝不能静默返回假草稿）；
#   ③ 命令进了 OpenAPI 契约（否则客户端生成不出调用点）；
#   ④ SetModelStack 必须在 PG 替换**之后**注入 —— 见下面那段顺序检查。
require_test "STORE-REC-003" "./internal/storeonboarding" \
  "TestSuggestStoreRecommendationStructuresTheNote" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-003" "./internal/storeonboarding" \
  "TestSuggestStoreRecommendationDoesNotInventUnsaidFields" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-003" "./internal/storeonboarding" \
  "TestSuggestStoreRecommendationFailsClosedWhenAIUnavailable" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-003" "./internal/storeonboarding" \
  "TestSuggestStoreRecommendationDistinguishesFailureFromMalformed" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
if ! grep -qF 'func (s *Service) suggestRecommendation' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-003]: SuggestStoreRecommendation handler is gone, so" >&2
  echo "        origin=\"AI\" can never be produced and the queue's AI filter is dead UI." >&2
  exit 1
fi
if ! grep -qF 'commandType == "SuggestStoreRecommendation"' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-003]: the domain no longer advertises" >&2
  echo "        SuggestStoreRecommendation, so the command will not dispatch." >&2
  exit 1
fi
if ! grep -qF 'storeonboarding.ai_not_configured' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-003]: the AI_NOT_CONFIGURED fail-closed path is gone, so an" >&2
  echo "        unwired model stack would silently degrade into a fabricated draft." >&2
  exit 1
fi
if ! grep -qF 'SuggestStoreRecommendation' apps/api-go/openapi.commands.generated.yaml; then
  echo "  FAIL [STORE-REC-003]: SuggestStoreRecommendation is missing from the OpenAPI" >&2
  echo "        command contract, so no client can call it. Regenerate with" >&2
  echo "        go run ./cmd/openapi-commands in apps/api-go." >&2
  exit 1
fi
# 注入顺序：SetModelStack 必须在 PG 替换之后。NewWithRepository 不会携带
# modelstack，先注入再被替换 = 适配器静默丢失，AI 能力退化成「永远
# AI_NOT_CONFIGURED」，而客户端会据此把入口藏起来 —— 从外部看，这个功能
# 就像从来没做过一样。marketplace 的 OPP-SUGGEST-001 原来就踩在这个坑上。
for svc in marketplaceService storeOnboardingService; do
  if ! awk -v svc="$svc" '
    $0 ~ svc " = [a-z]+\\.NewWithRepository" { repl = NR }
    $0 ~ svc "\\.SetModelStack" { wire = NR }
    END { if (wire && (!repl || wire > repl)) exit 0; else exit 1 }
  ' apps/api-go/cmd/api/main.go; then
    echo "  FAIL [STORE-REC-003]: $svc.SetModelStack is not wired after the PostgreSQL" >&2
    echo "        replacement, so the model stack is silently discarded when" >&2
    echo "        DATABASE_URL is set and every AI command returns AI_NOT_CONFIGURED." >&2
    exit 1
  fi
done
echo "    STORE-REC-003: PASS (小美 can actually produce an AI-origin recommendation, fail-closed)"

# STORE-REC-004: 运营评估队列必须能**出结论**。
#
# STORE-REC-002 给了读路径，但运营读完一条推荐之后没有任何地方记录
# 「采纳 / 不采纳」—— 结论只存在于他脑子里，队列变成一条只读的死胡同：
# 看完了，然后呢？
#
# 钉死：①命令存在且有测试；②operator-only（结论里写着「谁否掉了哪家店」，
# 落到普通用户手里等于公开运营的判断过程）；③结论进单独一张 append-only 表，
# 不给推荐记录加状态列（推荐是举证材料，改它就是改证据）；④命令进 OpenAPI 契约。
require_test "STORE-REC-004" "./internal/storeonboarding" \
  "TestDecideStoreRecommendationRecordsTheDecision" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-004" "./internal/storeonboarding" \
  "TestQueueShowsDecisionAndHonoursPendingOnly" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-004" "./internal/storeonboarding" \
  "TestLatestDispositionWinsWhenOperatorChangesMind" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
if ! grep -qF 'func (s *Service) decideStoreRecommendation' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-004]: DecideStoreRecommendation handler is gone, so the" >&2
  echo "        queue is read-only again and decisions exist only in the operator's head." >&2
  exit 1
fi
if ! grep -qF '"DecideStoreRecommendation": true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [STORE-REC-004]: DecideStoreRecommendation is no longer operator-only," >&2
  echo "        so any user could read who rejected which store." >&2
  exit 1
fi
# 结论必须落在**独立的 append-only 表**里，不能给 store_recommendations 加状态列：
# 推荐记录是举证材料（谁、什么时候、因为什么推荐了哪家店），
# 为了记结论去 UPDATE 它，等于把证据本身改掉了。
if ! [ -f apps/api-go/migrations/093_store_recommendation_dispositions.sql ]; then
  echo "  FAIL [STORE-REC-004]: the dispositions migration is missing, so decisions" >&2
  echo "        would have to be stored by mutating the recommendation evidence row." >&2
  exit 1
fi
if ! grep -qF 'CREATE TABLE IF NOT EXISTS business.store_recommendation_dispositions' apps/api-go/migrations/093_store_recommendation_dispositions.sql; then
  echo "  FAIL [STORE-REC-004]: store_recommendation_dispositions table is gone." >&2
  exit 1
fi
if ! grep -qF 'DecideStoreRecommendation' apps/api-go/openapi.commands.generated.yaml; then
  echo "  FAIL [STORE-REC-004]: DecideStoreRecommendation is missing from the OpenAPI" >&2
  echo "        command contract. Regenerate with go run ./cmd/openapi-commands." >&2
  exit 1
fi
echo "    STORE-REC-004: PASS (operators can record 采纳/不采纳, append-only and operator-only)"

# STORE-REC-005: 采纳之后，这条推荐必须还能被查出来。
#
# 队列默认只看待评估，而筛选条件此前是个布尔（只看待评估 / 全部），表达不了
# 「只看我采纳过的」。于是采纳是个死胡同：一点采纳，这条推荐就从默认视图消失，
# 只埋在「全部」那一堆里 —— 运营看不到自己批过什么，更没法跟进商家入驻。
# 采纳 = 批准接入，不等于店铺已存在；批准完查不到，事情就等于没发生。
#
# 注意这是又一次「通道建好了，没有调用方」，只是这次死在**读**的一侧：
# 结论写进去了（STORE-REC-004），却没有任何路径把它读回来。
#
# 钉死：①测试存在；②四态 status 在服务层存在（布尔表达不了「已采纳」）；
# ③**生产**读路径（Postgres）也认 ACCEPTED —— 只在内存仓储里实现是最经典的
# 半截接线，本地测试全绿、线上什么都查不到；④App 队列里有这个视图。
require_test "STORE-REC-005" "./internal/storeonboarding" \
  "TestAcceptedRecommendationsStayReachable" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
if ! grep -qF 'StatusAccepted = "ACCEPTED"' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-005]: the four-state queue status filter is gone, so" >&2
  echo "        accepted recommendations can no longer be listed on their own." >&2
  exit 1
fi
if ! grep -qF "\$4 = 'ACCEPTED'" apps/api-go/internal/platform/postgres/storeonboarding.go; then
  echo "  FAIL [STORE-REC-005]: the Postgres read path no longer honours the" >&2
  echo "        ACCEPTED filter -- a memory-repo-only filter is a half-wire that" >&2
  echo "        passes every local test and returns nothing in production." >&2
  exit 1
fi
# 光有服务端不够：App 里没有这个视图，采纳完运营照样看不到。
if ! grep -qF '已采纳' apps/mobile/src/surfaces/store-recommendation-queue.tsx; then
  echo "  FAIL [STORE-REC-005]: the queue UI has no 已采纳 view, so operators still" >&2
  echo "        lose sight of every recommendation the moment they accept it." >&2
  exit 1
fi
if ! grep -qF 'StoreRecommendationQueueStatus' apps/mobile/src/storeonboarding-client.ts; then
  echo "  FAIL [STORE-REC-005]: the mobile client lost the queue status type, so the" >&2
  echo "        UI cannot ask for accepted/rejected recommendations any more." >&2
  exit 1
fi
echo "    STORE-REC-005: PASS (accepted recommendations stay reachable, 采纳 is not a dead end)"

# STORE-REC-006: 评估结论必须落在一条真实存在的推荐上。
#
# 少了这个校验，id 打错（或推荐已被清理）时照样写进一条结论 —— 它永远 join 不到
# 任何推荐，于是那条推荐在队列里**永远还是「待评估」**。运营看到的是「我点了采纳
# 但没反应」，会反复点；而 dispositions 是 append-only 表，孤儿结论写进去就删不掉，
# 举证链里堆满谁也解释不了的记录。
#
# 钉死：①测试存在；②服务层在写结论**之前**查这条推荐（顺序不能反 ——
# 先写后查等于没查）；③仓储接口有 FindRecommendation（内存 + Postgres 都要有，
# 只在内存里实现 = 本地全绿、线上照写孤儿）；④App 把这个错误说清楚，
# 否则运营只会看到一句笼统的「记录失败」然后反复点。
require_test "STORE-REC-006" "./internal/storeonboarding" \
  "TestDispositionOnUnknownRecommendationIsRefused" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
if ! grep -qF 's.repository.FindRecommendation(ctx, recID)' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-006]: the disposition path no longer checks that the" >&2
  echo "        recommendation exists, so orphan dispositions can be written again." >&2
  exit 1
fi
if ! grep -qF 'DISPOSITION_RECOMMENDATION_NOT_FOUND' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-006]: the not-found rejection code is gone." >&2
  exit 1
fi
# 顺序：查必须在写**之前**。先写后查等于没查。
if [ "$(grep -n 'FindRecommendation(ctx, recID)' apps/api-go/internal/storeonboarding/service.go | head -1 | cut -d: -f1)" -ge \
     "$(grep -n 's.repository.AddDisposition(ctx, Disposition{' apps/api-go/internal/storeonboarding/service.go | head -1 | cut -d: -f1)" ]; then
  echo "  FAIL [STORE-REC-006]: FindRecommendation must run BEFORE AddDisposition." >&2
  echo "        Checking after writing proves nothing -- the orphan is already stored." >&2
  exit 1
fi
# 匹配方法定义（`) FindRecommendation(`）而不是参数名 —— 内存仓储用的是
# `_ context.Context`，Postgres 用的是 `ctx context.Context`，钉参数名会误报。
for f in apps/api-go/internal/storeonboarding/memory.go apps/api-go/internal/platform/postgres/storeonboarding.go; do
  if ! grep -qF ') FindRecommendation(' "$f"; then
    echo "  FAIL [STORE-REC-006]: $f is missing FindRecommendation." >&2
    echo "        A memory-repo-only implementation is a half-wire: green locally," >&2
    echo "        orphans written in production." >&2
    exit 1
  fi
done
if ! grep -qF 'DISPOSITION_RECOMMENDATION_NOT_FOUND' apps/mobile/src/surfaces/store-recommendation-queue.tsx; then
  echo "  FAIL [STORE-REC-006]: the queue UI no longer explains the not-found case," >&2
  echo "        so operators see a bare failure and tap the same button again." >&2
  exit 1
fi
echo "    STORE-REC-006: PASS (no orphan dispositions: a decision must point at a real recommendation)"

# STORE-REC-007: 推荐人必须能看见自己那条的进展 —— 且只能看见自己的。
#
# 采纳只代表运营批准接入，商家真正入驻是另一件事。而能完成入驻的人通常就是
# 推荐人本人，可他提交完就再无回音（运营队列是 operator-only，他调不动），
# 于是「已采纳 · 待接入」那一列永远等不到人：队列看起来办结了，事情却没发生。
#
# 钉死：①测试存在；②命令存在；③作用域由**服务端**收敛到 Actor.ID（这条最要紧 ——
# 客户端传参收敛是个安全洞，任何人都能读到别人的推荐理由）；
# ④**不是** operator 命令（否则普通用户照样看不到，缺口原样保留）；
# ⑤App 有这一屏；⑥命令进 OpenAPI 契约。
require_test "STORE-REC-007" "./internal/storeonboarding" \
  "TestRecommenderCanSeeOnlyTheirOwnStatus" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
if ! grep -qF 'func (s *Service) listMyRecommendations' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-007]: ListMyStoreRecommendations handler is gone, so" >&2
  echo "        recommenders are left without any feedback again." >&2
  exit 1
fi
# 作用域必须在服务端收敛。靠客户端传参收敛 = 任何人都能读到别人的推荐理由。
if ! grep -qF 'RecommendedBy: e.Actor.ID' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-007]: the per-caller scope is gone from the service." >&2
  echo "        Client-supplied scoping is not scoping -- it lets anyone read" >&2
  echo "        anyone else's recommendations." >&2
  exit 1
fi
# 若被加进 operator 白名单，普通用户就又看不到了，缺口原样保留。
if grep -qF '"ListMyStoreRecommendations": true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [STORE-REC-007]: ListMyStoreRecommendations became operator-only," >&2
  echo "        so ordinary recommenders cannot see their own status again." >&2
  exit 1
fi
if ! grep -qF 'ListMyStoreRecommendations' apps/api-go/openapi.commands.generated.yaml; then
  echo "  FAIL [STORE-REC-007]: ListMyStoreRecommendations is missing from the" >&2
  echo "        OpenAPI command contract. Regenerate with go run ./cmd/openapi-commands." >&2
  exit 1
fi
if ! grep -qF 'listMyRecommendations' apps/mobile/src/storeonboarding-client.ts; then
  echo "  FAIL [STORE-REC-007]: the mobile client lost listMyRecommendations." >&2
  exit 1
fi
if ! [ -f apps/mobile/src/surfaces/my-store-recommendations.tsx ]; then
  echo "  FAIL [STORE-REC-007]: the 我推荐的店 surface is gone, so the recommender" >&2
  echo "        has no place to learn that their store was approved." >&2
  exit 1
fi
echo "    STORE-REC-007: PASS (recommenders can see their own status, scoped server-side)"

# STORE-REC-ADDRESS-001: 推荐记录要带上地址与地图落点。
#
# 「城市」是筛选口径，不是位置：运营在推荐管理里看到的是一行行店名 + 城市，
# 但真去跑店的人需要门牌；只写门牌又没法在地图上核对店在哪。于是推荐记录
# 多出 address（文本）+ latitude / longitude（落点）三列。
#
# 三者都可选，理由不同：地址可选是因为 092 存量行没有地址、AI 草稿
# （SuggestStoreRecommendation）也产不出门牌；落点可选是因为地图在 Android 上
# 只是只读占位（拿不到坐标），手打地址是安卓唯一的录入路径 —— 所以地图只能是
# iOS 的便利通道，不能变成唯一入口。但落点必须**成对**：只有纬度没有经度画不出
# 任何东西。服务端 fail-closed 拒掉，库里也钉同一对约束（否则绕过命令层的写入
# 会破坏这条不变量）。
#
# 钉死：①服务端接受并带回地址/落点；②半截或越界坐标被拒，且什么都没存；
# ③真库往返；④真库拒绝半截坐标（证明迁移的约束真的会咬，不只是写着好看；
#   本机实测数据库点名报的正是 store_recommendations_coordinate_pair / _latitude_range，
#   而把经度补齐后同一条 INSERT 就能过 —— 所以拒绝确实来自这两条约束本身。
#   注意：机器上没有 postgres 时这两条会 SKIP ⇒ 下面**不能**用 require_test
#   （SKIP 的退出码也是 0，会假装 PASS）。改成数 `--- PASS` 条数，SKIP 也数得出来）；
# ⑤迁移存在且真的加列、加约束；⑥错误码是 INVALID_RECOMMENDATION_LOCATION，
# 不是静默存进去；⑦列表与详情两条读路径都选出这三列（写进去读不回来等于没写）；
# ⑧NULL 仍是「没落点」的唯一哨兵；⑨App 有选点面板，且**不传** radiusMeters
# （店没有服务半径，画个「覆盖 3 km」是编出来的信息）；⑩读模型暴露落点判定与地图链接。
require_test "STORE-REC-ADDRESS-001" "./internal/storeonboarding" \
  "TestRecommendStoreCarriesAddressAndPin" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
require_test "STORE-REC-ADDRESS-001" "./internal/storeonboarding" \
  "TestRecommendStoreRefusesHalfOrOutOfRangeCoordinate" \
  "apps/api-go/internal/storeonboarding/service_test.go" || exit $?
# PG 集成测试：先钉「文件 + 函数名」在，再**一次跑完数 PASS 条数**。
# ⚠️ 这里刻意不用 require_test：它的判据是 go test 的退出码，而**测试被 SKIP 时
# 退出码也是 0** —— 没有集群的机器上会打印 PASS 而实际什么都没验。数 `--- PASS`
# 条数就能把 SKIP 数出来（顺带：一次 go test 比两次 require_test 快得多，
# 后者各起一个一次性 PG 集群）。
addr_pg_file="apps/api-go/internal/platform/postgres/store_recommendation_address_integration_test.go"
for addr_pg_fn in TestStoreRecommendationAddressPostgresRoundTrip \
                  TestStoreRecommendationHalfCoordinateRefusedByDatabase; do
  if ! grep -q "func ${addr_pg_fn}(" "$addr_pg_file"; then
    echo "  FAIL [STORE-REC-ADDRESS-001]: $addr_pg_fn is missing from $addr_pg_file" >&2
    exit 1
  fi
done
addr_pg_re='^TestStoreRecommendation(AddressPostgresRoundTrip|HalfCoordinateRefusedByDatabase)$'
addr_pg_out=$(go -C apps/api-go test -count=1 -v -run "$addr_pg_re" ./internal/platform/postgres 2>&1)
addr_pg_rc=$?
if [ "$addr_pg_rc" -ne 0 ]; then
  printf '%s\n' "$addr_pg_out" | grep -E -- '--- FAIL|_test\.go:[0-9]+:' >&2
  echo "  FAIL [STORE-REC-ADDRESS-001]: the address/pin round-trip tests failed." >&2
  exit 1
fi
addr_pg_pass=$(printf '%s\n' "$addr_pg_out" | grep -c -- '^--- PASS' || true)
if [ "$addr_pg_pass" -ne 2 ]; then
  addr_pg_skip=$(printf '%s\n' "$addr_pg_out" | grep -c -- '^--- SKIP' || true)
  echo "  FAIL [STORE-REC-ADDRESS-001]: expected 2 passing PG tests, got $addr_pg_pass" >&2
  echo "        (skipped=$addr_pg_skip). A SKIP means the migration's CHECKs were" >&2
  echo "        never exercised -- the constraint is unproven, not proven." >&2
  exit 1
fi
if ! [ -f apps/api-go/migrations/130_store_recommendation_address.sql ]; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: migration 130 is gone, so the address and" >&2
  echo "        the map pin have nowhere to live." >&2
  exit 1
fi
if ! grep -qF 'ADD COLUMN IF NOT EXISTS latitude' apps/api-go/migrations/130_store_recommendation_address.sql; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the migration stopped adding the latitude" >&2
  echo "        column, so a map pin cannot be stored." >&2
  exit 1
fi
if ! grep -qF 'store_recommendations_coordinate_pair' apps/api-go/migrations/130_store_recommendation_address.sql; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the coordinate-pair constraint is gone. A row" >&2
  echo "        with a latitude but no longitude draws nothing on a map." >&2
  exit 1
fi
if ! grep -qF 'INVALID_RECOMMENDATION_LOCATION' apps/api-go/internal/storeonboarding/service.go; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the service no longer refuses a bad pin." >&2
  echo "        Silently storing half a coordinate is worse than rejecting it." >&2
  exit 1
fi
# 写进去了还得读回来：列表与详情两条读路径都要选这三列。
if ! grep -qF 'r.address, r.latitude, r.longitude' apps/api-go/internal/platform/postgres/storeonboarding.go; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the recommendation list query stopped" >&2
  echo "        selecting address/latitude/longitude, so operators cannot see them." >&2
  exit 1
fi
if ! grep -qF 'SELECT id, store_name, city, category, reason, address, latitude, longitude' apps/api-go/internal/platform/postgres/storeonboarding.go; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the single-recommendation query stopped" >&2
  echo "        selecting the address and the pin." >&2
  exit 1
fi
# NULL 是「没落点」的唯一哨兵。改成 float64 直扫会让 NULL 报错，或者让 0 变成
# 一个「恰好落在几内亚湾」的假落点。
if ! grep -qF 'var lat, lng sql.NullFloat64' apps/api-go/internal/platform/postgres/storeonboarding.go; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the NULL-safe scan is gone. NULL is the only" >&2
  echo "        correct 'no pin' -- (0,0) is a real coordinate in the Gulf of Guinea." >&2
  exit 1
fi
if ! [ -f apps/mobile/src/components/store-address-sheet.tsx ]; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the address picker sheet is gone, so iOS" >&2
  echo "        operators are back to guessing coordinates by hand." >&2
  exit 1
fi
if ! grep -qF 'disabled={!coord}' apps/mobile/src/components/store-address-sheet.tsx; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the address sheet no longer requires a pin" >&2
  echo "        before confirming, so it can save an empty location." >&2
  exit 1
fi
# 店没有服务半径。传 radiusMeters 会在地址面板上画出一个编出来的「覆盖 3 km」。
if grep -qF 'radiusMeters' apps/mobile/src/components/store-address-sheet.tsx; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the address sheet started passing radiusMeters." >&2
  echo "        A store has no service radius -- that circle would be fabricated." >&2
  exit 1
fi
if ! grep -qF 'export function recHasPin' apps/mobile/src/surfaces/store-recommendation-manage-model.ts; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: recHasPin is gone, so the UI can no longer" >&2
  echo "        tell a pinned recommendation from an unpinned one." >&2
  exit 1
fi
if ! grep -qF 'export function recMapsUrl' apps/mobile/src/surfaces/store-recommendation-manage-model.ts; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: recMapsUrl is gone, so a pinned store can no" >&2
  echo "        longer be opened on a map." >&2
  exit 1
fi
if ! grep -qF 'StoreAddressSheet' apps/mobile/src/surfaces/store-recommendation-manage.tsx; then
  echo "  FAIL [STORE-REC-ADDRESS-001]: the recommendation form stopped wiring the" >&2
  echo "        address picker, so there is no way to drop a pin anymore." >&2
  exit 1
fi
echo "    STORE-REC-ADDRESS-001: PASS (recommendations carry an address and a real map pin)"

# BENEFIT-ELIG-001: 资格门不能只是个装饰。
#
# EligibilityEngine 本身是对的，eligibility_test.go 也用真实信号把它测透了 ——
# 但 claim / redeem 两条调用路径**没喂信号**：TotalRedemptions 恒为 0，于是
# `0 >= N` 永不成立，「每人最多 N 次」这条规则从来没生效过。
# 更隐蔽的是 NewServiceWithClock 以前根本不接引擎（s.eligibility == nil），
# 而 `if s.eligibility != nil` 会让整道门被静默跳过 —— 所以**服务这条路径上的
# 资格门从来没被测过**，引擎的单测给了虚假的安全感。
#
# 本轮只修本地算得出的 TotalRedemptions。UserCity / AccountAge /
# DeviceCount / AccountCount 仍缺真实来源，对应规则依旧不生效 ——
# **不要用 0 冒充真实值**，那比留空更糟（min_account_age_days 会把所有人
# 判成 ACCOUNT_TOO_NEW，理由还是错的）。
#
# 钉死：①测试存在且走服务（不是只测引擎）；②测试用构造器必须接上默认引擎；
# ③两条调用路径都传了真实计数；④countRedemptions 还在。
require_test "BENEFIT-ELIG-001" "./internal/benefit" \
  "TestMaxRedemptionsIsEnforcedThroughTheService" \
  "apps/api-go/internal/benefit/service_test.go" || exit $?
if ! grep -qF 'eligibility: NewEligibilityEngine' apps/api-go/internal/benefit/service.go; then
  echo "  FAIL [BENEFIT-ELIG-001]: no constructor wires the eligibility engine," >&2
  echo "        so 'if s.eligibility != nil' silently skips the whole gate." >&2
  exit 1
fi
if [ "$(grep -c 'TotalRedemptions:' apps/api-go/internal/benefit/service.go)" -lt 2 ]; then
  echo "  FAIL [BENEFIT-ELIG-001]: the claim and redeem paths must both pass a real" >&2
  echo "        TotalRedemptions. Leaving it zero makes max_redemptions unenforceable." >&2
  exit 1
fi
if ! grep -qF 'func (s *Service) countRedemptions' apps/api-go/internal/benefit/service.go; then
  echo "  FAIL [BENEFIT-ELIG-001]: countRedemptions is gone, so the redemption cap" >&2
  echo "        has no real number behind it again." >&2
  exit 1
fi
echo "    BENEFIT-ELIG-001: PASS (redemption cap is really enforced, through the service)"

# BENEFIT-REDEEM-001: 核销方必须是这个活动的归属商家。
#
# p.MerchantID 由**调用方传入**，却被直接写进 Redemption，结算也据此进行。
# 缺了归属校验，任何商家扫到别人的券码都能把这笔核销记到自己名下 —— 钱也就结给了他。
# 与 business.createStore 的 BUSINESS_WRITE_REQUIRED 同一个口径：调用方声明的
# 身份必须被验证，不能只因为「他说他是」就算数。
#
# 钉死：①测试存在；②核销路径真的查了活动归属；③拒绝码还在。
require_test "BENEFIT-REDEEM-001" "./internal/benefit" \
  "TestRedeemRequiresTheCampaignOwner" \
  "apps/api-go/internal/benefit/service_test.go" || exit $?
if ! grep -qF 's.repo.GetCampaign(ctx, cl.CampaignID)' apps/api-go/internal/benefit/service.go; then
  echo "  FAIL [BENEFIT-REDEEM-001]: the redeem path no longer loads the campaign," >&2
  echo "        so a caller-supplied merchantId is trusted for settlement again." >&2
  exit 1
fi
if ! grep -qF 'MERCHANT_NOT_CAMPAIGN_OWNER' apps/api-go/internal/benefit/service.go; then
  echo "  FAIL [BENEFIT-REDEEM-001]: the ownership rejection code is gone." >&2
  exit 1
fi
echo "    BENEFIT-REDEEM-001: PASS (only the owning merchant can redeem; settlement cannot be hijacked)"

# SAFETY-GATE-001: safety 域的特权命令必须在 operator 门里。
#
# 全仓唯一的授权门就是 internal/api/security.go 的 operatorCommandTypes
# （command_dispatch.go:77 的 requiresOperator）。safety 域此前**一个都没进表**，
# 于是这些命令对任何已登录用户敞开：
#   - GrantJITAccess：granteeId + scope 全从 payload 来且无校验 → 自我签发任意权限（提权）
#   - CreateIncident：建 incident 之外还会**自动给目标打 ACCOUNT 封禁** → 冻掉任意账号
#   - CreateSafetyBlock / CreateOperatorCase / CreateLegalHold / ReleaseLegalHold：
#     封禁、运营工单、法务保全，天然是 moderaton 动作
#
# 钉死：①测试存在；②六个命令都在 operator 白名单里（逐个 grep，
# 只钉一个的话，少钉的那些照样可以悄悄被拿掉）。
#
# 注意用 `[[:space:]]*` 而不是字面一个空格：gofmt 会**按最长键对齐**这张 map 的值列，
# 于是实际写法是 `"GrantJITAccess":     true,`（5 个空格）。钉字面单空格会永远匹配不到
# —— 而且是在"门禁变红"的方向上错，很容易被误读成"有人把门拆了"。
# 更隐蔽的是：gofmt 的重排意味着**删掉任意一个条目都会改变别人的缩进**，
# 所以任何依赖固定空格数的钉都会随机变红。钉语义（键 + 值），别钉排版。
require_test "SAFETY-GATE-001" "./internal/api" \
  "TestSafetyPrivilegedCommandsRequireOperator" \
  "apps/api-go/internal/api/server_test.go" || exit $?
for cmd in GrantJITAccess CreateIncident CreateSafetyBlock CreateOperatorCase CreateLegalHold ReleaseLegalHold; do
  if ! grep -qE "\"$cmd\":[[:space:]]*true" apps/api-go/internal/api/security.go; then
    echo "  FAIL [SAFETY-GATE-001]: $cmd is no longer operator-gated, so any" >&2
    echo "        logged-in user can self-grant JIT scope or auto-block an account." >&2
    exit 1
  fi
done
echo "    SAFETY-GATE-001: PASS (safety privileges are operator-only; no self-grant, no drive-by account block)"

# BENEFIT-CAMPAIGN-001: 活动管理四条必须在 operator 门里。
#
# 与 SAFETY-GATE-001 同一个根因：benefit 域整域没进 operatorCommandTypes。
# 这四条把「活动归谁 / 配额给谁」放在 payload 里且不校验：
#   - CreateCampaign：ownerType + ownerId 来自 payload 只判非空 → 冒名建活动
#   - ActivateCampaign / PauseCampaign：只带 campaignId，不问归属 → 动别人的活动
#   - AllocateBenefit：distributorId 来自 payload → 把配额分给任意分销方
# 冒名活动一旦 Activate，真实用户领取核销时结算按 campaign.OwnerID 归属
# （BENEFIT-REDEEM-001 依赖它）→ 被冒名商家为别人造的活动买单。
#
# 钉死：①测试存在；②四条都在门里；③ClaimBenefit / RedeemBenefit **不在**门里
# （反向钉）—— 它们是真实用户动作，被顺手收紧就会把 BENEFIT-WIRE-001 刚接上的
# 权益链路重新锁死，而且这种「过度收紧」在门禁上是静默的：测试不会红，用户只是用不了。
require_test "BENEFIT-CAMPAIGN-001" "./internal/api" \
  "TestBenefitCampaignManagementRequiresOperator" \
  "apps/api-go/internal/api/server_test.go" || exit $?
for cmd in CreateCampaign ActivateCampaign PauseCampaign AllocateBenefit; do
  if ! grep -qE "\"$cmd\":[[:space:]]*true" apps/api-go/internal/api/security.go; then
    echo "  FAIL [BENEFIT-CAMPAIGN-001]: $cmd is no longer operator-gated, so any" >&2
    echo "        logged-in user can create a campaign in someone else's name," >&2
    echo "        activate it, and bill that merchant's settlement." >&2
    exit 1
  fi
done
for cmd in ClaimBenefit RedeemBenefit; do
  if grep -qE "\"$cmd\":[[:space:]]*true" apps/api-go/internal/api/security.go; then
    echo "  FAIL [BENEFIT-CAMPAIGN-001]: $cmd is operator-gated now, but it is a normal" >&2
    echo "        user action — gating it locks the benefit flow back out for everyone." >&2
    exit 1
  fi
done
echo "    BENEFIT-CAMPAIGN-001: PASS (campaign management is operator-only; claiming/redeeming stay open to users)"

# PROFILE-FROM-ANY-TAB-001: 动态页点「访问个人主页」必须真的能到主页。
#
# 洞的形状：openHumanProfile 的**写入方在 FEED**（feed.tsx 点头像 → 菜单
# 「访问个人主页」→ app-shell 的 onOpenProfile），但读它的分支此前只写在
# `tab === "HOME"` 里面。于是从动态进入时：状态被设了 → 重渲染 → 链子在
# `tab === "FEED"` 处就返回了 → **没有任何分支去读它** → 菜单一关屏幕纹丝不动。
# 用户看到的就是「点头像选访问个人主页没反应」。
# openAIProfile 是同一个洞的第二份：动态页 → 现实场景图 → 点 AI 账号时 tab 仍是 FEED。
#
# 注意这里钉的是**顺序**而不是「存在」：`<OtherProfileSurface` 一直都在这文件里，
# 只断言它存在的话，把它挪回 HOME 分支测试依然全绿 —— 那正是当初漏掉的原因。
pnpm --filter @proxy/mobile exec vitest run src/shell/app-shell.test.ts || exit $?
# 结构断言之外再钉一次顺序，这样即使有人把上面的测试文件改了也拦得住。
human_at=$(grep -n ') : openHumanProfile ? (' apps/mobile/src/shell/app-shell.tsx | head -1 | cut -d: -f1)
home_at=$(grep -n ') : tab === "HOME" ? (' apps/mobile/src/shell/app-shell.tsx | head -1 | cut -d: -f1)
if [ -z "$human_at" ] || [ -z "$home_at" ]; then
  echo "  FAIL [PROFILE-FROM-ANY-TAB-001]: 找不到个人主页分支或 HOME 分支（结构被改过）" >&2
  exit 1
fi
if [ "$human_at" -ge "$home_at" ]; then
  echo "  FAIL [PROFILE-FROM-ANY-TAB-001]: openHumanProfile 分支被挪到 tab 分支里面了" >&2
  echo "        （第 $human_at 行 vs HOME 分支第 $home_at 行）。" >&2
  echo "        它的写入方在动态页，挪进去会让「访问个人主页」静默失效。" >&2
  exit 1
fi
if ! grep -qF '!openAIProfile && !openHumanProfile' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [PROFILE-FROM-ANY-TAB-001]: 打开真人主页时没有收掉导航 chrome，" >&2
  echo "        用户切 tab 会被留在一个没人负责关闭的主页上。" >&2
  exit 1
fi
echo "    PROFILE-FROM-ANY-TAB-001: PASS (profile destinations sit above the tab branches; feed entry point reaches them)"

# SELF-FOLLOW-001: follow 缺了一道 unfollow 早就有的「自己人」门。
#
# 不对称：UnfollowProfile 有 CANNOT_UNFOLLOW_SELF，FollowProfile 没有任何自己人判断。
# 于是自关注是一条**永远删不掉**的行 —— follow 建了它，unfollow 又拒绝删除自己。
# 而 CountFollowers / CountFollowing 分别按 followee_id / follower_id 计数，
# 一次自关注会让自己的「粉丝」和「关注」各 +1，且没有任何 API 能回滚。
# 可达性：移动端「点头像 → + 关注」在本人帖子上就会走到这里（feed.tsx 的
# openProfileActions 没有 isOwnPost 判断），所以这不是一条够不着的路径。
require_test "SELF-FOLLOW-001" "./internal/engagement" \
  "TestFollow_CannotFollowSelf" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
require_test "SELF-FOLLOW-001" "./internal/engagement" \
  "TestFollow_SelfFollowLeavesCountsUntouched" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
# 结构断言：门必须还在源码里。上面两条测试已经会红，但这条能给出「哪里错了」的
# 直接提示（unfollow 还留着自己的门，不对称会回来）。
if ! grep -qF 'CANNOT_FOLLOW_SELF' apps/api-go/internal/engagement/service.go; then
  echo "  FAIL [SELF-FOLLOW-001]: follow 的自己人门被拿掉了；unfollow 还留着 CANNOT_UNFOLLOW_SELF，" >&2
  echo "        不对称会回来 —— 自关注将再次变成一条删不掉、且会给自己刷 +1 的行。" >&2
  exit 1
fi
echo "    SELF-FOLLOW-001: PASS (self-follow rejected; counts untouched; symmetric with unfollow)"

# UI 侧：本人帖子的头像菜单不该提供「关注」。移动端不能渲染 RN 组件
# （没有 testing-library / react-test-renderer），所以这里是源码级断言 ——
# 但断言的是「关注那一行被 isOwnAuthorId 挡住」这件事本身，不是「文件里有这个字符串」。
pnpm --filter @proxy/mobile exec vitest run src/feed-author.test.ts src/surfaces/feed-profile-actions.test.ts || exit $?
if ! grep -qF '!isOwnAuthorId(profileActions.userId, viewerAccountId)' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SELF-FOLLOW-001]: 本人帖子的头像菜单又把「关注」露出来了 ——" >&2
  echo "        后端会拒绝（CANNOT_FOLLOW_SELF），用户看到的是一个必然失败的操作。" >&2
  exit 1
fi
if ! grep -qF 'return isOwnAuthorId(post.authorId, viewerAccountId);' apps/mobile/src/feed-author.ts; then
  echo "  FAIL [SELF-FOLLOW-001]: isOwnPost 又开始自己比一遍了 ——" >&2
  echo "        「是不是我」必须只有一处定义（帖子用 authorId、主页菜单用 userId），" >&2
  echo "        两处各比一次正是当初漂移出「+ 关注」的原因。" >&2
  exit 1
fi
echo "    SELF-FOLLOW-001: PASS (UI 侧：本人帖子不显示关注，自己的主页入口仍可用)"

# OUTCOME-TEMPLATE-GATE-001: 观察模板的创建必须走 operator 门。
#
# 模板是**全局共享词汇表**：ObservationTemplate 没有 owner/scope 字段，而
# createTemplate 只校验 name 非空 —— 任何已登录用户都能往这张全局表里塞模板。
#
# 更硬的一层不是污染，而是**未授权用户能翻转全局状态**：CreateObservationSet 的
# 兼容门是 `if len(ListTemplates()) > 0 { 必须引用已存在的模板 }`，也就是
# 「有没有模板」本身就是一个全局开关。普通用户塞一个垃圾模板，就能把整个平台
# 踢出 bootstrap —— 之后**所有人**用历史模板 ID 建观察集都会被 TEMPLATE_NOT_FOUND
# 拒掉，而失败原因指向调用方，看起来像用户自己的错。
require_test "OUTCOME-TEMPLATE-GATE-001" "./internal/api" \
  "TestObservationTemplateCreationRequiresOperator" \
  "apps/api-go/internal/api/server_test.go" || exit $?
# 用 [[:space:]]* 而不是写死空格：gofmt 会按最长 key 重新填充整张表，
# 写死空格的钉会在一次无关的格式化后突然变红（SAFETY-GATE-001 踩过）。
if ! grep -qE '"CreateObservationTemplate":[[:space:]]*true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [OUTCOME-TEMPLATE-GATE-001]: CreateObservationTemplate 不在 operator 门里 ——" >&2
  echo "        任何已登录用户都能往全局模板表里塞东西，并翻转 bootstrap 开关。" >&2
  exit 1
fi
# 反向钉：读词表不该被顺手收紧。过度收紧在门禁上是**静默**的 ——
# 测试不会红，用户只是用不了。
for cmd in ListObservationTemplates GetObservationTemplate; do
  if grep -qE "\"$cmd\":[[:space:]]*true" apps/api-go/internal/api/security.go; then
    echo "  FAIL [OUTCOME-TEMPLATE-GATE-001]: $cmd 被收进 operator 门了 ——" >&2
    echo "        读一张运营维护的词表不构成越权，收紧只会让用户静默用不了。" >&2
    exit 1
  fi
done
echo "    OUTCOME-TEMPLATE-GATE-001: PASS (template creation is operator-only; reading the vocabulary stays open)"

# NOTIF-INBOX-GATE-001: inbox 写入必须走 operator 门。
#
# inbox 是平台自己说话的渠道。真正的生产者是 outbox worker（cmd/worker/main.go
# 的 businessInboxDelivery 用直连 SQL 写 notification.inbox_items，注释写着
# "bypass service to avoid auth"），写的是「订单已成立」「收到 Offer」这类系统通知。
# 而 SendInboxNotification 这条 HTTP 命令能往**任意用户**的 inbox 塞任意
# title/body/deepLink —— sendInbox 只校验非空，不问调用者是谁、收件人是谁。
# 任何已登录用户因此都能伪造一条平台通知，且落库后与系统通知同表同形。
require_test "NOTIF-INBOX-GATE-001" "./internal/api" \
  "TestInboxNotificationRequiresOperator" \
  "apps/api-go/internal/api/server_test.go" || exit $?
# 用 [[:space:]]* 而不是写死空格：gofmt 会按最长 key 重新填充整张表，
# 写死空格的钉会在一次无关的格式化后突然变红（SAFETY-GATE-001 踩过）。
if ! grep -qE '"SendInboxNotification":[[:space:]]*true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [NOTIF-INBOX-GATE-001]: SendInboxNotification 不在 operator 门里 ——" >&2
  echo "        任何已登录用户都能往任意用户的 inbox 塞伪造的平台通知（钓鱼/恐吓）。" >&2
  exit 1
fi
# 反向钉：读自己 inbox 的正常动作不该被顺手收紧。过度收紧在门禁上是**静默**的 ——
# 测试不会红，用户只是用不了。
for cmd in RegisterDeviceToken ListInbox MarkInboxRead ResolveDeepLink; do
  if grep -qE "\"$cmd\":[[:space:]]*true" apps/api-go/internal/api/security.go; then
    echo "  FAIL [NOTIF-INBOX-GATE-001]: $cmd 被收进 operator 门了 ——" >&2
    echo "        这是用户读自己 inbox 的正常动作，收紧只会让用户静默用不了。" >&2
    exit 1
  fi
done
echo "    NOTIF-INBOX-GATE-001: PASS (inbox writes are operator-only; reading your own inbox stays open)"

# LOCALNET-EVENTSTREAM-001: 跨用户读事件流必须走 operator 门。
#
# ListInteractionEvents 先取 payload 里的 actorId，只有它为空才回退到 e.Actor.ID
# （localnet/service.go:1909）—— 任何已登录用户传别人的 id 就能拿到那个人的交互
# 事件流。Postgres 侧的 WHERE 也只按这个入参过滤，没有第二道 scoping。
#
# 流里是行为轨迹：{eventType: PROFILE_OPEN|POST_IMPRESSION|CANDIDATE_VIEWED|
# AGENT_SHORTLISTED, targetId, needId} —— 即「某人某时刻看了谁的主页 / 哪条帖子 /
# 哪个候选人」，属于个人信息。同类先例：STORE-REC-002 的 ListStoreRecommendations
# 正是因为「含推荐人账号 id 与推荐理由，属于个人信息」而进门。
require_test "LOCALNET-EVENTSTREAM-001" "./internal/api" \
  "TestListInteractionEventsRequiresOperator" \
  "apps/api-go/internal/api/server_test.go" || exit $?
# 用 [[:space:]]* 而不是写死空格：gofmt 会按最长 key 重新填充整张表，
# 写死空格的钉会在一次无关的格式化后突然变红（SAFETY-GATE-001 踩过）。
if ! grep -qE '"ListInteractionEvents":[[:space:]]*true' apps/api-go/internal/api/security.go; then
  echo "  FAIL [LOCALNET-EVENTSTREAM-001]: ListInteractionEvents 不在 operator 门里 ——" >&2
  echo "        任何已登录用户传一个别人的 actorId，就能枚举那个人的行为轨迹。" >&2
  exit 1
fi
# 反向钉：帖子读不该被顺手收紧。ListFeedPosts 是公开只读（在 requiresAuthentication
# 豁免名单里），另两条是用户正常浏览；过度收紧在门禁上是**静默**的 ——
# 测试不会红，用户只是用不了。
for cmd in ListFeedPosts ListPostsByIds ListPostsMentioning; do
  if grep -qE "\"$cmd\":[[:space:]]*true" apps/api-go/internal/api/security.go; then
    echo "  FAIL [LOCALNET-EVENTSTREAM-001]: $cmd 被收进 operator 门了 ——" >&2
    echo "        这是用户正常浏览帖子的读，收紧只会让 App 静默坏掉。" >&2
    exit 1
  fi
done
echo "    LOCALNET-EVENTSTREAM-001: PASS (cross-user event-stream reads are operator-only; post browsing stays open)"

# PROFILE-QR-003: SCAN sheet 曾是假识别 —— 点一下就把写死的 PX-937201 填进搜索框，
# 假装扫到了人。现在走 parseScannedQr 真解析：三种失败说三句不同的话
# （读不到剪贴板 / 剪贴板是空的 / 不是 Proxy 名片），不是 Proxy 名片一律 fail-closed，
# 相机 / 相册 / 剪贴板共用同一处理器，不许静默吞掉。
#
# 钉接线，不钉调用拼写：钉死 `parseScannedQr(text)` 会在参数改名时对**合法**重构误报
# （相机接入后是 parseScannedQr(raw)），而这条钉真正要守的是「剪贴板内容必须经共用
# 处理器进真解析器」。参数名是实现细节，接线才是契约。
#
# PROFILE-QR-007（2026-09-16）：`src/profile-qr.test.ts` 已删除 —— 它是纯函数单测，
# 证明的是「这几行代码还在」，而这一轮改的是真机行为（相册选图、亮屏、名片格式）。
# 用户对此有明确口径：这类源码级单测没有意义。改由下面这几条**接线钉**接手：
# 解析器还在、三条入口都汇进 handleScannedCode、相册那条走标准入口 scanFromURLAsync。
if ! grep -q 'parseScannedQr' apps/mobile/src/profile-qr.ts ||
   ! grep -q 'buildContactCard' apps/mobile/src/profile-qr.ts ||
   ! grep -q 'handleScannedCode' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -qE 'parseScannedQr\(' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -qF 'await handleScannedCode(text)' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -qF 'await handleScannedCode(found[0]!)' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'scanFromURLAsync' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'PROFILE-QR-003' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PROFILE-QR-003]: scan-parse wiring or its tests are missing" >&2
  exit 1
fi
# 反向钉：码里必须是 vCard，不是链接。
# 注意**不能**拿域名当反向钉 —— `profile-qr.ts` 文件头的注释本来就要写明这段历史
# （写了才有人不去改回来），而 `grep -qF 'proxy.app'` 读的是原文，会在**正确**的树上误报。
# 所以钉编码路径独有的字面量：这三行只可能出现在 vCard 编码器里。
if ! grep -qF '"BEGIN:VCARD"' apps/mobile/src/profile-qr.ts ||
   ! grep -qF '"END:VCARD"' apps/mobile/src/profile-qr.ts ||
   ! grep -qF 'VERSION:3.0' apps/mobile/src/profile-qr.ts; then
  echo "  FAIL [PROFILE-QR-003]: the QR payload is no longer a vCard ——" >&2
  echo "        proxy.app is a parked domain for sale; the code must encode a vCard." >&2
  exit 1
fi
# 反向钉：三个出示码的地方（我的二维码 / 店铺卡 / 邀请卡）都不许再拼域名链接。
#
# 这三个文件里**一个字符都不许有**那个域名 —— 连解释「为什么删掉」的注释也不许写：
# gate 读的是原文，注释里写了就会在**正确**的树上误报（这个坑这次真的踩到了）。
# 完整的实测记录只写在 `profile-qr.ts` 文件头，那一个文件不在这条反向钉的范围内。
#
# 正向钉必须带 `(`：裸符号会被 `import { buildContactCard }` 那一行满足，
# 把真正的调用点换成硬编码字符串照样绿 —— 反向注入实测过，所以钉的是调用形状。
for qrsite in apps/mobile/src/surfaces/me.tsx \
              apps/mobile/src/surfaces/merchant-storefront.tsx \
              apps/mobile/src/surfaces/friend-crm.tsx; do
  if grep -qF 'proxy.app' "$qrsite"; then
    echo "  FAIL [PROFILE-QR-003]: $qrsite builds a QR payload from a domain again ——" >&2
    echo "        that domain is for sale on Spaceship; the code must encode a vCard." >&2
    exit 1
  fi
  if ! grep -qF 'buildContactCard(' "$qrsite"; then
    echo "  FAIL [PROFILE-QR-003]: $qrsite no longer builds its QR from a vCard" >&2
    exit 1
  fi
done
# 互斥锁必须是**活的**。scanBusyRef 之前只在关闭 sheet 时被置 false，从头到尾
# 没有一处置 true —— `if (scanBusyRef.current || scanned) return;` 的前半恒为假。
# 相机每帧都回调 onBarcodeScanned，而 `scanned` 是 state、要等一次渲染才生效，
# 同一 tick 里的后续帧全部穿过去，同一个人被查 N 次。锁不置位 = 锁不存在。
if ! grep -qF 'scanBusyRef.current = true;' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [PROFILE-QR-003]: scan re-entrancy lock is dead ——" >&2
  echo "        scanBusyRef is never set to true, so every camera frame re-runs the lookup." >&2
  exit 1
fi
# 反向钉：假演示不许回来。硬编码的演示号和假识别按钮一旦重现，用户扫到的
# 永远是同一个人 —— 这是**静默**的撒谎，测试不红但行为是假的。
if grep -q '模拟识别' apps/mobile/src/surfaces/friend-crm.tsx ||
   grep -q 'setProxySearch("PX-937201")' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [PROFILE-QR-003]: fake scan demo is back ——" >&2
  echo "        SCAN sheet must parse the real clipboard content, never fill a hardcoded demo id." >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts || exit $?
echo "    PROFILE-QR-003: PASS (real scan parse + distinct honest errors, fake demo stays dead)"

# HANDLE-UNIQUE-001: handle 的唯一性曾只写在 profile.go 的注释里
# （"uniqueness is per-tenant, enforced by repository on create"）。
# 039_profile.sql 建的是普通索引而非唯一索引，两个 repository 也都不查冲突，
# 而 initialProfileFor 从邮箱 local-part 派生 handle —— linh@gmail.com 与
# linh@outlook.com 必然同得 @linh。二维码/邀请链接就是 proxy.app/@linh，
# 客户端解析还按大小写不敏感，所以歧义意味着扫一个人的码可能加到另一个人。
require_test "HANDLE-UNIQUE-001" "./internal/identity" \
  "TestProfileHandleIsUniqueCaseInsensitively" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
require_test "HANDLE-UNIQUE-001" "./internal/identity" \
  "TestUpdateProfileRejectsTakenHandleWithItsOwnCode" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
require_test "HANDLE-UNIQUE-001" "./internal/identity" \
  "TestProvisionInitialProfileAvoidsTakenHandle" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?

# Postgres 侧不用 require_test：集成测试在临时集群起不来时会 SKIP，而
# `go test` 对 skip 返回 0 —— 门禁会绿着放行一条根本没跑过的钉。这里直接
# 要一行 "--- PASS"，SKIP 与 FAIL 一视同仁。
if ! go -C apps/api-go test -count=1 -run '^TestProfileHandleUniquenessIsEnforced$' -v ./internal/platform/postgres 2>&1 | grep -q -- "--- PASS: TestProfileHandleUniquenessIsEnforced"; then
  echo "  FAIL [HANDLE-UNIQUE-001]: the Postgres half did not actually run ——" >&2
  echo "        约束必须在 schema 里（raw INSERT 也要被挡），SKIP 等于没验证。" >&2
  exit 1
fi
echo "    HANDLE-UNIQUE-001: PASS (postgres: duplicate handle rejected by the index itself)"

# 反向钉：唯一索引不许被降级成普通索引 —— 降级后 Postgres 侧静默放行重复，
# 只有上面那条集成测试会红。
if ! grep -q 'CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_unique' apps/api-go/migrations/078_profile_handle_unique.sql; then
  echo "  FAIL [HANDLE-UNIQUE-001]: 唯一索引不见了或被降级 ——" >&2
  echo "        普通索引不挡重复，两个账号能同时拿到 @linh。" >&2
  exit 1
fi
# 反向钉：那句没有实现的声明不许回来。
if grep -q 'uniqueness is per-tenant' apps/api-go/internal/identity/profile.go; then
  echo "  FAIL [HANDLE-UNIQUE-001]: profile.go 又出现「uniqueness is per-tenant」这种没有实现支撑的声明" >&2
  exit 1
fi
echo "    HANDLE-UNIQUE-001: PASS (handle unique case-insensitively; registration resolves a free handle)"

# ADD-FRIEND-ENTRY-001: 整个 ADD_FRIEND 表面曾不可达 —— 一个建好却没有调用方的
# 通道。旧形态是 me.tsx 只在 subPage.route === "addfriend" 时渲染它，而全仓库
# 没有一处 setSubPage 到那个 route；当时的修法是在 friend-crm 的 LIST 视图里
# 加一个 setView("ADD_FRIEND") 按钮当入口。
#
# ADD-FRIEND-ENTRY-002 之后入口换了地方：那个按钮和消息模块顶栏扫码
# （MSG-SCAN-SHORTCUT-001）、首页点头像三个入口做同一件事，被摘掉了。
# 摘掉不等于通道没了 —— 现在由两处调用方以 initialView="ADD_FRIEND" 挂载进入：
#   - me.tsx:1706        我的 → 添加好友
#   - messages.tsx:394   顶栏扫码（MSG-SCAN-SHORTCUT-001）
# friend-crm.tsx 用 `const directEntry = initialView === "ADD_FRIEND";` 接住这条路径。
#
# 所以这条钉守住的是不变量本身 —— ADD_FRIEND 必须有调用方挂载，入口可以换，
# 不能没有。守住旧按钮形态会和 002 直接打架（它明令不许加回来）。
if ! grep -q 'initialView="ADD_FRIEND"' apps/mobile/src/surfaces/me.tsx ||
   ! grep -q 'initialView="ADD_FRIEND"' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'const directEntry = initialView === "ADD_FRIEND";' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'ADD-FRIEND-ENTRY-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [ADD-FRIEND-ENTRY-001]: 加好友入口断了 ——" >&2
  echo "        ADD_FRIEND 表面不可达：没有调用方以 initialView=\"ADD_FRIEND\" 挂载它。" >&2
  echo "        摘掉 LIST 里那个重复按钮（002）可以，但必须留下别的入口。" >&2
  exit 1
fi
echo "    ADD-FRIEND-ENTRY-001: PASS (me.tsx + messages.tsx mount ADD_FRIEND via initialView)"

# ADD-FRIEND-DEAD-BRANCH: me.tsx 里曾有两处 route === "friendcrm" —— line 848 的
# guard（在 `if (subPage)` 之前，无条件 return）和 `if (subPage)` 块内一份更旧的
# 残骸（少了 relationship / viewer / onOpenVouchers / profileClient）。848 无条件
# return，所以残骸永远走不到；但一旦 guard 被挪走或挪到后面，它就变成活代码 ——
# 渲染出一个连关系客户端都没接的表面，而且是静默降级。残骸已删除，这条钉防止
# 同路由的重复渲染分支再回来。
friendcrm_branches=$(grep -cE 'if \(subPage[^)]*route === "friendcrm"\)' apps/mobile/src/surfaces/me.tsx)
if [ "$friendcrm_branches" -ne 1 ]; then
  echo "  FAIL [ADD-FRIEND-DEAD-BRANCH]: friendcrm 渲染分支有 $friendcrm_branches 处，应为 1 ——" >&2
  echo "        重复的那处会被前面的 guard 遮蔽，guard 一挪就变成没接线的活代码。" >&2
  exit 1
fi
if ! grep -A1 -E 'if \(subPage[^)]*route === "friendcrm"\)' apps/mobile/src/surfaces/me.tsx | grep -qF 'profileClient={profileClient}'; then
  echo "  FAIL [ADD-FRIEND-DEAD-BRANCH]: 唯一那处 friendcrm 分支没接线 ——" >&2
  exit 1
fi
if ! grep -q 'ADD-FRIEND-DEAD-BRANCH' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [ADD-FRIEND-DEAD-BRANCH]: 测试不见了" >&2
  exit 1
fi
echo "    ADD-FRIEND-DEAD-BRANCH: PASS (exactly one friendcrm branch, and it is wired)"

# ADD-FRIEND-FROM-MESSAGES-001: 加好友表面住在 Me 模块，但 friend-crm 自己的返回
# 分支写着「当从 Messages 进入时…」—— 信息模块里从来没有这个入口，半截。
#
# 同一个 bug 还有第二面：me.tsx 以 initialView="ADD_FRIEND" 进这个表面，
# friend-crm 就从 initialView 猜返回标签，猜出来的目的地和 onBack 实际去向
# 不是同一个地方。标签必须由调用方给（addFriendBackLabel），不能猜。
#
# 所以这条钉两件事：(1) 信息 → 添加好友这条链路真的接上了（表面 → shell → Me）；
# (2) friend-crm 里不再出现任何写死的目的地文案。
#
# 2026-09-16 改线：添加好友不再跳「我的」—— 调用方传了 relationship，就在
# 消息模块内嵌 FriendCrmSurface（扫码/搜索/邀请全在本页）。门禁跟着改线：
# shell 必须透传 relationship，表面必须用调用方给的返回标签。
# 2026-09-19 再改线：MSG-SCAN-SHORTCUT-001 把「+」号方式选择页（邀请/通讯录/
# 社媒/搜索那一整页）从消息模块摘掉了 —— 有二维码就不需要到处都能申请加好友。
# 入口改名换形：onOpenAddFriend / setShowAddFriend 那一套没了，变成顶栏「扫码」
# 直接进相机（scanShortcut），内嵌的还是同一个 FriendCrmSurface。
# 这条钉守的不变量没变：信息模块必须能加好友 —— 入口可以换，不能没有。
if ! grep -qF 'const [scanShortcut, setScanShortcut] = useState(false);' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'accessibilityLabel="扫码"' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'onPress={() => setScanShortcut(true)}' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [ADD-FRIEND-FROM-MESSAGES-001]: 信息模块的加好友入口断了 ——" >&2
  echo "        顶栏「扫码」入口（MSG-SCAN-SHORTCUT-001）不在了：又只剩收件箱里的人，找不出还没聊过的人。" >&2
  exit 1
fi
if ! grep -qF 'relationship={relationship}' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF '<MessagesSurface' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF '<FriendCrmSurface' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'initialView="ADD_FRIEND"' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'addFriendBackLabel="‹ 返回"' apps/mobile/src/surfaces/messages.tsx ||
   # MSG-SCAN-SHORTCUT-001 改名：关闭这个表面现在是 setScanShortcut(false)
   # （原 setShowAddFriend(false)）。守的是「能退出去」，不是那个旧名字。
   ! grep -qF 'onBack={() => setScanShortcut(false)}' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [ADD-FRIEND-FROM-MESSAGES-001]: shell 没接这个入口 ——" >&2
  echo "        入口在、回调不在 = 点下去什么都不发生（或者停在信息页）。" >&2
  exit 1
fi
if ! grep -qF 'if (!requestedSubPage) return;' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'setSubPage(requestedSubPage);' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'onRequestedSubPageConsumed?.();' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ADD-FRIEND-FROM-MESSAGES-001]: Me 没消费跨模块请求 ——" >&2
  echo "        没有「请求 + 消费」，要么打不开，要么每次进「我的」都弹回添加好友。" >&2
  exit 1
fi
# 反向钉：写死的目的地文案不能回来。注意 friend-crm 里也不许在注释里提到它 ——
# 否则「删掉代码、留下解释」能让这条钉永远绿。
if grep -qF '‹ 返回消息' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [ADD-FRIEND-FROM-MESSAGES-001]: 返回标签又在替调用方猜目的地 ——" >&2
  echo "        friend-crm 不知道 onBack 通向哪里，标签只能由调用方传。" >&2
  exit 1
fi
if ! grep -qF 'addFriendBackLabel="‹ 返回我的"' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ADD-FRIEND-FROM-MESSAGES-001]: Me 入口没说明返回去向 ——" >&2
  echo "        onBack 回「我的」，标签就得写「返回我的」。" >&2
  exit 1
fi
if ! grep -q 'ADD-FRIEND-FROM-MESSAGES-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [ADD-FRIEND-FROM-MESSAGES-001]: 测试不见了" >&2
  exit 1
fi
echo "    ADD-FRIEND-FROM-MESSAGES-001: PASS (Messages reaches add-friend; the back label comes from the caller)"

# DEAD-PROP-001: 两个「声明了但没人读」的 prop。它们不是半截接线（有生产者、没消费者
# 才叫半截），是彻底的声明 —— 在仓库里只出现一次，就是它自己的类型声明。
#
# MessagesSurface 那个尤其值得记：app-shell 一直在传值，组件从来没读过。而且这不是
# 「忘了读」——它的词表（"CHAT"/"FRIENDS"）和本页的 panel 模型（对话/Convo/文件夹）
# 根本对不上，补线就得先编一套映射，那正是「组件替调用方猜目的地」的老毛病。所以删。
if grep -qF 'onOpenSearch' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [DEAD-PROP-001]: MeSurface 的空壳搜索 prop 回来了 ——" >&2
  echo "        要么入口和消费者一起接，要么别声明。" >&2
  exit 1
fi
if grep -qF 'initialTab' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [DEAD-PROP-001]: MessagesSurface 的初始 tab prop 回来了 ——" >&2
  echo "        它和本页的 panel 模型对不上，接了也不会生效。" >&2
  exit 1
fi
if grep -F 'MessagesSurface' apps/mobile/src/shell/app-shell.tsx | grep -qF 'initialTab'; then
  echo "  FAIL [DEAD-PROP-001]: shell 又在给 MessagesSurface 传初始 tab ——" >&2
  exit 1
fi
if ! grep -q 'DEAD-PROP-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [DEAD-PROP-001]: 测试不见了" >&2
  exit 1
fi
echo "    DEAD-PROP-001: PASS (no declared-but-unread props on the Me / Messages surfaces)"

# SEARCH-COPY-HONEST-001: 两处搜索文案声称的比代码做到的更多。
#
# 1) 信息页搜索框只匹配 `${name} ${preview}` —— 会话名 + 最近一条消息，
#    搜不到历史消息，但 placeholder 写「搜索聊天、联系人和消息」。
#    同一个文件里的联系人页早就写着「姓名或最近消息」，对齐它。
# 2) 首页搜索索引的注释把 people 分组说成「真实推荐人」「不造演示数据」，
#    而那份数据来自 SCENE_RECOMMEND fixture（没有真实 userId）。
#
# 这两条钉的都是**说法**，所以必须 grep 原文 —— 注释被剥掉就永远绿。
if grep -qF '搜索聊天、联系人和消息' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [SEARCH-COPY-HONEST-001]: 信息页搜索框又在承诺消息全文搜索 ——" >&2
  echo "        它只匹配会话名 + 最近一条消息。" >&2
  exit 1
fi
if ! grep -qF 'placeholder="搜索聊天名称和最近消息"' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [SEARCH-COPY-HONEST-001]: 信息页搜索框的精确文案不见了" >&2
  exit 1
fi
if ! grep -qF 'return `${it.name} ${it.preview}`.toLowerCase().includes(kw);' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [SEARCH-COPY-HONEST-001]: 搜索匹配器变了 ——" >&2
  echo "        改了匹配范围就要一起改文案，别让两者再次脱节。" >&2
  exit 1
fi
if grep -qF '不造演示数据' apps/mobile/src/surfaces/requester-home.tsx ||
   grep -qF '真实推荐人' apps/mobile/src/surfaces/requester-home.tsx; then
  echo "  FAIL [SEARCH-COPY-HONEST-001]: 首页搜索索引又在假装 people 分组是真数据 ——" >&2
  echo "        people 来自 SCENE_RECOMMEND fixture，没有真实 userId。" >&2
  exit 1
fi
if ! grep -qF 'ProfileClient.searchProfiles' apps/mobile/src/surfaces/requester-home.tsx; then
  echo "  FAIL [SEARCH-COPY-HONEST-001]: 首页搜索没写明全站人物搜索该走哪里" >&2
  exit 1
fi
if ! grep -q 'SEARCH-COPY-HONEST-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [SEARCH-COPY-HONEST-001]: 测试不见了" >&2
  exit 1
fi
echo "    SEARCH-COPY-HONEST-001: PASS (search copy matches what the code actually matches)"

# PROFILE-POSTS-FAILURE-001: 「我的」页拉动态失败时，两条路都失败的分支以前直接把
# 异常吞掉（catch 体是空的），profilePosts 留成 []，页面就渲染出「0 条动态」——
# 和「你还没发过动态」长得一模一样。这正是本仓反复强调的口径：空数据是答案，
# 拉取失败不是；两者不能长得一样。
#
# 同文件里关注数早就是 dash(n)（未知显示 —，不显示 0），所以这不是新发明，
# 是补上同一个口径。
if ! grep -qF 'setProfilePostsState("failed")' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-POSTS-FAILURE-001]: 动态拉取失败又不吭声了 ——" >&2
  echo "        失败会被渲染成「0 条动态」，看起来就是「你还没发过动态」。" >&2
  exit 1
fi
# PROFILE-POSTS-FAILURE-001 订正（2026-09-22）：原来把计数变量名也钉进去了
# （`… : profilePosts.length`）。在制的个人主页把 hub 的计数换成 personalHubPosts
# （排除 TARGETED 帖文）—— 契约本身没变，是变量名变了，所以这里钉**三元形状**：
# failed 必须映射成 undefined，冒号右边必须是某个集合的长度（不是字面量 0）。
if ! grep -qE 'posts: profilePostsState === "failed" \? undefined : [A-Za-z_$][A-Za-z0-9_$]*\.length' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-POSTS-FAILURE-001]: 失败时条数又显示成 0 ——" >&2
  echo "        未知要显示 —（dash 口径），不是 0。" >&2
  exit 1
fi
if ! grep -qF '不是你没有动态' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'setProfilePostsReload((n) => n + 1)' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'profilePostsReload]' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-POSTS-FAILURE-001]: 失败提示或重试不见了 ——" >&2
  echo "        重试必须真的能重跑 effect（reload 计数在依赖里）。" >&2
  exit 1
fi
# 反向钉：这个表面里不许再有「吞掉异常的空 catch」。注意 me.tsx 是基线敏感文件，
# 注释也要一起守规矩 —— 注释里写出那个 token 会让这条钉永远红。
if grep -qF 'catch {}' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-POSTS-FAILURE-001]: me.tsx 又出现吞掉异常的空 catch ——" >&2
  echo "        静默失败会把「没拉到」渲染成「没有」。" >&2
  exit 1
fi
if ! grep -q 'PROFILE-POSTS-FAILURE-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PROFILE-POSTS-FAILURE-001]: 测试不见了" >&2
  exit 1
fi
# 订正（2026-09-22 第二轮）：上面几条只钉到「条数别显示 0」和「横幅说出来了」。
# 但用户真正看的是**帖子列表本身** —— me.tsx 失败时传的是空数组，而空数组在
# ProfileTabs 里渲染成「还没有动态」。于是同一屏上横幅写着「不是你没有动态」、
# 下面写着「还没有动态」：一个说没拉到，一个说你没发过。空态才是那句话。
# SAVED/REPLIES/TAGGED 早就有 failed 旗标（PROFILE-TAB-LOAD-FAILED-001），
# POSTS 是当年漏掉的那一个。
if ! grep -qF 'postsFailed={profilePostsState === "failed"}' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [PROFILE-POSTS-FAILURE-001]: me.tsx 不再把失败态传给 ProfileTabs ——" >&2
  echo "        帖子列表拿不到失败信号，空态又会说「还没有动态」。" >&2
  exit 1
fi
# 两个空态（列表 + 网格）都要有失败文案，而且「真的没有」的文案必须还在 ——
# 只剩一句就说明又不分了。
#
# 注意这里钉的是 title="…" 这个 JSX 形态，不是裸字符串：上面那段说明文字里
# 就写着「还没有动态」，裸 grep 会匹配到注释 —— 把代码删掉、注释留着，测试
# 照样绿（本仓的老坑，PLACEHOLDER-011 栽过同一次）。
posts_failed_copy=$(grep -cF 'title="动态没读出来"' apps/mobile/src/surfaces/ProfileTabs.tsx)
if [ "$posts_failed_copy" -lt 2 ] ||
   ! grep -qF 'title="还没有动态"' apps/mobile/src/surfaces/ProfileTabs.tsx ||
   ! grep -qF 'title="还没有图片"' apps/mobile/src/surfaces/ProfileTabs.tsx; then
  echo "  FAIL [PROFILE-POSTS-FAILURE-001]: POSTS 空态又不分「没拉到」和「没有」了" >&2
  echo "        （title=\"动态没读出来\" $posts_failed_copy 处，需要 2 处；" >&2
  echo "        且 title=\"还没有动态\" / title=\"还没有图片\" 都要在）" >&2
  exit 1
fi
echo "    PROFILE-POSTS-FAILURE-001: PASS (a failed posts load says so; unknown shows —, not 0)"

# HANDLE-LOOKUP-001: 扫码识别出 @handle 之后必须真的问服务端「这是谁」。
# 旧行为只把 handle 塞进本机搜索框，而搜索结果是写死的 SEARCH_RESULTS ——
# 扫谁的码都返回同一批人，这是静默的撒谎。现在走 GetProfileByHandle
# （服务端按 lower(handle) 唯一解析），且四种结果分开：找到了 / 查无此人 /
# 请求失败 / 根本没接线。
require_test "HANDLE-LOOKUP-001" "./internal/identity" \
  "TestGetProfileByHandleResolvesExactlyOnePerson" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
if ! grep -q 'getProfileByHandle' apps/mobile/src/profile-client.ts ||
   ! grep -q 'await lookupScannedPerson(parsed)' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'profile_not_found' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'GetProfileByHandle' apps/api-go/internal/identity/service.go ||
   ! grep -q 'HANDLE-LOOKUP-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [HANDLE-LOOKUP-001]: handle 解析链路断了 ——" >&2
  exit 1
fi
# 反向钉：profileClient 必须挂在**可到达**的入口上。只断言「me.tsx 里有这个
# prop」是不够的 —— me.tsx 里还有一处 route === "friendcrm" 的重复分支不可达，
# 它带着 prop 会让门禁绿着放行一条断掉的活链路（反向注入时验证过这个坑）。
for anchor in 'if (subPage?.route === "friendcrm")' 'if (subPage.route === "addfriend")'; do
  if ! grep -A1 -F "$anchor" apps/mobile/src/surfaces/me.tsx | grep -qF 'profileClient={profileClient}'; then
    echo "  FAIL [HANDLE-LOOKUP-001]: 可到达的入口 $anchor 没拿到 profileClient ——" >&2
    echo "        扫码会停在「没接线」状态。" >&2
    exit 1
  fi
done
# 反向钉：不许退回「把 handle 塞进本机搜索框」。
if grep -q 'setProxySearch(scanned.handle)' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [HANDLE-LOOKUP-001]: 扫码又退回本机搜索框 ——" >&2
  echo "        SEARCH_RESULTS 是演示数据，扫谁的码都会返回同一批人。" >&2
  exit 1
fi
# 反向钉：没接线时不许静默停住，必须留下可分辨的 "no-client" 状态。
if ! grep -q '"no-client"' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [HANDLE-LOOKUP-001]: profileClient 缺失时静默停住了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts || exit $?
echo "    HANDLE-LOOKUP-001: PASS (scan resolves the handle server-side; four outcomes stay distinct)"

# PROFILE-SEARCH-001: 「搜索 Proxy」曾把写死的 SEARCH_RESULTS 显示给每一次查询 ——
# 搜什么都是同两个人，输入框纯装饰。服务端当时也**没有**任何搜索命令：Profile 只能
# 按 userAccountID（自己）或精确 handle 读，凡是不能精确说出 handle 的人都搜不到。
# 现在走服务端 SearchProfiles。
require_test "PROFILE-SEARCH-001" "./internal/identity" \
  "TestSearchProfilesFindsByHandleAndNameCaseInsensitively" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
require_test "PROFILE-SEARCH-001" "./internal/identity" \
  "TestSearchProfilesEmptyResultIsAnAnswerNotAnError" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
require_test "PROFILE-SEARCH-001" "./internal/identity" \
  "TestSearchProfilesRejectsQueriesTooShortToBeUseful" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
require_test "PROFILE-SEARCH-001" "./internal/identity" \
  "TestSearchProfilesIsAuthenticatedOnly" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?
require_test "PROFILE-SEARCH-001" "./internal/identity" \
  "TestSearchProfilesHonoursLimitAndOrdersByHandle" \
  "apps/api-go/internal/identity/profile_test.go" || exit $?

# Postgres 侧同样不用 require_test（集成测试 SKIP 时 go test 返回 0）。这条钉的是
# 谓词本身：写成 LIKE '%'||$1||'%' 就等于把手伸给调用方的通配符语法 —— "%%" 只有
# 两个字符、过得了长度校验，然后匹配**每一行**，一个请求拖走整张用户表。strpos 是
# 字面量匹配。内存实现用 strings.Contains，结构上不可能有这个 bug，所以只有
# Postgres 能证明它。
if ! go -C apps/api-go test -count=1 -run '^TestSearchProfilesIsLiteralNotWildcard$' -v ./internal/platform/postgres 2>&1 | grep -q -- "--- PASS: TestSearchProfilesIsLiteralNotWildcard"; then
  echo "  FAIL [PROFILE-SEARCH-001]: Postgres 谓词那半没真跑 ——" >&2
  echo "        通配符一旦被当模式解析，\"%%\" 就能拖走整张用户表。SKIP 等于没验证。" >&2
  exit 1
fi

# 反向钉：结果必须走 operationRef。parseCommandResult 在移动端按固定字段表构造
# CommandResult 并**丢掉 body**，所以只写 Body 的响应客户端读不到 —— 搜索会永远
# 看起来「什么都没找到」，而且不报错。
if ! grep -q 'result.operationRef' apps/mobile/src/profile-client.ts ||
   ! grep -q 'searchProfiles' apps/mobile/src/profile-client.ts; then
  echo "  FAIL [PROFILE-SEARCH-001]: 客户端读不到搜索结果 ——" >&2
  exit 1
fi
# 反向钉：站点级搜索能被用来枚举账号，必须要求登录。
if grep -q '"SearchProfiles"' apps/api-go/internal/api/command_dispatch.go; then
  echo "  FAIL [PROFILE-SEARCH-001]: SearchProfiles 被放进了公开白名单 ——" >&2
  echo "        匿名调用者可以借此枚举全站账号。" >&2
  exit 1
fi
# 反向钉：写死的演示结果不许回来。（不查 PX-482167 —— 那个 id 也合法地出现在
# CRM_FRIENDS 的演示好友行里，不是这套写死搜索结果的专属标记。）
if grep -q 'SEARCH_RESULTS' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [PROFILE-SEARCH-001]: 写死的演示搜索结果回来了 ——" >&2
  echo "        SEARCH_RESULTS 会让每次查询都返回同一批编造的人。" >&2
  exit 1
fi
# 反向钉：手机号搜索还没有授权开关撑着，UI 不许再声称能搜。
if grep -q '手机号只在对方允许被手机号搜索时可找到' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [PROFILE-SEARCH-001]: UI 又在声称能按手机号搜 ——" >&2
  echo "        Profile 没有手机号列，也没有「允许被手机号搜到」的开关。" >&2
  exit 1
fi
if ! grep -q 'PROFILE-SEARCH-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PROFILE-SEARCH-001]: 测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts || exit $?
echo "    PROFILE-SEARCH-001: PASS (site-wide search is a real server read; literal predicate, four honest states)"

# HOME-PEOPLE-SEARCH-001: 首页人名搜索只查本地推荐预览（fixture），新注册的
# 真人永远搜不到 —— 服务端 SearchProfiles 早就有了（PROFILE-SEARCH-001），
# 首页就是没接。现在够长（≥2 码点）且有 client 就问服务端，结果独立展示。
if ! grep -q 'shouldSearchServerPeople' apps/mobile/src/surfaces/requester-home.tsx ||
   ! grep -q 'profileClient.searchProfiles' apps/mobile/src/surfaces/requester-home.tsx ||
   ! grep -q 'profileClient={profile}' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [HOME-PEOPLE-SEARCH-001]: 首页人名搜索没接服务端 ——" >&2
  echo "        本地推荐预览里没有的人，在首页永远搜不到。" >&2
  exit 1
fi
if ! grep -q 'HOME-PEOPLE-SEARCH-001' apps/mobile/src/home-search-intent.test.ts ||
   ! grep -q 'HOME-PEOPLE-SEARCH-001' apps/mobile/src/requester-home-discovery-contract.test.ts; then
  echo "  FAIL [HOME-PEOPLE-SEARCH-001]: 触发判定或接线测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/home-search-intent.test.ts src/requester-home-discovery-contract.test.ts || exit $?
echo "    HOME-PEOPLE-SEARCH-001: PASS (home person search falls through to server profiles)"

# CONVO-LIST-001: 已退役（见 MSG-GROUPS-TAB-001）—— Convo 列表页已摘，
# myConvos 拉取/三态/重试整套跟着消失。listMyConvos 客户端方法保留
# （服务端契约），messages 表面不再调用，不再要求列表存在.

# CONTACT-SEARCH-COPY-001: 「新聊天」联系人页的副标题承诺了它那个搜索框做不到的事。
#
# 那张 sheet 的搜索框只匹配 `${c.name}${c.preview}` —— 姓名 + 最近一条消息；
# CONTACTS 由 visibleDialogs 映射而来，**没有 username**（同段注释写着
# 「不编造 username/在线状态/手机号」）。副标题却写「联系人 / Username」，
# 让用户在框里输 @handle 却永远搜不到。同一个框的 placeholder 早已是
# 「姓名或最近消息」。找没聊过的人走「添加好友」入口，不走这条搜索。
#
# 这条钉的是**界面文案**，所以必须 grep 原文 —— 用 stripComments 会把要钉的
# 那句话一起剥掉，断言永远绿。
if grep -qF '联系人 / Username' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [CONTACT-SEARCH-COPY-001]: 联系人页副标题又在承诺 Username 搜索 ——" >&2
  echo "        那个搜索框只匹配姓名 + 最近一条消息，CONTACTS 里没有 username。" >&2
  exit 1
fi
if ! grep -qF '联系人 · 姓名或最近消息' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [CONTACT-SEARCH-COPY-001]: 联系人页副标题的精确文案不见了" >&2
  exit 1
fi
if ! grep -qF '${c.name}${c.preview}' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [CONTACT-SEARCH-COPY-001]: 联系人页搜索匹配器变了 ——" >&2
  echo "        副标题里的「最近消息」就靠它兜着，改了要一起改文案。" >&2
  exit 1
fi
if ! grep -q 'CONTACT-SEARCH-COPY-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [CONTACT-SEARCH-COPY-001]: 测试不见了" >&2
  exit 1
fi
echo "    CONTACT-SEARCH-COPY-001: PASS (contacts-sheet subtitle matches what its search box actually matches)"

# ADD-FRIEND-PHONE-COPY-001: 加好友把「按手机号搜索」讲给用户，但后端没有这个能力，
# 也没有「允许被手机号搜到」的授权开关 —— friend-crm 的 SEARCH sheet 自己就写着
# 「手机号暂不可搜」。同一处能力却在两个地方被说成能搜手机号：
#   · friend-crm 的「添加方式」列表（用户真会看到的那一份）；
#   · me-sub-pages 的 addfriend 说明表。
#
# 关于那张说明表：addfriend 在 me.tsx 里**有**专属渲染分支，所以它的 sections
# 从来没有真的上过屏（meSubPage 也只投影 title/desc/icon，见 me-sub-pages.ts）。
# 表里装的是编造内容，已在 SUBPAGE-GENERIC-FABRICATED-001 里整表删除；因此
# 「表里必须有诚实说明」这一条改成条件式：表一旦被加回来就必须同时写清搜索
# 范围，否则照旧红。反方向（不许出现承诺手机号的那句）仍然无条件钉死。
# 这条钉的是**界面文案**，所以 grep 原文：注释里留一个同样的 token 会让它永远红。
if grep -qF '昵称、Proxy ID 或手机号' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [ADD-FRIEND-PHONE-COPY-001]: 加好友方式列表又在承诺手机号搜索 ——" >&2
  echo "        它打开的 SEARCH sheet 自己写着「手机号暂不可搜」。" >&2
  exit 1
fi
if grep -qF '昵称、Proxy ID、手机号' apps/mobile/src/surfaces/me-sub-pages.ts; then
  echo "  FAIL [ADD-FRIEND-PHONE-COPY-001]: addfriend 说明表又在承诺手机号搜索 ——" >&2
  exit 1
fi
if ! grep -qF '昵称或 Proxy ID' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -qF '手机号暂不可搜' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [ADD-FRIEND-PHONE-COPY-001]: 只报昵称与 Proxy ID 的文案，或 sheet 那句诚实说明，不见了" >&2
  exit 1
fi
ADDFRIEND_BLOCK=$(awk '/^  addfriend: \{/{f=1} f{print} f&&/^  \},$/{exit}' apps/mobile/src/surfaces/me-sub-pages.ts)
if printf '%s\n' "$ADDFRIEND_BLOCK" | grep -qF 'sections:'; then
  if ! printf '%s\n' "$ADDFRIEND_BLOCK" | grep -qF '昵称、Proxy ID'; then
    echo "  FAIL [ADD-FRIEND-PHONE-COPY-001]: addfriend 说明表回来了，却没写清搜索范围 ——" >&2
    exit 1
  fi
fi
if ! grep -q 'ADD-FRIEND-PHONE-COPY-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [ADD-FRIEND-PHONE-COPY-001]: 测试不见了" >&2
  exit 1
fi
echo "    ADD-FRIEND-PHONE-COPY-001: PASS (add-friend surface does not advertise a phone search that does not exist)"

# CONVO-OPEN-001: 已退役（见 MSG-GROUPS-TAB-001）—— 外部 Convo 列表页已摘，
# onOpenConvo 整条接线跟着消失。支线只在对话里长按消息创建（屏内 state），
# 不再要求外部接线存在.

# GROUP-CREATE-001: 群组从来就没真正建起来过 —— StartConversation 的参与者恒为
# {创建者, participantId} 两个，所以一个「GROUP」最多也就两个人。
#
# 更糟的是 conversationType 由客户端直接给、服务端从不校验，而
# DefaultProtectionFor 对 GROUP 给出**更弱**的保护（可转发 / 可复制 / 不警告截屏）。
# 两者合起来是一条降级通道：任何人都能把一条 1:1 对话声明成 GROUP，从而把对方
# 消息的保护降级。所以建群要真能建多人，同时把「两人 GROUP」这条路堵死。
require_test "GROUP-CREATE-001" "./internal/conversation" \
  "TestStartConversationCreatesGroupWithAllMembers" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
require_test "GROUP-CREATE-001" "./internal/conversation" \
  "TestStartConversationRejectsTwoPersonGroup" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
require_test "GROUP-CREATE-001" "./internal/conversation" \
  "TestStartConversationRejectsUnknownConversationType" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
require_test "GROUP-CREATE-001" "./internal/conversation" \
  "TestStartConversationRejectsTooManyParticipants" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
require_test "GROUP-CREATE-001" "./internal/conversation" \
  "TestStartConversationDedupesGroupParticipants" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
require_test "GROUP-CREATE-001" "./internal/conversation" \
  "TestStartConversationStillAcceptsLegacySingleParticipant" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
# 反向钉：参与者不许再写死成两个。不钉 "Participants:" 前缀 —— gofmt 会按最长 key
# 重新填充整张表，写死空格会在一次无关的格式化后突然变红（SAFETY-GATE-001 踩过）。
if grep -qF '[]string{e.Actor.ID, p.ParticipantID}' apps/api-go/internal/conversation/service.go; then
  echo "  FAIL [GROUP-CREATE-001]: 参与者又写死成 {创建者, participantId} 两个 ——" >&2
  echo "        那样建出来的「群组」永远只有两个人。" >&2
  exit 1
fi
for needle in maxGroupParticipants validConversationTypes resolveStartParticipants participantIds INVALID_CONVERSATION_TYPE GROUP_REQUIRES_MULTIPLE_PARTICIPANTS TOO_MANY_PARTICIPANTS; do
  if ! grep -qF "$needle" apps/api-go/internal/conversation/service.go; then
    echo "  FAIL [GROUP-CREATE-001]: $needle 不见了 ——" >&2
    echo "        人数上限 / 类型白名单 / 成员解析少一样，保护降级通道就回来了。" >&2
    exit 1
  fi
done
echo "    GROUP-CREATE-001: PASS (groups can hold more than two people; a two-person GROUP is rejected)"

# DEVICE-LOCATION-001: 移动几公里，「当前位置」不刷新。
#
# 根因不是"刷新失败"：app-shell 的「当前位置」只有两个来源，而且**都是静态的** ——
# 预设地点，或用户自己在地图上放的点（SecureStore 持久化），且只在挂载时读一次。
# expo-location 确实在 package.json 里也确实被 import 了，但既有三处用法
# （market.tsx / reality-scene-map.tsx / map-canvas.tsx）**全是按钮点一下取一次**
# 的 getCurrentPositionAsync —— 取完即弃，没有任何一处订阅设备移动。
# 所以人走出几公里，屏幕上还是挂载那一刻的地点：不是延迟，是没人听。
#
# 现成方案 = watchPositionAsync：移动时持续回调。distanceInterval 1000m +
# 低精度，对"移动几公里"正好，省电，也不碰需要服务端同意的精确定位那条线
# （/v1/location/consent 是另一条路，本模块不碰）。
# 同意 UI 就是 iOS 的「使用 App 期间」系统弹窗：拿到授权才订阅，拿不到停在
# permission_denied —— 不静默降级，也不拿旧坐标假装成功。
if ! grep -qF 'startDeviceLocationWatch({' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'expoLocationApi' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'makeDeviceLocation(next.latitude, next.longitude,' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [DEVICE-LOCATION-001]: app-shell 没订阅设备位置 ——" >&2
  echo "        不订阅，「当前位置」就只有预设/手动两个静态来源，走到哪都不刷新。" >&2
  exit 1
fi
# 手动选点必须让跟随让位 —— 否则下一次回调立刻把用户刚选的地点冲掉。
if ! grep -qF 'setFollowDevice(false);' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [DEVICE-LOCATION-001]: 手动选点后没关跟随 ——" >&2
  echo "        下一个定位回调会把用户刚选的地点冲掉，看起来像「选了没用」。" >&2
  exit 1
fi
# 上次保存的手动地点读完之前不许启动跟随，否则出现"先被设备覆盖、再被存档盖回"
# 的竞态（最终跟着一个 followDevice=true 的脏状态，下一次回调又吃掉存档）。
if ! grep -qF 'locationRestoreDone' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'if (!locationRestoreDone || !followDevice) return;' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [DEVICE-LOCATION-001]: 没等存档读完就启动跟随 ——" >&2
  echo "        存档和首个定位回调的先后不定，用户存过的地点会被随机冲掉。" >&2
  exit 1
fi
# 设备状态要一路传到顶栏和 picker —— 否则「没授权」「不可用」会显示成
# 「河内 · 还剑湖附近」，失败看起来跟成功一模一样。
# 必须传**两处**：顶栏 LocationContext 一处 + picker sheet 一处。
# 光钉"存在"是漏的 —— 这个 token 在 app-shell 里天然有两份，只给顶栏、
# 漏了 sheet 也能让"存在"成立，于是跟随开关消失、失败态无处显示。
DEVICE_STATE_PROPS=$(grep -cF 'deviceState={deviceLocationState}' apps/mobile/src/shell/app-shell.tsx)
if [ "$DEVICE_STATE_PROPS" -lt 2 ] ||
   ! grep -qF 'onFollowDevice={(next) => ' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -q 'setFollowDevice(next)' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'describeDeviceRow' apps/mobile/src/components/location-picker-sheet.tsx; then
   echo "  FAIL [DEVICE-LOCATION-001]: 设备定位状态没传到 UI ——" >&2
   echo "        顶栏和 picker 都收到才算接完；少一处，「未授权/定位中/不可用」就会显示得跟成功一样。" >&2
   exit 1
fi
# MSG-LOCATION-DUPE-001: 顶栏本地范围入口只许在 HOME 出现 —— MESSAGES 曾挂了
# 同一个 LocationContext（城市 + 切换 + 地图），消息页不需要地址入口。
# 把 `|| tab === "MESSAGES"` 加回来即红。
if grep -nF '(tab === "HOME" || tab === "MESSAGES")' apps/mobile/src/shell/app-shell.tsx >/dev/null 2>&1; then
  echo "  FAIL [MSG-LOCATION-DUPE-001]: location entry duplicated on messages — home keeps the single entry" >&2
  grep -nF '(tab === "HOME" || tab === "MESSAGES")' apps/mobile/src/shell/app-shell.tsx >&2
  exit 1
fi
if ! grep -nF '{isNavVisible && tab === "HOME" ? (' apps/mobile/src/shell/app-shell.tsx >/dev/null 2>&1; then
  echo "  FAIL [MSG-LOCATION-DUPE-001]: home location entry gate missing" >&2
  exit 1
fi
echo "    MSG-LOCATION-DUPE-001: PASS (location entry only on home)"
# 纯逻辑不许沾 native —— 沾了就再也进不了 vitest，这条钉自己也会失效。
if grep -qE 'from "(react-native|expo-location)"' apps/mobile/src/device-location.ts; then
  echo "  FAIL [DEVICE-LOCATION-001]: device-location.ts 直接 import 了 native 模块 ——" >&2
  echo "        一旦沾上 native runtime 就测不了，DEVICE-LOCATION-001 的测试会整块失效。" >&2
  exit 1
fi
# 反向钉：app-shell 不许直接 import expo-location —— 走适配器，别再加一处散装调用。
if grep -qF 'from "expo-location"' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [DEVICE-LOCATION-001]: app-shell 直接 import 了 expo-location ——" >&2
  echo "        走 device-location-native.ts 适配器，别再散一处权限流程。" >&2
  exit 1
fi
# 反向钉：不做后台定位。app.json 对用户的承诺是"不在后台获取"，
# UIBackgroundModes 里出现 location 就是说话不算话（也是审核风险）。
if grep -qE '^[[:space:]]*"location",?[[:space:]]*$' apps/mobile/app.json; then
  echo "  FAIL [DEVICE-LOCATION-001]: 开了后台定位 ——" >&2
  echo "        声明了"不在后台获取"却又注册 background location，是审核风险。">&2
  exit 1
fi
# 反向钉：权限文案不许再说"用一次位置" —— 现在是持续跟随，那句话是假的
# （Apple 会因为用途描述与实际行为不符拒审）。
if grep -qF '用一次位置' apps/mobile/app.json; then
  echo "  FAIL [DEVICE-LOCATION-001]: 定位用途文案还写着"用一次位置" ——" >&2
  echo "        实际是持续跟随，用途描述与行为不符会被拒审。" >&2
  exit 1
fi
if ! grep -q 'DEVICE-LOCATION-001' apps/mobile/src/device-location.test.ts ||
   ! grep -q 'DEVICE-LOCATION-001' apps/mobile/src/components/location-picker-sheet.test.ts; then
  echo "  FAIL [DEVICE-LOCATION-001]: 测试不见了" >&2
  exit 1
fi
echo "    DEVICE-LOCATION-001: PASS (location follows the device; denial/acquiring/failure render distinctly)"

# SCENE-ADDRESS-001: 场景有坐标没地址；Bắc Ninh 一个场景都没有。
#
# 用户问「Three Beans 这家店的地址有没有？在 maps 上显示了吗？」
#   · **地址：没有。** reality.scenes 只有 area（"Cầu Giấy" 这种区名）+ lat/lng。
#     地图 marker 的 description 拼的是「区 · 类型」—— 用户问"在哪条街"答不上来。
#     区名不是地址，拿它冒充就是假数据，所以 address 必须是独立字段。
#   · **maps：显示了，但只显示区名。** 场景地图（reality-scene-map）确实把每个
#     scene 画成 Marker；市场地图（market.tsx）根本不画 scene（它只画机会点和
#     硬编码的 3 个河内探索点）。
#   · **Bắc Ninh：空的。** launchScenes 里 9 条全是河内，Bắc Ninh 用户打开
#     nearby 一个场景都搜不到。
#
# 另有一个隐蔽半截接线：Scene 有自定义 MarshalJSON，结构体上加了字段**不会**
# 自动出现在接口 JSON 里。必须两处都改，否则 "Go 里有、客户端读不到"。
require_test "SCENE-ADDRESS-001" "./internal/realityscene" \
  "TestSceneCatalogCarriesStreetAddressDistinctFromArea" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-ADDRESS-001" "./internal/realityscene" \
  "TestSceneCatalogIncludesBacNinhVenue" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-ADDRESS-001" "./internal/realityscene" \
  "TestSceneAddressIsSerialized" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
# 地址是独立字段，不是 area 的别名。
# 查询里 address 要选**两处**：CTE 一次 + 外层 SELECT 一次。只钉"存在"是漏的 ——
# 这个片段在 listScenes 的 SQL 里天然有两份，删掉外层那一份照样能匹配到 CTE 的，
# 于是地址在 CTE 里算了、最终却没选出来（负向注入实测：删一份仍绿）。
# 用 -o 数**出现次数**而不是 grep -c（它数的是行数 —— 这两处在同一行 SQL 上，
# grep -c 永远返回 1，钉就形同虚设）。
# SCENE-CATEGORY-001 在 type 与 address 中间接了 category 列，针跟进去
# （`type,category,address,latitude`，命中结构和原来完全一致：CTE＋外层＋INSERT…）。
ADDRESS_SELECTS=$(grep -oF 'type,category,address,latitude' apps/api-go/internal/platform/postgres/reality_scene.go | wc -l | tr -d ' ')
if ! grep -qF 'ADD COLUMN IF NOT EXISTS address' apps/api-go/migrations/094_scene_address_bacninh.sql ||
   ! grep -qF '&s.Address' apps/api-go/internal/platform/postgres/reality_scene.go ||
   [ "$ADDRESS_SELECTS" -lt 2 ]; then
  echo "  FAIL [SCENE-ADDRESS-001]: 地址没接到底 ——" >&2
  echo "        迁移 / CTE / 外层 SELECT / Scan 少一处，接口就退回"只有区名"。" >&2
  exit 1
fi
# MarshalJSON 是接口真正的形状：结构体上有字段但这里没有 = Go 里有、客户端读不到。
if ! grep -qF 'json:"address,omitempty"' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-ADDRESS-001]: Scene.MarshalJSON 没输出 address ——" >&2
  echo "        Scene 有自定义 MarshalJSON，只改结构体字段不会进 JSON。" >&2
  exit 1
fi
# Bắc Ninh 那家店：id + 街道级地址都要在（地址是反查得到的，不是编的）。
#
# 2026-09-19：不再把街道名写进钉里。threebeans_bn 的地址在 2026-09-18 真机实测后
# 被更正过一次（Lê Văn Thịnh → 109 Lý Chiêu Hoàng，用户在店内上报定位），钉死街道
# 名只会让「改对了」也被判红。改成钉住形状：这一条目录项必须自带 Address，且是
# 街道级（带城市 `TP Bắc Ninh`），而不是拿 Area（"Bắc Ninh"）冒充 —— 后者正是
# 这条钉当初要治的病。
BN_ENTRY=$(grep -F '"threebeans_bn"' apps/api-go/internal/realityscene/service.go | head -1)
if ! grep -qF '"threebeans_bn"' apps/api-go/internal/realityscene/service.go ||
   ! printf '%s' "$BN_ENTRY" | grep -qF 'Address: "' ||
   ! printf '%s' "$BN_ENTRY" | grep -qF 'TP Bắc Ninh'; then
  echo "  FAIL [SCENE-ADDRESS-001]: Bắc Ninh 的 Three Beans 不在场景目录里 ——" >&2
  echo "        缺了它（或缺了它的街道级地址），Bắc Ninh 用户打开场景地图是空的。" >&2
  exit 1
fi
# 客户端：marker 的描述要走 sceneAddressLine（有地址用地址，没有退回区名+类型）。
if ! grep -qF 'sceneAddressLine(scene)' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -qF 'sceneAddressLine' apps/mobile/src/reality-scene-address.ts; then
  echo "  FAIL [SCENE-ADDRESS-001]: 地图 marker 没用地址行 ——" >&2
  echo "        拼回「区 · 类型」就等于这个字段白加。" >&2
  exit 1
fi
# 反向钉：marker 不许再写死"区 · 类型"。注释里不许出现下面这个 token ——
# raw grep 认全文，注释里留一份就能让这条钉永远红。
if grep -qF 'description={`${scene.area} · ${scene.type}`}' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-ADDRESS-001]: marker 描述又写死成区名+类型了 ——" >&2
  echo "        有地址也不显示，等于没加这个字段。" >&2
  exit 1
fi
if ! grep -q 'SCENE-ADDRESS-001' apps/mobile/src/reality-scene-address.test.ts; then
  echo "  FAIL [SCENE-ADDRESS-001]: 测试不见了" >&2
  exit 1
fi
echo "    SCENE-ADDRESS-001: PASS (scenes carry a street address; Bắc Ninh venue exists; marker shows it)"

# SCENE-DATA-ACCURACY-001: 场景数据要准，且不许静默漂移。
#
# 用户要求「核心必须要准确……而不是死数据」。两件具体的事：
#
# 1. **两个真相来源会静默漂移。** launchScenes()（内存仓库，没配 DATABASE_URL 时
#    走它）和 migrations 里 reality.scenes 的 seed（配了库走它）是同一份产品的两份
#    数据。一边加了店、另一边没加，本地和线上就是两个不同的场景目录，而且**不会
#    有任何东西报错** —— 数据不是被改坏的，是被忘记同步的。
# 2. **坐标要落在它声称的城市里。** 标着"Bắc Ninh"却落在河内（差 ~30 km），
#    地图上就会把 Bắc Ninh 的店画在河内。
require_test "SCENE-DATA-ACCURACY-001" "./internal/realityscene" \
  "TestSceneSeedMatchesMigrationSeed" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-DATA-ACCURACY-001" "./internal/realityscene" \
  "TestSceneCoordinatesMatchTheirArea" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
# 目录里要真的同时有「店」和「公共景点」两类，不是只有一家咖啡店。
if ! grep -qF '咖啡 · 动态场景' apps/api-go/internal/realityscene/service.go ||
   ! grep -qF '公共景点 · 湖边' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-DATA-ACCURACY-001]: 场景目录缺类别 ——" >&2
  echo "        目录要同时覆盖咖啡店和公共景点，只有一类就是"只有一家店"的老问题。" >&2
  exit 1
fi
# 还剑湖（用户点名要的公共景点）必须在。
# 注意：Go 里是双引号 ID: "hoankiem"，SQL 里才是单引号 —— 钉错引号会永久红。
if ! grep -qF 'ID: "hoankiem"' apps/api-go/internal/realityscene/service.go ||
   ! grep -qF "Hồ Hoàn Kiếm, Phường Hoàn Kiếm, Hà Nội" apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-DATA-ACCURACY-001]: 还剑湖不在场景目录里 ——" >&2
  echo "        用户点名要的公共景点，坐标/地址都以 OSM 为准。" >&2
  exit 1
fi
echo "    SCENE-DATA-ACCURACY-001: PASS (scene seed in sync, coordinates match their area, cafés + attractions present)"

# SCENE-REAL-COUNTS-001: 场景上的数字必须是真算出来的，不是写死的。
#
# 069 迁移里给每个场景写死了 posts / creators / activities / invites（312 / 118 / 26…）。
# 全仓**根本没有 post↔scene 的关联** —— 这些数没有任何真实来源。它们不显示，
# 却被拿去算 recommendation_score（"推荐度"），等于用编的数字给用户排序。
# 现在 saved / visited / planned 三个计数由 reality.user_scene_states 真聚合而来：
# 没人动过就是 0，有人收藏就 +1。
require_test "SCENE-REAL-COUNTS-001" "./internal/realityscene" \
  "TestSceneCountsAreDerivedFromUserStates" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-REAL-COUNTS-001" "./internal/realityscene" \
  "TestSceneRealCountsAreSerialized" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
# 排序不许再用那四个编的数。
if grep -qF 'ln(1+posts+2*creators+4*activities+2*invites)' apps/api-go/internal/platform/postgres/reality_scene.go; then
  echo "  FAIL [SCENE-REAL-COUNTS-001]: 推荐度还在用写死常数算 ——" >&2
  echo "        posts/creators/activities/invites 全仓没有真实来源，拿它们排序等于编造。" >&2
  exit 1
fi
if ! grep -qF 'json:"savedCount"' apps/api-go/internal/realityscene/service.go ||
   ! grep -qF 'sceneCountsLine(selected)' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-REAL-COUNTS-001]: 真实计数没接到 UI ——" >&2
  echo "        服务端算出来但没人显示 = 新的半截接线。" >&2
  exit 1
fi
echo "    SCENE-REAL-COUNTS-001: PASS (scene counts are aggregated from real user states, not seeded constants)"

# SCENE-NO-FABRICATED-001: 场景上不许再有**编出来的数字**。
#
# quality / posts / creators / activities / invites 五个整数是 069 迁移里手写死的
# 常数，没有任何真实来源：
#   · posts / creators / activities / invites —— 全仓根本没有 post↔scene 的关联，
#     这些数从哪来？答不上来。
#   · quality（84..96）—— 没有任何评分来源，85 和 96 差在哪说不出来。
# 它们大部分连 UI 都不显示，却被拿去算 recommendation_score（"推荐度"）——
# 等于用编的数字决定用户先看到谁。095 已经把五列 DROP 掉，这里钉住它们
# **不许回来**。
require_test "SCENE-NO-FABRICATED-001" "./internal/realityscene" \
  "TestSceneHasNoFabricatedNumbers" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-NO-FABRICATED-001" "./internal/realityscene" \
  "TestRecommendationScoreUsesOnlyRealSignals" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
# 客户端那句假信号的测试也得在（这是 vitest，require_test 只跑 go）。
if ! grep -qF 'describe("SCENE-NO-FABRICATED-001 sceneSignalLine"' apps/mobile/src/reality-scene-address.test.ts; then
  echo "  FAIL [SCENE-NO-FABRICATED-001]: sceneSignalLine 的测试不见了 ——" >&2
  echo "        「正在发生 / Scene Quality」就是从客户端这行文案冒出来的。" >&2
  exit 1
fi
# 1) 服务端：结构体、MarshalJSON、SQL SELECT 三处都不许再出现这些列。
#    三处都要钉 —— 结构体上有字段不代表进 JSON（Scene 有自定义 MarshalJSON）。
for needle in 'json:"quality"' 'json:"posts"' 'json:"creators"' 'json:"activities"' 'json:"invites"'; do
  if grep -qF "$needle" apps/api-go/internal/realityscene/service.go; then
    echo "  FAIL [SCENE-NO-FABRICATED-001]: Scene.MarshalJSON 里又出现 $needle ——" >&2
    echo "        这五个数字没有任何真实来源，拿它们算推荐度等于编造。" >&2
    exit 1
  fi
done
if grep -qF 'quality,best,posts,creators,activities,invites' apps/api-go/internal/platform/postgres/reality_scene.go; then
  echo "  FAIL [SCENE-NO-FABRICATED-001]: SQL 还在 SELECT 那五个已删除的列 ——" >&2
  echo "        095 已经 DROP 掉了，SELECT 会直接报错（列不存在）。" >&2
  exit 1
fi
# 2) 排序只能用真实信号：ln(1+ 真计数)，且**不许再掺** quality。
#    正向 + 反向都要钉：只钉正向的话，有人写 `quality*.55 + ln(1+...)`
#    照样能过（子串还在），反向钉才拦得住。
if ! grep -qF 'ln(1+COALESCE(tally.saved_count,0)' apps/api-go/internal/platform/postgres/reality_scene.go; then
  echo "  FAIL [SCENE-NO-FABRICATED-001]: SQL 推荐度不再由真实计数驱动 ——" >&2
  echo "        没人碰过的场景必须退回"按距离排"，不能靠写死的常数顶上去。" >&2
  exit 1
fi
if grep -qF 'quality*' apps/api-go/internal/platform/postgres/reality_scene.go; then
  echo "  FAIL [SCENE-NO-FABRICATED-001]: SQL 推荐度又掺进了 quality ——" >&2
  echo "        095 已经 DROP 了这一列，写一个不存在的列只会让查询报错；" >&2
  echo "        就算列还在，它也是没有来源的手写分数。" >&2
  exit 1
fi
# 3) 客户端：类型和文案都不许再有这些字段。
for needle in 'quality: number' 'posts: number' 'creators: number' 'activities: number' 'invites: number' 'Scene Quality' '正在发生'; do
  if grep -qF "$needle" apps/mobile/src/surfaces/reality-scene-map.tsx; then
    echo "  FAIL [SCENE-NO-FABRICATED-001]: 客户端又出现 $needle ——" >&2
    echo "        "正在发生" 读的是 seed 里的静态布尔值，跟此刻有没有人在现场无关。" >&2
    exit 1
  fi
done
# 4) 演示场所必须真的下架了（不是只从 Go 里删掉、SQL 里还活着）。
#    注意钉的是 **Go 目录**，SQL 里保留着 status='HIDDEN' 的历史行是有意的。
for dead in 'complex01' 'banana' 'bonsaidon' 'westlake'; do
  if grep -qF "ID: \"$dead\"" apps/api-go/internal/realityscene/service.go; then
    echo "  FAIL [SCENE-NO-FABRICATED-001]: 演示场景 $dead 又回到目录里了 ——" >&2
    echo "        它搜不到任何公开记录（complex01/banana/bonsaidon），或者不是一个点（westlake 是环湖路线）。" >&2
    exit 1
  fi
done
# 钉 `SET status='HIDDEN'` 而不是光钉 `status='HIDDEN'` —— 095 的**注释**里
# 也写着这个词，只钉后者的话，把 UPDATE 改成 status='ACTIVE' 都不会红。
# （这类"注释把反向钉永久顶住"的坑在本仓出现过不止一次。）
if ! grep -qF "SET status='HIDDEN'" apps/api-go/migrations/095_scene_catalog_real.sql; then
  echo "  FAIL [SCENE-NO-FABRICATED-001]: 095 迁移不再隐藏演示场所 ——" >&2
  echo "        从 Go 里删掉而 SQL 里还活着 = 本地和线上两个目录，又一处静默漂移。" >&2
  exit 1
fi
echo "    SCENE-NO-FABRICATED-001: PASS (no fabricated scene numbers; demo venues retired; ranking uses real signals only)"

# SCENE-CHECKIN-001: 「我在这里」—— 场景要能跟用户互动，不能是死数据。
#
# 收藏 / 去过 / 计划去都是**静态**的私人标记，写下去就不变；这一条是**会自己
# 过期**的现场声明，场景上第一次出现一个会变化的数字（hereCount）。
# 三件事一起钉，少一件它就变成新的假数据：
#   1. **会过期** —— 人走了数字自己掉下来。一个永不消失的"我在这里"会让场景
#      永远显示有人，正是我们要消灭的那种死数据；
#   2. **接得上** —— 命令进了 Supports() 才会被 dispatch 路由过来。本仓被
#      "建好了但没人调用"咬过很多次；
#   3. **只出聚合数** —— 不许带出"谁"在现场，也不许说"已核实本人在场"。
require_test "SCENE-CHECKIN-001" "./internal/realityscene" \
  "TestCheckInIsTimeBoxedAndCountedForReal" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-CHECKIN-001" "./internal/realityscene" \
  "TestCheckInIsReachableThroughCommand" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-CHECKIN-001" "./internal/realityscene" \
  "TestCheckInCountIsSerializedWithoutIdentity" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
# 命令必须进 Supports()：不进就是"命令存在但没人接"，等于功能不存在。
# 钉 `|| t == "…"` 这整个片段，不钉光秃秃的 `"SetRealitySceneCheckIn"` ——
# 后者在 `case "SetRealitySceneCheckIn":` 分派臂里也有，把命令从 Supports()
# 里删掉这个 pin 都不会红（"存在"不是 pin，多个出现点要数）。
if ! grep -qF '|| t == "SetRealitySceneCheckIn"' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-CHECKIN-001]: SetRealitySceneCheckIn 不在 Supports() 里 ——" >&2
  echo "        dispatch 永远不会把它路由过来，这是一根新的半截接线。" >&2
  exit 1
fi
# hereCount 必须真的进 JSON（Scene 有自定义 MarshalJSON，结构体加字段不算）。
if ! grep -qF 'json:"hereCount"' apps/api-go/internal/realityscene/service.go ||
   ! grep -qF 'reality.scene_checkins' apps/api-go/migrations/096_scene_checkin.sql; then
  echo "  FAIL [SCENE-CHECKIN-001]: hereCount 或 check-in 表没落地 ——" >&2
  echo "        服务端算了但客户端读不到 / 表不存在 = 半截接线。" >&2
  exit 1
fi
# 客户端必须真的发这个命令，而且不许把"声明"说成"已核实"。
if ! grep -qF '"SetRealitySceneCheckIn"' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -qF 'persistCheckIn(selected)' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-CHECKIN-001]: 客户端没有「我在这里」按钮 ——" >&2
  echo "        服务端支持但没有入口 = 用户根本用不到。" >&2
  exit 1
fi
# 真值边界：check-in 是**本人声明**，没有任何现场核销（订单/核销码/商家确认）。
if grep -qF '已核实' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-CHECKIN-001]: 客户端声称"已核实"本人在场 ——" >&2
  echo "        没有核销就不是核实，说了就是假证据。" >&2
  exit 1
fi
echo "    SCENE-CHECKIN-001: PASS (check-in is reachable, time-boxed, and exposes aggregate counts only)"

# SCENE-CONTRIB-001: 用户可以提交新场景，但**不能自己给自己背书**。
#
# 目录里的 11 条坐标是 OSM/Nominatim 查过的；用户提交的一条都没查过。把两种
# 数据混在一起还长得一模一样，就是重犯刚删掉的那五个假数字的错。所以：
#   · 提交进来是 PENDING，要 ≥2 个**除提交者以外**的人确认才进目录；
#   · 进目录时必须带 Source=COMMUNITY，客户端要标「社区提交 · 坐标未经核实」；
#   · 没有 source 字段的老数据按"来源未知"处理，不许静默当成已核实。
require_test "SCENE-CONTRIB-001" "./internal/realityscene" \
  "TestCommunityProposalNeedsOtherPeoplesConfirmation" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-CONTRIB-001" "./internal/realityscene" \
  "TestSceneSourceIsSerialized" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
# 命令必须进 Supports()，否则 dispatch 永远路由不到（半截接线）。
# 同样钉 `|| t == "…"` 而不是 bare `"ProposeRealityScene"` —— 后者在
# `case "ProposeRealityScene":` 里也出现，删掉 Supports() 里的这一项不会红。
if ! grep -qF '|| t == "ProposeRealityScene"' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-CONTRIB-001]: ProposeRealityScene 不在服务里 ——" >&2
  echo "        用户根本没有入口提交新场景。" >&2
  exit 1
fi
# source 必须进 JSON（Scene 有自定义 MarshalJSON，结构体加字段不算）。
if ! grep -qF 'json:"source"' apps/api-go/internal/realityscene/service.go ||
   ! grep -qF 'reality.scene_proposals' apps/api-go/migrations/097_scene_contribution.sql; then
  echo "  FAIL [SCENE-CONTRIB-001]: 来源标记或提案表没落地 ——" >&2
  echo "        没有来源标记，用户就分不清哪些坐标是查过的、哪些是别人随手点的。" >&2
  exit 1
fi
# 客户端提交入口暂撤（commander 重做社区提交 UI，管线不动）：移动端不再有
# ProposeRealityScene 调用，但来源后缀显示必须保留 —— 社区来源的店行照样标出。
if ! grep -qF '{sceneSourceSuffix(scene.source)}' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-CONTRIB-001]: 社区来源标记显示不见了 ——" >&2
  echo "        没有来源标记，用户就分不清哪些坐标是查过的、哪些是别人随手点的。" >&2
  exit 1
fi
echo "    SCENE-CONTRIB-001: PASS (community proposals need peer confirmation and stay labelled as unverified)"

# SCENE-ACTIVITY-LINK-001: 活动挂在"目录里查不到的场景"上，点了进不去。
#
# 为了删掉编出来的字段，场景目录把 bonsaidon / westlake 下架了
# (SCENE-NO-FABRICATED-001)。但 activity seed 里 5 条活动有 3 条指
# bonsaidon、2 条指 westlake —— 活动于是全部挂在已下架的场景上，而
# **没有任何测试变红**。PublishActivity 本来就强制要 realitySceneId，
# 所以这不是"没接线"，是"接线指向了一个已经不存在的东西"。
#
# 同一个 bug 的第二半是 people 字符串：它以前是写死在 payload 里的展示
# 文案，Join 只改 Joined，从来不碰 people —— 有人报名之后列表依旧写着
# "0 / 24 人"。同一个事实（已报名人数）两个来源，其中一个永远不更新，
# 这就是刚从场景字段里删掉的那类假数字。现在 people 由 Joined/Capacity
# 推导，没有名额的活动（capacity 0）不编数字、保留原文。
require_test "SCENE-ACTIVITY-LINK-001" "./internal/activity" \
  "TestSeededActivitiesPointAtRealScenes" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
require_test "SCENE-ACTIVITY-LINK-001" "./internal/activity" \
  "TestJoinUpdatesDisplayedPeopleCount" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
# 发布活动必须带 realitySceneId —— 没有场景的活动等于一个去不到的地方。
# 钉 `p.RealitySceneID == ""` 这个校验形式，而不是 bare "realitySceneId"。
if ! grep -qF 'p.RealitySceneID == ""' apps/api-go/internal/activity/service.go; then
  echo "  FAIL [SCENE-ACTIVITY-LINK-001]: PublishActivity 不再要求 realitySceneId ——" >&2
  echo "        活动没有场景 = 用户点进去不知道要去哪。" >&2
  exit 1
fi
echo "    SCENE-ACTIVITY-LINK-001: PASS (every activity points at a live scene; headcount is derived, not frozen)"

# SCENE-EVENT-SIGNUP-001: 场景详情只能"发起"活动，看不到、也报不上这里已有的活动。
#
# 场景详情原来只有三个**发布**动作（邀请真人 / 发布机会 / 发布活动）。用户面对
# 一个具体场景时只能喊话，看不到这个场景上已经有什么局、也没法报名 —— 这就是
# 用户说的"死数据"的另一半：内容是真的，但读不到、进不去。
#
# 修法是**复用**活动域（activity.activities + activity.participants，报名有
# 名额、有事务），不是再新造一套报名。所以这里钉两件事：
#   · 详情真的会拉这个场景的活动、真的有报名按钮；
#   · 报名走 ActivityClient，不许在场景面里手搓一条命令 —— 那会变成第二套
#     报名实现，两边计数各算各的（刚在 SCENE-ACTIVITY-LINK-001 修过一次）。
#
# 另外：列表「没有活动 / 取不到 / 没登录」必须是三种不同的说法。合并成一句
# 「暂无」，用户会以为这里真的没活动 —— 本仓的规矩是这几种状态不许长得一样。
if ! grep -qF 'new ActivityClient({ authClient, secureSessionStore })' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -qF 'loadSceneActivities(selectedId)' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -qF 'joinSceneActivity(item.activityId)' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-EVENT-SIGNUP-001]: 场景详情没接上活动列表或报名按钮 ——" >&2
  echo "        只能发布、看不到也报不上 = 活动对这个场景里的用户不存在。" >&2
  exit 1
fi
# 状态文案必须由专门的函数给（EMPTY / ERROR / SIGNED_OUT 三种不同说法），
# 不许在 JSX 里手写一句「暂无活动」把三种情况糊成一种。
if ! grep -qF 'sceneActivityFeedText(activityFeed)' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-EVENT-SIGNUP-001]: 活动列表的状态文案没走 sceneActivityFeedText ——" >&2
  echo "        「取不到」被说成「还没有活动」，用户会以为这地方真的没活动。" >&2
  exit 1
fi
# 不许在场景面里手搓报名命令 —— 那是第二套报名实现，两套计数会各算各的。
# （注释里故意不写那条命令的字面量：写了这条反向钉就永远红不了。）
if grep -qF '"JoinActivity"' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-EVENT-SIGNUP-001]: 场景面自己发起了报名命令 ——" >&2
  echo "        应该复用 ActivityClient，否则报名人数会有两套互不同步的算法。" >&2
  exit 1
fi
# 纯逻辑不许沾 native —— 沾了就再也进不了 vitest，这条钉自己也会失效。
if grep -qE 'from "react-native"' apps/mobile/src/scene-activities.ts; then
  echo "  FAIL [SCENE-EVENT-SIGNUP-001]: scene-activities.ts 沾了 react-native ——" >&2
  echo "        把纯逻辑搬出 tsx 就是为了能测，沾了 native 就白搬了。" >&2
  exit 1
fi
if ! grep -q 'SCENE-EVENT-SIGNUP-001' apps/mobile/src/scene-activities.test.ts; then
  echo "  FAIL [SCENE-EVENT-SIGNUP-001]: 场景活动逻辑没有命名测试 ——" >&2
  echo "        名额判定 / 场景归属 / 状态文案这三条会悄悄退化。" >&2
  exit 1
fi
echo "    SCENE-EVENT-SIGNUP-001: PASS (scene detail lists real events and signs up through the activity domain)"

# MARKET-R37-DETAIL-001: 点「我想接」之后进的订单详情，还是 R4 老样子。
#
# R37 那次改版（ee9b0f6，"implements the same visual on the live R4
# opportunity card"）只落地了两个组件：卡片 + 筛选 palette。点「我想接」
# 进的 `OpportunityDetail` 从来没动过 —— 卡片上是「标准订单类型 + 咖啡 +
# 拍照」，点进去变成英文 `OPPORTUNITY` kicker，视觉直接断掉，而且两套字号
# 尺度都不一样（卡片 6.4–15pt，详情 11–18pt）。
#
# 根因不是"没画好"，是**改版范围没覆盖用户点下去之后看到的那屏**。所以这里
# 钉的是"详情和卡片必须共用同一套类型视觉 + 同一张文案表"，不是钉某个像素。
# 详细断言在 apps/mobile/src/surfaces/r37-market-logo.test.ts。
if ! grep -q 'MARKET-R37-DETAIL-001' apps/mobile/src/surfaces/r37-market-logo.test.ts; then
  echo "  FAIL [MARKET-R37-DETAIL-001]: 订单详情的 R37 视觉没有命名测试 ——" >&2
  echo "        改版只改卡片不看下一屏，是最容易悄悄退化的那类漏改。" >&2
  exit 1
fi
# 详情头必须是批准的类型 logo。钉 `<MarketTypeLogo` 这个 JSX 形式而不是
# `MarketTypeLogo` —— 后者在 import 行里也有，删掉用法照样绿。
if ! grep -qF '<MarketTypeLogo' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-R37-DETAIL-001]: 订单详情没有用批准的类型 logo ——" >&2
  echo "        卡片有 logo、点进去没有 = 用户以为点错了订单。" >&2
  exit 1
fi
# 英文 kicker 不许回来。钉 `>OPPORTUNITY<`（JSX 文本节点）—— 单独钉
# "OPPORTUNITY" 会被 OPPORTUNITY_STATUS_FILTERS 之类的常量命中，永远绿。
if grep -qF '>OPPORTUNITY<' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-R37-DETAIL-001]: 订单详情又用回英文 OPPORTUNITY kicker ——" >&2
  echo "        R37 把它换成「标准订单类型 + 中文类型名」就是为了不再堆英文。" >&2
  exit 1
fi
# 卡片和详情共用一张文案表：否则改了卡片文案，详情又漂移回旧说法。
if ! grep -qF 'export const TYPE_LABEL' apps/mobile/src/surfaces/r37-opportunity-card.tsx ||
   ! grep -qF 'TYPE_LABEL[detailType]' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-R37-DETAIL-001]: 卡片和详情没有共用同一张类型文案表 ——" >&2
  echo "        两处各写一份 = 改一处就漂移，正是这次断掉的原因。" >&2
  exit 1
fi
echo "    MARKET-R37-DETAIL-001: PASS (order detail carries the approved type logo and shares the card's label table)"
# MARKET-QUOTE-SHEET-001: 详情页不再身兼"读订单 + 出价"两件事。
#
# 之前详情页底部塞了 4 格报价选择 (budget / standard / premium / custom) +
# 一个数字输入框 + "按我的条件回应"。这一坨挤在详情末尾, 用户得边读订单
# 边算金额, 而且 "参考区间 / 私密度声明 / 锚定说明" 都没地方放。Prototype
# 是把报价拆成独立一屏 "你的报价": 大号 K VND 输入 + 区间锚定 + 三个预设
# + 私密度声明。这里钉:
#   · 详情页真的把报价搬出去了 (sheet 渲染 + 状态机);
#   · 旧的"按我的条件回应"按钮和那 4 格选择不再回来;
#   · 详情页里编出来的数字 (通勤 `travel ?? 20` 在 null 时编 20 分钟, valueBox
#     的 "中等 / 68%" 没有任何来源) 不许静默复活。
if ! grep -q 'MARKET-QUOTE-SHEET-001' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 详情页没有标注报价已搬出 ——" >&2
  echo "        没有标注就意味着没人负责这块的契约, 容易在重构里悄悄回去。" >&2
  exit 1
fi
# sheet 真的接到了详情页, 不是写出来没人调用。`<OpportunityQuoteSheet` 这个
# JSX 形式, 单独 `OpportunityQuoteSheet` 也会被 import 行命中。
if ! grep -qF '<OpportunityQuoteSheet' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 详情页没有渲染报价 sheet ——" >&2
  echo "        sheet 写出来没人用 = 半截接线。" >&2
  exit 1
fi
if ! grep -qF 'setQuoteOpen' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 报价 sheet 没有开关状态 ——" >&2
  echo "        没法触发 = 按钮是死的。" >&2
  exit 1
fi
# 旧的"按我的条件回应"按钮不许回来。钉整段而不钉 "回应" —— "活动回应" /
# "申请回应" 也会命中, 太宽。
# 同时钉字面量 "报名报价" —— 详情页 CTA 必须是这个, 否则就是悄悄回到了 inline 报价。
if ! grep -qF '"报名报价"' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 详情页 CTA 不是「报名报价」 ——" >&2
  echo "        没有这个字面量说明详情页还在 inline 报价模式。" >&2
  exit 1
fi
if grep -qF '按我的条件回应' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 详情页又用回旧 CTA 「按我的条件回应」 ——" >&2
  echo "        旧 CTA 配套的是 inline 4 格报价 grid, 已经搬出。" >&2
  exit 1
fi
# 详情页 hero 不许再编通勤时间。`travel ?? 20` 是 null 时编 20 分钟。
if grep -qF 'travel ?? 20' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 详情页在 null 时编了 20 分钟通勤 ——" >&2
  echo "        travel 是 null 就是\"未知\", 写 20 是从 0 编出来的数字。" >&2
  exit 1
fi
# valueBox 的硬编码竞争力进度条 (68%) 没有任何服务端来源, 不许回来。
# 钉 `width: \"68%\"` 这个具体的 JSX 内联样式 —— 单独钉 "68%" 会命中其它字段,
# 单独钉 "中等" 会命中发布向导(那边也是同类假数据, 单独处理)。
if grep -qF 'width: "68%"' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 详情页又出现硬编码的竞争力进度条 (68%) ——" >&2
  echo "        服务端没返回这个评分, 渲染它等于把假数据展示给用户。" >&2
  exit 1
fi
# sheet 自己是独立的 (不是详情页 inline)。存在性是底线。
if [ ! -f apps/mobile/src/surfaces/opportunity-quote-sheet.tsx ]; then
  echo "  FAIL [MARKET-QUOTE-SHEET-001]: 报价 sheet 文件不在 ——" >&2
  echo "        详情页引用的 OpportunityQuoteSheet 找不到实现。" >&2
  exit 1
fi
echo "    MARKET-QUOTE-SHEET-001: PASS (quote lives in its own sheet; detail no longer fakes a travel time or a competitiveness score)"

# SCENE-MAP-LOCATION-001: 场景地图每次打开都回到河内默认（P0）。
#
# 面的 origin state 每次挂载都从 undefined 开始，只有点"定位"按钮才设值 ——
# 关掉再进，设备明明开着定位，地图却回到 21.036, 105.842。而壳里有活的设备
# 定位（DEVICE-LOCATION-001 的 tracking），就是没传进来。现在壳透传
# initialOrigin（tracking > 手选地点），面只在还没值时接，不抢手动定位。
if ! grep -q 'initialOrigin' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'prev ?? initialOrigin' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'sceneMapOrigin' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [SCENE-MAP-LOCATION-001]: 场景地图没接壳里的设备定位 ——" >&2
  echo "        关掉再进就回到河内默认，手机定位白开了。" >&2
  exit 1
fi
if ! grep -q 'SCENE-MAP-LOCATION-001' apps/mobile/src/surfaces/dynamic-scene-actions.test.ts; then
  echo "  FAIL [SCENE-MAP-LOCATION-001]: 接线测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/dynamic-scene-actions.test.ts || exit $?
echo "    SCENE-MAP-LOCATION-001: PASS (scene map opens on the phone location, not the Hanoi default)"

# MARKET-MAP-USER-CENTER-001: 市场地图初开摆河内硬编码/订单 centroid（P0）。
#
# 跟 SCENE-MAP-LOCATION-001 同一病：壳里有活的人位（sceneMapOrigin），
# 市场面就是不接，非要点一下“用我当前位置”。现在壳透传 userCenter，
# 面以人为先（晚到补飞，不抢手动点）；没人位才退回 centroid/河内。
if ! grep -q 'userCenter' apps/mobile/src/surfaces/market.tsx ||
   ! grep -q 'if (userCenter) {' apps/mobile/src/surfaces/market.tsx ||
   ! grep -q 'userCenter={sceneMapOrigin' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [MARKET-MAP-USER-CENTER-001]: 市场地图没接壳里的人位 ——" >&2
  echo "        初开就回到河内默认，手机定位白开了。" >&2
  exit 1
fi
if ! grep -q 'MARKET-MAP-USER-CENTER-001' apps/mobile/src/market-map-center.test.ts; then
  echo "  FAIL [MARKET-MAP-USER-CENTER-001]: 接线测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/market-map-center.test.ts || exit $?
echo "    MARKET-MAP-USER-CENTER-001: PASS (market map opens on the viewer, Hanoi stays the last resort)"

# MARKET-PIN-PARITY-001: 探索点钉挂 opacity=0.85，淡紫+半透明在活动页
# 看起来比实心订单钉小一圈。同一种原生图钉只许颜色区分语义。
if grep -n 'opacity={0.85}' apps/mobile/src/surfaces/market.tsx >/dev/null 2>&1; then
  echo "  FAIL [MARKET-PIN-PARITY-001]: explorer pins faded — align with order pins" >&2
  grep -n 'opacity={0.85}' apps/mobile/src/surfaces/market.tsx >&2
  exit 1
fi
if ! grep -q 'MARKET-PIN-PARITY-001' apps/mobile/src/market-pin-parity.test.ts; then
  echo "  FAIL [MARKET-PIN-PARITY-001]: 接线测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/market-pin-parity.test.ts || exit $?
echo "    MARKET-PIN-PARITY-001: PASS (explorer and order pins share one visual weight)"

# MARKET-LEGEND-PARITY-001: 订单/活动副标题长短不一，图例行换行不同，
# 整张地图卡一高一矮。锁死图例高度 + 副标题两行封顶。
if ! grep -q 'numberOfLines={2} style={styles.mapLegendSub}' apps/mobile/src/surfaces/market.tsx ||
   ! grep -q 'MARKET-LEGEND-PARITY-001' apps/mobile/src/market-legend-parity.test.ts; then
  echo "  FAIL [MARKET-LEGEND-PARITY-001]: legend height not locked — map cards differ per tab" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/market-legend-parity.test.ts || exit $?
echo "    MARKET-LEGEND-PARITY-001: PASS (legend fixed height, both tabs equal)"

# MAP-CONTAINER-PARITY-001: 三处地图容器各说各话（尺寸/圆角/边框/横向间隙），
# 定位/全屏/收起钮挂解释性文字，地图下面挂说明卡。统一到内联 330 + 圆角 22
# + 无横向间隙，按钮只留图标，地图下面只放地图。
if ! grep -q 'MAP-CONTAINER-PARITY-001' apps/mobile/src/map-container-parity.test.ts ||
   ! grep -q 'view === "MAP" || pageTab === "OPPORTUNITY" ? styles.contentFlat : null' apps/mobile/src/surfaces/market.tsx ||
   ! grep -q 'geoPrivacy' apps/mobile/src/map-container-parity.test.ts; then
  echo "  FAIL [MAP-CONTAINER-PARITY-001]: map containers diverged again" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/map-container-parity.test.ts || exit $?
echo "    MAP-CONTAINER-PARITY-001: PASS (one container language, no side gaps, icon-only buttons)"

# MAP-FULLSCREEN-001: 市场内联地图无全屏，详情进出重装原生地图顺带验证手势。
# MAP-CLUSTER-001: 图钉重叠点不了。两块断言都在上面的 parity 文件里跑，
# 这里只钉实现标记，防实现被删而测试被同步掏空。
if ! grep -q 'testID="market-map-expand"' apps/mobile/src/surfaces/market.tsx ||
   ! grep -q 'MAP-CLUSTER-001' apps/mobile/src/cluster-pins.ts ||
   ! grep -q 'MAP-CLUSTER-001' apps/mobile/src/cluster-pins.test.ts; then
  echo "  FAIL [MAP-FULLSCREEN-001/MAP-CLUSTER-001]: fullscreen or clustering went missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/cluster-pins.test.ts || exit $?
echo "    MAP-FULLSCREEN-001/MAP-CLUSTER-001: PASS (fullscreen shared instance, zoom-driven clusters)"

# OPP-REAL-COORDS-001: 订单钉只认从没人写的 coord，服务端真 lat/lng 被无视，
# 发布契约不开口，新订单永远无钉。显示优先真坐标，发布开 lat/lng 口。
if ! grep -q 'lat: z.number().min(-90).max(90).optional()' packages/contracts/src/index.ts ||
   ! grep -q 'OPP-REAL-COORDS-001' packages/contracts/src/market-opportunity.test.ts ||
   ! grep -q 'OPP-REAL-COORDS-001' apps/mobile/src/demand-moments.test.ts; then
  echo "  FAIL [OPP-REAL-COORDS-001]: real coordinates dropped from publish or display" >&2
  exit 1
fi
pnpm --filter @proxy/contracts test --run src/market-opportunity.test.ts || exit $?
require_test "OPP-REAL-COORDS-001" "./internal/marketplace" "TestOpportunityPublishPersistsCoordinates" "apps/api-go/internal/marketplace/service_test.go" || exit $?
echo "    OPP-REAL-COORDS-001: PASS (pins use server lat/lng, publish carries coordinates)"

# SCENE-FOOTPRINT-AUTO-001: 足迹只靠手点，订单完成/到场不沉淀。近场自动记
# （同一审计链）。SCENE-MAP-GESTURE-001: 详情整页替换重装地图，手势死亡；
# 改盖层常驻。断言在 parity 文件里跑，这里钉实现标记。
if ! grep -q 'autoFootprintDone' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'style={styles.detailOverlay}' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   grep -q 'if (selected) {' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-FOOTPRINT-AUTO-001/SCENE-MAP-GESTURE-001]: auto footprint or overlay gone" >&2
  exit 1
fi
echo "    SCENE-FOOTPRINT-AUTO-001/SCENE-MAP-GESTURE-001: PASS (proximity footprint, overlay detail)"

# DEVICE-LOCATION-002: 跟随开关冷启动必丢（P0）。
#
# 开关只活在内存（useState 默认 true），手动地点存在 keychain —— 每次冷启动
# 恢复流程读到存过的手动地点就 setFollowDevice(false)，用户点了"开启"也没用，
# 杀掉重进就回去，首页地址永远跟不上手机。现在开关和地点同一持久层，恢复读
# 开关、透传与手动选择都落盘。
if ! grep -q 'loadFollowDevice\|saveFollowDevice' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -q 'KEY_FOLLOW_DEVICE' apps/mobile/src/components/location-store.ts; then
  echo "  FAIL [DEVICE-LOCATION-002]: 跟随开关没持久化 ——" >&2
  echo "        冷启动恢复流程会把它打回 false，首页地址跟不上手机。" >&2
  exit 1
fi
if ! grep -q 'DEVICE-LOCATION-002' apps/mobile/src/components/location-store.test.ts ||
   ! grep -q 'DEVICE-LOCATION-002' apps/mobile/src/requester-home-discovery-contract.test.ts; then
  echo "  FAIL [DEVICE-LOCATION-002]: 开关持久化测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/components/location-store.test.ts || exit $?
echo "    DEVICE-LOCATION-002: PASS (follow toggle survives restarts next to the manual pin)"

# SCENE-COMPOSER-PREVIEW-001: Scene Composer 的「对方将看到」是一句**写死的样例**，
# 被当成用户刚填的内容展示给他自己看。
#
# 原句："West Lake Rooftop · 周六 16:00 · 3人已确认 · 饮品 included · 交通支持 — 你也会参加"
# 场景此刻还没创建（createScene 是点 CTA 才发），所以：
#   · "3人已确认" —— 一个人都没有，这个数字是从 0 编出来的；
#   · "West Lake Rooftop / 周六 16:00" —— 不是用户填的地点和时间，他选的是
#     tool / participation / cost 三个 chip；
#   · 整句不随选择变化，等于把一份样例当成预览。
# 现在预览由 meta.label + startsAt + participationLabel + costLabel 拼出来。
# 反向钉：那句编的样例不许回来。
if grep -qF 'West Lake Rooftop' apps/mobile/src/shell/app-shell.tsx ||
   grep -qF '3人已确认' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [SCENE-COMPOSER-PREVIEW-001]: 场景预览又变成写死的样例 ——" >&2
  echo "        「对方将看到」必须由用户刚选的 tool / 时间 / 参与方式 / 费用拼出来，" >&2
  echo "        不能报一个还没存在的确认人数。" >&2
  exit 1
fi
# 正向：预览真的读用户的选择，且和 createScene 用的是同一个起始时间。
if ! grep -qF 'const previewBody =' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'startsAt.toISOString()' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [SCENE-COMPOSER-PREVIEW-001]: 预览没有接到用户的选择上 ——" >&2
  echo "        预览和 createScene 必须用同一个 startsAt，否则两边说的不是一个场景。" >&2
  exit 1
fi
# 场景记忆那段不能承诺 App 做不到的事：RecordOutcome 在 App 里**没有调用方**
# （scene-client.recordOutcome 只有测试在用），所以「完成一次场景后会生成记忆」
# 是一句空头承诺 —— 和 SEARCH-COPY-HONEST-001 同一类。
if grep -qF '完成一次场景后会在此生成一条 Memory' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [SCENE-COMPOSER-PREVIEW-001]: 场景记忆在承诺 App 做不到的事 ——" >&2
  echo "        recordOutcome 没有调用方，场景无法被"完成"，记忆永远不会生成。" >&2
  exit 1
fi
echo "    SCENE-COMPOSER-PREVIEW-001: PASS (composer preview comes from the user's own choices)"

# MARKET-PUBLISH-ESTIMATE-001: 发布页在**替用户预测**一个没有来源的数字。
#
# 价格区下面那行写的是「预计 6–10 位合格回应 · 竞争力：中等」。机会此刻还没发布，
# 服务端没有「合格回应数」这个概念，也没有竞争力评分 —— 6–10 和「中等」都是字面
# 常量，任何价格、任何城市、任何时候都显示同一句。发布方会拿它当定价依据。
#
# 现在这行只说两件确定成立的事：金额（或「不公开」）会怎么展示给回应者，以及
# 「有多少人报名要等发布后才知道，这里不预估」。
# 反向钉 —— 那个预测常量和那个竞争力评级不许回来。
if grep -qF '预计 6–10 位合格回应' apps/mobile/src/surfaces/market.tsx ||
   grep -qF '竞争力：中等' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-PUBLISH-ESTIMATE-001]: 发布页又在预测回应人数/竞争力 ——" >&2
  echo "        机会还没发布，服务端没有「合格回应数」也没有竞争力评分。" >&2
  echo "        只说确定的事（金额怎么展示），报名人数留给发布后的真实数据。" >&2
  exit 1
fi
# 正向：这行必须随 moneyFlow 变（TBD 不能说「完整展示金额」），并且明确不预估。
#
# 钉子要钉在**这行独有**的字串上：只写 'moneyFlow === "TBD" ? "金额不公开' 会被
# 上一行已有的 {moneyFlow === "TBD" ? "金额不公开在卡片上" : "0₫"} 满足 —— 那行
# 是改动前就有的，删掉新分支它照样绿（实测过，确实绿）。带上「，由双方面谈确定」
# 才唯一指向新的这行。
if ! grep -qF '有多少人报名要等发布后才知道' apps/mobile/src/surfaces/market.tsx ||
   ! grep -qF '金额不公开，由双方面谈确定' apps/mobile/src/surfaces/market.tsx ||
   ! grep -qF '免费任务 · 完整展示给回应者' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-PUBLISH-ESTIMATE-001]: 发布页价格说明没接上 moneyFlow ——" >&2
  echo "        TBD 时金额不公开，这行就不能说「完整展示给回应者」。" >&2
  exit 1
fi
echo "    MARKET-PUBLISH-ESTIMATE-001: PASS (publish sheet states what is certain, predicts nothing)"

# SCENE-OPP-PRICE-001: 场景「公开任务」出口把**编出来的报酬写进了服务端**。
#
# 这个出口的 UI 里根本没有金额输入（只有 DIRECT_INVITE 才让用户填），但
# PublishMarketOpportunity 的 payload 里写死了 price "150,000₫" + moneyFlow EARN，
# 成功提示还回显「完成者可获得 150,000₫」。于是一个没人定价的机会带着一个
# 真实金额落库 —— 这不是显示层的假数字，是写进真源的假数据。
#
# 改成 moneyFlow TBD + price ""（服务端对 TBD 要求 Price 为空，见 marketplace
# service 的 moneyFlow 校验），提示改成「报酬由双方面谈确定」。
if grep -qF '150,000₫' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-OPP-PRICE-001]: 公开任务出口又带了写死的报酬 ——" >&2
  echo "        这个出口没有金额输入，写死金额会把没定价的机会写进服务端。" >&2
  echo "        走 moneyFlow TBD（金额双方面谈），不要替用户定价。" >&2
  exit 1
fi
if ! grep -qF 'moneyFlow: "TBD"' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -qF 'price: ""' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-OPP-PRICE-001]: TBD 必须带空金额 ——" >&2
  echo "        服务端对 moneyFlow=TBD 要求 Price 为空，两个必须成对出现。" >&2
  exit 1
fi
# 接线测试跟着改了口径，别只改源文本把钉子留在旧断言上。
if ! grep -q 'SCENE-OPP-PRICE-001' apps/mobile/src/surfaces/dynamic-scene-actions.test.ts; then
  echo "  FAIL [SCENE-OPP-PRICE-001]: 接线测试没有跟着改口径" >&2
  exit 1
fi
echo "    SCENE-OPP-PRICE-001: PASS (scene open-task publishes no invented compensation)"

# ENTERPRISE-FABRICATED-001: me.tsx 里三个「企业/经营」子页面整屏是编的。
#
# · trustedteam：两条写死的执行者档案（评分 / 合作次数 / 按时率），外加一句
#   「真实合作过 27 人 · 本周 11 人可用」和「推荐 4 人」。App 没有可靠执行者
#   接口，也没有合作次数、按时率字段。
# · multislot：5 条写死的名额行（含已分配到的人名）+「4 / 5 名额 · 80%」。
# · todayboard：名额 / 已到场 / 有风险三条统计 + 三条执行者行（含到场时刻与
#   预计到达分钟数）。到场与风险来自执行者真实上报，这个面读不到。
# · enterpriseops 的 Store Digitization Draft：三条写死的门店/权益行，含价格与
#   一个置信度百分比；抽取结果不随用户上传的素材变化，因为没有接模型调用。
#
# 入口卡片自己就写着「功能预览 · 实时数据待接入」，页身却在把编造的人名、评分和
# 百分比展示成真的。现在这些页落到明确的「尚未接入」态，Draft 只列真实素材。
if grep -qE '"4\.9"|"4\.8"|"94%"|"97%"|"96%"|真实合作过|17:46|329,000₫|599,000₫' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ENTERPRISE-FABRICATED-001]: 企业/经营页又出现编造的执行者或抽取结果 ——" >&2
  echo "        没有接口的页面必须落到「尚未接入」，不能编人名、评分和百分比。" >&2
  exit 1
fi
# 「4 / 5 名额 · 80%」里的 80% 单独钉（上面那条只覆盖带引号/百分号的写法）。
if grep -qF '名额 · 80%' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ENTERPRISE-FABRICATED-001]: 名额进度又是写死的百分比" >&2
  exit 1
fi
# 正向：三页各自说清楚自己缺什么，Draft 只列真实素材且标「待抽取」。
if ! grep -qF '这里还没有执行者' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF '名额尚未接入' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF '执行看板尚未接入' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF '待抽取' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ENTERPRISE-FABRICATED-001]: 未接入的页面没有说清自己缺什么 ——" >&2
  echo "        删掉假数据不能顺手把「为什么是空的」也删了。" >&2
  exit 1
fi
# 「发布线上店铺」原来只是把一个本地 state 翻成 PUBLISHED —— 什么都没发布，
# 却给出「查看已发布店铺」。线上店铺有真实面（merchantstorefront），直接跳过去，
# 让它自己按有没有商家身份说话。
if grep -qF '查看已发布店铺' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ENTERPRISE-FABRICATED-001]: 本地 state 又在冒充「已发布」 ——" >&2
  echo "        翻一个本地布尔不是发布。要跳就跳真实的线上店铺面。" >&2
  exit 1
fi
echo "    ENTERPRISE-FABRICATED-001: PASS (enterprise pages state what is missing instead of inventing it)"

# STATIC-COUNT-001: 两处**写死的条数**，紧跟的文案却说「不使用占位数据」。
#
# · merchant-me 的「平台通知」：标题写「未读通知：2 条」，正文下一句就是
#   「通知内容来自真实业务流，不使用占位数据」。2 是这个常量，不是真实未读。
# · FACET 内容库：「草稿 12 条 · 本地」「备选 5 条 · 待审核」，同一张卡片里的提示
#   已经写明「上传与审核在后续版本」—— 说明这两条数根本不该有。
if grep -qF '未读通知：2 条' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx; then
  echo "  FAIL [STATIC-COUNT-001]: 未读通知条数又是写死的常量 ——" >&2
  echo "        同一屏还写着「不使用占位数据」，2 条就是占位数据。" >&2
  exit 1
fi
if ! grep -qF '未读通知：暂无数据接入' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx; then
  echo "  FAIL [STATIC-COUNT-001]: 未读通知没有落到「暂无数据接入」" >&2
  exit 1
fi
if grep -qF '"12 条 · 本地"' apps/mobile/src/facet/FacetHomeSurface.tsx ||
   grep -qF '"5 条 · 待审核"' apps/mobile/src/facet/FacetHomeSurface.tsx; then
  echo "  FAIL [STATIC-COUNT-001]: FACET 内容库又在报写死的草稿/备选条数 ——" >&2
  echo "        同卡片已写明上传与审核在后续版本，这两个数没有来源。" >&2
  exit 1
fi
if ! grep -qF '— · 本地上传待后续版本' apps/mobile/src/facet/FacetHomeSurface.tsx ||
   ! grep -qF '— · 审核队列待后续版本' apps/mobile/src/facet/FacetHomeSurface.tsx; then
  echo '  FAIL [STATIC-COUNT-001]: FACET 草稿/备选没有落到 "—"' >&2
  exit 1
fi
echo "    STATIC-COUNT-001: PASS (hardcoded counts replaced by an honest no-data value)"

# DEVICE-LOCATION-003: 打开 App 不定位，首页地址半天不动。
#
# 冷启动只恢复旧地点，watch 的首个 fix 又要等距离/时间闸 —— 用户开着跟随，
# 杀掉重进，地址还是上次的。现在 mount 就定一次（跟随开着才定），拿不到就当
# 没发生（回退链照旧），不许编坐标。取 fix 的逻辑只许在 device-location.ts
# 里有一份，地图"定位"按钮复用它。
if ! grep -q 'getCurrentFix' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -q 'getCurrentFix(expoLocationApi' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [DEVICE-LOCATION-003]: 取 fix 又在各处手写 ——" >&2
  echo "        缓存秒回/GPS/超时三件必须只有一份实现。" >&2
  exit 1
fi
if grep -q 'getLastKnownPositionAsync().catch' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [DEVICE-LOCATION-003]: 地图里还有手写的取 fix 逻辑 ——" >&2
  echo "        改超时改两处就是这么漏的，统一走 getCurrentFix。" >&2
  exit 1
fi
if ! grep -q 'DEVICE-LOCATION-003' apps/mobile/src/device-location.test.ts; then
  echo "  FAIL [DEVICE-LOCATION-003]: 一次定位的命名测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/device-location.test.ts || exit $?
echo "    DEVICE-LOCATION-003: PASS (app open takes one fix; map reuses the same helper)"

# LOC-PIN-3KM-001: 拖 pin 一下飞出几十公里。
#
# pin 拖拽微调没有上限，手指一滑就飞出城，撤销只能重进。点选跳远地方不受限
# （全球选点是既有功能），只有拖拽按上次落点钳 3KM，超了明说并停在 3KM 处。
if ! grep -q 'clampToRadius' apps/mobile/src/components/location-picker-sheet.tsx ||
   ! grep -q 'MAX_MANUAL_TWEAK_METERS' apps/mobile/src/components/location-picker-sheet.tsx ||
   ! grep -q '"drag"' apps/mobile/src/components/map-canvas.tsx; then
  echo "  FAIL [LOC-PIN-3KM-001]: 拖拽钳制没接上 ——" >&2
  echo "        pin 一拖就飞，没有 3KM 上限。" >&2
  exit 1
fi
if ! grep -q 'LOC-PIN-3KM-001' apps/mobile/src/components/location-options.test.ts; then
  echo "  FAIL [LOC-PIN-3KM-001]: 钳制数学的命名测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/components/location-options.test.ts || exit $?
echo "    LOC-PIN-3KM-001: PASS (pin drags clamp to 3km; taps still jump anywhere)"

# LOC-SHARE-001: 选好的地址拿不走、跳不过去。
#
# 选点页的地址只能看：想发给朋友得手抄，想到 Google 地图导航得自己搜一遍。
# 现在地址行下面有复制 + Google 地图打开，复制的是屏幕上显示的那一行。
if ! grep -q '复制地址' apps/mobile/src/components/location-picker-sheet.tsx ||
   ! grep -q 'Google地图' apps/mobile/src/components/location-picker-sheet.tsx ||
   ! grep -q 'googleMapsUrl' apps/mobile/src/components/location-picker-sheet.tsx; then
  echo "  FAIL [LOC-SHARE-001]: 复制/地图打开没接上 ——" >&2
  echo "        选好的地址只能看不能用。" >&2
  exit 1
fi
if ! grep -q 'LOC-SHARE-001' apps/mobile/src/components/location-options.test.ts; then
  echo "  FAIL [LOC-SHARE-001]: 分享链接的命名测试不见了" >&2
  exit 1
fi
echo "    LOC-SHARE-001: PASS (picked address copies out and opens in Google Maps)"
# SUBPAGE-GENERIC-FABRICATED-001: 「我的 → 子页面」有两条渲染路径 —— 专属分支
# （`subPage.route === "xxx"`）与通用兜底分支。通用兜底把 SUB_PAGE_CONTENT[route]
# .sections 的每一行原样当用户自己的数据渲染（label 当标题、value 当正文），
# 没有 sections 才显示诚实空态。
#
# 所以「菜单可达 + 没有专属分支 + 带 sections」三者凑齐，用户点进一个还没做
# 出来的页面，看到的是一张编造的数据表。历史上真发生过两张：
#   · 成员与权限页 → 列出三个不存在的人，还给他们派了所有者/运营/账单权限；
#   · 商家结果历史页 → 列出一条不存在的复查趋势（三次分数一路走高）和结论。
# 两张表已删除，这两条路由现在落回空态。
#
# 这条钉三件事：编造内容不许回到数据文件；诚实空态不许消失；以及那条结构性
# 规则本身 —— 没有专属分支的路由不许配 sections（要展示就先把表面做出来）。
# 注释里不写那些被 grep 的原文：虽然本块 grep 的是数据文件而不是本脚本，
# 但保持同一个习惯，免得哪天改成 grep 本文件时自己把自己钉住。
MESUB=apps/mobile/src/surfaces/me-sub-pages.ts
METSX=apps/mobile/src/surfaces/me.tsx
for dead in 'Nguyen A' '检查 #001' '重复出现的问题' '已验证的改善' '英文菜单可用' '8,450,000' '满意度 4.6' 'Identity verified' 'Principal ACTIVE'; do
  if grep -qF "$dead" "$MESUB"; then
    echo "  FAIL [SUBPAGE-GENERIC-FABRICATED-001]: 编造的表格内容回到了子页面数据文件（$dead）——" >&2
    exit 1
  fi
done
if ! grep -qF '正在准备这个工作区' "$METSX"; then
  echo "  FAIL [SUBPAGE-GENERIC-FABRICATED-001]: 通用兜底的诚实空态不见了 ——" >&2
  exit 1
fi
DEDICATED=$(grep -oE 'subPage\.route === "[a-z]+"' "$METSX" | sed 's/subPage\.route === "//; s/"//' | sort -u)
MENU=$( { grep -oE 'openSubPage\("[a-z]+"\)' "$METSX" | sed 's/openSubPage("//; s/")//'; grep -oE 'route: "[a-z]+"' "$METSX" | sed 's/route: "//; s/"//'; } | sort -u )
for r in $MENU; do
  if printf '%s\n' "$DEDICATED" | grep -qx "$r"; then continue; fi
  BLK=$(awk -v k="  $r: {" 'index($0,k)==1{f=1} f{print} f&&/^  \},$/{exit}' "$MESUB")
  if printf '%s\n' "$BLK" | grep -qF 'sections:'; then
    echo "  FAIL [SUBPAGE-GENERIC-FABRICATED-001]: 路由 $r 没有专属渲染分支，它配的 sections 会被通用兜底当成用户数据上屏 ——" >&2
    exit 1
  fi
done
if ! grep -q 'SUBPAGE-GENERIC-FABRICATED-001' apps/mobile/src/surfaces/subpage-generic-fabricated.test.ts; then
  echo "  FAIL [SUBPAGE-GENERIC-FABRICATED-001]: 测试不见了" >&2
  exit 1
fi
echo "    SUBPAGE-GENERIC-FABRICATED-001: PASS (no generic sub-page renders an invented table)"


# CONVO-INBOX-SWALLOW-001: 收件箱加载失败不得显示成「还没有对话」（客户端不吞 + 屏幕有独立失败分支）
# 两层都要成立：
#   · conversation-client.listConversations() 读不出 payload 必须抛，不能吞成 []；
#   · messages.tsx 必须把「加载失败」和「真的没有会话」渲染成两句话。
# 只修一层等于没修：客户端抛了而屏幕仍显示「还没有对话」，用户看到的结果一样。
# ============================================================
  if ! grep -q 'CONVO-INBOX-SWALLOW-001' apps/mobile/src/conversation-client.ts; then
    echo "  FAIL [CONVO-INBOX-SWALLOW-001]: 客户端没有标注这个契约，判断口径无从追溯" >&2
    exit 1
  fi
  # 客户端：不许有吞异常的 catch。
  if grep -q 'catch { return \[\]; }' apps/mobile/src/conversation-client.ts; then
    echo "  FAIL [CONVO-INBOX-SWALLOW-001]: 收件箱把坏 payload 吞成了空列表 ——" >&2
    echo "        空列表和「真的没有会话」在 UI 上无法区分。" >&2
    exit 1
  fi
  # 三处坏 payload 都要抛（没有 ref / JSON 坏了 / 不是数组）。
  if [ "$(grep -c 'list conversations response malformed' apps/mobile/src/conversation-client.ts)" -lt 3 ]; then
    echo "  FAIL [CONVO-INBOX-SWALLOW-001]: 坏 payload 没有全部抛错（应为 3 处）" >&2
    exit 1
  fi
  # 屏幕：必须有独立的失败分支。
  if ! grep -q ') : inboxError ? (' apps/mobile/src/surfaces/messages.tsx; then
    echo "  FAIL [CONVO-INBOX-SWALLOW-001]: 收件箱没有独立的失败分支 ——" >&2
    echo "        加载失败会被渲染成「还没有对话」。" >&2
    exit 1
  fi
  if ! grep -q '会话列表没读出来' apps/mobile/src/surfaces/messages.tsx; then
    echo "  FAIL [CONVO-INBOX-SWALLOW-001]: 失败态文案不见了" >&2
    exit 1
  fi
  # 钉**那几条断言**，不是「文件里出现过这个 ID」。
  if ! grep -q 'a malformed inbox payload raises instead of looking empty' apps/mobile/src/conversation-client.test.ts; then
    echo "  FAIL [CONVO-INBOX-SWALLOW-001]: 行为测试不见了" >&2
    exit 1
  fi
  # 反向钉同在：修这个 bug 不能把「真的空收件箱」也变成错误。
  if ! grep -q 'a genuinely empty inbox is still an empty list, not an error' apps/mobile/src/conversation-client.test.ts; then
    echo "  FAIL [CONVO-INBOX-SWALLOW-001]: 空收件箱的反向钉不见了 ——" >&2
    echo "        不能为了修「失败像空」而把「空」也变成「失败」。" >&2
    exit 1
  fi
  echo "  PASS [CONVO-INBOX-SWALLOW-001]: a failed inbox load never reads as 'no conversations'"


# ENGAGEMENT-FALLBACK-EMPTY-001: 三个 engagement 读取方法不得把错误吞成空列表 + 计数 0。
# 危害不只是少显示：promise 永远 resolve，调用方没有机会知道失败了 —— 个人主页照常
# 渲染「还没有收藏／还没有回复」，用户以为自己的东西丢了；这也让
# PROFILE-TAB-LOAD-FAILED-001 的失败标记永远翻不起来（那一层的修会被这一层吃掉）。
# 同文件的 listMutedAuthors 一直就是这个口径：宁可抛，不假空。
  if ! grep -q 'ENGAGEMENT-FALLBACK-EMPTY-001' apps/mobile/src/engagement-client.ts; then
    echo "  FAIL [ENGAGEMENT-FALLBACK-EMPTY-001]: 客户端没有标注这个契约" >&2
    exit 1
  fi
  # 反向钉：三条静默兜底不许回来。
  for RET in 'return { ownerId, postIds: [], count: 0 };' 'return { userId, replies: [], count: 0 };' 'return { userId, bookmarks: [], count: 0 };'; do
    if grep -qF "$RET" apps/mobile/src/engagement-client.ts; then
      echo "  FAIL [ENGAGEMENT-FALLBACK-EMPTY-001]: 静默兜底回来了 —— $RET" >&2
      echo "        空列表 + 计数 0 会让调用方以为"加载成功、只是没有内容"。" >&2
      exit 1
    fi
  done
  # 正向：三个方法都要抛协议错（缺 operationRef 是以前会掉进 fallback 的那种响应）。
  for CMD in listPinnedPosts listUserReplies listUserBookmarks; do
    if ! grep -q "throw new EngagementProtocolError(\"$CMD response missing operationRef\")" apps/mobile/src/engagement-client.ts; then
      echo "  FAIL [ENGAGEMENT-FALLBACK-EMPTY-001]: $CMD 不再抛协议错" >&2
      exit 1
    fi
  done
  # 钉**那条断言**，不是「文件里出现过这个 ID」。
  if ! grep -q 'listUserBookmarks rejects instead of faking an empty list' apps/mobile/src/engagement-client.test.ts; then
    echo "  FAIL [ENGAGEMENT-FALLBACK-EMPTY-001]: 行为测试不见了" >&2
    exit 1
  fi
  echo "  PASS [ENGAGEMENT-FALLBACK-EMPTY-001]: engagement readers raise instead of faking an empty list"

# FACET-HERO-FABRICATED-001: facet 首屏 hero 的「已展示 N 条 / 新鲜素材 M 个」
# 不得是凭空写死的常量。
#
# Service.List 以前直接 return 两个字面量常量，跟库里任何一行数据都无关，还跟
# 同一屏里每个对象的 currentState（「已展示 N 条 · 本周新增 M 个素材」）矛盾
# —— 用户看到的是「全局 386 条」，点开每个人却都是「0 条 / 16 条」。
# 现在必须按对象 signals 累加：ObjectSignals 是本服务唯一的数据源。
  SVC=apps/api-go/internal/facet/service.go
  SVC_TEST=apps/api-go/internal/facet/service_test.go
  API_TEST=apps/api-go/internal/api/facet_test.go
  # 反向钉：那两个字面量常量不许再出现在 List 的返回里。
  # （注意：本块的注释刻意不复述这两个数字，否则 grep 会被自己的注释骗绿。）
  if grep -qE 'FreshAssets:[[:space:]]*[0-9]+' "$SVC"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: List 又直接返回了 freshAssets 字面量" >&2
    exit 1
  fi
  if grep -qE 'ShownAssets:[[:space:]]*[0-9]+' "$SVC"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: List 又直接返回了 shownAssets 字面量" >&2
    exit 1
  fi
  # 正向：必须把累加出来的变量写进 Payload。
  if ! grep -q 'FreshAssets: heroFresh' "$SVC"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: hero freshAssets 没有用累加值" >&2
    exit 1
  fi
  if ! grep -q 'ShownAssets: heroShown' "$SVC"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: hero shownAssets 没有用累加值" >&2
    exit 1
  fi
  # 正向：累加必须来自对象 signals（唯一数据源），不是别的常量。
  if ! grep -q 'heroFresh += obj.Signals.FreshAssetCount' "$SVC"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: freshAssets 不从对象 signals 累加" >&2
    exit 1
  fi
  if ! grep -q 'heroShown += obj.Signals.ShownAssetCount' "$SVC"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: shownAssets 不从对象 signals 累加" >&2
    exit 1
  fi
  # 钉**断言本身**，不是「文件里出现过这个 ID」。
  if ! grep -q 'TestFacetService_HeroStatsAreSumOfObjectSignals' "$SVC_TEST"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: hero = signals 之和的行为测试不见了" >&2
    exit 1
  fi
  # 反 hardcode 的核心钉子：换 signals 必须换 hero。常量实现会卡死在这里。
  if ! grep -q 'TestFacetService_HeroStatsTrackSignals' "$SVC_TEST"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: 「换 signals 必须换 hero」的钉子不见了 ——" >&2
    echo "        没有这条，常量实现可以悄悄回来而不被拦住。" >&2
    exit 1
  fi
  # 反向钉：不许为了去掉假数字而反过来断言「hero 必须 > 0」（那等于把种子数字钉成契约）。
  if grep -q 'freshAssets > 0 && shownAssets > 0' "$API_TEST"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: HTTP 层又把「hero 必须 > 0」钉成了契约 ——" >&2
    echo "        这会让没有数据源时无法如实返回 0。" >&2
    exit 1
  fi
  # 正向：HTTP 层只要求非负（跟 contracts 的 z.number().int().nonnegative() 一致）。
  if ! grep -q 'hero stats must be non-negative' "$API_TEST"; then
    echo "  FAIL [FACET-HERO-FABRICATED-001]: HTTP 层的非负断言不见了" >&2
    exit 1
  fi
  echo "  PASS [FACET-HERO-FABRICATED-001]: facet hero stats are summed from object signals"


# MARKET-FAKE-JUDGMENT-001: 市场不得编造「匹配度」与「已验证」。
# 服务端发布路径以前无条件写 p.Match="100%" 和 p.Verified=true —— 平台没有匹配引擎，
# 也没有对个人发布者的核验流程。客户端据此渲染「N% 匹配」标签 / 「发布方已验证」勾，
# 外加一整盒写死的 AI 结论（是否值得接 / 出价下限）。
# 服务端行为由 Go 测试钉住；这个块钉的是：服务端的常量不许回来 + 展示侧不许再造句。
  G=apps/api-go/internal/marketplace/service.go
  # 服务端：不许再无条件给匹配度 / 已验证。
  if grep -q 'p.Match = "100%"' "$G"; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 发布又写死了匹配度 —— 平台没有匹配引擎" >&2
    exit 1
  fi
  if ! grep -q 'p.Match = ""' "$G"; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 发布没有把匹配度留空" >&2
    exit 1
  fi
  if ! grep -q 'p.Verified = false' "$G"; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 发布默认仍然标记已验证 ——" >&2
    echo "        平台对个人发布者没有核验流程，那个勾是编的。" >&2
    exit 1
  fi
  # 已验证必须只在商家成员资格验过时打开（merchantStamp 分支里）。
  if [ "$(grep -c 'p.Verified = true' "$G")" -lt 1 ]; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 验过成员资格的商家也没拿到已验证标记" >&2
    exit 1
  fi
  # 钉**那两条 Go 断言**，不是「文件里出现过这个 ID」。
  if ! grep -q 'TestPublishDoesNotFabricateMatchOrVerification' apps/api-go/internal/marketplace/service_test.go; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 服务端行为测试不见了" >&2
    exit 1
  fi
  if ! grep -q 'TestPublishMarksVerifiedOnlyWithMerchantMembership' apps/api-go/internal/marketplace/service_test.go; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 商家成员资格的反向钉不见了 ——" >&2
    echo "        不能为了去掉假勾而让真验过的商家也失去标记。" >&2
    exit 1
  fi
  # 展示侧：卡片不许把"没算过"显示成 0%；详情页不许再拿匹配度造句。
  if grep -q 'opportunity.match ?? "0%"' apps/mobile/src/surfaces/r37-opportunity-card.tsx; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 卡片把没有匹配度显示成 0%" >&2
    exit 1
  fi
  if grep -q 'opportunity.match' apps/mobile/src/surfaces/market.tsx; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 详情页又在拿匹配度造句" >&2
    exit 1
  fi
  # ORDER-FLOW-COPY-001：判断区整块删除（原先要求留一句「这一版还没有评估」，那句本身就是
  # 废话）。守门改为反向：三条写死的结论、判断区标题都不许回来。
  if grep -qE '你的组合满足硬条件|不建议低于预算|值得考虑|给小美的判断' apps/mobile/src/surfaces/market.tsx; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 判断区又回来了（写死的结论或空盒）" >&2
    exit 1
  fi
  echo "  PASS [MARKET-FAKE-JUDGMENT-001]: no fabricated match score or verification badge"


# MARKET-PRICE-RANGE-PARSE-001: 机会的 price 可能是一个**真区间**，显示侧却把它当单一数字读。
#
# 发布页有两框（最低 / 最高），都填了 composePriceRange 会合成
# "1,500,000₫ – 2,000,000₫" 落到 wire 的 price 上 —— 这是合法形态，发布校验也认。
# 但卡片、详情页、报价 sheet 三处各自把 price 里的数字整串抠出来当单一预算：
#   1. 区间的两端被拼成一个数，卡片于是显示出一串天文数字般的 K 值；
#   2. 详情页那格再拿这个"单一预算"乘两个系数外推一个区间 —— 那两框没人填过；
#   3. 报价 sheet 的锚定区间和三个预设按钮跟着一起错。
#
# 现在统一走 parseOpportunityPrice（market-fixtures.ts，按区间两端拆开读）：
# 有真区间就显示真区间；只有单一价格就显示那个价格，不外推、也不声称可协商。
# 行为测试在 apps/mobile/src/market-price-range.test.ts（纯 .ts，跑得动）。
if grep -qF 'replace(/\D/g' apps/mobile/src/surfaces/r37-opportunity-card.tsx ||
   grep -qF 'replace(/\D/g' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-PRICE-RANGE-PARSE-001]: 显示侧又把 price 里的数字整串抠出来了 ——" >&2
  echo "        price 可能是发布方填的真区间，抠数字会把两端拼成一个天文数字。" >&2
  echo "        走 parseOpportunityPrice，按区间两端拆开读。" >&2
  exit 1
fi
# 外推系数：那两框发布方从来没填过，客户端不许替他造一个区间。
if grep -qF '0.95' apps/mobile/src/surfaces/r37-opportunity-card.tsx ||
   grep -qF '1.35' apps/mobile/src/surfaces/r37-opportunity-card.tsx ||
   grep -qF '0.95' apps/mobile/src/surfaces/market.tsx ||
   grep -qF '1.35' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-PRICE-RANGE-PARSE-001]: 又在拿单一预算外推一个区间 ——" >&2
  echo "        只有发布方真的填了两框才有区间；只有一个价就显示那个价。" >&2
  exit 1
fi
if grep -qF 'Proxy 建议区间' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-PRICE-RANGE-PARSE-001]: 详情页那格又变成编出来的建议区间" >&2
  exit 1
fi
# 正向：三处都接到同一个解析器上，且解析器真的存在。
if ! grep -qF 'export function parseOpportunityPrice' apps/mobile/src/market-fixtures.ts ||
   ! grep -qF 'parseOpportunityPrice' apps/mobile/src/surfaces/r37-opportunity-card.tsx ||
   ! grep -qF 'parseOpportunityPrice' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-PRICE-RANGE-PARSE-001]: 显示侧没有接到 parseOpportunityPrice 上 ——" >&2
  echo "        解析器对了而没人调用等于没修（三处以前就是各写一份）。" >&2
  exit 1
fi
if ! grep -q 'MARKET-PRICE-RANGE-PARSE-001' apps/mobile/src/market-price-range.test.ts; then
  echo "  FAIL [MARKET-PRICE-RANGE-PARSE-001]: 行为测试没有跟着改口径" >&2
  exit 1
fi
echo "    MARKET-PRICE-RANGE-PARSE-001: PASS (a published price range is read as two ends, never concatenated)"

# MARKET-SEED-FAKE-ACTIVITY-001: 市场种子行不得带凭空的互动量与紧急度。
#
# marketplace.SeedDefaults 在**生产 PG 路径**上也会跑（cmd/api/main.go 无条件下调），
# 所以它写进去的每一行真实用户都看得到。四行种子以前带着非零的响应人数和一个
# "热门"紧急度标记，但发布路径（PublishMarketOpportunity）把响应数初始化成 0、只在
# 有人真的报名时才 +1，紧急度标记压根不由发布路径产生 —— 于是种子行凭空声称"已经有
# 人响应了"且"很抢手"，详情页把响应数渲染成一行人数，卡片会为"热门"换一个强调色。
  SVC=apps/api-go/internal/marketplace/service.go
  TEST=apps/api-go/internal/marketplace/service_test.go
  # 反向钉：种子行不许再出现非零的响应数字面量。
  if grep -qE 'Responses: [1-9]' "$SVC"; then
    echo "  FAIL [MARKET-SEED-FAKE-ACTIVITY-001]: 种子行又带了非零的响应数 ——" >&2
    echo "        没有人报名过，发布路径的初值就是 0。" >&2
    exit 1
  fi
  # 反向钉：紧急度是算出来的判断，不是种子属性。
  if grep -qE 'SignalClass: "(hot|new|rising)"' "$SVC"; then
    echo "  FAIL [MARKET-SEED-FAKE-ACTIVITY-001]: 种子行又在自称「热门/紧急」" >&2
    exit 1
  fi
  # 正向：四行种子都必须从 0 起步（跟真实发布一致）。
  n=$(grep -c 'Responses: 0' "$SVC")
  if [ "$n" -lt 4 ]; then
    echo "  FAIL [MARKET-SEED-FAKE-ACTIVITY-001]: 只有 $n 行种子从 0 起步，期望 4 行" >&2
    exit 1
  fi
  # 钉**断言本身**，不是「文件里出现过这个 ID」。
  if ! grep -q 'TestSeedDefaultsCarryNoFabricatedEngagement' "$TEST"; then
    echo "  FAIL [MARKET-SEED-FAKE-ACTIVITY-001]: 种子不带假互动的行为测试不见了" >&2
    exit 1
  fi
  # 反向钉：不能为了去掉假互动就把 demo 列表本身删了。
  if ! grep -q 'TestSeedDefaultsStillProvideDemoListings' "$TEST"; then
    echo "  FAIL [MARKET-SEED-FAKE-ACTIVITY-001]: 「demo 列表还在」的反向钉不见了 ——" >&2
    echo "        修的是凭空的互动量，不是把市场种子一起端掉。" >&2
    exit 1
  fi
  echo "  PASS [MARKET-SEED-FAKE-ACTIVITY-001]: market seed rows carry no fabricated engagement"


# MARKET-SEEDED-TRAVEL-001: 市场的通勤时间不得拿种子占位数字冒充实时推算。
# travel 只有在 travelSource === "user_distance" 时才是"从看的人所在位置算出来的"；
# 种子数据里写死的 18/24/52/20（apps/api-go/internal/marketplace/service.go
# SeedDefaults）跟正在看的人在哪毫无关系，显示成"通勤约 18 分钟"就是编的。
# 服务端专门返了 travelSource 就是为了让客户端分得开 —— 以前声明了但没人读。
  if ! grep -q 'MARKET-SEEDED-TRAVEL-001' apps/mobile/src/market-fixtures.ts; then
    echo "  FAIL [MARKET-SEEDED-TRAVEL-001]: 派生函数没有标注这个契约" >&2
    exit 1
  fi
  # 反向钉：详情页不许再直接拿 travel 字段就渲染。
  if grep -q 'opportunity.travel != null' apps/mobile/src/surfaces/market.tsx; then
    echo "  FAIL [MARKET-SEEDED-TRAVEL-001]: 详情页直接渲染了 travel 字段 ——" >&2
    echo "        seeded（种子占位）会被当成看的人的通勤时间显示。" >&2
    exit 1
  fi
  # 正向：必须走派生函数，且派生函数只认 user_distance。
  if ! grep -q 'const viewerTravelMinutes = travelMinutesFromViewer(opportunity);' apps/mobile/src/surfaces/market.tsx; then
    echo "  FAIL [MARKET-SEEDED-TRAVEL-001]: 详情页没有走派生函数" >&2
    exit 1
  fi
  if ! grep -q 'opportunity.travelSource !== "user_distance"' apps/mobile/src/market-fixtures.ts; then
    echo "  FAIL [MARKET-SEEDED-TRAVEL-001]: 派生函数不再按 travelSource 区分 ——" >&2
    echo "        不区分就是把占位数字当实时推算。" >&2
    exit 1
  fi
  # 钉**那条断言**，不是「文件里出现过这个 ID」。
  if ! grep -q 'hides the seeded placeholder' apps/mobile/src/market-seeded-travel.test.ts; then
    echo "  FAIL [MARKET-SEEDED-TRAVEL-001]: 行为测试不见了" >&2
    exit 1
  fi
  # 反向钉：真算出来的通勤时间仍然要显示 —— 不能为了不编就把真的也删了。
  if ! grep -q 'returns the minutes when the server computed them from the viewer' apps/mobile/src/market-seeded-travel.test.ts; then
    echo "  FAIL [MARKET-SEEDED-TRAVEL-001]: 真通勤时间的反向钉不见了 ——" >&2
    echo "        修「占位当真」不能把真的算出来的时间也一起藏掉。" >&2
    exit 1
  fi
  echo "  PASS [MARKET-SEEDED-TRAVEL-001]: commute time is shown only when computed from the viewer"

# PERSON-DISTANCE-ZERO-001: 服务端真人不得被盖上「距离 0 米」。
#
# 首页按 userId 搜到的**真实平台用户**经 profileWireToPerson 转成本地人物卡时，
# 以前一律填 `distanceM: 0`。服务端没有这个人的坐标，0 不是"很近"而是"没有数据"，
# 但详情页会把它渲染成「0 m」—— 等于断言对方就在看的人脚下；同时「附近 <1000m」
# 筛选会把 0 当成通过，于是任何一个被搜到的真人都算「附近」。
# 没有坐标就必须留空：展示侧说「距离未知」，筛选侧排除出「附近」。
  FIX=apps/mobile/src/recommend-fixtures.ts
  UI=apps/mobile/src/surfaces/requester-home.tsx
  TEST=apps/mobile/src/person-distance-zero.test.ts
  # 反向钉：服务端真人身上不许再出现 distanceM 赋值（0 也是编的）。
  if /usr/bin/grep -q 'distanceM: 0' "$UI"; then
    echo "  FAIL [PERSON-DISTANCE-ZERO-001]: 又在给没有坐标的真人填距离 0" >&2
    echo "        0 会渲染成「0 m」，并把人塞进「附近」筛选。" >&2
    exit 1
  fi
  # 正向：距离字段必须是可选的，否则"未知"无法表达。
  if ! /usr/bin/grep -q 'distanceM?: number' "$FIX"; then
    echo "  FAIL [PERSON-DISTANCE-ZERO-001]: distanceM 又变回必填 ——" >&2
    echo "        必填就等于逼调用方拿 0 冒充没数据。" >&2
    exit 1
  fi
  # 正向：筛选侧要把"未知"排除在「附近」之外。
  # HOME-MORE-DIST-001（2026-09-22）：写死 1km 的「附近」开关改成恒生效的半径
  # 设置（1/3/5/10/20/50/100km），所以字面 `>= 1000` 改成半径变量；「距离未知
  # ≠ 很近」这条不许动 —— 任何半径都排除 undefined，否则 regress。
  if ! /usr/bin/grep -q 'p.distanceM === undefined || p.distanceM >= moreDistanceKm \* 1000' "$UI"; then
    echo "  FAIL [PERSON-DISTANCE-ZERO-001]: 「附近」筛选不再排除距离未知的人" >&2
    exit 1
  fi
  # 正向：展示侧要有如实文案，不能显示 0 m。
  if ! /usr/bin/grep -q '距离未知' "$UI"; then
    echo "  FAIL [PERSON-DISTANCE-ZERO-001]: 没有距离的如实文案不见了" >&2
    exit 1
  fi
  # 钉**断言本身**，不是「文件里出现过这个 ID」。
  if ! /usr/bin/grep -q 'does not stamp a distance onto server people' "$TEST"; then
    echo "  FAIL [PERSON-DISTANCE-ZERO-001]: 「不给真人盖距离」的断言不见了" >&2
    exit 1
  fi
  # 反向钉：不能为了不编就把 demo 列表的距离也删了。
  if ! /usr/bin/grep -q 'keeps the distance on the demo recommendation list' "$TEST"; then
    echo "  FAIL [PERSON-DISTANCE-ZERO-001]: 「demo 列表的距离还在」的反向钉不见了 ——" >&2
    echo "        修的是服务端真人那一路，不是把推荐列表的距离一起端掉。" >&2
    exit 1
  fi
  echo "  PASS [PERSON-DISTANCE-ZERO-001]: real people carry no invented proximity"


# PROFILE-TAB-LOAD-FAILED-001: 个人主页「收藏 / 回复 / 被标记」加载失败不得显示成「还没有…」
# 两层：me.tsx 必须记录失败并传下去；ProfileTabs 必须把失败态和空态渲染成两句话，
# 且失败态先判定（数组的失败形态就是 []，判空在前等于没修）。
# 只修一层没用：光在 me.tsx 记 flag 而 ProfileTabs 没有失败分支，用户看到的还是
# 「还没有收藏」。
  if ! grep -q 'PROFILE-TAB-LOAD-FAILED-001' apps/mobile/src/surfaces/ProfileTabs.tsx; then
    echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: ProfileTabs 没有标注这个契约" >&2
    exit 1
  fi
  # 三个失败态文案（和「还没有…」是不同的两句话）。
  for MSG in '回复没读出来' '收藏没读出来' '被标记没读出来'; do
    if ! grep -q "$MSG" apps/mobile/src/surfaces/ProfileTabs.tsx; then
      echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: 失败态文案不见了：$MSG" >&2
      exit 1
    fi
  done
  # 三个「真的没有」的文案必须还在 —— 不能把空态删掉只留失败态。
  for MSG in '还没有收藏' '还没有回复' '还没有被标记'; do
    if ! grep -q "$MSG" apps/mobile/src/surfaces/ProfileTabs.tsx; then
      echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: 空态文案被删掉了：$MSG ——" >&2
      echo "        修「失败像空」不能把真的空也一起干掉。" >&2
      exit 1
    fi
  done
  # 失败分支数量：三个 tab 各一个，且必须在判空之前。
  if [ "$(grep -c 'if (props.failed) {' apps/mobile/src/surfaces/ProfileTabs.tsx)" -lt 3 ]; then
    echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: 三个 tab 的失败分支不全（需 3 个）" >&2
    exit 1
  fi
  # flag 必须从 ProfileTabsProps 穿到各 tab。
  if ! grep -q 'failed={props.savedFailed}' apps/mobile/src/surfaces/ProfileTabs.tsx ||
     ! grep -q 'failed={props.repliesFailed}' apps/mobile/src/surfaces/ProfileTabs.tsx ||
     ! grep -q 'failed={props.taggedFailed}' apps/mobile/src/surfaces/ProfileTabs.tsx; then
    echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: 失败 flag 没有穿进 tab 组件" >&2
    exit 1
  fi
  # me.tsx：失败要记 true，成功要清 false。
  for CALL in 'setPersonalSavedFailed(true)' 'setPersonalRepliesFailed(true)' 'setPersonalTaggedFailed(true)'; do
    if ! grep -q "$CALL" apps/mobile/src/surfaces/me.tsx; then
      echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: me.tsx 没有记录失败：$CALL" >&2
      exit 1
    fi
  done
  for CALL in 'setPersonalSavedFailed(false)' 'setPersonalRepliesFailed(false)' 'setPersonalTaggedFailed(false)'; do
    if ! grep -q "$CALL" apps/mobile/src/surfaces/me.tsx; then
      echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: 成功时没有清掉失败标记：$CALL ——" >&2
      echo "        一次抖动会让 tab 永远显示失败。" >&2
      exit 1
    fi
  done
  # 钉**那条断言**，不是「文件里出现过这个 ID」。
  if ! grep -q 'the failure branch is decided before the empty branch in all three tabs' apps/mobile/src/profile-tabs-load-failed.test.ts; then
    echo "  FAIL [PROFILE-TAB-LOAD-FAILED-001]: 行为测试不见了" >&2
    exit 1
  fi
  echo "  PASS [PROFILE-TAB-LOAD-FAILED-001]: a failed profile tab never reads as 'you have none'"

# RECOMMEND-REPUTATION-FABRICATED-001: 推荐人的「历史信誉与评价」不得是编的。
#
# 详情页那张卡（requester-home.tsx 「历史信誉与评价」）曾经显示星级 / 好评百分比 /
# 完成次数 / 一句引号里的"用户评价" / 一份带日期的历史活动记录，而 recommend-fixtures
# 里这些值全部由 `(index + offset) % n` 算出来 —— 挂在真人姓名下的凭空信誉，还附了
# 「非公开记录不展示」的隐私说明。fixture 本身（姓名 / 描述 / 距离 / 标签）可以继续是
# demo 内容，但**评价类字段**声称的是"被测量过的历史"，没有真数据就必须为空，
# 让 UI 回落到「暂无公开记录」这类如实文案。
  FIX=apps/mobile/src/recommend-fixtures.ts
  TEST=apps/mobile/src/recommend-reputation-honest.test.ts
  UI=apps/mobile/src/surfaces/requester-home.tsx
  # 反向钉：任何按下标算出来的评价类字段都不许回来。
  if grep -qE 'rating:[[:space:]]*Number\(' "$FIX"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 星级又是算出来的" >&2
    exit 1
  fi
  if grep -qE 'positiveRate:[[:space:]]*[0-9]' "$FIX"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 好评率又是算出来的" >&2
    exit 1
  fi
  if grep -qE 'completedActivities:[[:space:]]*[0-9]' "$FIX"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 完成次数又是算出来的" >&2
    exit 1
  fi
  if grep -qE '(^|[^?])reviewSummary:' "$FIX"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 又在编" >&2
    echo "        一段「用户评价」摘要" >&2
    exit 1
  fi
  if grep -qE '(^|[^?])availabilityText:' "$FIX"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 又在替真人断言可用时间" >&2
    exit 1
  fi
  # 反向钉：那份带日期的历史活动记录（挂在真人姓名下 + 隐私说明）不许回来。
  if grep -q 'linh_history_' "$FIX"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 编造的历史活动记录又回来了" >&2
    exit 1
  fi
  # 正向：改动必须在这个契约下留名。
  if ! grep -q 'RECOMMEND-REPUTATION-FABRICATED-001' "$FIX"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: fixture 没标注这个契约" >&2
    exit 1
  fi
  # 钉**断言本身**，不是「文件里出现过这个 ID」。
  if ! grep -q 'carries no star rating for any recommended person' "$TEST"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 星级的断言不见了" >&2
    exit 1
  fi
  if ! grep -q 'carries no public activity history rows for any recommended person' "$TEST"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 历史活动记录的断言不见了" >&2
    exit 1
  fi
  # 反向钉：不能为了不编就把整个推荐列表删空。
  if ! grep -q 'still describes the person themselves' "$TEST"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 「demo 列表本身还在」的反向钉不见了 ——" >&2
    echo "        修「编信誉」不能把推荐人列表一起端掉。" >&2
    exit 1
  fi
  # 反向钉：读模型要留着，等服务端人物 feed 落地能直接填。
  if ! grep -q 'keeps the reputation fields on the type so the server feed can fill them' "$TEST"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 「字段要留着给真数据」的反向钉不见了 ——" >&2
    echo "        把字段删了，UI 的回落分支会变成死代码。" >&2
    exit 1
  fi
  # 展示侧：空状态不许暗示"有记录只是没公开"。
  # HOME-I18N-001 之后文案搬进 i18n.ts（noActivity 键），UI 走 t("noActivity")。
  I18N=apps/mobile/src/i18n.ts
  if grep -q '她暂未公开活动明细' "$UI" "$I18N"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 空状态仍在暗示存在未公开的记录" >&2
    exit 1
  fi
  if ! grep -q 'noActivity: "还没有可展示的活动记录"' "$I18N" || ! grep -q 't("noActivity")' "$UI"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 如实的空状态文案不见了" >&2
    exit 1
  fi
  echo "  PASS [RECOMMEND-REPUTATION-FABRICATED-001]: recommendation reputation is never invented"


# SUPPLY-BODY-001: 服务端 payload 解析失败被静默吞成 {}，跟"成功但为空"长得一样。
#
# supply-client 的 body() 以前是：
#     try { const v = JSON.parse(result.operationRef); if (v && typeof v === "object") return v; }
#     catch {}            ← 吞掉
#     return {};          ← 损坏的响应和空的响应都走到这里
#
# 后果：一次**失败**会渲染成"没有数据"而不是"加载失败" ——
#   · querySuppliers → 0 个可邀约的人（发布页「选个人邀约」显示空，而不是 ERROR）；
#   · getAgentPassport → 一个字段全 undefined 的 passport，不报错；
#   · setAvailabilityWindow → 返回 windowId ""，当成成功。
# 现在统一抛 SupplyProtocolError；六个调用方都有 catch，会各自落到自己的错误态。
if grep -qF 'catch {}' apps/mobile/src/supply-client.ts; then
  echo "  FAIL [SUPPLY-BODY-001]: 又出现吞异常的 catch ——" >&2
  echo "        payload 解析失败必须抛，不能退化成空对象（那跟"成功但没有数据"一样）。" >&2
  exit 1
fi
if ! grep -qF 'export function parseSupplyBody' apps/mobile/src/supply-client.ts ||
   ! grep -qF 'parseSupplyBody(result.operationRef)' apps/mobile/src/supply-client.ts; then
  echo "  FAIL [SUPPLY-BODY-001]: body() 没有走共享解析器 ——" >&2
  echo "        解析器对了而 body() 自己吞异常等于没修。" >&2
  exit 1
fi
# 钉**那条断言**，不是"文件里出现过这个 ID"。
if ! grep -q 'throws instead of returning {} when the payload is not valid JSON' apps/mobile/src/supply-client.test.ts; then
  echo "  FAIL [SUPPLY-BODY-001]: 行为测试不见了" >&2
  exit 1
fi
echo "    SUPPLY-BODY-001: PASS (a malformed supply payload raises instead of looking empty)"


# VOUCHER-SETTLEMENT-FAKE-STATE-001: 结算页在服务端没给数据时**预填三条状态**，
# 而且第一条是「已核销 · 完成」。
#
#   const states = settlement.length ? settlement
#     : [ {REDEEMED, 完成}, {RISK_CHECK, 检查中}, {SETTLEMENT, 待结算} ];
#
# 副标题还写着「商家已确认真实消费」。于是一张根本没核销过的券被渲染成已核销完成 ——
# 没有数据却渲染成了成功，这是最不能接受的一类。服务端今天确实总是返回三条，所以
# 这是个潜伏的兜底：一旦 states 为空（协议返回空数组、字段漂移）就会立刻说谎。
#
# 同一个分支还有第二个假成功：只要 status 不是 REDEEMED 就给「查看核销结果」，
# 而那一屏写的是「核销成功」—— 一张 EXPIRED 的券点进去也会看到核销成功。
# 现在只有 SETTLED 才进那一屏，其余状态显示自己真实的状态。
if grep -qF 'status:"COMPLETED"' apps/mobile/src/surfaces/voucher.tsx ||
   grep -qF 'status:"CHECKING"' apps/mobile/src/surfaces/voucher.tsx; then
  echo "  FAIL [VOUCHER-SETTLEMENT-FAKE-STATE-001]: 结算状态又在预填 ——" >&2
  echo "        服务端没返回就是没记录，不能给一张没核销过的券显示已完成。" >&2
  exit 1
fi
if ! grep -qF 'states.length ?' apps/mobile/src/surfaces/voucher.tsx ||
   ! grep -qF '还没有核销与结算记录' apps/mobile/src/surfaces/voucher.tsx; then
  echo "  FAIL [VOUCHER-SETTLEMENT-FAKE-STATE-001]: 没有记录时没有落到空态" >&2
  exit 1
fi
if ! grep -qF 'selected.status === "SETTLED" ? <Pressable' apps/mobile/src/surfaces/voucher.tsx ||
   ! grep -qF '这张礼券没有核销结果' apps/mobile/src/surfaces/voucher.tsx; then
  echo "  FAIL [VOUCHER-SETTLEMENT-FAKE-STATE-001]: 未核销的券又能直接跳到「核销成功」——" >&2
  echo "        只有 SETTLED 才有结果可看；其它状态要显示自己真实的状态。" >&2
  exit 1
fi
# 钉**那条断言**，不是"文件里出现过这个 ID"。
if ! grep -q 'never pre-fills settlement states the server did not return' apps/mobile/src/voucher-validity.test.ts; then
  echo "  FAIL [VOUCHER-SETTLEMENT-FAKE-STATE-001]: 行为测试不见了" >&2
  exit 1
fi
echo "    VOUCHER-SETTLEMENT-FAKE-STATE-001: PASS (settlement shows real states only; no success screen for unredeemed vouchers)"

# MERCHANT-ACCOUNT-AVATAR-001: 个人主页有头，商家账户卡永远字母。
#
# 店主 identity.profiles.avatar_path 明明有值（与个人主页同一张图），但
# ListMyBusinessAccounts 读模型里根本没有头像字段 —— 商家卡只能画首字。
# 现在服务端 LEFT JOIN 带出来，客户端按远端指针走 thumb 解析；没设头像的
# 给空，画 fallback，不许编。
if ! grep -q 'AvatarPath' apps/api-go/internal/business/service.go ||
   ! grep -q 'identity.profiles' apps/api-go/internal/platform/postgres/business.go ||
   ! grep -q 'merchantAvatarUri' apps/mobile/src/business-client.ts ||
   ! grep -q 'merchantAvatarUri(' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx; then
  echo "  FAIL [MERCHANT-ACCOUNT-AVATAR-001]: 商家账户头像没接上店主头像 ——" >&2
  echo "        个人主页有头，账户卡还是字母。" >&2
  exit 1
fi
if ! grep -q 'MERCHANT-ACCOUNT-AVATAR-001' apps/api-go/internal/platform/postgres/business_integration_test.go ||
   ! grep -q 'MERCHANT-ACCOUNT-AVATAR-001' apps/mobile/src/business-client.test.ts; then
  echo "  FAIL [MERCHANT-ACCOUNT-AVATAR-001]: 头像透传测试不见了" >&2
  exit 1
fi
go -C apps/api-go test -count=1 -run '^TestListMyBusinessAccountsCarriesOwnerAvatar$' ./internal/platform/postgres/ || exit $?
pnpm --filter @proxy/mobile exec vitest run src/business-client.test.ts || exit $?
echo "    MERCHANT-ACCOUNT-AVATAR-001: PASS (merchant card shows the owner portrait)"

# MEETUP-SHARE-001: 好友位置消息掉回 raw 文本。
#
# ConversationClient.sendMessage 早支持 messageType LOCATION，但会话面只渲染
# IMAGE/VIDEO/AUDIO —— 位置掉回原文一串字，收件箱也没有 [位置] 预览。
# 现在发送走 sendLocationMessage（可解析格式 + LOCATION 类型，非法坐标抛错不发），
# 会话面解码成卡，收件箱显示 [位置·标签]。
if ! grep -q 'public async sendLocationMessage' apps/mobile/src/conversation-client.ts ||
   ! grep -q 'decodeMeetupLocation(row.body' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'meetupPreview(latest.body' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [MEETUP-SHARE-001]: 位置收发接线断了 ——" >&2
  echo "        发的发不出去，收的看不懂。" >&2
  exit 1
fi
if ! grep -q 'MEETUP-SHARE-001' apps/mobile/src/meetup-share.test.ts ||
   ! grep -q 'MEETUP-SHARE-001' apps/mobile/src/conversation-location.test.ts; then
  echo "  FAIL [MEETUP-SHARE-001]: 接线测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/meetup-share.test.ts src/conversation-location.test.ts || exit $?
echo "    MEETUP-SHARE-001: PASS (location sends parsed, renders as card, previews as [位置])"

# MEETUP-NAV-001: 位置卡只有图钉没有导航。
#
# "在地图中打开"只是 q= 丢个图钉，不算导航。自写路线引擎要 Directions key +
# 计费 + 后台定位，不走那条路；用两家系统地图官方 directions scheme
# （Google dir/?api=1&destination=&travelmode=，Apple ?daddr=&dirflg=），
# iOS 进 Apple Maps、Android 进 Google Maps。
if ! grep -q 'export function meetupDirectionsUrls' apps/mobile/src/meetup-share.ts ||
   ! grep -q 'meetupDirectionsUrls(message.location' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'dir/?api=1' apps/mobile/src/meetup-share.ts ||
   ! grep -q 'dirflg=' apps/mobile/src/meetup-share.ts; then
  echo "  FAIL [MEETUP-NAV-001]: 真导航深链断了 ——" >&2
  echo "        卡片退回只能看不能走。" >&2
  exit 1
fi
if ! grep -q 'MEETUP-NAV-001' apps/mobile/src/meetup-share.test.ts; then
  echo "  FAIL [MEETUP-NAV-001]: 导航 URL 测试不见了" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/meetup-share.test.ts || exit $?
echo "    MEETUP-NAV-001: PASS (card navigates via system maps directions)"

# SCENE-CHECKIN-100M-001: 场景打卡不认位置。
#
# 之前「我在这里」谁点谁就算 —— 没定位能标，异地能标，标完还显示
# 「N 人说在这里」。现在打卡只认 GPS 真值：100 米内可打（含进圈自动打卡），
# 之外拒绝并明说距离；详情只留收藏/打卡，人工声明入口已撤。
if ! grep -q 'CHECKIN_RADIUS_METERS' apps/mobile/src/scene-checkin.ts ||
   ! grep -q 'checkinEligibility(' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'checkinHint(' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-CHECKIN-100M-001]: 打卡门禁断了 ——" >&2
  echo "        又退回谁点谁算。" >&2
  exit 1
fi
if ! grep -q 'SCENE-CHECKIN-100M-001' apps/mobile/src/scene-checkin.test.ts; then
  echo "  FAIL [SCENE-CHECKIN-100M-001]: 门禁测试不见了" >&2
  exit 1
fi
# 反向钉：半径必须是 100（单测含 100/100.1 边界，改大就红）。
if ! grep -q 'CHECKIN_RADIUS_METERS = 100' apps/mobile/src/scene-checkin.ts; then
  echo "  FAIL [SCENE-CHECKIN-100M-001]: 打卡半径被改掉了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-checkin.test.ts || exit $?
echo "    SCENE-CHECKIN-100M-001: PASS (check-in gated by 100m GPS truth)"

# SCENE-BADGE-001: 打卡徽章。打卡不是终点 —— 打卡景点/集类别/留足迹要有
# 看得见的回报，才有人愿意真的走到现场。本条锁死：规则只在
# realityscene/badges.go（与 mobile scene-badges.ts 对齐）；打卡成功后服务端
# 必须判定并把新获得的徽章随响应返回（客户端弹「恭喜获得徽章」）；已获得
# 徽章 append-only 记录 + ListMyBadges 可读；PG 仓储与迁移 093 必须存在。
require_test "SCENE-BADGE-001" "./internal/realityscene" \
  "TestEvaluateSceneBadgesFirstCheckin" \
  "apps/api-go/internal/realityscene/badges_test.go" || exit $?
require_test "SCENE-BADGE-001" "./internal/realityscene" \
  "TestEvaluateSceneBadgesSetsAndXiaomei" \
  "apps/api-go/internal/realityscene/badges_test.go" || exit $?
if ! grep -qF 'case "ListMyBadges"' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-BADGE-001]: ListMyBadges is no longer dispatched" >&2
  exit 1
fi
if ! grep -qF 'newlyEarnedBadges' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-BADGE-001]: check-in response no longer carries new badges" >&2
  exit 1
fi
if ! grep -qF 'func (r *RealitySceneRepository) EarnBadge' apps/api-go/internal/platform/postgres/reality_scene.go; then
  echo "  FAIL [SCENE-BADGE-001]: the Postgres badge repository is missing," >&2
  exit 1
fi
if [ ! -f apps/api-go/migrations/099_reality_scene_badges.sql ]; then
  echo "  FAIL [SCENE-BADGE-001]: migration 099_reality_scene_badges.sql is missing." >&2
  exit 1
fi
if ! grep -qF 'SCENE_BADGES' apps/mobile/src/scene-badges.ts; then
  echo "  FAIL [SCENE-BADGE-001]: the mobile badge catalog is missing." >&2
  exit 1
fi
if ! grep -qF 'AIVisits' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [SCENE-BADGE-001]: the scene detail no longer carries bound-Xiaomei visits" >&2
  exit 1
fi
echo "    SCENE-BADGE-001: PASS (badge rules are single-sourced, earned badges are append-only and readable)"

# ADD-FRIEND-NEXT-001: 发出的请求必须可查，“已发送”不是终点。
#
# 根因：reload() 只把 INCOMING 投影到请求列表，OUTGOING 没有任何渲染面 ——
# 点了添加变“已发送”即终点：查不到状态、通过了不提醒、无开聊入口。
# 现在 serverFriends.pending 按 direction === "OUTGOING" 派生 outgoingRequests，
# REQUESTS 加“我发出的”分组只展示等待态（服务端无撤回命令，不编按钮），
# SCAN 已发送态给下一步指路 + 内跳 REQUESTS，通过后开聊走 LIST 已有 onOpenConversation。
if ! grep -q 'outgoingRequests' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'direction === "OUTGOING"' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q '等待对方通过' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q '对方通过后会出现在好友列表，可直接开聊' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q '看看我发出的请求' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q '你还没发出过请求' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'ADD-FRIEND-NEXT-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [ADD-FRIEND-NEXT-001]: 发出的请求又不可查了 ——" >&2
  echo "        已发送即终点，无状态、无提醒、无开聊入口。" >&2
  exit 1
fi
# 反向钉：不许给发出态编撤回按钮，服务端没有撤回指令。
if grep -q '撤回好友请求' apps/mobile/src/surfaces/friend-crm.tsx ||
   grep -q 'cancelFriendRequest' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [ADD-FRIEND-NEXT-001]: 发出态编造了撤回动作 ——" >&2
  echo "        服务端无撤回命令，不编按钮。" >&2
  exit 1
fi
# 反向钉：两句空态不许混用一句（收件箱空 ≠ 发出箱空）。
if grep -q '暂无待处理请求，你还没' apps/mobile/src/surfaces/friend-crm.tsx; then
  echo "  FAIL [ADD-FRIEND-NEXT-001]: 两句空态混用了一句 ——" >&2
  echo "        没人加我 ≠ 我没加过人。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts || exit $?
echo "    ADD-FRIEND-NEXT-001: PASS (outgoing requests stay visible with a next step)"
# ADD-FRIEND-SEND-BUSY-001: 点添加在弱网下长时间没反应，还能重复点。
#
# 根因：addScannedPerson 在途无忙态（按钮一直是可点的“添加”）、无登录态
# 直接静默 return。修法：在途锁 + “发送中…”文案 + 失败 finally 解锁，
# 没登录态给 toast 不静默。
if ! grep -q 'scanAddBusy' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q '发送中' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'if (scanAddBusy || scanAddSent) return;' apps/mobile/src/surfaces/friend-crm.tsx ||
   ! grep -q 'ADD-FRIEND-SEND-BUSY-001' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [ADD-FRIEND-SEND-BUSY-001]: 添加按钮又回到无忙态 ——" >&2
  echo "        弱网下点下去像没反应，还能重复发送。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts || exit $?
echo "    ADD-FRIEND-SEND-BUSY-001: PASS (sending locks the button with a busy label)"

# SCENE-NAV-001: 场景有点可去 —— 导航走 MEETUP-NAV-001 同一套系统地图深链。
# SCENE-NAV-PIN-001（2026-09-19 反转旧决定）：旧门禁曾否掉 B 方案（点图钉改道），
# 但导航埋详情里用户找不到 —— 点图钉改弹快打卡（导航/详情二选一）。详情页内
# 导航按钮保留，同一条深链。
if ! grep -q 'meetupDirectionsUrls' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'Linking.openURL' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q '导航去这里' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'scene.latitude === 0 && scene.longitude === 0' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'SCENE-NAV-001' apps/mobile/src/scene-nav.test.ts; then
  echo "  FAIL [SCENE-NAV-001]: 场景主页的导航出口断了 ——" >&2
  echo "        看得到去不了。" >&2
  exit 1
fi
# 反向钉：不许绕过 validated builder 手拼地图 URL（q= 只能看不能走）。
if grep -q 'maps.apple.com' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   grep -q 'google.com/maps' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-NAV-001]: 主页手拼了地图 URL ——" >&2
  echo "        绕过坐标校验，拼错就是编点。" >&2
  exit 1
fi
# 正向钉：点图钉弹快打卡，看详情才进主页老链（B 方案，2026-09-19 生效）。
if ! grep -q 'setPinSheetId(scene.id)' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'setSelectedId(pinScene.id)' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'openSceneNavigation(pinScene)' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-NAV-PIN-001]: 图钉快打卡链被动了 ——" >&2
  echo "        点钉必须先选导航/详情，不许直通详情把导航藏回去。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-nav.test.ts || exit $?
echo "    SCENE-NAV-001: PASS (scene homepage navigates via system maps)"
echo "    SCENE-NAV-PIN-001: PASS (pin pops navigation-or-detail sheet)"

# SCENE-HUMANS-001: 场景详情“一起玩的人”只露圆头像 + 名字 + 可约状态。
#
# 之前是方形信息块（role / fit% / fitReason 全摊），而详情都在个人主页。
# 点按仍是“选中邀约对象”（DIRECT_INVITE 靠 selectedHumanId 找人）——
# 改成跳个人主页就断链，所以只动展示不动交互。
if ! grep -q '<CircularAvatarImage' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'human.availability' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'SCENE-HUMANS-001' apps/mobile/src/scene-humans.test.ts; then
  echo "  FAIL [SCENE-HUMANS-001]: 一起玩的人又变回方形信息块 ——" >&2
  exit 1
fi
# 反向钉：role / fit% 不许再渲染（类型字段和发包标签是另一回事，不许碰）。
if grep -q '{human.role}' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   grep -q 'Scene fit {human.sceneFit}' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-HUMANS-001]: role / fit% 又摊回这一屏 ——" >&2
  echo "        详情在个人主页看。" >&2
  exit 1
fi
# 反向钉：选中链不许断（DIRECT_INVITE 找不到人只会报“请先选择”）。
# SCENE-HUMANS-003 起点按是 toggle（选中→取消），不断链只断“粘住”。
if ! grep -q 'setSelectedHumanId((prev) => (prev === human.id ? undefined : human.id))' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-HUMANS-001]: 点按选中邀约对象的链路被动了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-humans.test.ts || exit $?
echo "    SCENE-HUMANS-001: PASS (round avatar, name and order availability only)"

# SCENE-HUMANS-002: 纯圆头 rail，不要白卡片 —— 圆头放大到 64，名字 + 可约居中，
# 选中态改走头像外圈紫环（卡片删了，边框无处可画）。
if ! grep -q 'size={64}' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'humanRingSelected' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'SCENE-HUMANS-002' apps/mobile/src/scene-humans.test.ts; then
  echo "  FAIL [SCENE-HUMANS-002]: 圆头被改小或选中环丢了 ——" >&2
  exit 1
fi
# 反向钉：白卡片不许回来（humanCard 一出现就等于把方形块又套回去了）。
if grep -q 'styles.humanCard' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-HUMANS-002]: 白卡片又套回来了 ——" >&2
  echo "        只要纯圆头。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-humans.test.ts || exit $?
echo "    SCENE-HUMANS-002: PASS (bare big round heads, ring selection, no card)"
# SCENE-HUMANS-004: “适合一起的人” rail 只挂载一遍 detail.humans.map。
#
# 之前同一行 map 并排出现两次 —— 进场景主页每个人出现两遍，各带各的选中态。
if ! grep -q 'SCENE-HUMANS-004' apps/mobile/src/scene-humans.test.ts; then
  echo "  FAIL [SCENE-HUMANS-004]: 去重测试不见了 ——" >&2
  echo "        同一个人又会并排出现两次。" >&2
  exit 1
fi
if [ "$(grep -o 'detail\.humans\.map' apps/mobile/src/surfaces/reality-scene-map.tsx | wc -l | tr -d ' ')" != "1" ]; then
  echo "  FAIL [SCENE-HUMANS-004]: humans rail 又渲染了不止一遍 ——" >&2
  echo "        一个人只许出现一次。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-humans.test.ts || exit $?
echo "    SCENE-HUMANS-004: PASS (people rail mounts exactly once)"
# SCENE-STUDIO-001: 场景 Studio 出图 —— 时段场景 × 点中菜单 × 绑定小美，
# 三元素拼一张卡走系统分享。选什么出什么：缺元素按钮 disabled + 明说，
# 不许拿默认替身凑数。
if ! grep -q 'SCENE-STUDIO-001' apps/mobile/src/scene-studio.test.ts ||
   ! grep -q 'ref={studioShareRef}' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'disabled={!studioReady}' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-STUDIO-001]: Studio 出图链被动了 ——" >&2
  echo "        场景×菜单×小美缺一不可，缺了必须明说。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-studio.test.ts || exit $?
echo "    SCENE-STUDIO-001: PASS (scene x menu x xiaomei studio card)"
# SCENE-CATEGORY-001: 场景顶类封闭三态（商家/景点/其他），前端只认这三个。
#
# 之前 type 是自由文本，词表无界 —— 后期按分类做的标记颜色、徽标、筛选全都
# 无从 key。细分（咖啡店/湖/海滩…）继续走 type 由后端定，前端不碰。
# 服务端：ValidSceneCategory + proposeScene 校验 + 098 迁移回填（口径见迁移文件）。
require_test "SCENE-CATEGORY-001" "./internal/realityscene" \
  "TestSceneCategoryValidation" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-CATEGORY-001" "./internal/realityscene" \
  "TestLaunchScenesCarryClosedCategory" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "SCENE-CATEGORY-001" "./internal/realityscene" \
  "TestApprovedProposalCarriesCategoryIntoCatalog" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
if [ ! -f apps/api-go/migrations/098_scene_category.sql ] ||
   ! grep -q "WHEN type LIKE '公共景点%'" apps/api-go/migrations/098_scene_category.sql ||
   ! grep -q 'ValidSceneCategory' apps/api-go/internal/realityscene/service.go ||
   ! grep -q 'type SceneCategory = "商家" | "景点" | "其他"' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'SCENE-CATEGORY-001' apps/mobile/src/scene-category.test.ts; then
  echo "  FAIL [SCENE-CATEGORY-001]: 场景分类链路断了 ——" >&2
  echo "        自由文本 type 又回来了，或顶类没落到库/端。" >&2
  exit 1
fi
# 反向钉：提交框的自由文本类型不许回来（picker 三选一是唯一的入口）。
if grep -q '类型，例如 咖啡 / 公园' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-CATEGORY-001]: 提交框又退回自由文本类型 ——" >&2
  echo "        词表无界，分类标记无从 key。" >&2
  exit 1
fi
# 反向钉：标记色必须按分类走，去过/未开放才置灰 —— 回到纯状态染色，
# 等于分类白收了，后期标记无从下手。
if ! grep -q 'scene.category === "商家" ? color.magenta' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-CATEGORY-001]: 标记色又退回纯状态染色 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-category.test.ts || exit $?
echo "    SCENE-CATEGORY-001: PASS (closed merchant/attraction/other end to end)"
# SCENE-HUMANS-003: 同一头像点两次 = 选中→取消。之前只有选中没有取消，
# 选错人只能去选别人顶掉，取消不掉。
if ! grep -q 'SCENE-HUMANS-003' apps/mobile/src/scene-humans.test.ts; then
  echo "  FAIL [SCENE-HUMANS-003]: 取消选中的测试不见了" >&2
  exit 1
fi
echo "    SCENE-HUMANS-003: PASS (tapping the selected person deselects)"

# MERCHANT-LOGO-001: 商家详情页必须有商家 logo，现在没有。
#
# 现状：场景链只有 venue 大图；logo 只活在商家自己的管理面
#（store_lines.logo_asset_path），且场景↔店铺没有关联键。
# 本轮：Detail.logoUrl（omitempty）+ 映射点 logoFor + 详情页标题旁小圆标；
# 没有回字母块（管理面同款），不编占位图。logo 文件本身要商户给 ——
# 全仓现在没有任何一家上传过，空着比编诚实。
require_test "MERCHANT-LOGO-001" "./internal/realityscene" \
  "TestSceneDetailCarriesMerchantLogoURL" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
if ! grep -q 'json:"logoUrl,omitempty"' apps/api-go/internal/realityscene/service.go ||
   ! grep -q 'logoFor(scene.ID)' apps/api-go/internal/realityscene/service.go ||
   ! grep -q 'detail?.logoUrl' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'MERCHANT-LOGO-001' apps/mobile/src/scene-merchant-logo.test.ts; then
  echo "  FAIL [MERCHANT-LOGO-001]: 商家 logo 链路断了 ——" >&2
  echo "        详情页又只剩 venue 大图。" >&2
  exit 1
fi
# 反向钉：映射点不许编 URL —— 商户没给资产之前，空表就是真相。
if grep -q 'sceneLogos = map\[string\]string{[^}]' apps/api-go/internal/realityscene/service.go; then
  echo "  FAIL [MERCHANT-LOGO-001]: logo 映射表里出现了手写 URL ——" >&2
  echo "        商户没给资产，空着。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-merchant-logo.test.ts || exit $?
echo "    MERCHANT-LOGO-001: PASS (merchant logo on scene detail, letter fallback)"
# CONVO-ATTACH-001: 会话窗的相机图标太弱 —— 点它和 ＋ 弹同一张 sheet，
# 进相册要点两次。Lotus 式：点图标直进自建相册，首格拍摄，后面最新照片。
# 系统相册一次只能做一件事（选图 XOR 拍照），合并不了，所以缩略图自己摆，
# 拍摄复用 chooseImage("CAMERA") 的真链路，选图进已有的发送链。
if ! grep -q 'new Query()' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'void openAlbum()' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'CONVO-ATTACH-001' apps/mobile/src/surfaces/convo-attach.test.ts; then
  echo "  FAIL [CONVO-ATTACH-001]: 相机图标又退回两次点击 ——" >&2
  echo "        点图标和 ＋ 弹同一张 sheet。" >&2
  exit 1
fi
# 反向钉：v57 顶层 getAssetsAsync 只会 throw（见 image-export.ts 开头），
# 谁把它请回来，相册在真机上就是死的。
if grep -q 'MediaLibrary.getAssetsAsync' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [CONVO-ATTACH-001]: 请回了只会抛异常的旧相册入口 ——" >&2
  echo "        真机上一点就抛，见 image-export.ts 开头。" >&2
  exit 1
fi
# 反向钉：照片入口搬走后，＋ 里不许再留一条进相册的路。
if grep -q '>照片</Text>' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [CONVO-ATTACH-001]: ＋ 里又冒出照片入口 ——" >&2
  echo "        两条路进同一个相册。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/convo-attach.test.ts || exit $?
echo "    CONVO-ATTACH-001: PASS (camera icon opens the album with capture first)"

# DESIGN-CLEANUP-001: token 纪律第一批 + 共享原语（ProxyLoading/ProxyEmptyState）
# + 死 PNG 删除 + 僵尸引用归档。A 档 23 组映射逐个验值（零视觉差）才允许进；
# B 档（lotus 定值）/C 档（Tailwind 返工）/ProxyEmptyLine 不在本轮。
if ! grep -q 'export function ProxyLoading' apps/mobile/src/components/proxy-foundation.tsx ||
   ! grep -q 'export function ProxyEmptyState' apps/mobile/src/components/proxy-foundation.tsx ||
   ! grep -q 'DESIGN-CLEANUP-001' apps/mobile/src/design-system-r3.test.ts; then
  echo "  FAIL [DESIGN-CLEANUP-001]: 共享原语或纪律钉丢了 ——" >&2
  exit 1
fi
# 反向钉：tone 必须显式传 —— 默认蒙混会把灰点染成品牌色。
if ! grep -q 'tone: LoadingTone;' apps/mobile/src/components/proxy-foundation.tsx; then
  echo "  FAIL [DESIGN-CLEANUP-001]: ProxyLoading 的 tone 不再强制 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/design-system-r3.test.ts || exit $?
echo "    DESIGN-CLEANUP-001: PASS (token discipline batch one, shared loading/empty)"
# NOTIF-INVITE-OFFER-001: 邀约/offer 的通知以前到不了该到的人。
#
# 两处真洞：1）SlotOfferCreated 按 PrincipalID 投递 —— 发起方是 requester，
# 5 分钟内必须行动的是 agent，等于把信送给了发信人自己，现在按 payload.agentId
# 投；2）InvitationCreated / InvitationResponded 根本不在 worker 的 switch 里，
# 被邀方和邀约方都收不到任何东西，现在按 inviteeId / hostId 投（hostId 是
# 随本次一起补进事件 payload 的，原来就没有）。
# 其余分支与原来一字不差；未知事件继续安静跳过（worker best-effort 语义不变）。
# 移动端一半：邀请卡片的“询问”按钮是个空壳（点它只改状态串，没地方输入问题），
# 按死按钮纪律删掉；接受/拒绝保持接线。
require_test "NOTIF-INVITE-OFFER-001" "./cmd/worker" \
  "TestInboxForEventRoutesOfferToAgent" \
  "apps/api-go/cmd/worker/main_test.go" || exit $?
require_test "NOTIF-INVITE-OFFER-001" "./cmd/worker" \
  "TestInboxForEventRoutesInvitations" \
  "apps/api-go/cmd/worker/main_test.go" || exit $?
require_test "NOTIF-INVITE-OFFER-001" "./cmd/worker" \
  "TestInboxForEventFallsBackWhenAgentMissing" \
  "apps/api-go/cmd/worker/main_test.go" || exit $?
require_test "NOTIF-INVITE-OFFER-001" "./cmd/worker" \
  "TestInboxForEventSkipsUnknown" \
  "apps/api-go/cmd/worker/main_test.go" || exit $?
if ! grep -q '"hostId": inv.HostID' apps/api-go/internal/scene/service.go ||
   ! grep -q 'payloadString("agentId")' apps/api-go/cmd/worker/main.go ||
   ! grep -q 'payloadString("inviteeId")' apps/api-go/cmd/worker/main.go ||
   ! grep -q 'NOTIF-INVITE-OFFER-001' apps/mobile/src/surfaces/me-invite-actions.test.ts; then
  echo "  FAIL [NOTIF-INVITE-OFFER-001]: 通知路由又断了 ——" >&2
  echo "        offer 投给发信人自己，或邀请继续零触达。" >&2
  exit 1
fi
# 反向钉：空壳询问按钮不许回来（没输入框的询问 = 换皮的拒绝）。
if grep -q 'respond(row.invitationId, "ASK")' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [NOTIF-INVITE-OFFER-001]: 空壳询问按钮又回来了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/me-invite-actions.test.ts || exit $?
echo "    NOTIF-INVITE-OFFER-001: PASS (offer and invitations reach the one who must act)"
# FEED-SAVED-COUNT-001: 收藏数显示查看者自己的 0/1，不是真实聚合数。
#
# 服务端根本没算这个聚合，计数管线建成之前只显示状态不显示数字。
# 同案只此一处：点赞/回复都是真值＋0 兜底。另：#18“两套图片系统”是误读 ——
# feed 多图轨＋X 式自动播只能用 Adaptive，个人主页照片墙才用 Threads 网格，
# 迁过去等于把自动播砍了，两边各守各的 lane，门禁钉住。
# FEED-ACTION-ICONS-001 之后收藏从文字态（"收藏"/"已收藏"）换成图标实心/描边态，
# 语义没变：filled 只跟 isSaved 走，旁边没有数字。钉跟着认图标态 —— 钉的是
# "不显示编出来的聚合数"，不是那两个字。
if ! grep -q 'filled={isSaved} name="bookmark"' apps/mobile/src/surfaces/feed.tsx ||
   ! grep -q 'FEED-SAVED-COUNT-001' apps/mobile/src/surfaces/feed-saved-count.test.ts; then
  echo "  FAIL [FEED-SAVED-COUNT-001]: 收藏数又开始编聚合了 ——" >&2
  exit 1
fi
# 反向钉：拿“我收没收藏”冒充“多少人收藏”的写法不许回来。
if grep -q '收藏 {isSaved ? 1 : 0}' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-SAVED-COUNT-001]: 0/1 假聚合回来了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/feed-saved-count.test.ts || exit $?
echo "    FEED-SAVED-COUNT-001: PASS (saved shows state, never a fabricated aggregate)"

# SCENE-FAVORITE-002: 用户报「home 场景点🤍 在我的 收藏没有」。
#
# 根因不是没接线，是「收藏」这一个词下面有两个互不相通的库：我的 → 收藏 读本机
# 场景 hearts（SCENE-FAVORITE-001），个人主页 → 收藏 tab 只读服务端帖子收藏 ——
# 对场景收藏的引用数是 0。用户在首页点了 🤍，去个人主页的收藏 tab 找，永远找不到；
# 而且只有场景收藏、没有帖子收藏时，那一屏还写着「还没有收藏」。
#
# SCENE-FAVORITE-001 当初只留了源码文本断言（"文件里有没有这个符号"）、没有进钉，
# 所以这个缺陷活了下来 —— 同族前科 22004f9（绿钉 + 用户可见缺陷同时成立）。
# 所以这条钉里必须有**行为**断言：解析函数对未知/重复 id 的真实行为。只 grep
# 符号在不在文件里，守不住「每条路径都走到」。
pnpm --filter @proxy/mobile exec vitest run src/scene-favorites.test.ts || exit $?
echo "    SCENE-FAVORITE-002: PASS (scene hearts reach both 收藏 surfaces, one shared resolver)"
# 反向钉：两个收藏面不许各写一遍目录回查 —— 那正是这个 bug 的漂移形状。
# 匹配的是调用形状（带括号），不是符号名：光出现在 import 里不算漂移。
if grep -q 'sceneMomentById(' apps/mobile/src/surfaces/me.tsx ||
   grep -q 'sceneMomentById(' apps/mobile/src/surfaces/me-orders.tsx; then
  echo "  FAIL [SCENE-FAVORITE-002]: 收藏面又自己写了一遍目录回查 ——" >&2
  echo "        两个面必须共用 resolveSavedSceneIds(ids, savedSceneLookup)。" >&2
  exit 1
fi

# MAIN-WIRING-SPLIT-001: cmd/api/main.go 曾是 1387 行的单文件接线根，
# 多 worktree 并行时 merge 冲突概率最高的单点。已按域拆成 wire_*.go
# （main 只留 main 函数），回潮就红。
if grep -q '^func seedPostgres\|^func configured\|^func newSupplyBatchCreator\|^func wireIdentity\|^func parseSMTPPortOrZero\|^func buildSMSProvider' apps/api-go/cmd/api/main.go; then
  echo "  FAIL [MAIN-WIRING-SPLIT-001]: 接线 helper 又堆回 main.go ——" >&2
  echo "        按域放 wire_*.go。" >&2
  exit 1
fi
if ! grep -q '^func configuredModelStack' apps/api-go/cmd/api/wire_providers.go ||
   ! grep -q '^func seedPostgresIdentity' apps/api-go/cmd/api/wire_seed.go ||
   ! grep -q '^func seedPostgresSupply' apps/api-go/cmd/api/wire_supply.go ||
   ! grep -q 'EnsureInvitationOrder' apps/api-go/cmd/api/wire_fulfillment.go; then
  echo "  FAIL [MAIN-WIRING-SPLIT-001]: wire_*.go 里少文件 ——" >&2
  exit 1
fi
echo "    MAIN-WIRING-SPLIT-001: PASS (api wiring stays split by domain)"
# ORPHAN-SWEEP-001: 孤儿代码只增不减 —— cmd/ 里的一次性查询脚本、
# 零 import 的 policy 草稿包，留着就是给后人埋"我以为接上了"的雷。
# 删过的东西回来、新的重号出现，门禁直接红。
if [ -e apps/api-go/cmd/qb ] || [ -e apps/api-go/cmd/qb2 ] || [ -e apps/api-go/cmd/qb3 ] || [ -e apps/api-go/cmd/qc ]; then
  echo "  FAIL [ORPHAN-SWEEP-001]: 一次性查询脚本又回到了 cmd/ ——" >&2
  echo "        扔 scripts/ 或删掉，不许和 api/worker/migrate 平级。" >&2
  exit 1
fi
if [ -e apps/api-go/internal/ai ] || [ -e apps/api-go/internal/creator ] || [ -e apps/api-go/internal/scale ]; then
  echo "  FAIL [ORPHAN-SWEEP-001]: 零 import 的孤儿包又回来了 ——" >&2
  echo "        接线了再建包，先建包后接线等于埋雷。" >&2
  exit 1
fi
# migration 序号：14 组历史重号（038/039/040 各 3 个，其余 2 个）是 grandfather，
# 只许减不许增 —— 新文件再撞号就红。改历史文件名更危险（已 apply 的库会重放），
# 所以存量不动，新号必须唯一。
DUP_PREFIXES=$(ls apps/api-go/migrations/*.sql | sed 's/.*\///' | cut -c1-3 | sort | uniq -c | sort -rn | awk '$1>1{print $2}' | tr '\n' ' ')
for known in 040 039 038 078 070 065 044 043 042 041 037 036 035 003; do
  DUP_PREFIXES=$(echo "$DUP_PREFIXES" | tr ' ' '\n' | grep -v "^${known}$" | tr '\n' ' ')
done
if [ -n "$(echo "$DUP_PREFIXES" | tr -d ' ')" ]; then
  echo "  FAIL [ORPHAN-SWEEP-001]: 新的 migration 撞号：$DUP_PREFIXES ——" >&2
  echo "        合并前先改成唯一序号，不要等最后合并的人手工救火。" >&2
  exit 1
fi
echo "    ORPHAN-SWEEP-001: PASS (no throwaway cmds, no orphan packages, no new migration collisions)"

# SHEET-ICONS-001: ＋ 面板的三个入口是图标块（名片/活动/位置），不是文字行。
# 拍照/选图/选视频都在相机图标的相册里 —— ＋ 里留任何一个都是第二条路。
if ! grep -q '| "pin"' apps/mobile/src/components/proxy-icon.tsx ||
   ! grep -q 'name="ticket"' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'SHEET-ICONS-001' apps/mobile/src/surfaces/convo-attach.test.ts; then
  echo "  FAIL [SHEET-ICONS-001]: 附件入口又退回纯文字行 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/convo-attach.test.ts || exit $?
echo "    SHEET-ICONS-001: PASS (attach entries are icon tiles, camera media stays in the album)"
# CONTACT-CARD-001: 名片 picker 曾经只有 UI 壳（setCardOptions 零调用，打开
# 永远转圈）。首项必须是"我自己的名片"，好友逐个解 handle、解不出的不列。
if ! grep -q 'setCardOptions(options)' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'CONTACT-CARD-001' apps/mobile/src/surfaces/contact-card.test.ts; then
  echo "  FAIL [CONTACT-CARD-001]: 名片 picker 又没数据源了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/contact-card.test.ts || exit $?
echo "    CONTACT-CARD-001: PASS (picker backed by profile + friendships, fail-closed)"
# SEND-NONBLOCK-001: 发出去就放行 composer，不等 AI 回复。回退（canSend 里
# 再出现 !sending 之类）会让"发完位置必须等回复"重现。
if grep -q '!sending' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'pendingReplies > 0 && aiAccount' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'SEND-NONBLOCK-001' apps/mobile/src/surfaces/send-nonblock.test.ts; then
  echo "  FAIL [SEND-NONBLOCK-001]: composer 又被在途请求按住了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/send-nonblock.test.ts || exit $?
echo "    SEND-NONBLOCK-001: PASS (composer released on paint, reply counter drives typing)"
# QUOTE-REPLY-001: 引用靠消息 ID，不靠文字快照。回退（只传快照不传 ID、
# 或 hydrate 不解析）会让对方收到孤立消息、AI 拿不到引用上下文。
if ! grep -q 'replyToMessageId' apps/mobile/src/conversation-client.ts ||
   ! grep -q 'byId.get(m.replyToMessageId)' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'QUOTE-REPLY-001' apps/mobile/src/surfaces/quote-reply.test.ts ||
   ! grep -q 'reply_to' apps/api-go/migrations/101_message_reply_to.sql; then
  echo "  FAIL [QUOTE-REPLY-001]: 引用又退回本地快照了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/quote-reply.test.ts || exit $?
echo "    QUOTE-REPLY-001: PASS (quotes by ID end to end, foreign/missing rejected)"
# NEARBY-SPOTS-001: 推荐地点必须是 3km 真数据。回退（路由没挂/客户端不用/
# 又写死景点）会让"推荐发不出去"重现。
if ! grep -q '"/v1/places/nearby", s.nearbyPlaces' apps/api-go/internal/api/server.go ||
   ! grep -q 'fetchNearbySpots(baseUrl' apps/mobile/src/components/location-picker-sheet.tsx ||
   ! grep -q 'NEARBY-SPOTS-001' apps/mobile/src/nearby-spots.test.ts; then
  echo "  FAIL [NEARBY-SPOTS-001]: 推荐地点又退回硬编码了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/nearby-spots.test.ts || exit $?
echo "    NEARBY-SPOTS-001: PASS (3km live spots, hardcoded presets are fallback only)"
# FEED-FRESH-001: 自己刚发的帖子在动态看不到。回退（发布后重载不穿缓存、
# "展示最新"替换时间线）会让发帖人当场找不到自己的帖子。
if ! grep -q 'await loadFeed(undefined, true)' apps/mobile/src/surfaces/feed.tsx ||
   ! grep -q 'setPosts(cachedPosts)' apps/mobile/src/surfaces/feed.tsx ||
   ! grep -q 'FEED-FRESH-001' apps/mobile/src/feed-fresh.test.ts; then
  echo "  FAIL [FEED-FRESH-001]: 新帖又在动态里隐身了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/feed-fresh.test.ts || exit $?
echo "    FEED-FRESH-001: PASS (post-publish reload bypasses cache, pill merges)"
# AUDIT-BATCH3-001: 第五~九轮 P0 小项合集（纯移动端，无后端变更）。
# SHARE-LINK-001 分享链接写死测试账号 / FAVORITES-REAL-001 收藏两条假记录 /
# LEGAL-BANNER-001 法律横幅从没挂载 / ANALYTICS-HONEST-001 漏斗文案自相矛盾 /
# FOLLOWER-FACES-001 假脸配真数字。逐条有命名测试，丢一条这里红。
if ! grep -q 'pxy.app/${shareHandle}/social' apps/mobile/src/surfaces/me.tsx ||
   ! grep -q '还没有收藏列表' apps/mobile/src/surfaces/me-orders.tsx ||
   ! grep -q '<LegalStatusBanner' apps/mobile/src/shell/app-shell.tsx ||
   # PROFILE-VISIT-001 之后「主页访问」接了 ListProfileViewStats，不再纯示例，
   # 副标题改成区分「这一步真实 / 其余仍是示例」的措辞，不再是笼统的
   # "示例数据 · 真实统计即将上线"。钉的是"不许自相矛盾地宣称只看真数据"，
   # 不是那句旧文案。
   ! grep -q '主页访问是真实数据；往后每一步和下方渠道来源仍是示例' apps/mobile/src/surfaces/me.tsx ||
   ! grep -q 'AUDIT-BATCH3-00' apps/mobile/src/surfaces/me-audit-batch3.test.ts; then
  echo "  FAIL [AUDIT-BATCH3-001]: 审计小项修复丢了 ——" >&2
  exit 1
fi
# 反向钉：写死的测试账号链接 / 两条假收藏 / 假脸不许回来。
if grep -q 'pxy.app/huyen/social' apps/mobile/src/surfaces/me.tsx ||
   grep -q 'Luna Spa' apps/mobile/src/surfaces/me-orders.tsx ||
   grep -q 'styles.personalFaces' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [AUDIT-BATCH3-001]: 假数据回来了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/me-audit-batch3.test.ts || exit $?
echo "    AUDIT-BATCH3-001: PASS (share link, favorites, legal banner, analytics copy, follower faces)"
# BADGE-WALL-001: 个人徽章墙 + 场景进度。10 枚成就只管“得没得”，墙和进度
# 要的是“还差几家”—— 打卡史（all-time，取消即删）是唯一诚实来源，有效期
# 内的 here 集合不行（过期就缩水）。新命令 ListMyCheckinHistory 不做迁移
# （查的现成表），openapi 重生成。
require_test "BADGE-WALL-001" "./internal/realityscene" \
  "TestCheckinHistoryIgnoresExpiryButNotCancel" \
  "apps/api-go/internal/realityscene/badges_test.go" || exit $?
require_test "BADGE-WALL-001" "./internal/realityscene" \
  "TestListMyCheckinHistoryCommand" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
require_test "BADGE-WALL-001" "./internal/platform/postgres" \
  "TestCheckinHistoryPostgresRoundTrip" \
  "apps/api-go/internal/platform/postgres/reality_history_integration_test.go" || exit $?
if ! grep -q 'ListMyCheckinHistory' apps/api-go/internal/platform/postgres/reality_scene.go ||
   ! grep -q 'listMyCheckinHistory()' apps/mobile/src/scene-client.ts ||
   ! grep -q 'badgeProgress(' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'badgeGrid' apps/mobile/src/surfaces/me.tsx ||
   ! grep -q 'BADGE-WALL-001' apps/mobile/src/surfaces/scene-badge-wall.test.ts; then
  echo "  FAIL [BADGE-WALL-001]: 徽章墙/进度链路断了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/scene-badge-wall.test.ts || exit $?
echo "    BADGE-WALL-001: PASS (wall on personal hub, progress on scene pages)"
# UNREAD-PIPELINE-001: 未读徽标和在线圆点在真实数据流里永远不亮。
#
# 根因三段：阅读位存储早就有（ReadCursor＋表）但零写入零聚合；
# toDialog 不赋值；打开会话不上报。修法：MarkDialogRead 命令（打开标一次，
# 不跟轮询）＋ list 下发未读数 ＋ 端上映射。在线圆点没有数据源，直接删掉，
# 不编 presence —— 那是另立项的事。
# 两个诚实细节：PG 落库不存 seq，全零 Seq 靠时间兜底；从没标过全量计入一次。
require_test "UNREAD-PIPELINE-001" "./internal/conversation" \
  "TestMarkDialogReadFlow" \
  "apps/api-go/internal/conversation/unread_test.go" || exit $?
require_test "UNREAD-PIPELINE-001" "./internal/conversation" \
  "TestMarkDialogReadRejectsOutsider" \
  "apps/api-go/internal/conversation/unread_test.go" || exit $?
require_test "UNREAD-PIPELINE-001" "./internal/conversation" \
  "TestCountUnreadEdges" \
  "apps/api-go/internal/conversation/unread_test.go" || exit $?
require_test "UNREAD-PIPELINE-001" "./internal/platform/postgres" \
  "TestDialogReadCursorPostgresRoundTrip" \
  "apps/api-go/internal/platform/postgres/dialog_cursor_integration_test.go" || exit $?
if ! grep -q 'WithDialogs(postgres.NewDialogRepository(pool))' apps/api-go/cmd/api/main.go ||
   ! grep -q 'case "MarkDialogRead":' apps/api-go/internal/conversation/service.go ||
   ! grep -q 'markDialogRead(convId)' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -q 'UNREAD-PIPELINE-001' apps/mobile/src/surfaces/messages-unread.test.ts; then
  echo "  FAIL [UNREAD-PIPELINE-001]: 未读链路又断了 ——" >&2
  echo "        徽标没数据，或打开不上报。" >&2
  exit 1
fi
# 反向钉：在途曾经有在线圆点但全仓无数据源，删了就别回来。
if grep -q 'styles.online' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [UNREAD-PIPELINE-001]: 在线圆点又回来了 ——" >&2
  echo "        先建 presence 系统再画点。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/messages-unread.test.ts || exit $?
echo "    UNREAD-PIPELINE-001: PASS (unread badge has real data, online dot removed)"
# 反向钉：相机媒体不许回流到 ＋ 面板（跟相机图标里的相册打架）。
if grep -q '>视频</Text>' apps/mobile/src/surfaces/conversation.tsx ||
   grep -q '>照片</Text>' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [SHEET-ICONS-001]: 相机媒体又在 ＋ 里单开了入口 ——" >&2
  exit 1
fi
# CONVO-AVATAR-PROFILE-001: 对话窗口点头像必须直达对方个人主页。
#
# 根因三段：toDialog 把 counterpartyId 丢了（Dialog 类型里就没有 userId，
# 进了对话窗口只剩一个名字）；ConversationSurface 的头像是纯展示（气泡和
# 顶栏都没有 Pressable）；even 名字都解析不了 —— Message 只有 sender 显示名。
# 修法：counterpartyId 从 inbox 一路透到 ConversationSurface（peerUserId），
# 气泡头像 + 顶栏头像都可点；没 id 的靠名字精确匹配（有且仅有一个才进，
# 否则明说）；点头像直达主页（Rev241 之前是弹中间关注 sheet，已退役 ——
# 他人主页自带关注按钮，少一次挡路确认）。
# 钉整条调用链：任何一段断了，现象都是"点了没反应"，和断的是哪段无关。
if ! grep -qF 'peerUserId' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'peerUserId: item.counterpartyId' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'peerUserId?: string' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'onOpenPeerProfile={openPeerProfile}' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'onOpenPeerProfile' apps/mobile/src/surfaces/conversation.tsx ||
   ! grep -qF 'setOpenHumanProfile' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [CONVO-AVATAR-PROFILE-001]: 对话头像进主页链路断了 ——" >&2
  echo "        现象永远是点了没反应，查三段（透传/入口/开主页）即可定位。" >&2
  exit 1
fi
# Rev241 退役反向钉：点头像直达主页，不再弹中间 sheet —— 他人主页自带
# 关注/取关按钮（other-profile.tsx toggleFollow + isFollowing），关注链不断，
# 只少一次挡路确认。钉改为守新行为：不许悄悄加回盖在主页上的中间 sheet。
if grep -qF 'PeerFollowPromptSheet' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [CONVO-AVATAR-PROFILE-001]: 中间关注 sheet 又被加回来了 ——" >&2
  echo "        Rev241 已定点头像直达主页，关注走他人主页自己的按钮。" >&2
  exit 1
fi
echo "    CONVO-AVATAR-PROFILE-001: PASS (conversation avatar opens profile directly, no blocking sheet)"
# 有真人 id 就建真人 DM —— 挂载 fallback 再敢用 user_proxy_ai，真人对话又会被
# 吞进助手串（Hana 事件）。问助手类入口（没 id）才允许走 fallback。
if ! grep -qF 'originId: peerUserId, participantId: peerUserId' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [CONVO-AVATAR-PROFILE-001]: 真人建会话又 fallback 到 user_proxy_ai ——" >&2
  echo "        Hana 会再次变成 AI助手。" >&2
  exit 1
fi
# ASSISTANT-THREAD-001: AI 助手有且仅有一个，对话列表只露一行（proxy_ai/AI助手）。
#
# 根因：proxy_ai（首页助手）和 user_proxy_ai（任务/帖子上下文助手）是同一个
# 助手的两个入口，但建会话与列收件箱都按 counterparty 原样处理 —— 每换一个
# 入口就多一行，收件箱里出现 ai_001/user_proxy_ai/proxy_ai 三个"助手"。
# ai_account_*（AI 小美等用户自选陪伴）与真人一样是「用户」，不在归一范围；
# 真人会话（哪怕 AI 接管）更不能动。
# 修法：建会话时助手入口复用该用户最新的助手串（分隔符留痕）；列表按
# canonical key 收敛，行身份永远是 proxy_ai / AI助手；旧串保留可读，
# 只是不再列出。客户端助手行挂 logo、不可点（没有主页）。
require_test "ASSISTANT-THREAD-001" "./internal/conversation" \
  "TestAssistantConversationsUnifyIntoOneThread" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
if ! grep -qF 'isAssistantCounterparty' apps/api-go/internal/conversation/service.go ||
   ! grep -qF 'canonicalAssistantCounterparty' apps/api-go/internal/conversation/service.go ||
   ! grep -qF 'latestAssistantConversation' apps/api-go/internal/conversation/service.go; then
  echo "  FAIL [ASSISTANT-THREAD-001]: 助手归一逻辑不见了 ——" >&2
  echo "        收件箱会重新冒出多个助手行。" >&2
  exit 1
fi
if ! grep -qF 'ASSISTANT_LOGO' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'peerIsAssistant' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [ASSISTANT-THREAD-001]: 助手行 logo / 不可点不见了 ——" >&2
  echo "        助手头像必须是 logo，且没有主页可点。" >&2
  exit 1
fi
echo "    ASSISTANT-THREAD-001: PASS (one assistant thread, logo avatar, companions and humans untouched)"
# CONVO-LIST-BLOCKED-001: 模型生成期间列表不能被堵住。
#
# 根因：HandleContext 对整条命令持有 s.mu，而 start/send 里的 generateAIReply
# 一次要几秒 —— 生成期间 ListConversations 也在排队，客户端列表一直"加载中"
# 直到 AI 回复出来。修法不是去锁（Seq 分配还要串行），而是只在模型调用期间
# 松开（withModelUnlocked，defer 配平防 panic 后 fatal）。
# 反向验证过：只解开一起始 site，门控测试 3.5s 红。
require_test "CONVO-LIST-BLOCKED-001" "./internal/conversation" \
  "TestListConversationsNotBlockedByModelGeneration" \
  "apps/api-go/internal/conversation/service_test.go" || exit $?
if ! grep -qF 'withModelUnlocked(func() *Message {' apps/api-go/internal/conversation/service.go ||
   ! grep -qF 's.mu.Unlock()' apps/api-go/internal/conversation/service.go; then
  echo "  FAIL [CONVO-LIST-BLOCKED-001]: 模型调用又抱着全局锁跑了 ——" >&2
  echo "        AI 生成几秒，列表就转圈几秒。" >&2
  exit 1
fi
echo "    CONVO-LIST-BLOCKED-001: PASS (list stays responsive during model generation)"
# TWIN-CENTER-001/002: 分身列表与收回授权。分身中心之前是纯静态 showcase，
# Twin 列表写死 Linh/Mai、「创建」按钮 onPress 是空函数。后端其实早有
# CreatePersona/GrantConsent，只是缺列表与收回两个口子，移动端零接线。
require_test "TWIN-CENTER-001" "./internal/api" \
  "TestListPersonasNewestFirst" \
  "apps/api-go/internal/api/aipersona_personas_test.go" || exit $?
require_test "TWIN-CENTER-002" "./internal/api" \
  "TestGrantRevokeConsentRoundTrip" \
  "apps/api-go/internal/api/aipersona_personas_test.go" || exit $?
# 移动端那一段曾经钉的是分身客户端的「列出我的分身」方法名，但它在这一屏里
# **只出现在一句注释中**（而那句注释本身也已经过期：三段实际走的是「找出已授权
# 的那个分身」而不是「列出全部取第一个」）⇒ 删掉真接线这条钉照样绿，是一颗假守卫。
# 换成两个会真的失败的点：这一屏必须真的挂载分身段，段内必须真的从服务端解析分身。
if ! grep -qF 'func (s *Server) listPersonas' apps/api-go/internal/api/aipersona_handlers.go ||
   ! grep -qF 'func (s *Server) revokeConsent' apps/api-go/internal/api/aipersona_handlers.go ||
   ! grep -qF 'func (s *Service) RevokeLiveConsent' apps/api-go/internal/aipersona/personas.go ||
   ! grep -qF 'class AiPersonaClient' apps/mobile/src/ai-persona-client.ts ||
   ! grep -qF '<TwinGallerySection' apps/mobile/src/surfaces/AIIdentityShowcaseSurface.tsx ||
   ! grep -qF 'personaClient.findAuthorizedTwin(ownerId)' apps/mobile/src/components/twin-gallery-section.tsx; then
  echo "  FAIL [TWIN-CENTER]: 分身真接线不见了 ——" >&2
  echo "        列表/收回接口、client、分身段真列表，少一段就回到假数据。" >&2
  exit 1
fi
echo "    TWIN-CENTER: PASS (persona list + revoke wired end to end)"
# AI-CLUSTER-BOUNDARY-001: AI 分身中心只管「分身的数字资产」（形象授权 + 授权后
# 生成的照片/视频）。访问战绩与活动日志归「好友与关系」。
#
# 这一屏曾经同时挂着两块不属于它的东西：TWIN-SIGNALS-001 / MEDIA-DWELL-001 的
# 「动态数据」（谁看了你的动态、看了多久、逐张照片停留）和 R15.78 的「审计日志」
# 静态 mock。前者跟好友与关系屏的 PROFILE-VIEWERS-001 / VIEWER-ACTIVITY-001 是
# 同一份 MEDIA-DWELL-001 数据，两屏各画了一遍。边界写在 me.tsx 的
# AI-FACET-CLUSTER-001：好友与关系管运营 · AI 分身出内容 · FACET 管投放。
#
# 两向都要钉：只钉「摘掉」会把数据删掉（摘了没人接），只钉「接住」会让越界悄悄回来。
# 正向钉必须**先剥注释再 grep** —— 这两个文件自己的注释里就写着「审计日志」
# 「动态数据」「动态浏览」（说明为什么搬走），不剥的话钉会被自己的注释喂绿。
ai_cluster_ai=$(grep -vE '^[[:space:]]*(//|\{/\*)' apps/mobile/src/surfaces/AIIdentityShowcaseSurface.tsx)
if printf '%s\n' "$ai_cluster_ai" | grep -qE 'listPostImpressionStats|listMediaImpressionStats|AUDIT_ROWS|AuditTable|styles\.twinStatRow|styles\.twinMediaRow'; then
  echo "  FAIL [AI-CLUSTER-BOUNDARY-001]: AI 分身中心又长回了访问战绩 / 活动日志 ——" >&2
  echo "        那一屏只该管分身的数字资产；谁看了我的动态、看了多久归「好友与关系」。" >&2
  exit 1
fi
ai_cluster_crm=$(grep -vE '^[[:space:]]*(//|\{/\*)' apps/mobile/src/surfaces/friend-crm.tsx)
if ! printf '%s\n' "$ai_cluster_crm" | grep -qF 'listPostImpressionStats' ||
   ! printf '%s\n' "$ai_cluster_crm" | grep -qF '动态浏览'; then
  echo "  FAIL [AI-CLUSTER-BOUNDARY-001]: 动态浏览战绩没落在「好友与关系」里 ——" >&2
  echo "        从 AI 分身摘掉却没人接住，等于把 TWIN-SIGNALS-001 / MEDIA-DWELL-001 的数据删了。" >&2
  exit 1
fi
echo "    AI-CLUSTER-BOUNDARY-001: PASS (AI 分身只管资产；动态浏览归好友与关系)"
# AGE-BACKFILL-001: 老账号补年龄断言。COMP-AGE-001 之前注册的号零年龄证据，
# 分身门禁 fail-closed 全拒，而注册只收一次出生日期 —— 没有这个口，
# 老号永远建不了分身，且只能看到英文原文。
require_test "AGE-BACKFILL-001" "./internal/identity" \
  "TestBackfillRecordsWithBackfillSource" \
  "apps/api-go/internal/identity/age_assertion_backfill_test.go" || exit $?
require_test "AGE-BACKFILL-001" "./internal/api" \
  "TestRecordAgeAssertionRequiresToken" \
  "apps/api-go/internal/api/age_assertion_test.go" || exit $?
if ! grep -qF 'SELF_DECLARED_BACKFILL' apps/api-go/internal/identity/service.go ||
   ! grep -qF 'recordAgeAssertion' apps/mobile/src/ai-persona-client.ts ||
   ! grep -qF 'TwinNoAgeEvidenceError' apps/mobile/src/ai-persona-client.ts; then
  echo "  FAIL [AGE-BACKFILL-001]: 补年龄断言链路不见了 ——" >&2
  echo "        老号又会卡在英文 no age evidence 上。" >&2
  exit 1
fi
echo "    AGE-BACKFILL-001: PASS (old accounts can backfill age assertion)"
# TWIN-SIGNALS-001: 曝光带停留入库 + 战绩读侧。interaction_events 表早有
# watch_ms 列但服务端从不写、移动端从不上报 —— "看了几次看多久"没有数据源。
require_test "TWIN-SIGNALS-001" "./internal/localnet" \
  "TestPostImpressionStatsRoundTrip" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
if ! grep -qF 'WatchMs' apps/api-go/internal/localnet/service.go ||
   ! grep -qF 'ListPostImpressionStats' apps/api-go/internal/localnet/service.go ||
   ! grep -qF 'recordPostImpression' apps/mobile/src/localnet-client.ts ||
   ! grep -qF 'endPostView' apps/mobile/src/post-impression.ts; then
  echo "  FAIL [TWIN-SIGNALS-001]: 曝光停留链路不见了 ——" >&2
  echo "        战绩页又会回到没有数据源。" >&2
  exit 1
fi
echo "    TWIN-SIGNALS-001: PASS (impression watch time stored and readable)"
# CONTENT-ANALYTICS-001: 浏览日志分层。用户侧只拿近 30 天的聚合（分析面板 + 折叠的逐条统计）；
# 逐人明细（谁、看了几秒、放大几次）只给运营（ANALYTICS scope），用于精准投流；服务端事件全量保存。
# 链路：信息流卡片曝光 + 全屏逐张停留 + 放大都要上报（审计时发现信息流一条都不报）。
require_test "CONTENT-ANALYTICS-001" "./internal/api" "TestPerPersonViewingDetailIsOperatorOnly" \
  "apps/api-go/internal/api/content_analytics_tier_test.go" || exit $?
for t in TestUserStatsOnlyLoadTheLastMonthButEveryEventIsKept TestOperationsAudienceHasDwellAndZoomPerPerson; do
  require_test "CONTENT-ANALYTICS-001" "./internal/localnet" "$t" \
    "apps/api-go/internal/localnet/content_analytics_test.go" || exit $?
done
ca_crm=$(grep -vE '^[[:space:]]*(//|\{/\*)' apps/mobile/src/surfaces/friend-crm.tsx)
if printf '%s\n' "$ca_crm" | grep -qF 'listMediaActivityForViewer' ||
   ! printf '%s\n' "$ca_crm" | grep -qF 'getContentAnalytics' ||
   ! grep -qF 'useFeedImpressions(localNet' apps/mobile/src/surfaces/feed.tsx ||
   ! grep -qF 'recordMediaZoom' apps/mobile/src/media/AdaptiveMediaCollection.tsx; then
  echo "  FAIL [CONTENT-ANALYTICS-001]: 用户侧又拿到逐人浏览明细 / 分析面板没了 / 信息流曝光或放大不再上报。" >&2
  exit 1
fi
echo "    CONTENT-ANALYTICS-001: PASS (user side aggregates only; per-person detail is operator-only; feed + zoom logged)"
# ANALYTICS-ME-001: 「我的」分析弹层浏览/互动曾写死 "—"。浏览 = 近 30 天主页
# 访问（ListProfileViewStats 传 sinceDays，全量口径留给 friend-crm）；互动 =
# 近 30 天收到的赞 + 评论（GetReceivedEngagementStats 服务端聚合，自赞/自评
# 排除，客户端不做 N+1）。拉失败是未知画 —，不画 0。
require_test "ANALYTICS-ME-001" "./internal/engagement" \
  "TestReceivedEngagementStatsCountsOthersActionsInWindow" \
  "apps/api-go/internal/engagement/service_test.go" || exit $?
require_test "ANALYTICS-ME-001" "./internal/localnet" \
  "TestProfileViewStatsSinceDaysWindow" \
  "apps/api-go/internal/localnet/service_test.go" || exit $?
require_test "ANALYTICS-ME-001" "./internal/platform/postgres" \
  "TestReceivedEngagementPostgresRoundTrip" \
  "apps/api-go/internal/platform/postgres/engagement_received_stats_integration_test.go" || exit $?
require_test "ANALYTICS-ME-001" "./internal/platform/postgres" \
  "TestProfileViewStatsSinceDaysPostgresRoundTrip" \
  "apps/api-go/internal/platform/postgres/localnet_integration_test.go" || exit $?
if ! grep -qF 'GetReceivedEngagementStats' apps/api-go/openapi.commands.generated.yaml ||
   ! grep -qF 'getReceivedEngagementStats()' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'listProfileViewStats(30)' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'dash(profileAnalytics.interactions)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ANALYTICS-ME-001]: 分析弹层又回到写死 —，浏览/互动没接数据源。" >&2
  exit 1
fi
echo "    ANALYTICS-ME-001: PASS (sheet wired to 30d views + received likes/comments)"
# MODAL-HANDOFF-001: 关一个 Modal 同一 tick 再开另一个，后开的被 iOS
# present 冲突吃掉（点了没反应）。统一走 openModalAfterClose 错峰 350ms。
if ! grep -qF 'openModalAfterClose' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'pendingModalTimer' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [MODAL-HANDOFF-001]: Modal 错峰 helper 不见了 ——" >&2
  echo "        同 tick 一关一开又会点不开。" >&2
  exit 1
fi
echo "    MODAL-HANDOFF-001: PASS (sequential modals staggered)"
# AVATAR-RESOLUTION-001: fixture id（u_linh）不能直接当账号用。
# 首页 fixture id 与服务端真账号（user_mockcreator_linh）是两套 id，
# 拿 fixture id 建会话/开主页/查资料会落到幽灵 id：头像 404 空白、关注落空、
# 动态扫不到。入口统一先 resolveHomePersonAccountId；裸 ai_001 认成对应伴侣；
# 坏图三处（列表/联系人/对话窗）回落首字母，永不空白。
if ! grep -qF 'resolveHomePersonAccountId' apps/mobile/src/recommend-fixtures.ts ||
   ! grep -qF 'resolveHomePersonAccountId' apps/mobile/src/shell/app-shell.tsx ||
   ! grep -qF 'account.personaId === item.counterpartyId' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'resolveAvatarSource(avatarRef' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'markAvatarBroken' apps/mobile/src/surfaces/messages.tsx ||
   ! grep -qF 'brokenPeerAvatar' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [AVATAR-RESOLUTION-001]: 头像解析链路不见了 ——" >&2
  echo "        幽灵 id 空白头像会回来。" >&2
  exit 1
fi
echo "    AVATAR-RESOLUTION-001: PASS (fixture ids resolve to real accounts, broken images fall back)"
# HIDE-RESURFACE-001: 滑删 = dismiss 当前视图，来新动态即回；block 才彻底。
# 左滑隐藏没有恢复口、藏了连新消息都不浮出来，等于"对方发消息我永远看不到"
# （Linh 行消失事件）。隐藏集记时刻（id → 藏起毫秒），行最后动态晚于藏起
# 时刻就浮出来；v1 纯 id 老文件按升级时刻迁移。不另做恢复口 —— 有新动态自回，
# 没新动态就继续藏着。
if ! grep -qF 'shouldResurfaceHidden' apps/mobile/src/local-snapshot.ts ||
   ! grep -qF 'parseHiddenChatTimes' apps/mobile/src/local-snapshot.ts ||
   ! grep -qF 'shouldResurfaceHidden(hiddenIds[d.id], d.lastActivityMs)' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [HIDE-RESURFACE-001]: 隐藏会话又不浮出来了 ——" >&2
  echo "        新消息进隐藏串等于石沉大海。" >&2
  exit 1
fi
echo "    HIDE-RESURFACE-001: PASS (hidden threads resurface on new activity)"
# SCENE-CHECKIN-FRESH-001: 定位有保质期，过期不打。
#
# 根因：origin 落定就冻住 —— 离店不更新，90 分钟打卡过期后重进详情，
# 又按旧坐标自动打一次（在家给店打卡，重复幽灵打卡）。修法：每次落定位
# 打时间戳，超过 10 分钟门禁不再认（自动和手动同一口径）；详情打开时过期
# 就后台静默重取（不申请权限），久坐的无感续上，离店的拿回真坐标被拒。
if ! grep -qF 'ORIGIN_FRESH_MS' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -qF 'originFresh()' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -qF 'setOriginAt(Date.now())' apps/mobile/src/surfaces/reality-scene-map.tsx; then
  echo "  FAIL [SCENE-CHECKIN-FRESH-001]: 定位新鲜度门禁不见了 ——" >&2
  echo "        冻住的旧坐标又能自动打卡。" >&2
  exit 1
fi
echo "    SCENE-CHECKIN-FRESH-001: PASS (stale fixes cannot check in)"
# TOPIC-INVITE-001: 原型"加入 · 邀请她"按主题邀约 —— 没有 task/slot/金额，
# 与档位 Offer 共用生命周期，TTL 默认 60s（原型 60 秒倒计时）。
# 坑有三处，钉死：① 主题订单 task/slot 存 NULL（不是 ""），否则唯一索引
# 把第二个主题订单当"同一个档位卖两次"拒掉（memory 仓同规则）；
# ② 拒绝记 REJECTED 不是 CANCELLED（取消是需求方的动作）；
# ③ 体解析失败不许按默认拒绝处理（会把坏请求误判成拒单）。
require_test "TOPIC-INVITE-001" "./internal/fulfillment" \
  "TestCreateTopicInviteDefaultsSixtySeconds" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
require_test "TOPIC-INVITE-001" "./internal/fulfillment" \
  "TestRespondTopicInviteAcceptDeclineAndExpiry" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
require_test "TOPIC-INVITE-001" "./internal/fulfillment" \
  "TestTwoTopicOrdersDoNotTripSlotUniqueness" \
  "apps/api-go/internal/fulfillment/service_test.go" || exit $?
if ! grep -qF 'CreateTopicInvite' apps/api-go/internal/fulfillment/service.go ||
   ! grep -qF 'RespondTopicInvite' apps/api-go/internal/fulfillment/service.go ||
   ! grep -qF 'offerTTLSeconds' apps/api-go/internal/fulfillment/service.go; then
  echo "  FAIL [TOPIC-INVITE-001]: 主题邀约命令不见了 ——" >&2
  echo "        原型邀请链又只能走档位 Offer。" >&2
  exit 1
fi
echo "    TOPIC-INVITE-001: PASS (topic invites reuse the offer lifecycle)"
# STORE-AMENITIES-001: 门店设施属性商家自填（网速/吸烟/空调/插座/噪音/座位）。
# 原型标记的数据源必须是商家自己填的，不能是平台编的。空=没填（不显示不筛选）；
# 封闭词表外整单拒绝（不静默丢字段）；空调 16..30 度整数，0=没填。
require_test "STORE-AMENITIES-001" "./internal/business" \
  "TestStoreLinesAmenitiesRoundTrip" \
  "apps/api-go/internal/business/service_test.go" || exit $?
# 2026-09-19：中间那条原来是 `grep -qF '104_store_amenities' .../104_store_amenities.sql`
# —— 让文件 grep 自己的文件名。全仓 121 个迁移文件没有一个自报名字，这个条件
# 恒假，也就是说这条钉从被写出来起就没绿过（门禁每次都在更前面就退出了）。
# 改成钉真东西：迁移文件在、字段是幂等新增的、客户端类型在。
if ! grep -qF 'allowedStoreWifi' apps/api-go/internal/business/service.go ||
   ! [ -f apps/api-go/migrations/104_store_amenities.sql ] ||
   ! grep -qF 'ADD COLUMN IF NOT EXISTS wifi' apps/api-go/migrations/104_store_amenities.sql ||
   ! grep -qF 'ADD COLUMN IF NOT EXISTS ac_temp_c' apps/api-go/migrations/104_store_amenities.sql ||
   ! grep -qF 'StoreAmenities' apps/mobile/src/business-client.ts; then
  echo "  FAIL [STORE-AMENITIES-001]: 设施属性字段不见了 ——" >&2
  echo "        原型标记又会回到没有数据源。" >&2
  exit 1
fi
echo "    STORE-AMENITIES-001: PASS (merchant-entered shop amenities)"

# MARKET-DEAD-MORE-001: 头部「•••」是死按钮 —— 长成按钮，没有 Pressable、没有
# onPress。四处 header（订单详情 / 发布需求模板页 / 发布需求表单 / 选人工作台）
# 各挂一个。删掉而不是留着：一个按不动的按钮在承诺一个不存在的菜单。
# （2026-09-19 重建：第一版连同代码一起被别人的 index-only 提交扫掉了。）
if ! grep -q 'MARKET-DEAD-MORE-001' apps/mobile/src/surfaces/market-publish-honest.test.ts; then
  echo "  FAIL [MARKET-DEAD-MORE-001]: 死按钮的钉子不见了 ——" >&2
  exit 1
fi
if grep -qF '•••' apps/mobile/src/surfaces/market.tsx ||
   grep -qF 'detailMore' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [MARKET-DEAD-MORE-001]: 死掉的「更多」按钮又回来了 ——" >&2
  echo "        要么接上真菜单，要么别画这个按钮。" >&2
  exit 1
fi
# PUBLISH-NO-FAKE-DEFAULT-001: 发布表单预填"看起来真实的"内容 —— 用户不改直接
# 发布，就产出一条自己没写过的假需求（时间/地点/价格全是编的）。从空开始，
# 示例走 placeholder；选模板/预设时才回填真值。
if ! grep -q 'PUBLISH-NO-FAKE-DEFAULT-001' apps/mobile/src/surfaces/market-publish-honest.test.ts; then
  echo "  FAIL [PUBLISH-NO-FAKE-DEFAULT-001]: 预填假需求的钉子不见了 ——" >&2
  exit 1
fi
if grep -qE 'useState\("(周六|河内|10:00|[0-9],)' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [PUBLISH-NO-FAKE-DEFAULT-001]: 发布表单又开始预填了 ——" >&2
  echo "        示例放 placeholder，别放进 state 初始值。" >&2
  exit 1
fi
if ! grep -qF 'const [title, setTitle] = useState("");' apps/mobile/src/surfaces/market.tsx ||
   ! grep -qF 'const [time, setTime] = useState("");' apps/mobile/src/surfaces/market.tsx ||
   ! grep -qF 'const [location, setLocation] = useState("");' apps/mobile/src/surfaces/market.tsx ||
   ! grep -qF 'const [priceMin, setPriceMin] = useState("");' apps/mobile/src/surfaces/market.tsx; then
  echo "  FAIL [PUBLISH-NO-FAKE-DEFAULT-001]: 发布字段不再从空开始 ——" >&2
  exit 1
fi
# OPP-TYPE-OTHER-001: 关键词一个都不中时归未分类，不再硬塞 coffee_photo ——
# 那会把「咖啡 + 拍照」稀释成垃圾桶，筛选也会把无关机会算进来。
if ! grep -q 'OPP-TYPE-OTHER-001' apps/mobile/src/surfaces/market-publish-honest.test.ts; then
  echo "  FAIL [OPP-TYPE-OTHER-001]: 未分类兜底的钉子不见了 ——" >&2
  exit 1
fi
if grep -qF 'return "coffee_photo";' apps/mobile/src/surfaces/r37-opportunity-card.tsx; then
  echo "  FAIL [OPP-TYPE-OTHER-001]: 未分类又被硬归成咖啡 + 拍照了 ——" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/surfaces/market-publish-honest.test.ts || exit $?
echo "    MARKET-DEAD-MORE-001: PASS (no dead more button anywhere in market)"
echo "    PUBLISH-NO-FAKE-DEFAULT-001: PASS (publish form starts empty, examples are placeholders)"
echo "    OPP-TYPE-OTHER-001: PASS (unknown opportunity type is uncategorised, not coffee+photo)"

# SCENE-HUMANS-EMPTY-001: 选人是付费决策点 —— 没有人时必须说出"没有人"，不能
# 只留标题和一个空横滑（那会被读成"还在加载"）。SCENE-HUMANS-004 只做了去重，
# 空态是另一件事。
if ! grep -q 'detail.humans.length > 0 ?' apps/mobile/src/surfaces/reality-scene-map.tsx ||
   ! grep -q 'SCENE-HUMANS-EMPTY-001' apps/mobile/src/scene-humans.test.ts; then
  echo "  FAIL [SCENE-HUMANS-EMPTY-001]: 人选空态不见了 ——" >&2
  echo "        用户正准备付钱，这块空着会被读成「加载中」。" >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/scene-humans.test.ts || exit $?
echo "    SCENE-HUMANS-EMPTY-001: PASS (no people is stated, not left blank)"

# COMP-EPHEMERAL-001（合规约束，不得回退）：阅后即焚 / 查看上限 / 防截屏在
# **付费会话**（OriginType TASK / SERVICE / ACTIVITY / NEED / OFFER / ORDER）
# 必须被禁用 —— 服务端强制，客户端不可覆盖。
# 出处：docs/design/references/Proxy_Chat_Aligned_With_LotusChat_v0.1.md
#   「功能层面的硬性约束（不得回退）」第 1 条。
#
# 2026-09-19 实录：我曾把收件人侧的阅览次数消耗接上（让「看一次就销毁」真的烧），
# 经确认该功能法务未过 —— 同文档 Review Checklist 里
#   「法务 review：防截屏 / 阅后即焚 / BURNER 在越南 / 东南亚的法律风险」
# 至今未勾选。**已撤回**，本钉守住撤回后的状态：
#   1) 服务端对付费来源走 TransactionLinkedProtection() + 空策略（ErrEphemeralNotAllowed）；
#   2) 客户端不得自行消耗阅览次数（那会让阅后即焚在社交会话里真的烧起来）。
if ! grep -qF 'func PolicyForOrigin(originType string)' apps/api-go/internal/conversation/message_protection.go ||
   ! grep -qF 'if IsTransactionLinkedOrigin(originType) {' apps/api-go/internal/conversation/message_protection.go ||
   ! grep -qF 'if IsTransactionLinkedOrigin(conv.OriginType) {' apps/api-go/internal/conversation/service.go ||
   ! grep -qF 'base = TransactionLinkedProtection()' apps/api-go/internal/conversation/service.go ||
   ! grep -qF 'ApplyWithPolicy(base, *p.ProtectionOverride' apps/api-go/internal/conversation/service.go; then
  echo "  FAIL [COMP-EPHEMERAL-001]: 付费会话的阅后即焚闸门被拆了 ——" >&2
  echo "        付费来源必须走 TransactionLinkedProtection + 空策略，服务端强制、客户端不可覆盖。" >&2
  exit 1
fi
# 反向钉：客户端不许自己消耗阅览次数。
# 阅后即焚法务未过（RFC Review Checklist 未勾），不许在客户端把它点起来。
if grep -qF 'markMessageRead(' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [COMP-EPHEMERAL-001]: 客户端又在消耗阅览次数 ——" >&2
  echo "        那会让「看一次就销毁」真的烧起来，而法务 review 未过。" >&2
  exit 1
fi
echo "    COMP-EPHEMERAL-001: PASS (paid conversations reject ephemerality; client does not consume views)"
# AGENT-CLAIM-NUMBER-001: 接单编号（技师号）。注册时按顺序分配（1 起、无跳号，
# 上限 10000000）；个人管理→编辑资料里只读展示，且仅可接单（AVAILABLE）时可见，
# 不接单整行隐藏、无手动开关。
# 正向：迁移/分配/读取三段都在，缺一段就是“有号无来源”或“有来源无号”。
if ! grep -qF 'identity.agent_claim_numbers' apps/api-go/migrations/105_agent_claim_number.sql ||
   ! grep -qF 'allocateAgentClaimNumber(ctx, transaction, userID)' apps/api-go/internal/platform/postgres/identity.go ||
   ! grep -qF 'FOR UPDATE' apps/api-go/internal/platform/postgres/identity.go ||
   ! grep -qF 'ClaimNumber int `json:"claimNumber"`' apps/api-go/internal/identity/profile.go ||
   ! grep -qF 'COALESCE(c.claim_number, 0)' apps/api-go/internal/platform/postgres/identity.go ||
   ! grep -qF 'formatClaimNumber(claimNumber)' apps/mobile/src/surfaces/me.tsx ||
   ! grep -qF 'availability === "AVAILABLE" && formatClaimNumber(claimNumber)' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [AGENT-CLAIM-NUMBER-001]: 接单编号链路断了 ——" >&2
  echo "        注册分配 / profile 携带 / 编辑资料展示三段必须都在。" >&2
  exit 1
fi
# 反向钉：编号不可编辑（系统分配），展示至少 3 位零填充。
if ! grep -qF 'padStart(3, "0")' apps/mobile/src/claim-number.ts; then
  echo "  FAIL [AGENT-CLAIM-NUMBER-001]: 编号展示口径丢了 ——" >&2
  echo "        至少 3 位零填充（001），未分配返回空串由调用方隐藏整行。" >&2
  exit 1
fi
go -C apps/api-go test ./internal/platform/postgres/ -run TestAgentClaimNumberSequential -count=1 || exit $?
pnpm --filter @proxy/mobile exec vitest run src/surfaces/me-claim-number.test.ts || exit $?
echo "    AGENT-CLAIM-NUMBER-001: PASS (claim numbers sequential, read-only, AVAILABLE-only)"
# VOUCHER-CONFIRM-001: 消费者自证核销，回执曾谎称 MERCHANT_CONFIRMED。
# 确认路径无商家参与时回执必须诚实标注，不得伪造商家举证。
require_test "VOUCHER-CONFIRM-001" "./internal/voucher" \
  "TestConfirmRedemptionReceiptDoesNotClaimMerchantConfirmation" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
# BENEFIT-REDEEM-002: RedeemBenefit 曾只比对 payload 商家串，
# 未校验调用方本人是否在该商家有身份。商户归属活动核销必须验成员。
require_test "BENEFIT-REDEEM-002" "./internal/benefit" \
  "TestRedeemRejectsCallerWithoutMerchantMembership" \
  "apps/api-go/internal/benefit/service_test.go" || exit $?
require_test "BENEFIT-REDEEM-002" "./internal/benefit" \
  "TestRedeemFailsClosedWithoutMerchantVerifierConfigured" \
  "apps/api-go/internal/benefit/service_test.go" || exit $?
# GUEST-RELATIONSHIP-001: 访客首页曾弹"好友状态暂时无法加载"。
# 根因：早退只认 viewerAccountId，而访客可能带着已失效的老 session
#（PUBLIC 但 secure store 还有 userAccountId），拉关系链必失败。
# 修法：isGuest 直接透进首页，访客不拉链、失败提示也不留。
if ! grep -qF 'if (isGuest)' apps/mobile/src/surfaces/requester-home.tsx ||
   ! grep -qF '{...(isGuest ? { isGuest } : {})}' apps/mobile/src/shell/app-shell.tsx; then
  echo "  FAIL [GUEST-RELATIONSHIP-001]: 访客关系链守卫丢了 ——" >&2
  echo "        首页 effect 必须先认 isGuest，app-shell 必须把 isGuest 透下去。" >&2
  exit 1
fi
echo "    GUEST-RELATIONSHIP-001: PASS (guest home skips friendships, no stray notice)"
# VOUCHER-ISSUE-001: 商户发行券定义必须验主体成员。归属只认服务端标注
#（merchantStamp），payload.merchantId 伪造在 api 层即 403，不带声明直调
# service 即 VOUCHER_MERCHANT_REQUIRED；定义行 FK business.accounts。
require_test "VOUCHER-ISSUE-001" "./internal/voucher" \
  "TestIssueDefinitionRequiresMerchantAnnotation" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
require_test "VOUCHER-ISSUE-001" "./internal/voucher" \
  "TestIssueDefinitionStampsMerchantFromAnnotationOnly" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
require_test "VOUCHER-ISSUE-001" "./internal/voucher" \
  "TestIssueDefinitionRejectsInvalidPayload" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
require_test "VOUCHER-ISSUE-001" "./internal/api" \
  "TestMerchantIssueVoucherDefinitionStampsShop" \
  "apps/api-go/internal/api/merchant_identity_test.go" || exit $?
require_test "VOUCHER-ISSUE-001" "./internal/api" \
  "TestMerchantIssueVoucherDefinitionForgedForbidden" \
  "apps/api-go/internal/api/merchant_identity_test.go" || exit $?
require_test "VOUCHER-ISSUE-001" "./internal/api" \
  "TestMerchantIssueVoucherDefinitionRequiresClaim" \
  "apps/api-go/internal/api/merchant_identity_test.go" || exit $?
if ! grep -qF '"IssueVoucherDefinition": true' apps/api-go/internal/api/merchant_identity.go; then
  echo "  FAIL [VOUCHER-ISSUE-001]: IssueVoucherDefinition 掉出 merchantPublishCommands ——" >&2
  echo "        离开成员校验等于回到 payload 自认商户，B-5 冒名洞重开。" >&2
  exit 1
fi
go -C apps/api-go test ./internal/platform/postgres/ -run TestVoucherDefinitionPostgresRoundTrip -count=1 || exit $?
echo "    VOUCHER-ISSUE-001: PASS (merchant-stamped definitions, forged claims rejected, PG persisted)"
# VOUCHER-PURCHASE-001: 平台采购（operator 下单/确认），金额服务端算、
# 确认原子铸券（CAS 守 ORDERED，重放不双铸），109 CHECK 闭合算术。
require_test "VOUCHER-PURCHASE-001" "./internal/voucher" \
  "TestOrderPurchaseComputesTotalServerSide" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
require_test "VOUCHER-PURCHASE-001" "./internal/voucher" \
  "TestOrderPurchaseRejectsUnknownOrRetiredDefinition" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
require_test "VOUCHER-PURCHASE-001" "./internal/voucher" \
  "TestOrderPurchaseRejectsBadQuantity" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
require_test "VOUCHER-PURCHASE-001" "./internal/voucher" \
  "TestConfirmPurchaseMintsInstancesAndRejectsReplay" \
  "apps/api-go/internal/voucher/service_test.go" || exit $?
if ! grep -qF '"OrderVoucherPurchase":' apps/api-go/internal/api/security.go ||
   ! grep -qF '"ConfirmVoucherPurchase":' apps/api-go/internal/api/security.go; then
  echo "  FAIL [VOUCHER-PURCHASE-001]: 采购命令掉出 operator 门 ——" >&2
  echo "        任何人能给自己开采购单等于自己印券，必须收进 operator 门。" >&2
  exit 1
fi
go -C apps/api-go test ./internal/platform/postgres/ -run TestVoucherPurchasePostgresRoundTrip -count=1 || exit $?
echo "    VOUCHER-PURCHASE-001: PASS (server-computed totals, atomic mint, PG traceability join)"

# SERVICE-DISABLED-MSG-001：运营拨下 kill switch 后，命令被拒时用户看到的是**句子**，
# 不是英文机器串。
#
# 服务端拒绝时给的是
#   code       = "SERVICE_DISABLED"
#   messageKey = "compliance.service_disabled"     ← 机器串，不是句子
# （apps/api-go/internal/api/command_dispatch.go:171；签名见 command/model.go:102）
# 而各 *-client.ts 原本一律
#   throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? fallback)
# ⇒ 那个英文机器串直接进了 Error.message，也就是直接给用户看了。
# 全仓原本没有任何 messageKey → 人话的翻译表。
#
# 这不是文案取舍，是漏翻译。仓库里已经修过同一类：native-app.tsx 的
# loginChallengeErrorMessage()（注释「裸 messageKey 换成与主路径同一套映射文案」），
# 并且刻意**把原始错误码留在括号里**便于排查 —— 这里照同一形状做。
#
# 钉的形状跟 LC-06 那条教训一致：**逐个出口**钉。第一版只接了 7 个 commerce
# client，grep 一查还有 18 处同样的漏翻译（其中 marketplace-client 正是
# 「MARKETPLACE 被停、用户点下单」那条路）。文件级 grep 抓不到「这一处没接」。
if ! grep -qE 'export function commandErrorMessage\(' apps/mobile/src/command-error-message.ts; then
  echo "  FAIL [SERVICE-DISABLED-MSG-001]: the command-error translator is gone." >&2
  exit 1
fi
for f in payment-client fulfillment-client supply-client voucher-client social-settings-client \
         socialspace-client benefit-client login-client relationship-client profile-client \
         engagement-client experience-client moderation-client activity-client marketplace-client \
         session-client demand-client notification-client outcome-client business-client \
         localnet-client storeonboarding-client scene-client media-client; do
  if ! grep -qF 'commandErrorMessage(' "apps/mobile/src/$f.ts"; then
    echo "  FAIL [SERVICE-DISABLED-MSG-001]: $f still throws the raw messageKey at the user." >&2
    echo "        A killed service returns messageKey=compliance.service_disabled — not a sentence." >&2
    exit 1
  fi
done
if ! grep -qF 'commandErrorMessage(' apps/mobile/src/experience-runtime/client.ts; then
  echo "  FAIL [SERVICE-DISABLED-MSG-001]: experience-runtime/client still throws the raw messageKey." >&2
  exit 1
fi
# 场景域的命令出口：现实行动（打卡 / 收藏 / 去过 / 邀请 / 发机会 / 发活动）被拒时
# 自己 throw。它上面还有一层 sceneActionErrorMessage() 会把纯机器串兜成
# 「操作失败，请稍后重试」，所以原本看不到裸码 —— 但接上映射后能说得更准
# （「服务已暂停」而非泛泛的「操作失败」）。
#
# ⚠️ 这个出口 2026-09-24 从 surfaces/reality-scene-map.tsx 搬到了 scene-commands.ts
# （分类列表/单店详情也要发同一种命令，封包只留一份 —— 抄第二份等于把
# commandId / idempotencyKey / purpose / 错误分流各留两套）。**钉必须跟着代码走**：
# 留在旧文件上就是假守卫，因为 reality-scene-map.tsx 已经一条命令都不发了。
#
# b52b4a2 那次只重指了 vitest 那条（command-error-message.test.ts 的 wired 列表），
# 这条 shell 钉没跟着搬 ⇒ 它从那天起一直是红的；而 pin 脚本在第一个红钉就 exit，
# 于是它把 8935 行之后的**全部**钉一起静音了。又因为同期 COMP-SELLER-001 的 gofmt
# 假红把脚本更早地卡在 3144 行，这条红连红都没红到人面前。2026-09-24 修。
if ! grep -qF 'commandErrorMessage(' apps/mobile/src/scene-commands.ts; then
  echo "  FAIL [SERVICE-DISABLED-MSG-001]: the scene command exit still throws the raw" >&2
  echo "        messageKey. This exit lives in scene-commands.ts now —" >&2
  echo "        reality-scene-map.tsx no longer sends commands, so pinning it there" >&2
  echo "        guards nothing." >&2
  exit 1
fi
# ⚠️ 已知未接（2026-09-22），**故意没钉成 FAIL**：
#   apps/mobile/src/shell/app-shell.tsx:1038
#     setError(e?.result?.error?.messageKey ?? e?.message ?? "创建失败")
#   仍然把 messageKey 直接上屏（GLOBAL 开关拨下时用户会看到
#   "compliance.service_disabled"）。
#   但该文件当时是**别人的在制文件**，动不得；而为它加一条"从写出来就红"的钉，
#   会挡住所有人提交 —— 那是拿门禁替别人做决定。所以这里只记录，不拦。
#   等文件空闲了：接上 commandErrorMessage，并把下面这段注掉的臂打开。
#
# if grep -qF 'error?.messageKey ?? e?.message' apps/mobile/src/shell/app-shell.tsx; then
#   echo "  FAIL [SERVICE-DISABLED-MSG-001]: app-shell still puts the raw messageKey on screen." >&2
#   exit 1
# fi
pnpm --dir apps/mobile exec vitest run src/command-error-message.test.ts || exit $?
echo "    SERVICE-DISABLED-MSG-001: PASS (a killed service says 服务已暂停, not compliance.service_disabled)"

# PROXY-OBJECT-PERSIST-001（2026-09-22，发现于 ROOM-CREATE-001 见面邀约卡片的
# 真机验证）：conversation.messages.proxy_object 列早在迁移 039 就加了，但
# ConversationRepository.AppendMessage / Messages / GetMessage 从没读写过它——
# 任何带 ProxyObject 的消息（结构化建议、活动分享、见面邀约卡片）落到 Postgres
# 后 proxy_object 静默变 NULL，客户端收到一条没有卡片内容的空气泡。内存版
# Repository（绝大多数单测用）不受影响，只有接真实 Postgres 才会暴露，所以这个
# 洞混进代码库很久都没被测出来——这条钉必须打真实 Postgres，不能改回内存版。
require_test "PROXY-OBJECT-PERSIST-001" "./internal/platform/postgres" \
  "TestAppendMessagePersistsProxyObject" \
  "apps/api-go/internal/platform/postgres/proxy_object_persist_test.go" || exit $?

# HOME-MORE-DIST-001（2026-09-22，照 deepseek_html_20260922_1c2e2c.html 的
# distance-chip）：「附近」原来是一个**写死 1km 的开关**，而原型里它是一个
# **距离控件**（📍 10km 内 ▾ + 滑杆，1/3/5/10/20/50/100 km，默认 10km）。
#
# 这不是换皮：写死 1km 的时候，「附近」对 1.05km 的人和 100km 的人是同一个答案，
# 而用户没有任何办法表达"我想看远一点" —— 控件看着可选，其实只有一个值。
# 所以这条钉的不是"有没有那个 chip"，是**半径有没有真的接上筛选**。
MORE_HOME=apps/mobile/src/surfaces/requester-home.tsx

# ① 半径必须来自 state。退回写死的常量即红 —— 那正是"控件是假的"的形态。
#    后半句同样重要：undefined 那半边是 PERSON-DISTANCE-ZERO-001，
#    距离未知 ≠ 很近，任何半径都不许放过它。
if ! grep -qF 'p.distanceM === undefined || p.distanceM >= moreDistanceKm * 1000' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: 距离筛选不再用可选的半径（退回写死值了？），" >&2
  echo "        或者不再排除 distanceM === undefined —— 距离未知不能算「附近」。" >&2
  exit 1
fi

# ② chip 上要有当前半径。数字跟 kmUnit 分开拼（HOME-I18N-001 之后
#    kmUnit 随语言变：zh 是 "km 内"、en 是 "km"、ko 是 "km 이내"），
#    所以不能再钉字面量 "km 内"。点它是展开面板（不是开关）。
if ! grep -qF '📍 {moreDistanceKm}{t("kmUnit")}' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: 距离 chip 不再显示当前半径。" >&2
  exit 1
fi
if ! grep -qF 'setMoreDistanceOpen((open) => !open)' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: 点距离 chip 不再展开/收起面板。" >&2
  exit 1
fi

# ③ 档位表 + 每一档可点。只画一条装饰轨道 = 用户选不了任何东西。
if ! grep -qF 'MORE_DISTANCE_KM: ReadonlyArray<number> = [1, 3, 5, 10, 20, 50, 100]' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: 距离档位表被改了或不见了。" >&2
  exit 1
fi
if ! grep -qF 'onPress={() => setMoreDistanceIndex(index)}' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: 距离档位点了不再选中（退化成装饰轨道）。" >&2
  exit 1
fi
# 反向：默认档必须是 10km（跟原型一致）。默认值漂了，用户看到的初始半径就变了。
if ! grep -qF 'MORE_DISTANCE_DEFAULT_INDEX = 3' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: 默认半径档位不再是 3（=10km）。" >&2
  exit 1
fi

# ④ 不许同时存在两个距离控件：「附近」不能再是一个开关型 chip。
#    一个开关 + 一个半径会互相矛盾（开关关着时半径还有没有效？没人说得清）。
if grep -qF '{ id: "near", label: "附近" }' apps/mobile/src/recommend-fixtures.ts; then
  echo "  FAIL [HOME-MORE-DIST-001]: 「附近」又变回开关型 chip 了 —— 现在会有两个" >&2
  echo "        距离控件（一个开关 + 一个半径），它们对同一个人可能给出相反答案。" >&2
  exit 1
fi

# ⑤ 原型 chip 样式：无边框 + 选中转深色。回到 lime 高亮或带描边即红。
if ! grep -qF 'filterChipOn: { backgroundColor: color.ink }' "$MORE_HOME" ||
   grep -qF 'filterChipOn: { backgroundColor: color.lime' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: chip 选中态不是原型的深色（回到 lime 了）。" >&2
  exit 1
fi
if grep -qE 'filterChip: \{[^}]*borderWidth' "$MORE_HOME"; then
  echo "  FAIL [HOME-MORE-DIST-001]: chip 又带上描边了（原型是无边框）。" >&2
  exit 1
fi

pnpm --dir apps/mobile exec vitest run src/person-distance-zero.test.ts || exit $?
echo "    HOME-MORE-DIST-001: PASS (distance is a real selectable radius, and an unknown distance is still not 'nearby')"

# HOME-I18N-001（2026-09-22，用户：「原型是给你参考的 你肯定要改好 语言要支持选择」）：
# 「更多」整页的「中文」chip（原在首页页头，HOME-I18N-002 挪过去）+ 选择语言面板。
#
# 这条钉的不是"有没有那个按钮"，是**按钮按下去语言真的换、而且换完还在**：
#   ① chip 显示的是**当前**语言的本名（写死「中文」= 换完不更新，chip 在骗人）；
#   ② 入口是「更多」整页的「中文」chip（HOME-I18N-002），面板以 overlay 叠在
#      那个全屏 Modal 里（iOS 一次只呈现一个 Modal，嵌第二个会被无声吞掉，点了不弹
#      —— HOME-MORE-SHEET-004 的同一个坑）；
#   ③ 选择要落盘（pref_language）、冷启动要读回来（loadPreferences），
#      否则"选了老挝语、重启回中文"—— 看着能选，其实没生效；
#   ④ 校验器必须是白名单（isLanguage），不能退回只认字面量 "vi"/"en"：
#      那种写法会把新增的 lo/ko/ja **静默吞回中文**，是这条钉最想防的形态。
#
# 文案本身（6 种语言、没有"复制粘贴忘翻译"）由 src/i18n.test.ts 守；
# 这里守的是"接线"，两边合起来才叫语言选择是真的。
I18N_HOME=apps/mobile/src/surfaces/requester-home.tsx
I18N_SHEET=apps/mobile/src/components/language-sheet.tsx
I18N_PREFS=apps/mobile/src/preferences.ts
I18N_SRC=apps/mobile/src/i18n.ts

# ① 入口在「更多」整页的「中文」chip，不在首页页头（HOME-I18N-002，2026-09-23 用户：
#    「多语言筛选按钮做在 home 这个不对 应该做在已有的更多-中文按钮」）。
if grep -qF 'accessibilityLabel={t("language")}' "$I18N_HOME" || grep -qF '{appLangOption.short}' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-002]: 首页页头又长出了语言按钮 —— 入口只在「更多」的「中文」chip。" >&2
  exit 1
fi
lang_chip=$(grep -nF 'if (chip.id === "lang_zh") {' "$I18N_HOME" | head -1 | cut -d: -f1)
if [ -z "$lang_chip" ]; then
  echo "  FAIL [HOME-I18N-002]: 「更多」里的「中文」chip 不再是语言入口。" >&2
  exit 1
fi
lang_chip_body=$(sed -n "${lang_chip},$((lang_chip + 14))p" "$I18N_HOME")
if ! grep -qF 'onPress={() => setLanguageSheetOpen(true)}' <<<"$lang_chip_body" ||
   ! grep -qF '{appLangOption.name}' <<<"$lang_chip_body"; then
  echo "  FAIL [HOME-I18N-002]: 「中文」chip 没有打开语言面板，或没显示**当前**语言本名 ——" >&2
  echo "        写死「中文」的话，切到 Tiếng Việt 之后 chip 还在说「中文」，是 chip 在骗人。" >&2
  exit 1
fi

# ② 面板在「更多」整页 Modal **里面**，而且必须是 overlay 形态：iOS 一次只呈现一个
#    Modal，嵌第二个会被无声吞掉（HOME-MORE-SHEET-004 的同一个坑）。
if ! grep -qF '<LanguageSheet presentation="overlay" visible={languageSheetOpen}' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-002]: 「更多」页里没有以 overlay 形态挂 LanguageSheet。" >&2
  exit 1
fi
if grep -F '<LanguageSheet ' "$I18N_HOME" | grep -vqF 'presentation="overlay"'; then
  echo "  FAIL [HOME-I18N-002]: 首页还有一个 Modal 形态的 LanguageSheet —— 它跟「更多」" >&2
  echo "        整页 Modal 同时 present 会被吞，入口也应该只有一个。" >&2
  exit 1
fi
more_open=$(grep -nF 'visible={filterSheetOpen}' "$I18N_HOME" | head -1 | cut -d: -f1)
sheet_mount=$(grep -nF '<LanguageSheet presentation="overlay"' "$I18N_HOME" | head -1 | cut -d: -f1)
if [ -z "$more_open" ] || [ -z "$sheet_mount" ] || [ "$more_open" -ge "$sheet_mount" ] ||
   awk -v a="$more_open" -v b="$sheet_mount" 'NR>a && NR<b' "$I18N_HOME" | grep -qF '</Modal>'; then
  echo "  FAIL [HOME-I18N-002]: overlay 面板不在「更多」整页 Modal 内部 —— 在外面的话" >&2
  echo "        它会被全屏 Modal 盖住，点 chip 看不到面板。" >&2
  exit 1
fi
if ! grep -qF 'if (presentation === "overlay") return visible ? body : null;' "$I18N_SHEET"; then
  echo "  FAIL [HOME-I18N-002]: LanguageSheet 的 overlay 形态又包回了 Modal。" >&2
  exit 1
fi

# ③ 选择要落盘、冷启动要读回来。
if ! grep -qF 'saveLanguage(code)' "$I18N_SHEET"; then
  echo "  FAIL [HOME-I18N-001]: 选完语言没有落盘 —— 重启就回默认语言。" >&2
  exit 1
fi
if ! grep -qF 'pref_language' "$I18N_PREFS"; then
  echo "  FAIL [HOME-I18N-001]: pref_language 这个存储键没了。" >&2
  exit 1
fi
if ! grep -qF 'applyLanguage(prefs.language)' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-001]: 首页起来没有把存下来的语言读回内存 ——" >&2
  echo "        落盘了但没人读，等于没存。" >&2
  exit 1
fi

# ④ 校验器必须是白名单。退回字面量比较即红 —— 那会把 lo/ko/ja 静默吞回中文。
if ! grep -qF 'if (v && isLanguage(v)) return v;' "$I18N_PREFS"; then
  echo "  FAIL [HOME-I18N-001]: 语言校验不再走 isLanguage 白名单。" >&2
  exit 1
fi
if grep -qF 'v === "vi"' "$I18N_PREFS" || grep -qF 'v === "en"' "$I18N_PREFS"; then
  echo "  FAIL [HOME-I18N-001]: 校验器退回只认字面量 \"vi\"/\"en\" ——" >&2
  echo "        新增的 lo/ko/ja 会被静默吞回中文（选了老挝语、重启变中文）。" >&2
  exit 1
fi

# ⑤ 六种语言的表必须在 i18n.ts 里，而且首页不许再自带一份中文文案表。
if ! grep -qF 'export const LANGUAGES' "$I18N_SRC" ||
   ! grep -qF 'export const I18N' "$I18N_SRC" ||
   ! grep -qF 'export const RIDE_TIMES' "$I18N_SRC" ||
   ! grep -qF 'export const ICEBREAKER_LINES' "$I18N_SRC"; then
  echo "  FAIL [HOME-I18N-001]: i18n.ts 少了语言表（LANGUAGES / I18N / RIDE_TIMES / ICEBREAKER_LINES）。" >&2
  exit 1
fi
# 骑行档位 / 破冰开场白曾经是首页里的中文常量，切语言不跟着走。回来了即红。
if grep -qF 'MORE_DISTANCE_RIDE' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-001]: 骑行档位又变回首页里的写死常量了（切语言不跟着变）。" >&2
  exit 1
fi
if grep -qF 'ICEBREAKER_OPENERS' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-001]: 破冰开场白又变回首页模块级的中文数组了。" >&2
  exit 1
fi

# ⑥ 距离 chip 的数字和单位必须分开拼：zh 的 kmUnit 是「km 内」，en 是「km」，
#    ko 是「km 이내」—— 把「km 内」写死进 JSX 就等于只有中文对。
if ! grep -qF '📍 {moreDistanceKm}{t("kmUnit")}' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-001]: 距离 chip 不再按语言拼单位（写死「km 内」了？）。" >&2
  exit 1
fi

# ⑨ 「继续进行」卡片必须在**渲染时**翻译（卡片存 subKey，不存翻译好的串）。
#    这个 effect 的依赖只有 demandClient，切语言时它**不会重跑** ——
#    如果卡片存的是已翻译的串，页面其余部分都换过去了，就这两张卡还停在旧语言。
#    另一个修法（给 effect 加 lang 依赖）会为了两句文案多拉一次 listHomeItems。
if ! grep -qF '{t(item.subKey, item.subVars)}' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-001]: 「继续进行」卡片不是在渲染时才翻译的 ——" >&2
  echo "        切语言时那两张卡不会跟着变（effect 依赖只有 demandClient，不会重跑）。" >&2
  exit 1
fi
# 注意别写成通用的 `sub: t(` —— 四宫格那几个 tile 的 sub 也是 sub: t(...)，
# 但它们是**渲染时**算的（在组件里），不在 state 里，那样写会误伤。
# 这里只钉两个投影函数里那两句。
if grep -qF 'sub: t("draftProgress"' "$I18N_HOME" ||
   grep -qF 'sub: t("publishedWaiting")' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-001]: 卡片把翻译好的字符串存进 state 了（sub: t(...)）。" >&2
  echo "        存串 ⇒ 切语言时 effect 不重跑 ⇒ 这两张卡停在旧语言。" >&2
  exit 1
fi
if ! grep -qF 'subKey: "draftProgress"' "$I18N_HOME" ||
   ! grep -qF 'subKey: "publishedWaiting"' "$I18N_HOME"; then
  echo "  FAIL [HOME-I18N-001]: 两张卡没有存 subKey（草稿进度 / 已发布等待匹配）。" >&2
  exit 1
fi

# ⑦ 文案层面：6 种语言齐全、没有"复制粘贴忘翻译"、占位符不漏成 undefined。
pnpm --dir apps/mobile exec vitest run src/i18n.test.ts || exit $?
echo "    HOME-I18N-001: PASS (language is selectable, it persists, and no language silently falls back)"

# ⑧ 持久化行为：六种语言"存进去 → 冷启动读回来"必须原样回来。
#    这条抓的是源码看不出来的那种坏：校验器只认 "vi"/"en"，lo/ko/ja 存得进、
#    读出来变中文 —— 界面上的表现就是"选了没生效"。
pnpm --dir apps/mobile exec vitest run src/preferences.test.ts || exit $?
echo "    HOME-I18N-001: PASS (every language round-trips through pref_language)"

# 首页的文案契约跟着一起验 —— 那些断言是按 t() 键钉的，键名漂了会红。
pnpm --dir apps/mobile exec vitest run src/requester-home-discovery-contract.test.ts || exit $?
echo "    HOME-I18N-001: PASS (home copy still resolves through the same keys)"

# HOME-MORE-ROOMS-001（2026-09-23，原型 deepseek_html_20260923_2308b7.html，用户：
# 「聊天房点击 list 直接弹出已有的房和创建房卡片 目前的不对」）：
# 「更多」整页的「聊天房」chip 是本页的视图切换 —— 列表换成「开房大卡 + 正在进行的房间」，
# 不是直接跳创建页。房间只认服务端真实的 GROUP 会话（带 roomScene），读失败和
# 没有房分开说；开创建页 / 进房前先关掉「更多」Modal（iOS 只呈现一个 Modal）。
ROOMS_HOME=apps/mobile/src/surfaces/requester-home.tsx
ROOMS_SHELL=apps/mobile/src/shell/app-shell.tsx
if ! grep -qF 'setMoreMode("rooms");' "$ROOMS_HOME" || ! grep -qF '{moreMode === "rooms" ? (' "$ROOMS_HOME"; then
  echo "  FAIL [HOME-MORE-ROOMS-001]: 「聊天房」chip 不再切到房间列表视图。" >&2
  exit 1
fi
chip_line=$(grep -nF 'accessibilityLabel={t("chipChatRoom")}' "$ROOMS_HOME" | head -1 | cut -d: -f1)
if [ -z "$chip_line" ] || sed -n "${chip_line},$((chip_line + 10))p" "$ROOMS_HOME" | grep -qF 'onOpenRoomCreate'; then
  echo "  FAIL [HOME-MORE-ROOMS-001]: 「聊天房」chip 又直接跳创建页了 —— 原型是先看到已有的房 + 开房大卡。" >&2
  exit 1
fi
if ! grep -qF 'item.conversation.conversationType === "GROUP" && item.conversation.roomScene !== undefined' "$ROOMS_HOME"; then
  echo "  FAIL [HOME-MORE-ROOMS-001]: 房间列表不再只认真实的 GROUP + roomScene 会话。" >&2
  exit 1
fi
if ! grep -qF 't("roomsLoadFailed")' "$ROOMS_HOME" || ! grep -qF 't("roomsEmpty")' "$ROOMS_HOME"; then
  echo "  FAIL [HOME-MORE-ROOMS-001]: 读失败和没有房不再分开说。" >&2
  exit 1
fi
# HOME-MORE-ROOMS-002（2026-09-23，用户：「点击聊天房卡片创建 先弹回 home 再进入创建
# 这个多此一举」）：开房 / 进房不关「更多」，创建页和房间以 overlay 叠在「更多」Modal 里。
if grep -qF 'setFilterSheetOpen(false); onOpenRoomCreate' "$ROOMS_HOME" ||
   awk '/const enter = \(\): void => \{/{f=1} f&&/setFilterSheetOpen\(false\)/{print; exit} f&&/^                  \};/{exit}' "$ROOMS_HOME" | grep -q .; then
  echo "  FAIL [HOME-MORE-ROOMS-002]: 开房 / 进房又先关了「更多」—— 中间会闪回首页。" >&2
  exit 1
fi
more_open=$(grep -nF 'visible={filterSheetOpen}' "$ROOMS_HOME" | head -1 | cut -d: -f1)
layer_line=$(grep -nF '{moreRoomLayer}' "$ROOMS_HOME" | head -1 | cut -d: -f1)
if [ -z "$more_open" ] || [ -z "$layer_line" ] || [ "$more_open" -ge "$layer_line" ] ||
   awk -v a="$more_open" -v b="$layer_line" 'NR>a && NR<b' "$ROOMS_HOME" | grep -qF '</Modal>'; then
  echo "  FAIL [HOME-MORE-ROOMS-002]: 创建页 / 房间没有叠在「更多」整页 Modal 里面。" >&2
  exit 1
fi
if ! grep -qF 'moreRoomLayer={roomLayerInMore ? renderRoomLayers("overlay") : null}' "$ROOMS_SHELL" ||
   ! grep -qF 'const here = presentation === "overlay" ? roomLayerInMore : !roomLayerInMore;' "$ROOMS_SHELL"; then
  echo "  FAIL [HOME-MORE-ROOMS-002]: app-shell 不再按入口区分 overlay / Modal —— 两份同时 visible 会被 iOS 吞掉一份。" >&2
  exit 1
fi
for f in apps/mobile/src/surfaces/room-create.tsx apps/mobile/src/surfaces/room.tsx; do
  if ! grep -qF 'if (presentation === "overlay") return visible ? body : null;' "$f"; then
    echo "  FAIL [HOME-MORE-ROOMS-002]: $f 的 overlay 形态又包回了 Modal。" >&2
    exit 1
  fi
done
if ! grep -qF 'loadRooms={() => conversation.listConversations()}' "$ROOMS_SHELL" || ! grep -qF 'onOpenRoom={(conversationId) => { setRoomLayerInMore(true); setRoomChatId(conversationId); }}' "$ROOMS_SHELL"; then
  echo "  FAIL [HOME-MORE-ROOMS-001]: app-shell 没把房间读取 / 进房接进首页。" >&2
  exit 1
fi
echo "    HOME-MORE-ROOMS-001/002: PASS (聊天房 shows the create card and my real rooms; create/enter stack on top of the more page)"

# HOME-MORE-GREET-001（2026-09-23，用户：「邀约一般就是打招呼 … 线下很近的 2 个人 比如 200m
# 以内 我们认为处于同一个窗景 这个提示就比较正常的逻辑 但是超出了 … 就是 hi 的行为 点击就
# 发出默认预制的招呼话语 不要只有一个 多写几句」）：
#   - 拼桌 / 邀约按「同一窗景」（已知距离 ≤ 200m）分，不按在线分；
#   - 邀约 = 一点就真发一句招呼（PROFILE DM），不弹破冰面板；句子池 ≥ 6 句，随机挑；
#   - 发失败要说没发出去，没账号的人不假装发出去。
GREET_HOME=apps/mobile/src/surfaces/requester-home.tsx
GREET_SHELL=apps/mobile/src/shell/app-shell.tsx
if ! grep -qF 'const SAME_SCENE_RADIUS_M = 200;' "$GREET_HOME" ||
   ! grep -qF 'return person.distanceM !== undefined && person.distanceM <= SAME_SCENE_RADIUS_M;' "$GREET_HOME"; then
  echo "  FAIL [HOME-MORE-GREET-001]: 同一窗景不再是「已知距离 ≤ 200m」。" >&2
  exit 1
fi
if grep -qF 'const actionLabel = p.online ? t("actionTable")' "$GREET_HOME"; then
  echo "  FAIL [HOME-MORE-GREET-001]: 拼桌 / 邀约又按在线状态分了。" >&2
  exit 1
fi
if ! grep -qF 'onPress={() => { if (sameScene) setIcebreakerTarget(p); else greet(p); }}' "$GREET_HOME"; then
  echo "  FAIL [HOME-MORE-GREET-001]: 邀约又弹了破冰面板（应该一点就发招呼）。" >&2
  exit 1
fi
if ! grep -qF 'setGreetMsg(t("greetFailed"));' "$GREET_HOME" || ! grep -qF 't("greetNoAccount", { name: person.name })' "$GREET_HOME"; then
  echo "  FAIL [HOME-MORE-GREET-001]: 发失败 / 没账号不再如实说。" >&2
  exit 1
fi
if ! grep -qF 'conversationType: "DM", firstMessage: line,' "$GREET_SHELL"; then
  echo "  FAIL [HOME-MORE-GREET-001]: app-shell 的招呼不再真发到 DM。" >&2
  exit 1
fi
# HOME-MORE-GREET-002（2026-09-23，用户：「显示发送中-已打招呼 这属于多余 邀约 已邀约 就可以 …
# 不能必须等对方（模型 真人）回复才能更新状态」）：StartConversation 带首条消息时服务端会同步
# 生成 AI 代回复，所以「已邀约」必须在发请求**之前**就置上，不能挂在请求的 then 上；
# 也不许再出现「发送中」这种中间态。
optimistic_line=$(grep -nF 'writeGreetState({ ...greetStateRef.current, [accountId]: Date.now() });' "$GREET_HOME" | head -1 | cut -d: -f1)
send_line=$(grep -nF 'onGreetHuman(person, lines)' "$GREET_HOME" | head -1 | cut -d: -f1)
if [ -z "$optimistic_line" ] || [ -z "$send_line" ] || [ "$optimistic_line" -ge "$send_line" ]; then
  echo "  FAIL [HOME-MORE-GREET-002]: 「已邀约」没有在发请求之前置上 —— 又在等对方回复才变状态。" >&2
  exit 1
fi
if grep -qF 'greetSending' "$GREET_HOME" || grep -qF '"sending"' "$GREET_HOME"; then
  echo "  FAIL [HOME-MORE-GREET-002]: 又出现了「发送中」中间态。" >&2
  exit 1
fi
# HOME-MORE-GREET-003（2026-09-23，用户：「已邀约 切换到 home-更多 又重置了 … 可以发 3 条连续
# 超过没有回复等待回复吧 但是状态不能重置 必须要冷静 12H 后才能重置状态」）：
#   「已邀约」落盘、12h 冷静期；连发 3 条对方本人没回就不再发（AI 代回复 proxy_ai 不算回复）。
GREET_STATE=apps/mobile/src/greet-state.ts
if ! grep -qF 'export const GREET_COOLDOWN_MS = 12 * 60 * 60 * 1000;' "$GREET_STATE" ||
   ! grep -qF 'export const GREET_MAX_UNANSWERED = 3;' "$GREET_STATE"; then
  echo "  FAIL [HOME-MORE-GREET-003]: 冷静期不是 12h，或连发上限不是 3。" >&2
  exit 1
fi
if ! grep -qF 'void saveGreetState(viewerAccountId, next)' "$GREET_HOME" || ! grep -qF 'loadGreetState(viewerAccountId, Date.now())' "$GREET_HOME"; then
  echo "  FAIL [HOME-MORE-GREET-003]: 「已邀约」不再落盘 / 不再读回 —— 切页面就会重置。" >&2
  exit 1
fi
if ! grep -qF 'const invited = !sameScene && isInvited(greetState, resolveHomePersonAccountId(p.id), Date.now());' "$GREET_HOME"; then
  echo "  FAIL [HOME-MORE-GREET-003]: 按钮状态不再按落盘的 12h 冷静期算。" >&2
  exit 1
fi
if ! grep -qF '>= GREET_MAX_UNANSWERED) return "awaiting_reply";' "$GREET_SHELL"; then
  echo "  FAIL [HOME-MORE-GREET-003]: 发之前不再检查「连发 3 条对方没回」。" >&2
  exit 1
fi
# HOME-MORE-GREET-004：挑招呼句子要避开跟这个人聊天里我已经发过的（同一句发两遍，AI 代回复都会
# 吐槽「又是这句」）。
if ! grep -qF 'const line = pickGreetingLine(lines, alreadySent);' "$GREET_SHELL"; then
  echo "  FAIL [HOME-MORE-GREET-004]: 招呼句子不再避开已经发过的。" >&2
  exit 1
fi
pnpm --dir apps/mobile exec vitest run src/greet-state.test.ts || exit $?
pnpm --dir apps/mobile exec vitest run src/i18n.test.ts -t "several distinct greeting lines" || exit $?
echo "    HOME-MORE-GREET-001/002/003/004: PASS (one-tap hi; invited persists 12h; max 3 unanswered in a row; no repeated line)"

# PULL-REFRESH-001（2026-09-23，用户：「目前所有社交产品都是上下滑动进行刷新 我们缺少这个逻辑」）：
# 首页 / 更多（真人 + 聊天房）/ 消息 / 动态 / 市场 的主列表都能下拉刷新；转圈跟着真实加载停
# （usePullToRefresh 等 Promise、useTrackedRefresh 等被 track 的请求），不是固定时长。
PR_HOOK=apps/mobile/src/components/pull-to-refresh.ts
for spec in \
  "apps/mobile/src/surfaces/requester-home.tsx:refreshControl={<RefreshControl refreshing={homeRefreshing} onRefresh={onHomeRefresh} />} style={styles.root}" \
  "apps/mobile/src/surfaces/requester-home.tsx:refreshControl={<RefreshControl refreshing={homeRefreshing} onRefresh={onHomeRefresh} />} style={styles.moreList}" \
  "apps/mobile/src/surfaces/requester-home.tsx:refreshControl={<RefreshControl refreshing={rooms.status === \"loading\"} onRefresh={refreshRooms} />}" \
  "apps/mobile/src/surfaces/messages.tsx:refreshControl={<RefreshControl refreshing={inboxPull.refreshing} onRefresh={inboxPull.onRefresh} />}" \
  "apps/mobile/src/surfaces/feed.tsx:refreshControl={<RefreshControl refreshing={feedPull.refreshing} onRefresh={feedPull.onRefresh} />}" \
  "apps/mobile/src/surfaces/market.tsx:refreshControl={<RefreshControl refreshing={marketPull.refreshing} onRefresh={marketPull.onRefresh} />}"; do
  file="${spec%%:*}"; needle="${spec#*:}"
  if ! grep -qF "$needle" "$file"; then
    echo "  FAIL [PULL-REFRESH-001]: $file 的主列表没有下拉刷新了：$needle" >&2
    exit 1
  fi
done
# 首页的加载 effect 必须跟着 nonce 重跑、请求必须被 track —— 否则下拉只是转个圈。
for needle in 'void trackHomeLoad(relationship.listMyFriendships())' 'void trackHomeLoad(activities.listActivities())' 'void trackHomeLoad((async () => {' '}, [demandClient, homeRefreshNonce]);'; do
  if ! grep -qF "$needle" apps/mobile/src/surfaces/requester-home.tsx; then
    echo "  FAIL [PULL-REFRESH-001]: 首页下拉不再真的重拉数据：$needle" >&2
    exit 1
  fi
done
if grep -qE 'setTimeout\(\(\) => setRefreshing\(false\), [0-9]{3,4}\)' "$PR_HOOK"; then
  echo "  FAIL [PULL-REFRESH-001]: 转圈改成固定时长收起了 —— 必须等真实加载结束。" >&2
  exit 1
fi
echo "    PULL-REFRESH-001: PASS (home / more / rooms / messages / feed / market all pull-to-refresh on real loads)"

# AI-MANAGE-003（2026-09-23，用户：「ai 管理模块 原型给了 干的一坨屎 logo 也不对 功能也不对」）：
# 「对话管理 —— AI 怎么替你聊天」管的是**被代表的人**：私聊真人时读收消息那个真人（owner）的
# 暂停 / 权限 / 风格，不是发消息的人；跟 Proxy 助手的会话不受影响；Token 记在 owner 头上。
# AI-MANAGE-002 读的是 e.Actor —— 方向反了，「每次确认」还把替 owner 起草的回复交给了对方。
require_test "AI-MANAGE-003" "./internal/conversation" \
  "TestStandInReadsTheRecipientsSettingsNotTheSenders" \
  "apps/api-go/internal/conversation/ai_engine_gate_test.go" || exit $?
require_test "AI-MANAGE-003" "./internal/conversation" \
  "TestStandInHonoursRecipientPauseAndOffBeforeTheModel" \
  "apps/api-go/internal/conversation/ai_engine_gate_test.go" || exit $?
# AI-MANAGE-013：每次确认 = 替本人起草、只有本人看得到；发消息的人拿不到也动不了草稿；
# 本人发出的是本人的消息（不带 AI 代回）；过时的草稿（对方又发 / 本人自己回了）作废不能再发。
for t in TestConfirmDraftsForTheOwnerOnlyAndNeverAnswersTheSender TestOwnerSendsTheDraftAsTheirOwnMessage TestStaleDraftsAreSupersededAndCanBeDiscarded; do
  require_test "AI-MANAGE-013" "./internal/conversation" "$t" \
    "apps/api-go/internal/conversation/stand_in_draft_test.go" || exit $?
done
# AI-MANAGE-014：全自动代回复按本人「节奏」延迟发出，不在发消息的请求里同步回；连发只回最新一条；
# 等待期间本人自己回了 / 关掉了就不发。
for t in TestStandInWaitsForTheOwnersRhythmThenRepliesAsTheOwner TestStandInAnswersOnlyTheLatestMessageAfterABurst TestStandInStaysSilentWhenTheOwnerAnsweredOrTurnedItOffWhileWaiting TestStandInDelayMatchesTheRhythmChoices; do
  require_test "AI-MANAGE-014" "./internal/conversation" "$t" \
    "apps/api-go/internal/conversation/stand_in_rhythm_test.go" || exit $?
done
require_test "AI-MANAGE-003" "./internal/conversation" \
  "TestStandInAutoUsesTheOwnersStyleAndMetersTheOwner" \
  "apps/api-go/internal/conversation/ai_engine_gate_test.go" || exit $?
require_test "AI-MANAGE-003" "./internal/conversation" \
  "TestAssistantThreadIsNotGovernedByChatManagement" \
  "apps/api-go/internal/conversation/ai_engine_gate_test.go" || exit $?
if grep -qF 's.aiGenerationBlocked(ctx, e.Actor.ID)' apps/api-go/internal/conversation/service.go ||
   grep -qF 'payload["aiDraft"]' apps/api-go/internal/conversation/service.go; then
  echo "  FAIL [AI-MANAGE-003]: 会话侧又按发消息的人读 AI 管理设置 / 又把草稿交给了对方。" >&2
  exit 1
fi
# 页面：原型牌标、目录完整、不画假上限、没接上的能力不说「运行中」。
pnpm --dir apps/mobile exec vitest run src/surfaces/ai-management.test.ts || exit $?
echo "    AI-MANAGE-003: PASS (chat management governs the represented person; surface matches the prototype honestly)"
# PROFILE-REPLIES-VISIBLE-001: 个人主页 PostCard 以前只有动作按钮 —— feed 里
# 能看到的赞数/评论列表在主页完全看不见。调用方传 engagementClient 进来后
# hydrate 计数、点开拉评论；作者名走 resolveReplyAuthorDisplayName，无名不显示裸 id。
pnpm --dir apps/mobile exec vitest run src/profile-post-replies.test.ts || exit $?
echo "    PROFILE-REPLIES-VISIBLE-001: PASS (profile posts show counts + expandable replies)"
# ORDER-EXEC-001: 订单明细以前只有"返回列表" —— OFFERED 卡死，EXECUTING 走不到
# COMPLETED，COMPLETED 评不了分。明细页按 lifecycle 逐态出真按钮，全部走命令。
pnpm --dir apps/mobile exec vitest run src/order-exec.test.ts src/fulfillment-client.test.ts || exit $?
echo "    ORDER-EXEC-001: PASS (order detail drives confirm/start/complete/satisfaction)"
# ORDER-SCENARIO-001: 消费场景跟着机会走（发布向导按 moment 家族填 scenario，
# 确认时快照进 OrderRecord → 订单快照）。城市协助永远全流程，不跟金额走。
require_test "ORDER-SCENARIO-001" "./internal/marketplace" \
  "TestConfirmMarketApplicationCarriesScenario" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
pnpm --dir apps/mobile exec vitest run src/demand-moments.test.ts || exit $?
echo "    ORDER-SCENARIO-001: PASS (scenario published, snapshotted, and tiered)"
# SCENE-PHOTO-WALL-001: 照片墙只收标记了本场景、带图、对看的人可见的帖子（可见性与 feed 同一套）。
require_test "SCENE-PHOTO-WALL-001" "./internal/localnet" "TestListPostsAtSceneOnlyTaggedVisiblePostsWithMedia" \
  "apps/api-go/internal/localnet/scene_wall_test.go" || exit $?
# SCENE-CHECKIN-GATE-001: 11,761 公里外照样打卡成功 —— 服务端对报了距离且 >100 米的拒绝，按钮在太远时禁用。
require_test "SCENE-CHECKIN-GATE-001" "./internal/realityscene" "TestCheckInRejectsReportedDistanceBeyondRadius" \
  "apps/api-go/internal/realityscene/service_test.go" || exit $?
if ! grep -qF '(!hereChecked && !checkinAllowed)' apps/mobile/src/components/scene-shop-directory.tsx; then
  echo "  FAIL [SCENE-CHECKIN-GATE-001]: 「我在这里」按钮没接 100 米门禁。" >&2
  exit 1
fi
# AVATAR-SVG-DECODE-001: react-native-svg <Image> 无缓存、每次挂载异步解码 —— 首帧一个空圆。垫 expo-image（memory-disk）。
if ! grep -qF 'cachePolicy="memory-disk"' apps/mobile/src/components/circular-avatar-image.tsx ||
   ! grep -qF '<ClipPath' apps/mobile/src/components/circular-avatar-image.tsx; then
  echo "  FAIL [AVATAR-SVG-DECODE-001]: 圆头像没有缓存底图（或丢了 SVG 圆裁剪）。" >&2
  exit 1
fi
# COMPOSER-IDENTITY-001: 发帖页头部写死「Thanh @thanh」—— 谁发帖都显示别人。必须读本账号资料。
if grep -qF '>Thanh</Text>' apps/mobile/src/surfaces/ComposerV2Screen.tsx ||
   ! grep -qF 'composerProfileStore.read().then' apps/mobile/src/surfaces/ComposerV2Screen.tsx; then
  echo "  FAIL [COMPOSER-IDENTITY-001]: 发帖页身份又写死了。" >&2
  exit 1
fi
# ORDER-PERMISSION-001: 接单权限不按性别设门（Rev290 曾要求「自证女性」—— 歧视）。性别只是可选自述。
require_test "ORDER-PERMISSION-001" "./internal/providerapp" "TestGenderIsOptionalAndNeverGates" \
  "apps/api-go/internal/providerapp/providerapp_test.go" || exit $?
if grep -qF 'gender_attested' apps/api-go/internal/providerapp/providerapp.go apps/mobile/src/provider-application-client.ts; then
  echo "  FAIL [ORDER-PERMISSION-001]: 又出现了性别门槛字段。" >&2
  exit 1
fi
echo "    SCENE-PHOTO-WALL-001 / SCENE-CHECKIN-GATE-001 / AVATAR-SVG-DECODE-001 / COMPOSER-IDENTITY-001 / ORDER-PERMISSION-001: PASS"
# ORDER-PERMISSION-TWIN-001: 「有接单权限才开动 ai 分身」—— 建本人分身 / 模型读本人照片 / 代回复 三处都要查接单权限，生产必须接线。
require_test "ORDER-PERMISSION-TWIN-001" "./internal/api" "TestAITwinRequiresOrderPermission" \
  "apps/api-go/internal/api/order_permission_twin_test.go" || exit $?
require_test "ORDER-PERMISSION-TWIN-001" "./internal/conversation" "TestStandInRequiresTheOwnersOrderPermission" \
  "apps/api-go/internal/conversation/stand_in_order_permission_test.go" || exit $?
if ! grep -qF 'server.OrderPermission = server.ProviderApps.Granted' apps/api-go/cmd/api/main.go ||
   ! grep -qF 'conversationService.SetOrderPermission(' apps/api-go/cmd/api/main.go ||
   ! grep -qF '<OrderPermissionGate' apps/mobile/src/surfaces/me.tsx; then
  echo "  FAIL [ORDER-PERMISSION-TWIN-001]: AI 分身的接单权限门没接线。" >&2
  exit 1
fi
echo "    ORDER-PERMISSION-TWIN-001: PASS"
# ORDER-CENTER-STATS-001: 接单面板放在「我的订单」里；比率分母为 0 必须是 —（不许 0% / 100% 冒充）。
require_test "ORDER-CENTER-STATS-001" "./internal/providerapp" "TestFillRatesLeavesEmptyDenominatorsNil" \
  "apps/api-go/internal/providerapp/providerapp_test.go" || exit $?
if ! grep -qF '<ProviderOrderPanel' apps/mobile/src/surfaces/me-orders.tsx; then
  echo "  FAIL [ORDER-CENTER-STATS-001]: 我的订单里没有接单面板。" >&2
  exit 1
fi
echo "    ORDER-CENTER-STATS-001: PASS"
# ORDER-PERMISSION-KYC-003: KYC 只认人（头像 / 实名 / 出生年份 / 性别可选 / 手机号 + 证件 + 条款），
# 不收城市 / 服务区域 / 语言（用户：「把会说的语言也放入了 干什么」）。
require_test "ORDER-PERMISSION-KYC-003" "./internal/providerapp" "TestKYCDoesNotRequireCityAreasOrLanguages" \
  "apps/api-go/internal/providerapp/providerapp_test.go" || exit $?
if grep -qF 'LANGUAGE_LABELS' apps/mobile/src/surfaces/provider-application.tsx || grep -qF 'accessibilityLabel="所在城市"' apps/mobile/src/surfaces/provider-application.tsx; then
  echo "  FAIL [ORDER-PERMISSION-KYC-003]: KYC 表单又收语言 / 区域了。" >&2
  exit 1
fi
echo "    ORDER-PERMISSION-KYC-003: PASS"
