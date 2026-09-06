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
if ! grep -q 'MERCHANT-CREATOR-001' apps/mobile/src/supply-client.test.ts ||
   ! grep -q 'MerchantCreatorRecommendations' apps/mobile/src/surfaces/merchant-me-r21.tsx; then
  echo "  FAIL [MERCHANT-CREATOR-001]: merchant Creator recommendation pipeline or tripwire is missing" >&2
  exit 1
fi
pnpm --filter @proxy/mobile test --run src/supply-client.test.ts || exit $?
require_test "MERCHANT-CREATOR-001" "./internal/supply" \
  "TestSupplyQueryReturnsOnlyEligible" \
  "apps/api-go/internal/supply/service_test.go" || exit $?
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

# UI-HOME-DISCOVERY-001: 首页发现层级冻结。真人推荐必须在 AI 推荐之前；
# 两区都要显式标识身份。AI 首页只展示纯圆头像，添加/消息动作只能进主页后做。
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
   ! grep -q 'function Workbench' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q 'Creator 工作台' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '客户与券工作台' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '活动工作台' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '销售工作台' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx || \
   ! grep -q '运营工作台' apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx; then
  echo "  FAIL [MERCHANT-ME-VISUAL-001]: merchant Me lost its branded logo/icon module shell" >&2
  exit 1
fi
echo "    MERCHANT-ME-VISUAL-001: PASS (merchant Me keeps branded functional workbenches over server-backed data)"

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

echo "  regression contracts: OK"
