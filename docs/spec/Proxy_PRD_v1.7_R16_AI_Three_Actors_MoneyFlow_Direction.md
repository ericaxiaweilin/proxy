# Proxy PRD v1.7 — R16.x AI Three Actors + MoneyFlow Direction

**Date:** 2026-09-04
**Status:** WIRE CONTRACT FREEZE / AI ACTOR BOUNDARY FREEZE / MONEY-FLOW DIRECTION MANDATE
**Inherits:** `Proxy_PRD_v1.6_R15_12_15_Guest_Google_Phone_Auth_Freeze_2026-08-21.md`
**Commits:**
- `9d17c0a fix(ai+market): three AI actor kinds + mandatory money-flow direction`
- `a841485 chore(market): split publisher / applicant price labels in PublishDemand`
- `18cac56 fix(pg): tripwire MoneyFlow + PriceLabel + AI metadata JSONB round-trip`

This patch closes two semantic gaps that survived prior freezes:

1. **AI identity was a boolean label**, not three subjects.
2. **Opportunity / Activity price was a bare amount**, not a money-flow direction.

Both gaps were invisible to functional tests (the API returned 200, the UI rendered the digits) but violated the product contract (AI could act as "the host", money-flow direction was implied instead of declared).

---

# 1. Executive Freeze

**AI is not one identity.** Every actor in the system now belongs to one of
four subjects, and each subject has a closed capability matrix:

| Subject              | Can speak as user? | Can act on marketplace? | Can publish as host? | Can join / check-in? |
|----------------------|--------------------|--------------------------|----------------------|----------------------|
| `Human`              | yes                | yes                      | yes                  | yes                  |
| `PlatformAI`        | no                 | no (publish / apply forbidden) | no (publish forbidden) | no |
| `UserTwin`          | no (drafts only)   | yes (apply / dismiss / interest) | no | no (drafts surface for human confirmation only) |
| `UserAssistant`     | no                 | yes (apply / dismiss / interest under principal gate) | no | no |

`PlatformAI` is the system actor. Cold-start catalog (5 fixtures) must be
`Origin = PLATFORM + AIStatus = AI_GENERATED + AIActorKind = PLATFORM_AI +
MoneyFlow = FREE`. Platform must never earn money on cold-start and must
never appear as the human host.

`UserTwin` is the AI persona that **drafts for** a user but cannot publish.
Twin-authored activity surfaces with `AIStatus = AI_ASSISTED` and requires
human confirmation before any side effect.

`UserAssistant` is the AI persona that **acts under** a user's principal
gate (OAuth-like delegation). Every assistant action is stamped with both
`Principal` (the user) and `Actor` (the assistant). UI surfaces this with
`AIStatus = AI_ASSISTED + AIActorKind = USER_ASSISTANT` so the recipient
sees "Ken's assistant" instead of "Ken".

**MoneyFlow is mandatory, never implied.** Every Opportunity and Activity
on the wire carries:

- `MoneyFlow ∈ {EARN, PAY, FREE, TBD}` (opportunity)
- `MoneyFlow ∈ {FREE, PAY_TO_JOIN, PAID_TO_ATTEND}` (activity)
- `PriceLabel: string` (min length 1)

Server-side `normalizeOpportunityMoney()` and `normalizeActivityMoney()`
are the single source of truth. Clients may send `MoneyFlow = ""`; the
server infers from `Price` and stamps `PriceLabel` from a deterministic
mapping. A client sending `MoneyFlow = FREE` with a non-zero `Price` is
rejected with `ai.action_forbidden` semantics — clients cannot bypass.

**PriceLabel uses two perspectives on the same fact.** `priceLabelForFlow`
is the wire-bound helper (applicant reads this on the card). `priceLabelForPublisher`
is the publisher-side helper used only inside PublishDemand. They share
the same four MoneyFlow values but address different readers (publisher
sees "你付金额", applicant sees "完成后你可获得"). The wire contract is
still `PriceLabel = priceLabelForFlow(...)`.

---

# 2. Wire Schema

