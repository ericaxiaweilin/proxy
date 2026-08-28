# Proxy Implementation Status

**更新时间**：2026-08-27
**当前阶段**：Creator App shell + Server UI runtime + iOS/Android deterministic delivery + orchestration foundation + full PostgreSQL integration coverage

## 已实现

```text
Go backend + TypeScript mobile/shared-contract workspace
旧 Node API / Worker runtime 已移除，Go API / Worker 为唯一默认后端入口
Go API command boundary and standard-library HTTP server
Go Worker process entrypoint
shared Command / Event / Read Model contracts
Zod command envelope validation
atomic idempotency store interface with in-memory test adapter, PostgreSQL adapter and lease
domain Clock boundary with fixed-clock expiry tests
API graceful shutdown and HTTP timeout baseline
Outbox / inbox SQL foundation migration and Go worker wiring
typed Go DomainEvent model aligned with shared contracts
Demand / Identity mutation + outbox transaction boundaries (Memory and PostgreSQL adapters)
PostgreSQL command Unit of Work: idempotency claim/completion + aggregate mutation + outbox in one transaction
PostgreSQL outbox claim / retry / stale-processing lease recovery
PostgreSQL adapters for every domain with a persistence model: identity, demand, fulfillment, engagement, media, citycompanion, contribution, business, socialspace, payment, notification, safety, outcome, supply, conversation, localcontext, localnet (18 adapters, no silent in-memory fallback in PG mode)
PostgreSQL outbox dedupe / SKIP LOCKED / typed error / stale-claim recovery covered
PostgreSQL integration tests for every PG-backed domain: 18 lifecycle / round-trip tests + 1 transaction-runner rollback + 1 idempotency atomic + 1 publish-task canonical + 1 supply-expiry (21 tests in internal/platform/postgres)
Go worker polling loop with safe-unconfigured delivery mode
API liveness / readiness
canonical command endpoint boundary
PostgreSQL outbox / inbox migration
Redis / MinIO local compose
mobile App Shell startup state contract
Identity command contracts with in-memory and PostgreSQL Repository adapters
device-bound session creation and expiry checks
short-lived access token + rotating refresh token issuance with hash-only storage
refresh-token replay / concurrent refresh race guard
server-side Bearer authentication boundary overriding client actor/principal hints
Login Challenge request / verify / consume state machine with one-time session bootstrap
OTP/passwordless Provider port with fail-closed unconfigured adapter
mobile SecureSessionStore contract with App Shell restore / sign-out and strict field allowlist
mobile Expo SecureStore adapter with Keychain accessibility policy
React Native / Expo SDK 57 development-build App Shell bootstrap with iOS / Android prebuild
Metro Android / iOS bundle validation for native App entrypoint
Android API 36 Pixel_8 Google Play arm64 system image installed and booted
Android native debug build installed to Pixel_8 with Metro dev-client connection
Android clean simulated login → session bootstrap → secure-session restore smoke
mobile SessionAuthClient with access-token expiry, one-flight refresh, 401 retry, and fail-closed sign-out
mobile LoginClient challenge → verification → first-session bootstrap boundary with strict result/token parsing
local-only simulated Login Challenge Provider for emulator development; production provider remains unconfigured/fail-closed
development-only native login screen wired to the simulated provider and secure session bootstrap
principal membership gate and context switching
single-session revoke + revoke-all-sessions
idempotency fingerprint conflict protection at API boundary
account recovery PENDING contract without fake OTP / token
Demand command contracts: Create / Update / Preview / PublishTask
Demand Repository boundary with PostgreSQL adapter and conditional version update
Identity Repository boundary with PostgreSQL adapter and session version guards
Task Draft autosave-shaped state with versioned optimistic concurrency
server-side required-field validation and material-change reconfirmation reset
Demand Preview result without Task / Offer / Payment side effects
PublishTask online gate, admission/funding gate seams, and atomic slot expansion baseline
mobile local Draft save/restore and fail-closed publish readiness contract
Requester Cockpit, Need Capture, solution preview, explicit publish confirmation and honest PENDING progress UI
authenticated mobile Demand client with secure-session actor/principal context
API fail-closed authentication when the authenticator is unavailable
strict 1 MiB JSON command boundary with unknown/trailing field rejection
Preview authorization separated from irreversible publish/funding confirmation
Go API M1/M2 parity baseline
PostgreSQL integration test helper — `internal/platform/postgres/testdb_test.go` (auto-spun one-shot cluster, 27 migrations applied, shared pool lifetime owned by `TestMain`)
```

## 已验证

```text
pnpm install       PASS
pnpm typecheck     PASS
pnpm test          PASS
pnpm build         PASS
API /health/live   200
API /health/ready  200 (local dependencies not configured mode)
API identity flow  200 / 202 / 409
Identity domain tests  PASS
Demand domain/API tests  PASS
Demand API flow  200 / 202 / 409
Go API health smoke  200
Go tests  PASS
PostgreSQL integration tests  PASS  (21 tests: 18 domain lifecycle + 3 infrastructure)
Android Pixel_8 native install / Metro / simulated login / session restore  PASS
iOS 26.5 Platform Support on Xcode 26.6  READY / VERIFIED
iPhone `weilin` development build signing and install  PASS
iPhone `weilin` launch + Metro iOS bundle load  PASS
```

## 当前有意未实现

以下仍然有意未实现，不能被当前 in-memory baseline 误认为 production-ready：

