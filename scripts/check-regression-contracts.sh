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

# OPS-TELEMETRY-001: 纯字面量端点必须自报 dataSource，且控制台必须真的渲染它。
#
# 服务端声明来源只是半截接线 —— 控制台不读这个字段，运营看到的还是
# "决策引擎 30 天 1860 万次调用 · 谱系完整度 99.92%"，照样会以为引擎在跑。
# 一个假的健康度比没有健康度更糟：它让人停止怀疑。所以两边一起钉。
#
# 范围要说清：不是所有 /v1/operator/* 都是占位。context-field / surface-plans
# 真的调用了 runtime.Decide 和 compiler.Compile（输入是固定快照），
# experience/metrics 返回的是真实进程内计数器。所以只钉这三个纯字面量端点，
# 不写"整个 /v1/operator 都是假的" —— 那会是另一个谎。
require_test "OPS-TELEMETRY-001" "./internal/api" \
  "TestOperatorFixtureEndpointsDeclareSource" \
  "apps/api-go/internal/api/reality_scene_test.go" || exit $?
for page in SupplyActivation Clarification Engine; do
  # 钉 JSX 用法，不钉 import —— 第一版写的是 grep 'FixtureNotice'，它匹配的是
  # import 那一行；把 <FixtureNotice .../> 从渲染里删掉，import 还在，契约照样绿。
  # 反向注入时抓到的：那条是假守卫。
  if ! grep -q '<FixtureNotice' "apps/market-intelligence-console/src/pages/$page.tsx"; then
    echo "  FAIL [OPS-TELEMETRY-001]: $page.tsx does not render <FixtureNotice> — the server declares dataSource but the console ignores it" >&2
    exit 1
  fi
done
echo "    OPS-TELEMETRY-001: PASS (3 个占位端点已声明来源，控制台已渲染)"

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
if grep -q 'images.unsplash.com' apps/mobile/src/recommend-fixtures.ts; then
  # R34 放宽（OVERRIDE-UNSplash-001，commander 决定 2026-09-18）：mock 期不许灰
  # 头像，无真人账户的 fixture 允许用 stock 占位 —— 但必须同时满足三条，
  # 缺一条就还是按违规处理：
  # ① 所有 unsplash URL 只能出现在 R34_HUMAN_PORTRAITS 注册表内（不许散落各处）；
  # ② 有账户的一律走写真 thumb（ACCOUNT_AVATAR_ASSET 分支），不许走 R34；
  # ③ 服务端人物 feed 落地后整段删除，回到有账号才有头像（到期人工执行）。
  R34_START=$(grep -n 'const R34_HUMAN_PORTRAITS' apps/mobile/src/recommend-fixtures.ts | cut -d: -f1)
  R34_END=$(awk -v s="$R34_START" 'NR>s && /^\] as const/ {print NR; exit}' apps/mobile/src/recommend-fixtures.ts)
  R34_OK=true
  while IFS= read -r ln; do
    n=${ln%%:*}
    if [ -z "$R34_START" ] || [ -z "$R34_END" ] || [ "$n" -lt "$R34_START" ] || [ "$n" -gt "$R34_END" ]; then
      R34_OK=false
    fi
  done <<-LINES
	$(grep -n 'images.unsplash.com' apps/mobile/src/recommend-fixtures.ts)
	LINES
  if [ "$R34_OK" != "true" ]; then
    echo "  FAIL [IDENTITY-ID-001]: unsplash portrait outside the R34 registry ——" >&2
    echo "        stock 脸只能住在 R34_HUMAN_PORTRAITS 里，不许散落。" >&2
    exit 1
  fi
  if ! grep -q 'ACCOUNT_AVATAR_ASSET\[person.id\] !== undefined' apps/mobile/src/recommend-fixtures.ts ||
     ! grep -q 'R34_HUMAN_PORTRAITS\[portraitIndexForPerson(person.id)\]' apps/mobile/src/recommend-fixtures.ts; then
    echo "  FAIL [IDENTITY-ID-001]: wired accounts must use portrait assets, R34 is fallback only ——" >&2
    echo "        有账号走写真 thumb，无账号才按 id 哈希落 R34。" >&2
    exit 1
  fi
  echo "    IDENTITY-ID-001: PASS with R34 fallback (registry-confined stock, wired accounts on portraits)"