## 2.1 Activity

```
{
  "origin": "PLATFORM" | "MERCHANT" | "USER" | "TEST",
  "aiStatus": "NONE" | "AI_ASSISTED" | "AI_GENERATED",  // default NONE
  "aiActorKind": "PLATFORM_AI" | "USER_TWIN" | "USER_ASSISTANT" | undefined,
  "aiPersonaId": string | undefined,
  "aiPersonaName": string | undefined,
  "aiPersonaAvatar": string | undefined,
  "moneyFlow": "FREE" | "PAY_TO_JOIN" | "PAID_TO_ATTEND",
  "priceLabel": string (min 1)
}
```

`origin = "AI_PERSONA"` is **removed**. AI authorship is now expressed
via `aiStatus + aiActorKind + aiPersonaId`. The previous enum value
leaked a "AI as human host" semantic that no longer exists.

`aiStatus` defaults to `"NONE"`. A row that was inserted before R16.x
without `aiStatus` must be defaulted by the read path (single-response
normalize) so the wire contract stays stable across PG rows.

## 2.2 MarketOpportunity

```
{
  "moneyFlow": "EARN" | "PAY" | "FREE" | "TBD",
  "priceLabel": string (min 1)
}
```

`EARN` is the publisher-pays-applicant flow (commission-style).
`PAY` is the applicant-pays-publisher flow (委托 / 代订位).
`FREE` is no money exchanged (同好 / 社区).
`TBD` is the dual-side negotiation flow (费用待确认).

The four are not interchangeable. `EARN ≠ PAY`: the legal direction of
money flow is different, and the contract prohibits "publisher earns and
applicant also pays" — that is a future marketplace-side semantic, not a
publisher-authored state.

## 2.3 Persona

`PersonaType ∈ {USER_TWIN, CREATIVE, PLATFORM_AI, USER_ASSISTANT}`.
`USER_TWIN` and `USER_ASSISTANT` are post-R16.x additions. `PLATFORM_AI`
replaces the previous top-level "AI_PERSONA" origin usage.

---

# 3. AI Boundary Gate (AIBOUND)

Server module `apps/api-go/internal/aiboundary/policy.go`:

```go
type ActorKind int
const (
    Human ActorKind = iota
    PlatformAI
    UserTwin
    UserAssistant
)

var AllActions = []Action{
    PublishOpportunity, ApplyOpportunity, PublishActivity, JoinActivity,
    InterestActivity, CheckinActivity, CancelActivity, NoShowActivity,
    DismissOpportunity,
}

func Allows(kind ActionKind, action Action) bool  // default-deny
func FromCommandIdentity(env command.Envelope) ActorKind  // principal-first
```

`Allows` defaults to `false` for any unknown action — fail-closed so a
future enum extension stays guarded until explicitly opened.

`FromCommandIdentity` classifies with principal-type priority:

1. `Principal.Type = USER_*` → the principal is a Human; actor may be
   `UserTwin` or `UserAssistant` but the gate is opened by the principal,
   not the actor.
2. `Principal.Type = PLATFORM_AI` → `PlatformAI`.
3. Unknown principal → widen to `Human` (fail-widen: human trust boundary
   is the highest privilege; refusing an unknown principal is preferable
   to silently downgrading a Human).

Forbidden actions return `ErrorCode = "AI_ACTION_FORBIDDEN"` /
`MessageKey = "ai.action_forbidden"`. Mobile error map decodes both
keys into a single user-facing toast.

---

# 4. Gate (g4) Tripwire