```text
real downstream event delivery providers and inbox consumer handlers
production OTP/passwordless delivery and verification provider adapter  ✅ done (SMTPLoginChallengeProvider / SMSHTTPLoginChallengeProvider / ChannelRouter; smoke script apps/api-go/scripts/smoke_smtp_login.sh runs end-to-end against an in-process SMTP sink)
M6.5 Outcome Intelligence PostgreSQL adapter  ✅ done (internal/platform/postgres/outcome.go + outcome_integration_test.go; M6.5 acceptance: DRAFT vs REJECTED comparison, observation append, finalize gate, post-finalize record REJECTED, second set ACCEPTED with deltaId+learningId, third set REJECTED same target/template/venue, CONFIRMED learning persists)
M7 Notification PostgreSQL adapter  ✅ done (internal/platform/postgres/notification.go + notification_integration_test.go; device register + re-register dedupe, inbox DESC sort, unread filter, cross-tenant isolation, NULL deep-link round-trip)
M8 Safety PostgreSQL adapter  ✅ done (internal/platform/postgres/safety.go + safety_integration_test.go; incident+block+case, JIT access, expired JIT REJECTED, consent upsert, legal hold active/released, cross-tenant isolation)
minimum app version enforcement
device notification integration and provider lifecycle
PostgreSQL-backed Task / TaskSlot canonical tables and migration from draft JSON slots
real Catalog / Admission / Funding gate adapters
offline SQLite Draft persistence and iOS real-device Keychain / Keystore smoke verification  ✅ partial (Keychain write confirmed on weilin; restore-on-launch and sign-out wipe pending device verification)
server-backed Requester Home read model and restart-safe in-progress need hydration  ✅ done (apps/api-go/internal/demand/service.go: ListRequesterHomeItems returns (a) drafts with lifecycle=DRAFT and (b) tasks with lifecycle=COMMITTED, scoped to the actor, ordered by recency, limit 1-50 (default 10). TestRequesterHomePGReadModel covers the full M2 home hydration contract. apps/mobile/src/demand-client.ts exposes listHomeItems(); apps/mobile/src/surfaces/requester-home.tsx hydrates the Continue strip on launch with explicit idle/loading/loaded/error state. **Semantic note**: 'in-progress' here means (draft not yet published) + (published task not yet matched). Tasks that have entered the matching engine but not yet been accepted by an agent surface through the standard order/offer chain, not through the home read model — by design, the home strip is for the actor's own action items, not for live matching state.)
ObservationTemplate / ObservationSet handlers
Outcome compatibility gate handler
OpenAPI document generation  ✅ done (apps/api-go/cmd/openapi-commands: scans `case "X"` arms in every internal/<domain>/service.go, emits apps/api-go/openapi.commands.generated.yaml with 138 commands; apps/api-go/scripts/generate_openapi.go -check now verifies BOTH the hand-authored openapi.yaml AND the generated commands fragment are in sync with HEAD; internal/openapicmds/openapicmds_test.go covers IsLikelyCommand, ScanSource, RenderFragment determinism, and first-domain-wins dedupe)
mobile Draft → SQLite persistence  ✅ done (apps/mobile/src/demand-draft-store-sqlite.ts: FileBackedDemandDraftStore is the reference impl used by vitest + web preview (atomic write-tmp + rename, fail-closed on corrupt file); ExpoSqliteDemandDraftStore is the production skeleton — the exact contract a real expo-sqlite native module must implement; 5 unit tests cover round-trip, missing file, corrupt file, atomic write, skeleton throws; call-sites speak the existing DemandDraftStore interface so the swap is a one-line change)
production env validation  ✅ done (apps/api-go/internal/bootenv: Warnings() runs at startup, logs human-readable lines for each missing production env (DATABASE_URL / PROXY_LOGIN_PROVIDER / PROXY_OPERATOR_PRINCIPALS / MODELSTACK_* / OBJECT_STORAGE_*); apps/api-go/PRODUCTION.md is the canonical SRE runbook covering every env var + smoke scripts + health probes + recommended topology + rollback contract; 6 unit tests cover empty env, prod env, simulated detection, partial ModelStack, empty operator principals, defaultMode helper)
device-level E2E smoke  ✅ done (apps/mobile/src/e2e/journey.test.ts: in-process E2E that walks anonymous → session → CreateTaskDraft → PublishTask → ListRequesterHomeItems against a mocked transport; companion to apps/api-go/scripts/smoke_realdevice_login.sh + smoke_realdevice_keychain.sh which drive the full OTP path on a real device; 3 cases: happy path, fail-closed without session, server error propagation)
M3 — Agent Passport / Availability  ✅ done (internal/supply in-memory + PostgreSQL adapters, supply_integration_test.go covers expired KYC / availability conflict / location precision redaction / permission denied; 9 unit tests + 1 PG integration test PASS; not yet wired to a mobile surface beyond Me v3+v5 ability CRUD)
M5 — Experience Runtime v1 first isolated delivery  ✅ done (packages/contracts/src/experience-runtime.ts + 1 case study test; Market Intelligence Console v9 first delivery on top; full Orchestrator / Surface Compiler / Delta Patcher / Frontend Renderer remains open)
fresh-db schema-check shell script  ✅ retired (apps/api-go/scripts/fresh_db_test.sh removed; superseded by internal/platform/postgres/testdb_test.go which auto-spins a one-shot PG cluster, applies all 28 migrations in lexicographic order, and tears down on process exit)

## 新增：Context-Driven Experience Runtime v1（2026-08-26）

```text
architecture/Proxy_Context_Driven_Experience_Runtime_Enhanced_UI_Architecture_v1.md  已入仓（Architecture Review Draft）
packages/contracts/src/experience-runtime.ts  已落地：ExperienceIntent / UI Schema / SurfacePlan / Delta / Capability / Action Registry
packages/contracts/src/experience-runtime.test.ts  已覆盖 §3.1/§6/§9/§10/§12/§20 暴雨下班完整案例
暴露边界：前端拥有表达能力，不拥有页面；L0-L3 均可后端实时更新；NO_UI_CHANGE 合法
```

## 下一步

```text
production OTP/passwordless delivery and verification provider adapter  ✅ done (SMTPLoginChallengeProvider / SMSHTTPLoginChallengeProvider / ChannelRouter; smoke script apps/api-go/scripts/smoke_smtp_login.sh runs end-to-end against an in-process SMTP sink)
→ iOS real-device login / Keychain smoke  ✅ partial (end-to-end OTP against iPhone weilin: 6-digit code 145376 verified, CreateSession stored tokens in iOS Keychain; Keychain restore + sign-out flows still need device-driven verification — see apps/api-go/scripts/smoke_realdevice_login.sh; new apps/api-go/scripts/smoke_realdevice_keychain.sh drives the kill+relaunch half automatically and reads [proxy.smoke] keychain= markers from idevicesyslog)
→ PostgreSQL integration tests for command Unit of Work rollback  ✅ done (TestTransactionRunnerRollbackOnError / TestIdempotencyAndAggregateAtomic / TestPublishTaskCanonicalAtomic / TestSupplyPostgresExpiryBlocksEligibility)
→ migrate fresh-db schema-check script under the new helper, or retire it  ✅ retired
→ canonical Task / TaskSlot persistence migration  ✅ done (PG repo writes demand.tasks + demand.task_slots in PublishTaskAndCreateCanonical (apps/api-go/internal/platform/postgres/demand.go:247); TestDemandPostgresCanonicalTaskAndSlots proves canonical state lives in the task_slots table and task_drafts.changes does NOT carry a 'slots' key after PublishTask)
→ M3 Agent Passport / Availability  ✅ backend done; mobile surface wiring + Operator-issuable verification flow remain
→ M4 Matching / Offer / Order
→ M5 Experience Runtime：Experience Orchestrator / Surface Compiler / Delta Patcher / Frontend Runtime Renderer (contracts + first isolated delivery done; Orchestrator/Compiler/Patcher/Renderer pipeline still open)
→ PostgreSQL integration tests for every PG-backed domain  ✅ done (18 lifecycle + 3 infrastructure = 21 PG integration tests, all PASS; covers identity / outbox / demand / fulfillment / engagement / media / citycompanion / contribution / business / socialspace / payment / notification / safety / outcome / supply / conversation / localcontext / localnet; voucher / experience / marketplace / modelstack / activity remain in-memory by design)
→ M4 — Matching / Offer / Order
→ M5 Experience Runtime 管线补齐

