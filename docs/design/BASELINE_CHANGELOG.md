# Design baseline changelog

Every intentional change to a baseline-sensitive implementation must update
this file and `CURRENT_BASELINE.json` or `IMPLEMENTATION_CONTRACTS.json` in the
same commit. Do not record routine business logic changes here.

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
