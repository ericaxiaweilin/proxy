# Design baseline changelog

Every intentional change to a baseline-sensitive implementation must update
this file and `CURRENT_BASELINE.json` or `IMPLEMENTATION_CONTRACTS.json` in the
same commit. Do not record routine business logic changes here.

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
