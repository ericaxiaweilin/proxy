# Proxy Decision Intelligence Engine · Governance Addendum v2

## Why this revision exists

The Decision Engine already supports Feature / Tags / Gravity / Intent / Evidence / Resource / Human Value / Matching / Orchestration. The next scaling risks are no longer missing algorithms; they are state explosion, policy conflict, semantic drift, and uncontrolled tag growth.

This revision adds four cross-cutting governance components:

1. **State Budget & Lifecycle Manager**
2. **Policy Conflict Resolver**
3. **Feature Registry + Online/Offline Parity Guard**
4. **Tag Utility / Economics Manager**

---

## 1. State Budget & Lifecycle Manager

Tag definitions may grow into tens or hundreds of thousands. Online `User × Tag` state may not.

```text
Cold Historical State
        ↓ promote by relevance
Warm Active State
        ↓ resolve by Event/Context
Hot Decision State
        ↓
/v1/decisions/evaluate
```

Suggested operational model:

```text
Cold:  historical, training, replay, audit
Warm:  current active state, seconds/minutes refresh
Hot:   only decision-relevant state, single-digit ms read
```

TTL is represented by `expires_at`; do not create one timer per UserTag.

Lifecycle:

```text
Create → Warm → Context Promote → Hot
                  ↓
          Lazy Expire on Read
                  ↓
          Bucket / Sweeper Cleanup
                  ↓
                 Cold
```

Key SLOs:

```text
hot_state_read_p99 < 10ms
hot_state_per_decision monitored
warm_state_per_user monitored
write_amplification monitored
```

---

## 2. Policy Conflict Resolver

Do not solve all conflicts with numeric priorities.

Semantic policy domains resolve in this order:

```text
Safety / Legal / Privacy
Explicit User Negative
Hard Resource Constraint
Intervention / Frequency Budget
Evidence Gate
Human Value Guardrail
Business Eligibility
Ranking Preference
Commercial Objective
```

A rule must **not** directly emit a user action.

Bad:

```text
if coffee_interest > .8:
  PUSH(coffee_offer)
```

Correct:

```text
coffee_affinity_rule → signal +0.18
promo_fatigue_rule   → penalty -0.31
blocked_merchant     → HARD_BLOCK

Policy Resolver
    ↓
Decision Engine
    ↓
Action
```

Inside one policy domain, resolve by:

```text
Context Specificity
→ Evidence Authority
→ Freshness
→ Confidence
→ Stable tie-break rule
```

---

## 3. DSL Boundary and Execution Planes

Core principle:

> **DSL composes. Models compute.**

DSL may support:

```text
AND / OR / NOT
comparison
COUNT / SUM / AVG / percentile
window
recency
radius
source
confidence
```

DSL must not implement:

```text
Transformer training
GNN
embedding generation
ANN retrieval
Hawkes fitting
CP-SAT
```

Those capabilities produce registered features first:

```text
meal_hazard_60m=.91
graph_trust_affinity=.82
price_accept_p75=120K
```

Then DSL can compose them.

Execution planes:

```text
OFFLINE
training / embedding / GNN / long windows
        ↓
Feature Registry
        ↓
NEARLINE
tag / decay / state update
        ↓
ONLINE
context / policy / guard / ranking / decision
```

---

## 4. Online / Offline Semantic Parity

Every Feature must record:

```text
feature_id
version
definition
owner
source
window semantics
event-time semantics
null semantics
offline implementation
online implementation
parity tests
```

A change in definition requires a new Feature version.

Never silently reuse the same name with different semantics.

---

## 5. Tag Utility / Economics

Fine-grained tags are intentionally allowed. But every tag still has lifecycle economics.

Monitor:

```text
coverage
decision usage
query frequency
unique information gain
fulfillment lift
retention lift
conflict rate
storage cost
compute cost
last used
```

Important distinction:

```text
small coverage + high fulfillment lift → KEEP
large coverage + no decision usage → ARCHIVE candidate
high redundancy + little unique information → MERGE / REVIEW
```

Archiving a tag means stopping active online state; historical evidence remains available for training and audit.

---

## 6. Revised Engine Runtime

```text
Raw Events
    ↓
Feature Compute
    ↓
Feature Registry / Parity Guard
    ↓
Warm State / Tag Engine
    ↓
Context State Resolver
    ↓
Hot Decision Working Set
    ↓
Gravity / Intent
    ↓
Evidence Gate
    ↓
Resource Envelope
    ↓
Human Value Guardrail
    ↓
Policy Conflict Resolver
    ↓
Eligibility
    ↓
Retrieval / Ranking
    ↓
Orchestration
    ↓
Outcome
    ↺
```

Cross-cutting governance:

```text
State Budget Manager
Policy Resolver
Feature / Model Registry
Tag Utility Manager
Experiment / Replay / Shadow
Audit / Observability
```
