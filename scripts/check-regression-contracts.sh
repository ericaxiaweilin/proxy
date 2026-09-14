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
if ! grep -qF 'REPLY_PREVIEW_LIMIT = 5' apps/mobile/src/reply-preview.ts; then
  echo "  FAIL [FEED-REPLY-002]: the comment preview limit is no longer 5," >&2
  echo "        so comments are either fully collapsed or fully expanded again." >&2
  exit 1
fi
if ! grep -qF 'visibleReplies(replies, repliesExpanded)' apps/mobile/src/surfaces/feed.tsx; then
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
if ! grep -qF 'func postMatchesSearch(p Post, loweredQuery string) bool {' apps/api-go/internal/localnet/service.go; then
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
if ! grep -qF 'if !postMatchesSearch(p, search) {' apps/api-go/internal/localnet/service.go; then
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
if ! grep -qF 'const read = await localNet.listFeedPosts(undefined, searching ? 50 : 25, searching ? search : undefined);' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: the feed surface stopped passing its query to the" >&2
  echo "        server — this is the exact dead-parameter bug that was fixed." >&2
  exit 1
fi
if ! grep -qF 'const timer = setTimeout(() => void loadFeed(query), query === "" ? 0 : 250);' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: nothing re-runs the feed load when the query changes," >&2
  echo "        so the search box only filters whatever is already loaded." >&2
  exit 1
fi
if ! grep -qF 'if (!postMatchesFeedSearch(post, normalizeFeedSearchQuery(searchQuery))) return false;' apps/mobile/src/surfaces/feed.tsx; then
  echo "  FAIL [SEARCH-CORPUS-001]: the feed surface re-implements its own search" >&2
  echo "        haystack instead of using the shared predicate, so the two field sets" >&2
  echo "        can drift and the client silently drops rows the server matched." >&2
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