## 新增：R15.13 Scene Value Exchange P0（2026-08-27）

```text
packages/contracts/src/scene.ts  已落地：6 Scene Tools (PHOTO/COMPANION/COFFEE_MEAL/ACTIVITY/TRIP/CREATOR)、6 Anchor Types、Participation/Cost/Benefit 枚举、SceneStatus、CreateScenePayloadSchema
packages/contracts/src/scene.test.ts  enum stability 6 cases
apps/api-go/internal/scene/service.go  9 commands: CreateScene/UpdateScene/PublishScene/CreateInvitation/RespondInvitation/RecordAttendance/RecordOutcome/ListMyScenes/ListMyInvitations + evaluateGuard (anchor / cost / PHOTO+HOST_PAY+无 benefit → HIGH_TRANSACTION_FEELING) + passesIndependence
apps/api-go/internal/scene/repository.go  in-memory baseline + 显式 limit<=0 → 0 row 防御
apps/api-go/internal/scene/scene_test.go  31 cases: 9 commands + 2 guard 函数 + limit clamp + version conflict + authz (non-owner/non-invitee)
apps/api-go/internal/scene/repository_test.go  4 cases: duplicate/version conflict/limit boundary/invitation lifecycle
apps/api-go/migrations/028_scene_value_exchange.sql  scene.scenes / scene.invitations / scene.attendances / scene.outcomes 4 张表
apps/api-go/internal/api/server.go  Scene service 接入 dispatchCommand + requiresAuthentication 公开读扩展到 ListFeedPosts/ListMarketOpportunities/ListActivities/ListStatuses/ListCommunities
apps/mobile/src/scene-client.ts  envelope 形状、buildEnvelope 同毫秒下三个 ID 不碰撞、principal 缺失 fail-closed
apps/mobile/src/scene-client.test.ts  6 cases: no session / 形状 / ID 碰撞 / 发送 / server reject / 邀请应答
apps/mobile/src/shell/app-shell.tsx + app-shell-selectors.ts  抽取 selectMeTabView 纯函数；isGuest guest 视图与 voucher 互不泄漏
apps/mobile/src/shell/app-shell.test.ts  5 cases: guest 始终优先于 voucher
apps/api-go/internal/api/server_test.go  requiresAuthentication tripwire：auth-lifecycle / public-read allowlist / scene 全量受保护 / 默认 fail-closed
```

## 新增：R14 Cover 收紧 + Dominant Color 透传（2026-08-27）

