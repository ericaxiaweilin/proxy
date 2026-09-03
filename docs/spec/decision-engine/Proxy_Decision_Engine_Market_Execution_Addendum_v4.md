# Proxy Decision Engine · Market Execution Addendum v4

## 0. Purpose

This revision moves Proxy from a primarily demand-understanding / recommendation engine toward a complete two-sided market execution engine.

New production layers:

```text
Clarification Gate
Supply Health
Supply Activation
Alternative Resolver
Sync / Async Orchestration
Fulfillment Attribution
Market Execution Metrics
```

---

# 1. Updated Main Chain

```text
Raw Event
↓
Feature / Tag / Graph
↓
State Resolver
↓
ContextSnapshot
  ├ User
  ├ World
  └ Market
↓
Gravity / Intent
↓
Evidence Gate
↓
Clarification Eligibility
↓
Resource Envelope
↓
Human Value Guardrail
↓
Policy Resolver
↓
Demand / Supply Health
↓
Supply Activation / Alternative Resolver
↓
Eligibility
↓
Retrieval / Ranking
↓
CandidatePlan / SurfacePlan
↓
Sync or Async Orchestration
↓
Commitment
↓
Fulfillment
↓
Fulfillment Attribution
↓
Outcome Learning
↺
```

---

# 2. Clarification Gate

Clarification exists to complete an already-existing task.

It must not be used to create Intent or manufacture evidence.

## Allowed

```text
User explicitly initiated a task
AND a missing field materially changes feasibility / ranking / orchestration
AND asking has positive expected decision value
AND question burden is low
```

Example:

```text
User: 周六想找人去宁平

Missing:
departure_window

Question:
周六上午还是下午出发？
```

## Forbidden

```text
Model infers user may travel
→ Push: 周末想去宁平吗？
```

This is system-induced evidence creation.

### Default answer scope

A clarification answer is task-scoped by default.

```text
“周六上午”
→ updates current WEEKEND_TRIP task
≠ automatically creates long-term tag #喜欢上午旅行
```

Long-term state still requires independent repeated evidence.

---

# 3. ClarificationPlan

```json
{
  "state": "INLINE_ALLOWED",
  "question_id": "cq_819",
  "field": "departure_window",
  "reason": "MATCH_FEASIBILITY",
  "max_questions": 1,
  "expires_in_s": 900,
  "answer_scope": "CURRENT_TASK",
  "write_to_profile": false
}
```

Suggested states:

```text
NOT_REQUIRED
INLINE_ALLOWED
TASK_BLOCKING
PASSIVE_ONLY
FORBIDDEN
```

---

# 4. Supply Health

Demand-side intelligence is not sufficient for a two-sided market.

Proxy must model:

```text
Active Supply
Latent Supply
Supply Coverage
Activation Probability
Response Time
Supply Reliability
Price Elasticity
Alternative Availability
```

A useful contextual metric:

```text
SupplyCoverage
=
Eligible Active Supply
/
Qualified Demand
```

Illustrative strategy bands, not universal industry standards:

```text
>= 1.00   healthy
0.85–1.00 tight
0.60–0.85 under-supplied
< 0.60    severe shortage
```

Thresholds must be calibrated by intent type.

---

# 5. Supply Activation

When supply is insufficient, do not immediately fail the Intent.

Activation ladder:

```text
1. Activate opted-in latent supply
2. Relax time / radius only within user resource guardrails
3. Batch / queue / waitlist
4. Alternative mode
5. Platform-funded supply incentive
```

Possible supply-side incentives:

```text
platform subsidy
reduced commission
lead priority
guaranteed minimum
batch demand
future opportunity priority
```

## Pricing boundary

Resource Envelope is used to judge feasibility.

It must not become a hidden individualized price extraction mechanism.

Forbidden:

```text
user appears wealthy
+ supply shortage
→ silently charge this user more
```

---

# 6. Alternative Resolver

Possible fallback modes:

```text
same service / delayed
expanded radius
waitlist
adjacent service
AI tool
human + AI hybrid
self-service toolkit
```