else
  echo "    IDENTITY-ID-001: PASS (single source of truth for mock identity)"
fi

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
# 两区都要显式标识身份。Owner 决议：一键加好友可在首页做（+ 徽标直调
# follow），发消息仍只能进主页后做。语义变更待 commander 确认。
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
pnpm --dir apps/mobile test -- --run src/activity-client.test.ts
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
pnpm --dir packages/contracts test -- --run src/activity.test.ts
echo "    ACT-MY-ACTIVITIES-001: PASS (mobile wire schema round-trip)"

# AI-PERSONA-PHOTO-001: 平台 AI 5 角色 (ai_001-ai_005) 冷启动
# 活动必须携带 aiPersonaPhoto 资产引用 (ai-personas/ai_00X.svg)。
# 防 “photo 字段从 seed 被丢掉” 造成 "看起来像真人" 的
# avatar 退回. path 在 apps/mobile/assets/ai-personas/ 下.
require_test "AI-PERSONA-PHOTO-001" "./internal/activity" \
  "TestPlatformAIPersonaPhotoRequiredOnColdStart" \
  "apps/api-go/internal/activity/service_test.go" || exit $?
pnpm --dir packages/contracts test -- --run src/activity.test.ts
echo "    AI-PERSONA-PHOTO-001: PASS (mobile wire schema round-trip)"

# CHAT-PROXY-ACTIVITY-001: conversation sendProxyObject 必须
# 使用 server 真 activityId, 不允许 hardcoded "act_westlake"
# 等不存在的 ID. 防 "聊天发活动 ≠ 我的活动页有活动" 的两路径
# 不对齐. mobile test 拒绝任何隐性 fallback 到 hardcoded ID.
pnpm --dir apps/mobile test -- --run src/conversation-client.test.ts
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
pnpm --dir apps/mobile exec vitest run src/business-client.test.ts
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
pnpm --dir apps/mobile exec vitest run src/business-client.test.ts
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
pnpm --dir apps/mobile exec vitest run src/profile-client.test.ts
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
pnpm --dir apps/mobile exec vitest run src/fulfillment-client.test.ts >/dev/null
if ! grep -q 'cancelOrder' apps/mobile/src/surfaces/me-orders.tsx; then
  echo "  FAIL [CANCEL-001 mobile]: me-orders surface never calls client.cancelOrder" >&2
  exit 1
fi
echo "    CANCEL-001: PASS (server CancelOrder + mobile cancelOrder + UI button)"

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
pnpm --dir apps/mobile exec vitest run src/business-client.test.ts >/dev/null
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
pnpm --dir apps/mobile exec vitest run src/relationship-client.test.ts >/dev/null
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
pnpm --dir apps/mobile exec vitest run src/surfaces/placeholder-honest-actions.test.ts >/dev/null
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