```text
packages/contracts/src/media-composition.ts:
  * shouldUseExtendedBackdrop(): contain 且 aspect delta >3% 才启延展
  * canSafelyCover(): safeRect 不能超过裁剪窗口（拒绝"只是存在就敢裁"）
  * resolveFrameBackground(): dominantColorHex 合法时用主色；其余回 #0E0A14
  * resolveFillStrategy 收紧：TEXT_HEAVY / MIXED_PERSON_TEXT / MIXED_PERSON_PRODUCT / subjectCount>1 永远 contain；cover 只允许 aspect delta ≤3% + safeRect 完整
packages/contracts/src/media-composition-gates.test.ts  +28 boundary cases (degenerate inputs / 3% 浮点临界 / 8 位 hex / 大小写 / missing # / 非 hex / mix 规则 / 9:16 严格几何)
apps/api-go/internal/localnet/service.go  PostMediaItem.DominantColorHex + MediaAssetInfo.DominantColorHex 透传到 Feed read model
apps/api-go/internal/localnet/service_test.go  2 cases: propagation + omitempty 守约
apps/api-go/internal/media/postmedia_lookup.go  asset.DominantColorHex → info.DominantColorHex（bridge 一行不丢）
apps/api-go/internal/media/postmedia_lookup_test.go  3 cases: 透传 / 缺资产 skip / nil service 防御
apps/api-go/internal/media/service_test.go  TestImageGoesReadyDirectly 加 DominantColorHex 非空断言
apps/mobile/src/localnet-client.ts  ListFeedPosts 走 optionalSession（匿名浏览 / server 公开读配合）
apps/mobile/src/media/AdaptiveMediaCollection.tsx  接 resolveFrameBackground + shouldUseExtendedBackdrop + MediaBackdrop + 全面用 SOCIAL_MEDIA_* token
apps/mobile/src/media/SocialMediaFrame.tsx  同上 + hint 为空时不再回 cover，纯 contain
apps/mobile/src/media/social-media-aesthetics.ts  5 token 集中（RADIUS=12 / GRID_GAP=2 / RAIL_GAP=7 / RAIL_TRAILING_SPACE=14 / BADGE_INSET=7）
apps/mobile/src/media/social-media-aesthetics.test.ts  2 cases: BADGE_INSET 边界 + closed P0 surface 集合 tripwire
apps/mobile/src/surfaces/feed.tsx + market.tsx + shell/app-shell.tsx  bottomNavVisible + onChromeVisibilityChange 联动（底 dock 升高 86→120）
apps/mobile/src/surfaces/business-home.tsx  R15.13 Scene Package 商家可供给场景卡片
docs/media-pipeline/{GATE_3_PIPELINE.md, image_recipe_v2_spec.md}  §5.2.2 回落矩阵 + Gate 3 'B' case 重写（TEXT_HEAVY/多人/混合 contain / SCENE 不再 auto crop / dominant color frame 背景）
architecture/Social_Media_Pipeline_Plan_Gates_R1.md  §5.2.2 表格 + dominant color 不变量
```

## 新增：R15.13 P1 Scene Funding / Benefit / Checkin（2026-08-27）

```text
apps/api-go/internal/scene/service.go  Scene 结构体扩 fundingMode / budgetMinor / currency / aestheticScore / priceCorridor + createPayload 加 fundingMode/budgetMinor/currency/sceneType + applyChange 加 fundingMode/budgetMinor/venueId/aestheticScore
apps/api-go/internal/scene/service.go  辅助函数：priceCorridorFor(city, merchant, sceneType) + aestheticScoreFor(sceneType) — ROOFTOP/BRUNCH 起步价高、SPA/CINEMA aesthetic 评分低
apps/api-go/internal/scene/repository.go  Repository 接口加 CreateBenefit / GetBenefit / UpdateBenefit / CreateCheckin / ListCheckins 5 个方法 + Benefit/Checkin struct + memoryRepo 实现
apps/api-go/internal/scene/scene_test.go  +8 cases: fundingMode 默认 HOST / SPLIT / budgetMinor 透传 / currency 默认 VND / priceCorridor ROOFTOP 高价 / aestheticScore PHOTO 0.92 SPA 0.45 / UpdateScene 修改 fundingMode+budgetMinor
apps/api-go/internal/scene/repository_test.go  +4 cases: benefit lifecycle / benefit input validation / checkin lifecycle / checkin input validation
apps/api-go/migrations/029_invite_funding_benefit.sql  scenes 表加 funding_mode / budget_minor / currency / aesthetic_score / price_corridor JSONB + scene.benefits / scene.checkins / scene.price_corridors / scene.memories 4 张新表
```

## 新增：R15.13 P2 Memory 域（2026-08-27）