| ID                | Scope                                              | Tests                                                                                              |
|------------------|----------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `AI-ACTOR-001`   | Activity publish / join / interest by AI is denied | `TestActivityActionsAreForbiddenForAIActor`, `TestActivityPublishForbiddenForAIActor`               |
| `AI-ACTOR-002`   | Market publish / apply / dismiss by AI is denied   | `TestMarketPublishIsForbiddenForAIActor`, `TestMarketApplyIsForbiddenForAIActor`                    |
| `MONEYFLOW-001`  | Opportunity publish / list always carry 4-way       | `TestOpportunityMoneyFlowNormalize`, `TestMarketPublishRejectsFreeWithNonZeroPrice`                |
| `MONEYFLOW-002`  | Cold-start activities are FREE + PLATFORM_AI       | `TestColdStartActivitiesArePlatformAIGeneratedAndFree`, `TestNormalizeActivityMoneyAndAIDefaults`  |
| `MONEYFLOW-003`  | PG JSONB round-trip preserves MoneyFlow + AI       | `TestActivityPostgresJSONBRoundTripPreservesMoneyFlowAndAI`, `TestMarketplacePostgresJSONBRoundTripPreservesMoneyFlow` |
| `LIFECYCLE-PG-001` | PG lifecycle SQL (Join / Apply / Dismiss / Checkin / Outcome) | `TestActivityPostgresLifecycle`, `TestMarketplacePostgresLifecycle`, `TestScenePostgresLifecycle`, `TestOutcomePostgresLifecycle` |

`g4` is the gate that runs on every pre-commit. `g1` (build) and `g2`
(tests) are unchanged.

---

# 5. Mobile UX

## 5.1 PublishDemand (publisher view)

Four `MoneyFlow` chips: `EARN / PAY / FREE / TBD`. Publisher-side wording:

| MoneyFlow | Chip sub                                                |
|-----------|---------------------------------------------------------|
| `EARN`    | "你付金额，接单者完成后获得"                              |
| `PAY`     | "接单者预付" / "受托代购/订位等委托场景"                |
| `FREE`    | "0₫ · 同好/社区"                                        |
| `TBD`     | "双方面谈 · 不显示金额"                                 |

Price input is conditional: `EARN` and `PAY` require non-empty Price;
`FREE` allows `0₫`; `TBD` must be empty.

## 5.2 Opportunity card (applicant view)

Renders `priceLabelForFlow(MoneyFlow)`. Server emits this value; mobile
treats the wire as the source of truth.

| MoneyFlow | priceLabel            |
|-----------|-----------------------|
| `EARN`    | "完成后你可获得"      |
| `PAY`     | "你需支付"            |
| `FREE`    | "免费"                |
| `TBD`     | "费用待确认"          |

## 5.3 ActivityDetail footer

Footer badges reflect `aiStatus + aiActorKind + persona`:

- `AIStatus = NONE` → no badge.
- `AIStatus = AI_GENERATED + AIActorKind = PLATFORM_AI` → "平台 AI · 免费"
  badge with `aiActivityBadge{Bg,Fg}` theme tokens.
- `AIStatus = AI_ASSISTED + AIActorKind = USER_TWIN` → "AI 草稿 · 待你确认"
  badge with twin-drafted action footer (cancel / confirm CTA pair).
- `AIStatus = AI_ASSISTED + AIActorKind = USER_ASSISTANT` → "助手代发 ·
  身份 = Ken" badge (principal attribution).

---

# 6. Out of Scope

- **Native iPhone / iOS Simulator visual smoke**: R16.x visual smoke
  requires `@testing-library/react-native` + RN mock infra + Expo
  Simulator or a USB-paired device. This patch covers the wire contract
  through vitest (577 mobile tests) and the server through vitest +
  PG integration tests (15 tripwires in `g4`). Visual smoke is a
  follow-up item; the mobile UI tests added in this commit do not
  exercise the actual chip-switch / footer-render path on a real device.
- **PRD canonical doc updates beyond this file**: this patch is the
  R16.x canonical entry. `Proxy_PRD_v1.4_Canonical_Registry.md` (if it
  exists at freeze time) and Chapter 02 Capability Graph should
  cross-reference this file rather than be rewritten in lock-step.
- **`GenerateMedia` Action on the AI boundary**: media generation by
  `USER_ASSISTANT` (e.g., user's assistant generating a draft photo) is
  a future API surface. The media pipeline keeps `AI_PERSONA` as a
  `AIGenerationSource` namespace separate from activity origin and is
  intentionally not gated by `aiboundary` in this patch.