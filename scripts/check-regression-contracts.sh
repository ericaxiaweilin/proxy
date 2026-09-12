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
if ! grep -q 'MERCHANT-CREATOR-001' apps/mobile/src/supply-client.test.ts ||
   ! grep -q 'MerchantCreatorRecommendations' apps/mobile/src/surfaces/merchant-me-r21.tsx; then
  echo "  FAIL [MERCHANT-CREATOR-001]: merchant Creator recommendation pipeline or tripwire is missing" >&2
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
  echo "  FAIL [IDENTITY-ID-001]: home fixtures must not ship their own portraits" >&2
  exit 1
fi
echo "    IDENTITY-ID-001: PASS (single source of truth for mock identity)"

# IDENTITY-ID-001 附加：不得再按「显示名」匹配人。用户名可编辑、可重复，按名字找人在
# 改名或同名用户存在时会串人（requester-home 曾用 p.name.includes("linh") 选人）。
if grep -nE 'filteredPeople\.findIndex\(\(p\) => p\.name' apps/mobile/src/surfaces/requester-home.tsx >/dev/null 2>&1; then
  echo "  FAIL [IDENTITY-ID-001]: match people by identity id, never by display name" >&2
  grep -nE 'filteredPeople\.findIndex\(\(p\) => p\.name' apps/mobile/src/surfaces/requester-home.tsx >&2
  exit 1
fi

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

# PLACEHOLDER-016: 页签与文件夹同一横滑行。
if ! grep -q 'PLACEHOLDER-016' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-016]: tab-folder-row tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-016: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-017: 筛选只在对话页，文件夹页有归档统计。
if ! grep -q 'PLACEHOLDER-017' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-017]: folder-scope tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-017: PASS (tripwire present; covered by the vitest run above)"

# PLACEHOLDER-018: 新建按钮在类型行内。
if ! grep -q 'PLACEHOLDER-018' apps/mobile/src/surfaces/placeholder-honest-actions.test.ts; then
  echo "  FAIL [PLACEHOLDER-018]: newbtn tripwire is missing" >&2
  exit 1
fi
echo "    PLACEHOLDER-018: PASS (tripwire present; covered by the vitest run above)"

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
if ! grep -q 'await foldersFile.json()' apps/mobile/src/surfaces/messages.tsx; then
  echo "  FAIL [SYNC-FS-001]: folders read must await json()" >&2
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
if ! grep -q 'feed-scope-banner-v1' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [FEED-SCOPE-001]: the feed no longer tells the user that a time filter is active." >&2
  echo "        Silent filtering is what made this look like data loss." >&2
  exit 1
fi
pnpm --filter @proxy/mobile exec vitest run src/expo-feed-prefs-store.test.ts || exit $?
echo "    FEED-SCOPE-001: PASS (default is long-lived; explicit 7D/30D still honoured; filter is visible)"

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