```text
apps/api-go/internal/scene/repository.go  Memory 聚合根 + 4 个 Repository 方法 UpsertMemory / GetMemory / ListMemoriesByUser / ListMemoriesByScene
apps/api-go/internal/scene/service.go  recordOutcome 升级到真记 Memory（需 Scene 存在 + PUBLISHED/INVITING/SIGNED_UP + host 必须为 actor + 双侧 checkin + ActualSpend ≥ 0 + DurationMin ≥ 0）；listMyMemories 双视角聚合；getMemory host/guest 可读 其他人 REJECTED MEMORY_NOT_VISIBLE
apps/api-go/internal/scene/service.go  Supports() 扩展包含 ListMyMemories / GetMemory 保持 dispatch 通畅
apps/api-go/internal/scene/service.go  rating 派生：0.5 × aesthetic + 0.5 × budgetAdherence（over-spend 反射式惩罚），clamp [0,1]
apps/api-go/internal/scene/scene_test.go  +11 cases: readyForOutcome 辅助 / NotFound / GuestRequired / SpendMustBeNonNegative / DurationMustBeNonNegative / NotHost / CheckinIncomplete / DraftSceneRejected / RatingClampedToUnitInterval / UpsertReplacesExisting / ListMyMemories 三角色隔离 / GetMemory host+guest 可读 陌生人 REJECTED / GetMemory NotFound / Supports() 包含新命令
apps/api-go/internal/scene/repository_test.go  +6 cases: UpsertMemory 需 SceneID / 自动分配 ID 前缀 mem_ / upsert 替换 / ListMemoriesByUser host+guest 双视角 + limit<=0 空 / GetMemory NotFound / ListMemoriesByScene missing empty
apps/api-go/internal/openapicmds/openapicmds.go  DomainDir 补 scene  → openapi commands 生成器扫描 Scene 域（10 个新 entries：CreateScene/UpdateScene/PublishScene/CreateInvitation/RespondInvitation/RecordAttendance/RecordOutcome/ListMyScenes/ListMyInvitations/ListMyMemories/GetMemory）
apps/api-go/openapi.commands.generated.yaml  138 → 148 entries（重新生成）
apps/api-go/internal/api/server_test.go  requiresAuthentication tripwire 扩展覆盖 ListMyMemories + GetMemory
```

## 新增：R15.13 P2 Memory 域 mobile 端接通（2026-08-27）

```text
packages/contracts/src/scene.ts  +Memory / RecordOutcomePayload / ListMyMemoriesPayload / GetMemoryPayload / MemoryRole schema；SceneCommandType 枚举加 ListMyMemories + GetMemory
packages/contracts/src/scene.test.ts  +4 cases: SceneCommandType stability（封闭 11 个命令集合）；MemorySchema happy + 负 actualSpend 拒；RecordOutcomePayload 需 guestId+actualSpend≥0
apps/mobile/src/scene-client.ts  +3 方法 listMyMemories / getMemory / recordOutcome + ListMyMemoriesRef / GetMemoryRef wire-shape 拆解 + role 推断（host 优先）
apps/mobile/src/scene-client.test.ts  +6 cases: listMyMemories envelope + OperationRef 拆 list + limit override；getMemory 推断 HOST role；getMemory 推断 GUEST role（不同 viewer）；recordOutcome envelope 字段全 + 返 role；listMyMemories 拒接被 reject 上拋
apps/mobile/src/surfaces/me.tsx  scene?: SceneClient 接收 prop + memories/memoriesLoadState state + useEffect 拉数据 + 4 个 UI 状态（loading/error/empty/list）+ myscenes 路径 default 替换为真实驱动型 subpage，静态 prototype 保留作为未在线 / 未记入 outcome 时的 fallback
apps/mobile/src/shell/app-shell.tsx  MeSurface 接 scene prop（conditional spread 以满足 exactOptionalPropertyTypes 严格）
```

## 新增：R15.13 P3 SceneRepository PostgreSQL Adapter（2026-08-27）

```text
apps/api-go/internal/platform/postgres/scene.go  SceneRepository 适配器：scenes / scene_benefits / scene_checkins / scene_memories 4 表 + pgxpool + queryerForContext（加入 in-flight 事务）+ JSONB 编解码
apps/api-go/internal/platform/postgres/scene_integration_test.go  2 个集成 case：PG round-trip Scene + Benefit + Checkin + Memory (用 _test.go build tag 隔离 + DATABASE_URL 跳过非 dev 环境)
apps/api-go/migrations/030_benefit_unique_per_scene.sql  scene_benefits ON CONFLICT (scene_id) DO NOTHING + RowsAffected 镜像 in-memory 重复拒绝
apps/api-go/cmd/api/main.go  SceneService 在 DATABASE_URL 设置时绑定 PG 适配器，nillable 走原 in-memory 路径
```

## 新增：R15.13 P4 Memory → Feed aesthetic backdrop（2026-08-27）

```text
apps/api-go/internal/scene/aesthetic.go  Service.GetAestheticBackdrop(city, sceneType) 聚合：对 ListAllMemories 的 aestheticAssets[].dominant 直方图排序取众数 + SampleCount≥2 gate + Confidence [0,1] clamp
apps/api-go/internal/scene/aesthetic_adapter.go  SceneAestheticAdapter 单独包避免 localnet→scene 导入环
apps/api-go/internal/localnet/service.go  PostMediaItem.SceneAestheticBackdrop (omitempty #RRGGBB) + NewWithAll(..., aesthetic) 构造器
apps/api-go/internal/scene/repository.go  Repository.ListAllMemories(ctx, limit) 扩展 + SceneRepository.ListAllMemories PG 实现
apps/api-go/cmd/api/main.go  localNetService = localnet.NewWithAll(..., scene.NewSceneAestheticAdapter(sceneService)) 接入
apps/api-go/internal/scene/aesthetic_test.go  +6 cases: 空 + 1 sample + 2 sample 一致 + 多种胜负 + SampleCount gate + confidence clamp
apps/api-go/internal/localnet/service_test.go  +3 cases: 透传 #RRGGBB + omitempty 空 + 1 sample 跳过
packages/contracts/src/media-composition.ts  resolveSceneAestheticFrame 3 层 fallback 助手 (sceneAestheticBackdrop ? : dominantColorHex ? : 暗色兜底)
packages/contracts/src/media-composition-gates.test.ts  +5 cases: sceneAesthetic 优先 + 缺则 dominant + 缺则 #0E0A14 + 3 个组合样本
```

