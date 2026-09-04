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

# AIBOUND-001: DismissMarketOpportunity 曾经无 aiboundary 落点（AI 可调），
# market 写曾经无 USER 主体检查（与 activity 不对称）。现 Dismiss 进 gate，
# Publish/Apply/Dismiss 必须 USER；PublishActivity 保留位仍 fail-closed。
require_test "AIBOUND-001" "./internal/marketplace" \
  "TestMarketDismissIsForbiddenForAIActor" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?
require_test "AIBOUND-001" "./internal/marketplace" \
  "TestMarketWritesRequireUserActor" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

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
# PublishMarketOpportunityInputSchema  PriceLabel 设为 optional。
# 四种 MoneyFlow × 三种 client PriceLabel input 状态（缺省 / 空白 /
# 错位），server response 必须都推成 opportunityPriceLabel(MoneyFlow)。
require_test "MONEYFLOW-005" "./internal/marketplace" \
  "TestMarketPublishOmitsClientPriceLabel" \
  "apps/api-go/internal/marketplace/service_test.go" || exit $?

# UI-CHAT-001: 会话图片必须走媒体上传后的 storageKey，不能只在本地显示
# 假预览；输入区必须保留安全区布局。
pnpm --dir apps/mobile exec vitest run src/conversation-client.test.ts
if ! grep -q 'Math.max(insets.bottom, 16)' apps/mobile/src/surfaces/conversation.tsx; then
  echo "  FAIL [UI-CHAT-001]: conversation composer lost bottom safe-area spacing" >&2
  exit 1
fi
echo "    UI-CHAT-001: PASS (image wire + composer safe area)"

echo "  regression contracts: OK"
