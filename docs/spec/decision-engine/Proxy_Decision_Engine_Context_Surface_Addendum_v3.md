# Proxy Decision Engine · Context & Surface Addendum v3

## 新增生产能力

### 1. Context / Gravity Field

每次 Decision 统一绑定：

```text
User Context
+ World Context
+ Market Context
= ContextSnapshot
```

World Context 包含时间、节假日、天气、本地事件、交通等；Market Context 包含供需、库存、容量、排队、优惠密度、配送能力等。

Gravity 升级为：

```text
P(Event in Δt | user history, user context, world context, market context)
```

但 Gravity 只负责业务预测，不替代 SRE 的 circuit breaker、load shedding、backpressure、fallback。

### 2. Evidence Independence

强 Gravity Event 不自动降低 Evidence 质量门槛。

错误：

```text
Christmas strong → evidence_min 3 → 1
```

正确：

```text
Christmas
→ prior probability changes
→ resource/value/rank changes

Evidence Gate remains independently governed.
```

### 3. Surface Composition Engine

Decision Engine 现在可返回：

```text
CandidatePlan
SurfacePlan
OrchestrationPlan
```

禁止：

```text
Tag → UI
```

正确：

```text
User State
+ Context Field
+ Gravity / Intent
+ Evidence
+ Human Value
→ Decision Engine
→ SurfacePlan
```

SurfacePlan 包含 module、priority、mode、blocked_modules、TTL。

### 4. Hot Update Boundary

允许热更新：

```text
module priority
layout mode
eligibility
thresholds
experiment traffic
surface policy version
```

不可绕过：

```text
Explicit Negative
Privacy
Evidence Gate
Hard Resource
Anger Block
Safety
```

### 5. Context-conditioned Metric Research

研究目标：

```text
d(user, item | context)
```

建议顺序：

```text
CatBoost / LightGBM with context
→ Context-aware Two-Tower
→ Context-conditioned Mahalanobis / neural metric
→ Hyperbolic / manifold only if data proves value
```

不要因为架构使用“Gravity”概念，就默认生产上采用黎曼流形。

### 6. 正式生产对象

```text
ContextSnapshot
GravityState
ResourceEnvelope
EvidenceState
HumanValueResult
EligibilityResult
RankScore
SurfacePlan
OrchestrationPlan
OutcomeRecord
```

研究对象：

```text
ContextEmbedding
MetricMatrix M(c)
HyperbolicEmbedding
ManifoldDistance
```

物理类比不进入正式 Policy 语义：

```text
Lorentz transformation
Planck constant
negative mass
wave-function collapse
```

## 更新后的主链

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
Resource Envelope
↓
Human Value Guardrail
↓
Policy Resolver
↓
Eligibility
↓
Retrieval / Ranking
↓
CandidatePlan / SurfacePlan / OrchestrationPlan
↓
Proxy Experience / Transaction / Fulfillment
↓
Exposure / Outcome
↺
```

核心原则：

> Context 可以改变“什么更相关、更有价值”，但不能未经独立治理就改变“什么证据算可信”。