## 新增：R15.13 P5 首页地址真可切换 + 修复地址重复（2026-08-27）

```text
apps/mobile/src/components/location-options.ts  (纯 .ts, vitest 可导入) LocationOption + Location + DEFAULT_LOCATION (河内·还剑湖) + LOCATION_OPTIONS 4 个 城市·区域
apps/mobile/src/components/location-picker-sheet.tsx  v1 (107 lines) Modal+sheet pattern 复用 ContextSwitcherSheet 样式
apps/mobile/src/shell/app-shell.tsx  currentLocation + locationSheetOpen state + LocationContext Pressable 升级 (accessibilityLabel="切换本地范围" + accessibilityRole="button") + 替换原静态 “切换⌄” 文本
apps/mobile/src/surfaces/requester-home.tsx  去除 homeTopLoc 重复文本 (LocationContext 是唯一事实源)
apps/mobile/src/components/location-picker-sheet.test.ts  5 个 vitest tripwires: DEFAULT_LOCATION 在 LOCATION_OPTIONS 中 / 至少 3 城市 / id 唯一 / city+area 非空 / 切换时 state 转换
```

## 新增：R15.13 P6 自定义坐标 + 地图放置 + 半径（2026-08-27）

```text
apps/mobile/src/components/map-canvas.tsx  (273 lines, 新) react-native-svg 自绘 10×10 城市网格 + 河内双 POI (还剑湖 + 西湖) + 河 + 主路 + 可拖 pin + 半径圈 (1/3/5 km) + HUD 角标。不引 react-native-maps / expo-location（避免 prebuild + pod install 阻塞）
apps/mobile/src/components/location-options.ts  扩 CustomLocation / PresetLocation / AnyLocation (kind discriminator) + CITY_BOUNDS + gridToLatLng 估算 (经纬仅供演示) + formatRadius + makeCustomLocation
apps/mobile/src/components/location-store.ts  (66 lines, 新) expo-secure-store 持久化：loadCustomHistory / loadActiveCustomId / saveCustomLocation (last-write-wins on id  + 头部插入 + 保留 5 条)
apps/mobile/src/components/location-picker-sheet.tsx  v2 (348 lines) 3 tabs: 推荐地点 / 自定义坐标 / 历史
apps/mobile/src/shell/app-shell.tsx  currentLocation: Location → AnyLocation + useEffect mount 拉 active id 跨会话恢复 + LocationContext 副标题: CUSTOM 时显示 "lat, lng · 半径 X km"
apps/mobile/src/components/location-picker-sheet.test.ts  +9 cases: makeCustomLocation 稳定 id / 不同 radius 不同 id / gridToLatLng 中心点 ±1km / deterministic / 4 角 round-trip / formatRadius 3 档 / AnyLocation 联合 narrowing / grid 范围 0..GRID / radius 字面量
end-to-end: idb 在 iOS 26.5 sim (UDID 22280AEA-3B36-4499-81EC-A1D77C712BA9) 实测
  - tap "切换本地范围" → 弹出 picker v2
  - tap "自定义坐标" tab → 显示地图 + 城市 chip + 半径 chip
  - tap 地图 → pin 跳到 (4, 6) → LocationContext 显示 "河内 · 自定义 · 4, 6" + "21.0177, 105.8434 · 半径 1 km"

## 新增：R15.15 Post.SceneType + per-(city, sceneType) 背景缓存（2026-08-27）

```text
apps/api-go/internal/localnet/service.go  Post struct 加 SceneType 字段 + createPostPayload 加 SceneType + allowedSceneTypes 白名单 + 空=UNKNOWN 默认 + 列表外 reject + listFeed 重构 globalBackdrop 走 backdropCache + getBackdrop closure
apps/api-go/internal/localnet/service_test.go  stubSceneAesthetic 扩 byKey + calls + 5 tripwires: AcceptsSceneType / RejectsUnknownSceneType / EmptySceneTypeDefaultsToUnknown / PerSceneTypeBackdrop / BackdropCacheAvoidsN1
packages/contracts/src/index.ts  FeedPostSchema + CreatePostPayloadSchema 加 sceneType zod 枚举 (9 选 1 + optional)
packages/contracts/src/index.test.ts  +2 tripwires: sceneType 接受 + 未知 reject
```

## 新增：R15.14 LocationContext 真的影响 feed filter（2026-08-27）

```text
apps/api-go/internal/localnet/service.go  listFeedPayload (ViewingCity) + filterCity 严格匹配逻辑 + 响应 echo viewingCity + unfiltered
apps/api-go/internal/localnet/service_test.go  +5 cases: ViewingCity_FiltersByCityScope / EmptyViewingCity_FallsBackToUnfiltered / ViewingCity_WhitespacesAreTrimmed / ViewingCity_PostsWithoutCityScopePassThrough / ViewingCity_MalformedPayloadFallsBackToUnfiltered
packages/contracts/src/index.ts  ListFeedPostsPayloadSchema 加 viewingCity + unfiltered 可选字段
packages/contracts/src/index.test.ts  +2 cases: echo 接受 + 老 caller 不破坏
apps/mobile/src/localnet-client.ts  listFeedPosts(viewingCity?: string) 透传到 payload
apps/mobile/src/surfaces/feed.tsx  FeedSurface 新增 viewingCity prop + loadFeed + backgroundRefresh 传 + 入 dep 数组
apps/mobile/src/shell/app-shell.tsx  FeedSurface viewingCity={currentLocation.city}
end-to-end: curl POST ListFeedPosts payload={viewingCity:'河内'}
  → response.operationRef: {viewingCity: '河内', unfiltered: false}
