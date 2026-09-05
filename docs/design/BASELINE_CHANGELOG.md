# Design baseline changelog

Every intentional change to a baseline-sensitive implementation must update
this file and `CURRENT_BASELINE.json` or `IMPLEMENTATION_CONTRACTS.json` in the
same commit. Do not record routine business logic changes here.

## Revision 37 — 2026-09-05

- R18.x DEAD-MARKET-001: removed 3 dead sub-views in
  market.tsx (`ApplicantDetail` / `SubmissionDetail` /
  `CompareScene`), the dead `MarketExperienceSurface`
  surface + `openExperience` state in app-shell.tsx,
  and the dead `TasksSurface` export + hardcoded
  `IN_PROGRESS` / `DONE` rows in tasks.tsx. All of
  these were unreachable from any production code
  path, but each one shipped hardcoded mock data
  (composite price text, "比较 3 位候选" 96/98/94%,
  "Bonsaidon / 78 health / 248 到店 / 6.2M 成交额
  ..."). tasks.tsx is now a shared
  ActivityFeedCard + ActivityDetail module; the
  workspace entry pattern it used to back is
  driven by the live supply / fulfillment
  surfaces. `MarketSurface.onOpenExperience` is
  now an optional prop, and app-shell no longer
  passes it.

## Revision 36 — 2026-09-05

- Closed the 'me hub + bdash' remaining fabrication
  gaps and removed three dead subPages. The '个人总管理'
  (personalmanage) subPage used to render
  '已验证 · 准时 98%' as the city line; the personalhub
  AboutTab used to render '已履约 42 · 98% 准时 · 复购 7
  · ✓ 真实性已校验' as a fabricated stats row; the bdash
  (企业 / 店铺资料) hero used to render the hardcoded
  'Bonsaidon' + '海鲜自助 · 河内 · 主体已验证' regardless
  of which business the user actually owns. The
  REQUESTER_ME persona `desc` also carried the fake
  '河内 ✓ 已验证 · 准时 98%' stat. This revision:
  - personalmanage: city line now reads the live
    profileDraft.city (server-backed via ProfileClient).
  - personalhub AboutTab: the fake stats row is
    removed; the about card now shows only the bio,
    city, handle, and the real followers/following/posts
    counts.
  - bdash hero: pulls the live shop name via
    useMerchantIdentity (the same hook tasks.tsx +
    market.tsx use) and falls back to the persona name
    when the user has no shop yet. The fake
    '主体已验证' badge is gone.
  - REQUESTER_ME persona `desc`: the fake '已验证 · 准时
    98%' is replaced with '河内 · 个人身份', which is
    descriptive context, not a reputation claim.
  - me-sub-pages.ts: 'personalhub' / 'myscenes' fixture
    sections lose the fake '准时 98%' / '已履约 42' /
    '复购 7' rows.
  - Dead subPages removed from me.tsx + me-sub-pages.ts:
    'messages' (4 hardcoded threads Linh / Bonsaidon /
    Mai / 西湖摄影散步), 'requestermemory' (5 hardcoded
    confirmed + suggested memories), and
    'businessdiagnostic' (Bonsaidon + 78 health / 248
    到店 / 6.2M 成交额 / 172 新客户 / 38 复购 / 37% /
    +22% — 8 fabricated business metrics in a single
    render). All three were unreached from any menu row,
    from meOwnedRouteForLabel, or from any setSubPage
    call. memorySourceLabel helper, also only used by
    requestermemory, is removed.
  - FAKE-STATS-001 tripwire (grep guard on the live
    surfaces).
  - DEAD-SUBPAGE-001 tripwire (grep guard on the three
    removed subPages; me-sub-pages.ts must not
    re-introduce them).

## Revision 35 — 2026-09-05

- Closed the me-hub social badge gap. The hub top
  card used to render the hardcoded
  `persona.profileCard.social` (`["TT","Z","IG","in"]`)
  no matter what the user actually configured in
  the social accounts editor. Editing a handle +
  flipping visibility to "公开展示" had no effect
  on the hub. This revision adds `resolveHubSocials`
  in `me-types.ts` and rewires the me.tsx render
  path to project the live `socialAccounts` (already
  wired to `socialSettingsClient` + 250ms debounced
  write) onto the badges. Accounts with blank handles
  or non-public visibility are hidden; when the list
  is empty the card shows a "去 我的 → 社媒账户 设置"
  hint. HUB-SOCIAL-001 tripwire (1 mobile vitest
  + 2 grep guards).

## Revision 34 — 2026-09-05

- Closed the '我的' hub card gap. The me-hub top
  profile card + identity card used to render the
  hardcoded `persona.name` ('Huyen' for requester,
  'Bonsaidon' for business) and a fake
  '已验证 · 准时 98%' verification stat, no matter
  who was signed in. The profile editor (编辑主页)
  wires profileStore + ProfileClient, but the hub
  card never read those fields, so editing 主页 had
  no visible effect on the hub. This revision adds
  `resolveHubProfile` in `me-types.ts` (single source
  of precedence for displayName / initial / city /
  handle / hasAvatar) and rewires both the profile
  card and the identity card to project the live
  profile onto their renders. The fake verify badge
  is gone; the handle now shows in its place when
  the user has set one. HUB-PROFILE-001 tripwire
  (6 mobile vitest + 3 grep guards).

## Revision 33 — 2026-09-05

- Closed the '我的 → 好友与关系' gap. The mobile
  FriendCrmSurface was entirely hardcoded mock: 4 fake
  friends (Mai / An / Luna / Khoa), 2 fake pending
  requests, fake contact / social matches; every
  action (add / accept / ignore / block) mutated only
  local React state. This revision adds the
  relationship package end-to-end: server commands
  ListMyFriendships / SendFriendRequest /
  AcceptFriendRequest / IgnoreFriendRequest /
  BlockFriend with USER-only auth + symmetric (a,b)
  pair canonicalisation + IGNORED_TOMBSTONE row
  semantics, PG persistence (migration 040), mobile
  RelationshipClient with 4 cases, and the surface
  rewire that projects server active + pending buckets
  into the existing render path. The 4 mock constants
  remain as offline fallback only. FRIEND-001 tripwire
  (6 server + 4 mobile + grep guard).

## Revision 32 — 2026-09-05

- 小美快捷入口改道：推荐页未落地前，“看小美机会”进真实 AI 活动流
  （ACTIVITY tab），不再跳机会页占位。纯路由改道，无视觉新增。

## Revision 31 — 2026-09-05

- Closed the storefront '编辑主页 / 联系方式 / 营业时间' gap.
  The server has had UpsertStoreLines since R18.x b77187a,
  but the mobile MerchantStorefrontSurface was read-only:
  business owners saw their old lines but had no way to
  edit description / contact / hours / logo. This revision
  adds the inline edit form (5 TextInputs + a 保存
  button + 取消) and the startEditLines / saveLines
  handlers; saveLines calls client.upsertStoreLines, and
  validates the hours JSON client-side before sending so
  the user gets a clearer error than the server's reject.
  LINES-EDITOR-001 tripwire.

## Revision 30 — 2026-09-05

- Closed the '取消订单' gap. The Order lifecycle enum
  included CANCELLED, but no server command ever wrote it:
  every '我的订单 → 已取消' tab was empty, and the surface
  had no button. This revision adds the
  fulfillment.CancelOrder command (actor must be either
  party; OFFERED / CONFIRMED / EXECUTING are cancellable;
  COMPLETED / CANCELLED are terminal; the reason lands in
  the OrderCancelled event payload for audit) and the
  me-orders surface's red outline '取消订单' button with
  confirmation prompt + optimistic lifecycle update.
  CANCEL-001 tripwire (5 server + 3 mobile tests).
  Also enables the previously-disabled PROFILE-001 mobile
  half of commit 946a710.

## Revision 29 — 2026-09-05

- 商家身份发布 (MERCHANT-PUBLISH-001)：发布需求/活动表单新增“发布身份”
  选择（个人/名下店铺，无店不显示）；以店名义发布时订单 Owner/OwnerType、
  活动 Origin/merchantName 由服务端注记盖章。个人路径零变化，无视觉新增，
  只是发布表单多一行选择器。

## Revision 28 — 2026-09-05

- Wired the Profile service half that commit 6e68aaf
  accidentally missed: identity.Service.profileService
  field, NewWithRepositoryAndClockAndChallengeProvider
  initializes it to NewProfileService(nil, clock),
  SetProfileRepository lets the transport layer swap in
  the PG repo, and main.go's PG path now calls
  identityService.SetProfileRepository(postgres.NewIdentityRepository(pool))
  so UpdateProfile survives restarts. The PROFILE-001
  server half is now actually exercised by identity_test.

## Revision 27 — 2026-09-05

- Replaced feed-local fixed `0/1` reaction displays with authenticated server
  counts and viewer state; like and unlike are idempotent across Memory and PG.
- Added the minimal per-post reply list and refresh-after-send path so replies
  and their counts remain visible (`POST-REACTION-TRUTH-001`,
  `POST-COMMENT-VISIBILITY-001`).

## Revision 26 — 2026-09-05

- 修头像 P0 丢失：hydration 用了不存在的 `file.exists`（恒 falsy，每次冷
  启动都丢头像只剩字母头）＋绝对路径存 container UUID（重装即死）。现只
  存文件名、启动按当前沙盒重锚＋校验，老记录后台回写自愈。无视觉变更。

## Revision 25 — 2026-09-05

- 商家店铺页补建店入口：无账号时可一次建账号+首店，有账号无店时可追加
  店铺。之前两处空态互相指“去别处建”但全仓无入口，商家链路（相册、
  以店名义发布）对新商家完全不可达。纯增量 UI，无视觉规范变更。

## Revision 26 — 2026-09-05

- Closed the '编辑主页' gap. The mobile profile editor in me.tsx
  was a local-only write (profileStore.write to iOS Keychain /
  Android Keystore). No server command existed, so the new
  name / handle / bio / city / avatar never reached feeds,
  opportunity applicants, or any cross-device read. This
  revision adds the server half: identity.Profile aggregate
  with ProfileRepository (memory + PG /039), two commands
  (UpdateProfile / GetProfile) in the identity service, with
  actor-scoped authorization (USER only) and the same asset
  path rule as business.store_photos (rejects external URLs).
  PROFILE-001 tripwire. (Mobile wire lands in the next commit.)

## Revision 24 — 2026-09-05

- Closed the merchant surface gap. The previous '商家' tab in
  business-home.tsx and merchant-me-r21.tsx was entirely hardcoded:
  'Bonsaidon' identity, '48 张相册' counter, '8,426 关注' stats, and
  every manage tile was a non-clickable View. This revision gives the
  business domain four new server-side commands (AddStorePhoto /
  ListStorePhotos / DeleteStorePhoto, UpsertStoreLines / GetStoreLines,
  UpsertMemberDirectory / ListMemberDirectory, UpsertSpendDaily /
  ListSpendDaily) backed by a real PostgreSQL schema (migrations
  /038) and an in-memory repository. Asset paths are constrained to
  Proxy-internal prefixes (ai-personas/, assets/, store/, photo_); an
  external URL on the photo or logo path is rejected with
  INVALID_ASSET_PATH. Mobile commit (de2538e) wires the new
  BusinessClient methods, the photo picker
  (retainStorePhoto + ImagePicker.launchImageLibraryAsync) and the
  me.tsx > merchantstorefront route into MerchantStorefrontSurface
  so the user can upload a real photo. Mobile commit
  (merchant-me-r21-replacement) removes merchant-me-r21.tsx
  (1250-line @ts-nocheck hardcoded mock) and
  merchant-creator-center.tsx, replacing them with
  MerchantMeR21Replacement — a real surface that calls
  BusinessClient.listMyAccounts / ListBusinessStores /
  ListMemberDirectory / ListSpendDaily, SupplyClient.querySuppliers
  for creator recommendations, and ActivityClient.listActivities
  for the activity surface. Empty states are honest ('server 列表
  为空') instead of the bogus '12.6tr VND' / '148 订单' fallbacks.
  app-shell.tsx threads the activities client down to MeSurface.
  Mobile commit (BusinessHome real wire) replaces the 242-line
  hardcoded 'Bonsaidon today push' / 'Rooftop Photo Afternoon' /
  '场景结果 Invite Sent 12' mock with a real surface that calls
  BusinessClient.listMyAccounts / listStores / listMemberDirectory /
  listSpendDaily and ActivityClient.listActivities, with honest
  empty states. app-shell.tsx threads business + activities into
  <BusinessHome/>. Tripwires: STORE-PHOTO-001, STORE-LINES-001,
  MERCHANT-DIRECTORY-001, MERCHANT-SPEND-DAILY-001, MERCHANT-R21-001,
  BIZ-HOME-WIRE-001.

## Revision 23 — 2026-09-05

- Hardened marketplace confirmation so application state and the derived
  fulfillment order commit atomically in PostgreSQL and fail together in memory.
- Made order derivation deterministic and idempotent across retries, and hydrate
  the requester from the authoritative opportunity owner (`CHAT-ORDER-ATOMIC-001`).

## Revision 22 — 2026-09-05

- chat → order 派生路径 (R17.x): marketplace
  ConfirmMarketApplication 不再用 fake "order_" +
  applicationID 拼接 — server 生成真 ord_<hex>, 委托 fulfillment
  MemoryRepository 创建真 Order (production 走 PG adapter)。“我
  的订单”页 (走 fulfillment.listMyOrders) 现在能看到
  marketplace confirm 产生的 Order。Application 加 OwnerID 字
  段 (apply 时快照 opportunity owner 作为 Order.RequesterID) 。
  Idempotency: 重复 confirm 不重复创建 Order。
  tripwire CHAT-ORDER-MATERIALISATION-001 跳防 " 我的订单/我
  的机会" 两路径不一。

## Revision 21 — 2026-09-05

- Added a merchant-only `Creator 推荐` rail backed by `QuerySuppliers`, using
  real active profiles, verified eligibility, market availability, profile
  photos and reference pricing. Missing/error states remain explicit instead
  of falling back to hard-coded people. Added the durable
  `MERCHANT-CREATOR-001` client/server regression tripwire.

## Revision 19 — 2026-09-04

- 对话中 "活动" 按钮发出的 proxyObject 不再 hardcoded
  "act_westlake" (一个 server 不存在的 ID). 现在 conversation
  sheet picker 从 server listActivities() 选真实活动, 发
  真 ID. tripwire CHAT-PROXY-ACTIVITY-001 跳防 hardcoded
  fallback 重现。“点聊天活动” 路径与“我的活动”页在 server
  同一份仓储。

## Revision 19 — 2026-09-04

- 平台 AI 5 角色 (ai_001-ai_005) 冷启动活动带 photo 资产。
  apps/mobile/assets/ai-personas/ 下五个统一风格 SVG 头像
  (紫/粉/绿/橙/金主题 + AI 虚拟 badge); ActivitySchema 增
  aiPersonaPhoto 字段; tasks.tsx + me-orders.tsx 改用 persona
  圆形 token 渲染 (SVG 上线后 Image 可换 require); 5 个
  冷启动活动 seed 都 携带 ai-personas/ai_00X.svg 路径,
  tripwire AI-PERSONA-PHOTO-001 跳防路径丢失。明确不
  “看起来像真人": 是 AI-rendered 头像, 不是真人拍提。

## Revision 18 — 2026-09-04

- “我的活动” surface (me.tsx > myactivities) 接进 server
  真实 activity 仓储。MyActivitiesSurface 不再用 hardcoded
  mock; ActivityClient.listMyActivities() 取代“本周暂无
  开放活动” fallback。匿名访问下“已参加 / 我发起的”诚
  实提示登录。detail 页面 复用 ActivityDetailSurface 加
  initialActivityId / onBack props (与别人 cherry-pick 一致)，
  修一个别人留下的 detailId 状态未声明 的 TS bug.

## Revision 17 — 2026-09-04

- “我的活动” 物化路径 (R17.x): server 端 ListMyActivities 返
  actor-scoped created + joined 两个数组; PG 以 payload->>'ownerId'
  和 activity.participants JOIN 提供仓库事实; contracts 增
  ListMyActivitiesPayloadSchema schema + 3 个 tripwire。Anonymous
  / 空 actor 被 server 拒绝 (不能“看到任何我的活动"")。下一个
  commit 将进 mobile surface 替换 hardcoded mock  (MyActivitiesSurface)。

## Revision 16 — 2026-09-04

- 个人总管理页可编辑基本信息：新增“编辑资料”入口，复用个人主页编辑器
  （Modal 移到根，各页可开）。无视觉新增，只是把已有编辑器挂到总管理页。
- 二维码分享接通：两处 QrCard 的分享按钮调起系统分享（真实主页链接）；
  文案诚实化（二维码图形升级中，先分享链接）。无新增图形资源。
- 总管理注册文案与 AVAILABILITY_OPTIONS 对齐（忙碌/暂不接单/隐身）。
- 我的活动页接真实活动服务（可参加/报名），去掉写死假数据。列表卡片沿用
  现有 savedCard/orderTab 样式，无新视觉规范。

## Revision 15 — 2026-09-04

- Closed the client side of R16.x single-source-of-truth: the
  `PublishDemand` publish() path no longer constructs a PriceLabel
  locally, and `apps/mobile/src/surfaces/market.tsx` no longer
  carries the `priceLabelForFlow` helper that mirrored
  `opportunityPriceLabel`. `apps/mobile/src/marketplace-client.ts`
  publish() now takes the new
  `PublishMarketOpportunityInputSchema` from packages/contracts
  (with `priceLabel: z.string().optional()`), parses the response
  through the strict `MarketOpportunitySchema` so the wire-down
  invariant ("no naked amount") still holds.
- Added `MONEYFLOW-005` regression tripwire: client publish may
  omit, blank, or send a wrong-flow PriceLabel; the server's
  `normalizeOpportunityMoney` always derives the wire-down
  PriceLabel from MoneyFlow. Combined with the MONEYFLOW-004
  server-side fix in bdb1857, the R16.x PriceLabel contract is
  now end-to-end server-authoritative: mobile does not maintain a
  parallel mapping.

## Revision 14 — 2026-09-04

- Replaced the active opportunity candidate workbench's hard-coded Xiaomei,
  Linh, and Minh inventory with owner-only, repository-backed applications.
- Added the prototype lifecycle: human applies, owner selects one application,
  the other submissions close, and the selected human confirms cooperation to
  materialize a stable order reference. Platform AI, user twins, and AI
  assistants cannot select or confirm.
- Added `OPPORTUNITY-DEAL-001` across service, PostgreSQL lifecycle, mobile
  wiring, and the regression gate. Reputation/profile enrichment remains a
  named gap; the UI no longer invents rankings or fulfillment percentages.

## Revision 13 — 2026-09-04

- Raised the conversation composer above the device bottom safe area and kept
  keyboard overlap handling inside the fixed AppShell body.
- Added camera/library selection, local preview, the existing resumable media
  upload pipeline, IMAGE message send, and historical thumbnail rendering.
- Added `UI-CHAT-001` to prevent regression to text-only/local-only image UI.

## Revision 12 — 2026-09-04

- Promoted the prototype activity creation path into the active implementation
  baseline: a signed-in human can publish a shared-participation activity at a
  real CAFE/RESTAURANT scene and immediately open its server-backed detail.
- Enforced the prototype boundary in the service: user activities are free;
  venue consumption is separately declared as SPLIT or HOST_COVERS; paid
  capability requests stay in the demand/opportunity pipeline.
- Added `ACT-PUBLISH-001` backend, PostgreSQL, mobile command, and offline-write
  guards. Participant invitation and activity chat remain explicit next gaps.

## Revision 11 — 2026-09-04

- Added `docs/spec/Proxy_PRD_v1.7_R16_AI_Three_Actors_MoneyFlow_Direction.md`:
  canonical entry for the R16.x AI-three-actors + MoneyFlow-direction
  freeze. Records the AI boundary capability matrix (Human / PlatformAI /
  UserTwin / UserAssistant), the four-way MoneyFlow wire contract
  (EARN / PAY / FREE / TBD for Opportunity; FREE / PAY_TO_JOIN /
  PAID_TO_ATTEND for Activity), the publisher / applicant dual-perspective
  priceLabel wording, and the g4 tripwire registry (AI-ACTOR-001/002,
  MONEYFLOW-001/002/003, LIFECYCLE-PG-001 — 13 named tests).
- `scripts/check-regression-contracts.sh`: registered four pre-existing
  PG lifecycle integration tests (TestActivityPostgresLifecycle /
  TestMarketplacePostgresLifecycle / TestScenePostgresLifecycle /
  TestOutcomePostgresLifecycle) under the new `LIFECYCLE-PG-001` tripwire.
  Previously these tests existed but were not gated; a future refactor
  that weakened their SQL semantics could land without g4 noticing.

## Revision 10 — 2026-09-04

- `market` scope (PublishDemand): split the price label helper into
  `priceLabelForFlow` (wire-bound, applicant-side) and
  `priceLabelForPublisher` (view-only, publisher-side). The previous
  version used the applicant-side copy in the publisher UI which read
  as "completed you receive" — wrong perspective. Both helpers keep
  the same Chinese wording intent as before but address the right
  reader; the wire contract still flows through `priceLabelForFlow`
  and server `normalizeOpportunityMoney`. `IMPLEMENTATION_CONTRACTS.json`
  updated to describe the dual-perspective design and to list
  `apps/api-go/internal/marketplace/service_test.go` as additional
  evidence for both `market` and `activity` scopes (AI-ACTOR-002 /
  MONEYFLOW-001 tripwires that pin the wire contract).

## Revision 9 — 2026-09-04

- Anchored the market/tasks/activity UI work that was previously scopeless:
  `market` + `activity` are now ACTIVE_SCREEN_REFERENCE under
  `Proxy_Market_Opportunity_Filter_R7.html` ("Opportunity / Activity R2"),
  `my-tasks` is FUNCTIONAL_REFERENCE_ONLY under `proxy_my_market_modules_v5.html`.
- Added `market` + `activity` implementation contracts (PARTIAL): moneyFlow
  4-state + priceLabel rendering wired; known gaps are EARN copy unification
  and organizer-delegated attendance marking.
- Security hardening that touches baseline-sensitive surfaces: facet writes
  require session + server-stamped UpdatedBy + rate limiting (FACET-AUTH-001),
  attendance verifies participation (ACT-ATTEND-001), market dismiss enters the
  AI boundary gate (AIBOUND-001). No visual contract changed by these.

## Revision 8 — 2026-09-04

- Replaced the mobile Reality Scene launch catalog and fixed `47` count with a
  PostgreSQL-backed catalog projection.
- Added consent-gated current-location recommendations ranked by distance and
  popularity, plus timestamped private visit history (`UI-SCENE-MAP-001`).

## Revision 7 — 2026-09-04

- Preserved device-only settings during the first account-sync upgrade instead
  of treating an absent server record as authoritative empty data.
- Serialized preference writes to prevent slow, older requests from restoring
  stale settings; added the `UI-SOCIAL-003` regression contract.

## Revision 6 — 2026-09-04

- Upgraded social and collaboration settings from device-only persistence to
  authenticated account persistence with local offline cache fallback.
- Added `UI-SOCIAL-002` client/server ownership and round-trip regression coverage.

## Revision 5 — 2026-09-04

- Added persisted collaboration opt-in, types, optional rate and contact fields.
- Disabled and labeled Merchant Me tiles that do not yet have a real route.

## Revision 4 — 2026-09-04

- Persisted user-controlled social accounts and visibility locally; removed
  realistic prefilled identities that could be mistaken for user data.
- Relabeled merchant preview metrics so static prototype values no longer claim
  to be live server truth.
- Added `UI-SOCIAL-001` regression coverage.

## Revision 3 — 2026-09-04

- Corrected Personal Profile from `IMPLEMENTED` to `PARTIAL`; its five-tab
  implementation does not match the active three-tab prototype.
- Corrected Social Contact ownership from Friend CRM to the `me.tsx`
  `socialidentity` route and documented missing persisted collaboration settings.
- Corrected Creator Center to `SCAFFOLD_ONLY`.
- Closed `UI-PROFILE-001` (first post hidden without a real pin) and
  `UI-PROFILE-002` (unrelated photos presented as saved/tagged content).

## Revision 2 — 2026-09-04

- Added monotonic baseline protection: active scopes cannot disappear, point
  into archive, or be downgraded without an explicit baseline revision.
- Added machine-readable prototype-to-implementation contracts and explicit
  known-gap states.
- Bound root dock and profile references to implementation and test evidence.