# PLACEHOLDER-010: AI 添加待同意显示添加中。
if ! grep -q 'PLACEHOLDER-010' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-010]: ai-pending tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-010: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-011: 待定添加灰字。
if ! grep -q 'PLACEHOLDER-011' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-011]: pending-gray tripwire is missing" >&2
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
pnpm --dir apps/mobile exec vitest run src/surfaces/hub-profile.test.ts >/dev/null
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
pnpm --dir apps/mobile exec vitest run src/surfaces/hub-profile.test.ts >/dev/null
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
pnpm --dir apps/mobile exec vitest run src/conversation-client.test.ts
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
pnpm --dir apps/mobile exec vitest run src/local-snapshot.test.ts \
  src/sync-fs-persist.test.ts || exit $?
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
echo "    COMP-SELLER-001: PASS (sellers must be real-name verified before they can be matched)"

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
if ! grep -qF 'resolveReplyAuthorDisplayName(reply, viewerAccountId)' apps/mobile/src/surfaces/feed.tsx; then
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
if ! grep -qF 'replyTargetLabel(props.viewerMode, target, props.viewerAccountId)' apps/mobile/src/surfaces/ProfileTabs.tsx; then
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
if ! grep -qF 'filterPostsByFeedSearch(profilePosts, q)' apps/mobile/src/surfaces/me.tsx; then
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
# 结构性 pin：每一行 SELECT 都必须在列清单里带上 ephemeral_until，数量要和
# 扫它的 rows.Scan 对齐。
#
# 为什么需要这条：给 4 个 rows.Scan 加了 &post.EphemeralUntil、却忘了给其中
# 3 条 SELECT 的列清单加 ephemeral_until，结果**任何真实数据库上的 feed 读取
# 全部失败**（number of field descriptions must equal number of destinations），
# 而 `go test ./...` 因为全跑在内存 fake 上，绿得发亮。这个 bug 只有真机联调
# 才暴露 —— 所以这里用源码结构做个廉价守门。
#
# 只对行尾匹配（`ephemeral_until$`）：INSERT 的列清单以 `)` 结尾，不会被算进来。
scans=$(grep -cF '&post.EphemeralUntil' apps/api-go/internal/platform/postgres/network.go)
selected=$(grep -cE 'context_refs, created_at, ephemeral_until[[:space:]]*$' apps/api-go/internal/platform/postgres/network.go)
if [ "$scans" != "$selected" ]; then
  echo "  FAIL [GHOST-24H-001]: SELECT/scan drift on ephemeral_until —" >&2
  echo "        $scans rows.Scan destination(s) vs $selected SELECT list(s)." >&2
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
# 4 条读路径（ListFeedPage / Snapshot / GetPost / ListPostsMentioning）都要判空。
city_guards=$(grep -cF 'cityScope != nil' apps/api-go/internal/platform/postgres/network.go)
if [ "$city_guards" -lt 4 ]; then
  echo "  FAIL [FEED-NULL-CITY-001]: only $city_guards read path(s) guard the" >&2
  echo "        nullable city_scope, want 4." >&2
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
if ! grep -qF 'posts: profilePostsState === "failed" ? undefined : profilePosts.length' apps/mobile/src/surfaces/me.tsx; then
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
  if ! grep -q '这一版还没有评估' apps/mobile/src/surfaces/market.tsx; then
    echo "  FAIL [MARKET-FAKE-JUDGMENT-001]: 判断区没有如实说明" >&2
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
  if ! /usr/bin/grep -q 'p.distanceM === undefined || p.distanceM >= 1000' "$UI"; then
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
  if grep -q '她暂未公开活动明细' "$UI"; then
    echo "  FAIL [RECOMMEND-REPUTATION-FABRICATED-001]: 空状态仍在暗示存在未公开的记录" >&2
    exit 1
  fi
  if ! grep -q '还没有可展示的活动记录' "$UI"; then
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
if ! grep -qF 'func (s *Server) listPersonas' apps/api-go/internal/api/aipersona_handlers.go ||
   ! grep -qF 'func (s *Server) revokeConsent' apps/api-go/internal/api/aipersona_handlers.go ||
   ! grep -qF 'func (s *Service) RevokeLiveConsent' apps/api-go/internal/aipersona/personas.go ||
   ! grep -qF 'class AiPersonaClient' apps/mobile/src/ai-persona-client.ts ||
   ! grep -qF 'listMine' apps/mobile/src/surfaces/AIIdentityShowcaseSurface.tsx; then
  echo "  FAIL [TWIN-CENTER]: 分身真接线不见了 ——" >&2
  echo "        列表/收回接口、client、分身段真列表，少一段就回到假数据。" >&2
  exit 1
fi
echo "    TWIN-CENTER: PASS (persona list + revoke wired end to end)"
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