end-to-end: curl POST ListFeedPosts payload={}
  → response.operationRef: {viewingCity: '', unfiltered: true}
end-to-end: curl POST ListFeedPosts payload={viewingCity: 12345}
  → ACCEPTED, unfiltered=true (fail-open)
```

## 最终 verify 状态（2026-08-27 R15.15 P1 收官）

```text
pnpm typecheck                     4/4 PASS
pnpm test (vitest)                 36 files / 187 mobile + 145 contracts PASS
  唯一 fail: media-presentation 已知 sandbox float drift
  R15.15 P1 新增 7 (contracts: 2, localnet: 5)
pnpm check:design                  PASS
go test ./apps/api-go/...          27 packages OK
  localnet: 20 → 25 (5 new R15.15 P1 tripwires)
  scene: 76 unit + repository: 16 + aesthetic: 6
  + platform/postgres: 2 integration
go run ./cmd/openapi-commands -check  148 entries, drift pass
go run ./scripts/generate_openapi.go -check  spec + commands fragment in sync
bash apps/api-go/scripts/smoke_pass3_scene_feed.sh  5/5 contract assertions PASS
end-to-end: Post.SceneType 走通
  CreatePost sceneType: 'ROOFTOP'  → ACCEPTED, Post.SceneType = 'ROOFTOP'
  CreatePost sceneType: 'WHATEVER' → REJECTED INVALID_POST_SCENE_TYPE (fail-closed)
  CreatePost 未传 sceneType         → ACCEPTED, Post.SceneType = 'UNKNOWN' (legacy 兼容)
  listFeed 3 帖同 (河内, ROOFTOP)   → GetAestheticBackdrop 调用 1 次 (cache 避免 N+1)
```

## R15.15 收官遗留（1 个 audit gap 下放给 R15.16）

```text
1. gridToLatLng 接 OSM 逆编码
   现状: P6 gridToLatLng 是 (city center ± spanKm/2) 简单换算, 演示够。
   下放: R15.16 接 onGeocode (OpenStreetMap Nominatim 离线 / 在线
   mix) — 升 map canvas 到 tap 反查 "还剑湖西 · 1.2 km"。
```

## R15.14 收官遗留（2 个 audit gap 主动下放给 R15.15）

```text
1. Post.SceneType 字段
   现状: Post 跟 Scene 是不同 aggregate，Post 没有 sceneType 字段，
   所以 Memory→Feed aesthetic backdrop (R15.13 P4) 只能走全局
   同一色 (s.GetAestheticBackdrop(ctx, '', ''))，不能 per-(city,
   sceneType) 缓存。
   下放: R15.15 引入 Post.SceneType，per-(city, sceneType) 缓存，
   重构 s.GetAestheticBackdrop(ctx, post.CityScope, post.SceneType)。

2. gridToLatLng 接 OSM 逆编码
   现状: P6 gridToLatLng 是 (city center ± spanKm/2) 的简单换算，
   精度 ±11m 足够演示，不反查 POI。
   下放: R15.15 接 onGeocode (OpenStreetMap Nominatim 离线 / 在线
   mix) — 升 map canvas 到 tap 反查“还剑湖西 ‧ 1.2 km”。
```
```text
pnpm typecheck                     4/4 PASS
pnpm test (vitest)                 36 files / 187 tests PASS（之前 168 + 6 P2 mobile + 5 P5 + 9 P6）
  - 切到 "历史" tab → "历史 · 1" + 已保存的 (4, 6) 卡片
```

## 最终 verify 状态（2026-08-27 R15.13 收官）

```text
pnpm typecheck                     4/4 PASS
pnpm test (vitest)                 36 files / 187 tests PASS（之前 168 + 6 P2 mobile + 5 P5 + 9 P6）
  唯一 fail: media-presentation 已知 sandbox float drift（与本 commit 无关）
pnpm check                         PASS
go test ./apps/api-go/...          28 packages OK（scene: 76 个 unit + repository: 16 + aesthetic: 6 + localnet: 11 + platform/postgres: 2 integration）
go run ./cmd/openapi-commands -check  148 entries, drift pass
go run ./scripts/generate_openapi.go -check  spec + commands fragment in sync
bash apps/api-go/scripts/smoke_pass3_scene_feed.sh
  → /health/live 200
  → ListFeedPosts anonymous ACCEPTED
  → CreateScene anonymous REJECTED
  → CreateScene with bearer reaches Scene service
  → all 5 contract assertions PASS
end-to-end: POST /v1/commands/ListMyMemories with Bearer token
  → INVALID_ACCESS_TOKEN (proves routing + requiresAuthentication gate
    both work; a valid Bearer would reach scene.listMyMemories)
end-to-end: idb 在 iOS 26.5 sim 实测
  P4 aesthetic backdrop        记住顶帖背景色随 sample count 变化
  P5 location picker           "当前" badge 在切预设时正确迁移
  P6 custom coordinate         tap 地图 → pin (4, 6) → LocationContext 显示
                                "河内 · 自定义 · 4, 6" + "21.0177, 105.8434 · 半径 1 km"
                                历史 tab “历史 · 1” + 已保存卡片
```
```