Example for ZH-VI translation:

```text
Human live
→ Human delayed
→ Human + AI
→ AI toolkit
→ Waitlist
```

The alternative itself must pass Resource and Human Value guardrails.

---

# 7. Sync vs Async Orchestration

Do not force every optimization problem into the synchronous Decision API.

## Real-time Decision Plane

Use for:

```text
Feed
Market
Search
simple recommendation
simple assignment
```

Illustrative target:

```text
p99 < 120ms
```

## Async Orchestration Plane

Use for:

```text
multi-person group formation
schedule coordination
route planning
vehicle / capacity allocation
multi-step fallback planning
```

Decision API may return:

```json
{
  "state": "ACTIVE_ORCHESTRATE",
  "execution": {
    "mode": "ASYNC",
    "orchestration_job_id": "job_..."
  }
}
```

The product may show an immediate pending state while the plan is solved asynchronously.

---

# 8. Solver Circuit Breaker

Small synchronous optimization:

```text
soft budget 20ms
hard budget 35ms
```

If exact solver exceeds budget:

```text
exact solver
→ greedy / heuristic fallback
→ solver_fallback=true
```

Complex problems should not use this fallback merely to preserve a fake 80ms budget; they should move to Async Orchestration.

All latency values are policy/SLO starting points and require production calibration.

---

# 9. Fulfillment Attribution Engine

A failed fulfillment cannot be represented as one generic negative reward.

Taxonomy:

```text
Demand-side
  user_cancel
  user_no_show
  changed_mind
  price_regret

Supply-side
  provider_timeout
  provider_cancel
  capacity_lost
  quality_issue

Match-side
  compatibility_error
  distance_error
  schedule_conflict
  expectation_mismatch

Orchestration
  group_not_filled
  route_failure
  fallback_failed
  late_replan

Platform
  payment_error
  notification_failure
  latency_timeout
  technical_error

External
  weather
  traffic
  venue_closed
  policy_event
```

---

# 10. AttributionRecord

```json
{
  "fulfillment_id": "ful_8821",
  "decision_id": "dec_82A1",
  "status": "NOT_FULFILLED",

  "primary_cause": {
    "code": "PROVIDER_TIMEOUT",
    "domain": "SUPPLY",
    "confidence": 0.91
  },

  "contributing_causes": [
    {"code": "TIGHT_SUPPLY", "weight": 0.62},
    {"code": "LATE_ACTIVATION", "weight": 0.31}
  ],

  "evidence_ids": [
    "evt_provider_no_reply",
    "activation_402"
  ],

  "route_to": [
    "supply_reliability",
    "activation_policy"
  ]
}
```

Support `UNKNOWN`.

Do not invent a cause when evidence is insufficient.

---

# 11. Feedback Routing

```text
provider_timeout
→ supply reliability / activation model

price_regret
→ resource envelope / human value

schedule_conflict
→ eligibility / orchestration

compatibility_error
→ ranking / graph features

payment_error
→ platform / SRE

weather cancellation
→ context / replanning
```

This prevents unrelated models from learning the wrong lesson.

---

# 12. Market Execution Metrics

## Engine Health

```text
Decision p99
solver fallback rate
feature freshness
async orchestration p95
```

## Market Health

```text
supply coverage
latent supply activation rate
time-to-fill
alternative salvage rate
```

## Fulfillment Health

```text
commit → fulfill
cancel / no-show
attribution coverage
repeat fulfillment
```

## Human Value Health

```text
anger block rate
post-exposure hide
clarification abandonment
intervention saturation
usage drop
```

A higher fulfillment rate is not success if anger, regret or usage drop increases materially.

---

# 13. Core Principles

> Clarification completes Intent; it does not create Intent.

> Supply shortage should trigger supply formation and alternatives before Intent is allowed to die.

> Complex real-world orchestration should be asynchronous when necessary; latency budgets must reflect product reality.

> Fulfillment failure must be attributed before it is converted into learning signals.

> Resource models support user fit; they must not become hidden individualized price discrimination.