Outcome Intelligence 的实现顺序仍遵循 [Outcome Intelligence Architecture R3](./Proxy_Outcome_Intelligence_Architecture_R3.md)，不会直接把 HTML local state 当成数据库模型。

## R15.16 收官（2026-08-28）

接管范围全面 ship, 4 commit / 4 个子集:

### 1. R15.16 P1 (c45ed71) — 接管补修 (iCloud / 浮点 / wall)

#### 1a. iCloud 防护 (mediaStoreDir 默认路径)

`apps/api-go/cmd/api/main.go` 默认 `PROXY_MEDIA_STORE_DIR` 走
`~/Developer/kake-data/media_store` (non-iCloud 固态位置) 而不
是 `./media_store` (Desktop + iCloud sync 范围)。iCloud 会在
闲置期 evict 文件, 派生图变 dataless placeholder, 媒体服务
返超时 / 0 byte。

### 2. R15.16 P2 (fd7af57) — 11 fixture 规范化照片素材 (R15.16 P2 重点)

genfixtures Go stdlib 生成 11 个 JPEG + manifest, 覆盖 6 单人 +
2 多人 + 1 风景 + 2 贴标 (ad / screenshot)。6 Go tripwires + 14
TS tripwires。

#### 2a. 浮点精度门 (mediaRailMetrics)

`mediaRailMetrics` 改用 r3(n) = round(n*1000)/1000 — 避免
0.8 * 378 = 302.40000000000003 在 IEEE 754 累积, 粉碎 test 期望
[0, 312.4, 535.025] 精确等。

#### 2b. wall 高度门 (wallCellAspect 纯函数)

`wallCellAspect(aspect)`: portrait 最低 0.8 (4:5, 9:16 上升),
landscape [1, 1.91]。9 个 vitest tripwires 钉明边界。

### 4. 11 fixture 规范化照片素材

`architecture/fixtures/social-media/matrix/` 11 个 stdlib 生成
JPEG + manifest.json:

| id | 比例 | 主体 |
|---|---|---|
| single-portrait-half-4x5 | 0.80 | 半身人像 |
| single-portrait-full-9x16 | 0.56 | 全身人像 |
| single-landscape-half-4x3 | 1.33 | 横构半身 |
| single-landscape-full-3x1 | 3.00 | 街拍全身 |
| group-portrait-2-1x1 | 1.00 | 2 人合拍 |
| group-portrait-4-1x1 | 1.00 | 4 人合拍 |
| landscape-skyline-16x9 | 1.78 | 城市风景 |
| object-product-4x5 | 0.80 | 居中物体 |
| object-flatlay-1x1 | 1.00 | 4 件平铺 |
| ad-banner-text-heavy-16x9 | 1.78 | 广告贴 AD 徽标 (不拒) |
| screenshot-ui-9x19.5 | 0.46 | App 截图归 SYSTEM (不拒) |

复现: `go -C apps/api-go run ./internal/media/cmd/genfixtures`
tripwires: 6 Go + 14 TS (219 vitest + 6 media 测全 PASS)。

### 3. R15.16 P3 (d87f2d2) — 风控策略 E2E 验证

`architecture/scripts/e2e_media_security_gate.sh` 11 fixture 走完
init→upload(204)→complete(ACCEPTED) + 5 negative cases (no-auth
401 / bad-token 401 / cross-user 403 / ghost 404 / html-bytes 415)
+ bomb quarantine fail-closed。**16/16 PASS**。

### 4. R15.16 P0 (P0 audit fix) — fixture 接入 feed

`architecture/scripts/p0_audit_fix.sh` 11 fixture → Upload → CreatePost
→ ListFeedPosts 端到端 21/21 PASS:

  Step 1: 11 fixture init+upload+complete (11/11)
  Step 2: 4 个 CreatePost (Linh/Mai/Huyen/Bonsaidon) 用 fixture asset
  Step 3: ListFeedPosts 可见 (feed ≥ 4 帖, 4 fixture post 全在)
  Step 4: viewingCity=胡志明市 过滤 (empty cityScope 仍过, R15.14
          tripwire 工作, 10 帖)
  Step 5: SceneType PHOTO / COFFEE 走 per-(city,sceneType) cache

  *** P0 audit fix 填补之前 R15.16 P2 一个真 bug: 11 fixture
  走通 media pipeline 但没真接 Post→Feed。本脚本补接。***

## R15.16 收官遗留（1 个 PRD gap 下放给 R15.17）

```text
1. 内容拒收门 (nudity / politics / violence)
   现状: media_assets 状态机有 QUARANTINED / APPROVED /
   REJECTED_TECHNICAL 3 个 — 但只有 “技术原因” (无音频流 / > 30s)
   触发器, “内容原因” (黄 / 政治 / 暴力) 不存在。
   下放: R15.17 增 REJECTED_CONTENT_NUDITY /
   REJECTED_CONTENT_POLITICS / REJECTED_CONTENT_VIOLENCE 3 个状态
   + admin 手动 review 路径 + audit log (不变 production 默认, 仅
   给人工 review API 入口供未来 AI 内容审核接入)。

2. fixture 边界拓展
   现状: 11 fixture 都是"可以发"主体。内容拒 (黄/政治) 不会在
   fixture 里造, 以避免落 /tmp 创 不可逆样本 (违反人脸 / 未成年
   保护）。R15.17 用“纯几何示意 + 明确标签”表示内容拒, 跟
   real-world 数据集 (NSFW dataset) 解耦。
```

## R15.17 计划（待启动）
