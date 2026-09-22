# Proxy PRD v1.1
## Canonical Round 2 — ER / Ownership / State Truth Audit

**状态**：COMPLETED  
**目的**：检查 v1.1 Chapter 01–20 中对象是否重复、Ownership 是否清楚、Derived State 是否被误当 Source of Truth、跨 Domain 是否存在双写风险。  
**原则**：不增加当前 MVP 业务范围；只减少未来实现歧义。

---

# 1. Executive Result

Round 2 共识别：

```text
8 个需要立即 Canonical 修正的问题
6 个建议现在锁定的关系约束
5 个可以保留为 Open Question 的问题
```

最大风险不是“缺对象”，而是：

> **同一事实被两个对象同时保存，最终出现双写和漂移。**

这一轮重点执行：

```text
One Business Fact
→ One Authoritative Owner
→ Other fields become reference / snapshot / derived read model
```

---

# 2. Severity Definition

```text
P0-BLOCKER
开发 Domain 前必须解决

P0-IMPORTANT
页面/API 定义前必须锁定

P1-CLEANUP
不阻塞当前 MVP，但需要明确 owner

OPEN
现有 PRD 不足以确定，不猜
```

---

# 3. Audit Finding A01
## Order `execution_status` 与 Order Lifecycle 重复

### Source conflict

Chapter 03 `Order Schema` 使用：

```text
execution_status
```

但同一 Chapter 随后正式定义：

```text
Order Lifecycle:
CONFIRMED
EN_ROUTE
ARRIVED
IN_PROGRESS
EVIDENCE_SUBMITTED
COMPLETION_REVIEW
COMPLETED
CLOSED
CANCELLED
```

这实际上描述的就是 Order 主生命周期。

### Risk

如果工程实现：

```text
order.execution_status = ARRIVED
order.lifecycle_status = CONFIRMED
```

系统会立刻出现两个真相。

### Canonical Decision

Order 的唯一主状态字段：

```text
order.lifecycle_status
```

Canonical enum：

```text
CONFIRMED
EN_ROUTE
ARRIVED
IN_PROGRESS
EVIDENCE_SUBMITTED
COMPLETION_REVIEW
COMPLETED
CLOSED
CANCELLED
```

### Deprecate

```text
order.execution_status
```

作为可写字段废弃。

如果前端 Read Model 需要 `execution_status` 文案，可以从：

```text
order.lifecycle_status
```

转换。

**Severity：P0-BLOCKER**

---

# 4. Audit Finding A02
## `ExecutionContext.execution_status` 会形成第二 Order 状态真相

Chapter 11 的 `ExecutionContext` 包含：

```text
execution_status
```

但：

```text
EN_ROUTE
ARRIVED
IN_PROGRESS
EVIDENCE_SUBMITTED
COMPLETED
```

已经属于 Order Lifecycle。

### Canonical Decision

`ExecutionContext` 负责：

```text
arrival target
scheduled window
venue binding
check-in policy
evidence policy
location visibility policy
execution instructions/context
```

不拥有独立交易生命周期。

因此：

```text
ExecutionContext.execution_status
```

只能是：

```text
DERIVED READ MODEL
```

或直接删除。

### Authoritative Truth

```text
Order.lifecycle_status
```

### Why

ExecutionContext 是：

> 执行配置 / 执行上下文。

Order 才是：

> Agent 与 Slot 的正式履约关系。

**Severity：P0-BLOCKER**

---

# 5. Audit Finding A03
## Task 的 Execution Status 必须保持 Derived

Chapter 03 已明确：

```text
Task.execution_status
=
NOT_STARTED
UPCOMING
IN_PROGRESS
ENDING
FINISHED
EXCEPTION
```

是由 Slots / Orders 派生。

### Canonical Decision

以下字段：

```text
Task.fulfillment_status
Task.execution_status
```

统一标记：

```text
DERIVED / READ MODEL
```

禁止客户端：

```text
PATCH Task.execution_status
PATCH Task.fulfillment_status
```

### Authoritative Inputs

```text
TaskSlot lifecycle
Order lifecycle
ExecutionException
matching deadline
task time boundary
```

**Severity：P0-BLOCKER**

---

# 6. Audit Finding A04
## TaskSlot `budget / price_unit` 与 CompensationTerms 重复

Chapter 03 的 TaskSlot Schema 包含：

```text
budget
price_unit
```

Chapter 09 后续正式建立：

```text
CompensationTerms
```

并明确每一个 TaskSlot 都有 CompensationTerms。

### Risk

可能形成：

```text
slot.budget = 500k
compensation_terms.base_amount = 650k
```

不知道哪个是真的。

### Canonical Decision

金额合同 Source of Truth：

```text
CompensationTerms
```

TaskSlot Canonical 应改为：

```text
compensation_terms_id
```

或 ORM 关系：

```text
TaskSlot 1 → 1 active CompensationTerms version
```

### Draft Stage

Demand Builder 可以暂时使用：

```text
draft_budget
draft_price_unit
```

作为 UI Draft Data。

Commit / Version freeze 后：

```text
CompensationTerms
```

成为正式价格真相。

### Read Model

TaskSlot Card 可以返回：

```text
budget
price_unit
```

但它们是 CompensationTerms projection，不是第二可写字段。

**Severity：P0-BLOCKER**

---

# 7. Audit Finding A05
## Task `location` 与 LocationReference 重复

Chapter 03 Task Schema 使用：

```text
location
```

Chapter 17 后续建立：

```text
LocationReference
```

并区分：

```text
PUBLIC_VENUE
BUSINESS_STORE
PRIVATE_ADDRESS
TEMPORARY_MEETING_POINT
APPROXIMATE_AREA
REMOTE
```

### Canonical Decision

Task 不再保存一个不透明：

```text
location {}
```

作为正式位置真相。

Canonical：

```text
task.location_reference_id
task.venue_id optional
```

### Meaning

```text
LocationReference
= geography truth

Venue
= named physical execution place

Store
= business operating unit
```

### Snapshot

Order 创建时可以冻结必要 Location Snapshot，避免后续地址修改改写合同历史。

**Severity：P0-BLOCKER**

---

# 8. Audit Finding A06
## SupplyReservation 被遗漏在 Canonical P0 Object Set

Chapter 08 明确：

```text
Order CONFIRMED
→ SupplyReservation
```

用于占用：

```text
task execution window
+
travel buffer
```

而 Round 1 Canonical Object Set 漏掉了它。

### Canonical Decision

正式加入 P0：

```text
SupplyReservation
```

关系：

```text
Order 1 → 1 SupplyReservation
Agent 1 → N SupplyReservations over time
```

P0：

```text
capacity_units = 1
```

### Role

SupplyReservation 是：

> Schedule conflict / effective supply 的时间占用真相。

不是 AvailabilitySession 的替代品。

```text
AvailabilitySession
= Agent 愿意工作

SupplyReservation
= 已经被 Order 占用
```

**Severity：P0-BLOCKER**

---

# 9. Audit Finding A07
## RequesterTrustProfile 不能只按 `user_id`

Chapter 01 初版：

```text
RequesterTrustProfile
user_id
trust_tier
...
```

但 Proxy 已正式支持：

```text
INDIVIDUAL requester
BUSINESS requester
```

并且 Chapter 12/13 都要求：

```text
Business / Requester Trust
```

独立影响交易。

### Problem

如果：

```text
User A
```

同时代表：

```text
Individual
Business X
Business Y
```

三者历史不能共享一个 Requester Trust。

### Canonical Decision

RequesterTrustProfile 改为 Principal-scoped：

```text
requester_trust_profile_id

principal_type
principal_id

trust_tier
completed_orders
dispute_rate
restricted_features

updated_at
```

### Key

```text
UNIQUE(principal_type, principal_id)
```

### Result

```text
Individual Trust
≠
Business X Trust
≠
Business Y Trust
```

**Severity：P0-BLOCKER**

---

# 10. Audit Finding A08
## BusinessTrustedTeam / BusinessTrustedAgent 与 TrustedRelationship 重复

Chapter 12 建立：

```text
TrustedRelationship
```

支持：

```text
principal_type
principal_id
agent_id
relationship_type
```

Chapter 15 又提出：

```text
BusinessTrustedTeam
BusinessTrustedAgent
```

如果全部做成持久化对象，会产生两套关系真相。

### Canonical Decision

唯一正向 Repeat Relationship persistence：

```text
TrustedRelationship
```

### Canonical relationship_type

```text
TRUSTED_PROXY
PREFERRED_PROXY
BUSINESS_TRUSTED_TEAM
```

### Business scope extension

TrustedRelationship 增加可选上下文字段：

```text
scope_type optional
scope_id optional

role_ids[] optional
```

例如：

```text
principal_type = BUSINESS
principal_id = biz_001
relationship_type = BUSINESS_TRUSTED_TEAM
scope_type = STORE
scope_id = store_001
role_ids = [GREETER, INTERPRETER]
```

### BusinessTrustedTeam

以后定义为：

```text
READ MODEL / UI COLLECTION
```

### BusinessTrustedAgent

定义为：

```text
Business-oriented projection of TrustedRelationship
```

不建立第二 persistence truth。

### Important

Chapter 15 的：

```text
ACTIVE
PAUSED
REMOVED
BLOCKED
```

需要拆语义：

- ACTIVE / PAUSED / REMOVED：可以属于 positive relationship lifecycle；
- BLOCKED：不应继续塞在 Trusted relationship。

`BLOCKED` 应进入：

```text
SafetyBlockRelation
```

或 Match exclusion / safety domain。

**Severity：P0-BLOCKER**

---

# 11. Audit Finding A09
## `Do Not Match` / `Safety Block` 已正确拆分，Business Team 也必须遵守

Round 1 已拆：

```text
TrustedRelationship
MatchExclusionPreference
SafetyBlockRelation
```

Round 2 补充：

> Business Trusted Team 也不能用一个 `BLOCKED` status 同时表达“移出团队”和“安全封锁”。

### Canonical Business Actions

普通业务选择：

```text
Remove from Trusted Team
→ TrustedRelationship REMOVED / inactive
```

普通不想再合作：

```text
Do Not Match Again
→ MatchExclusionPreference
```

安全原因：

```text
Safety Block
→ SafetyBlockRelation
→ optional Incident / RiskSignal
```

**Severity：P0-IMPORTANT**

---

# 12. Audit Finding A10
## Invite 不需要成为第二 Persistent Object

Chapter 06 明确：

```text
Invite
= Requester actively selects candidate

Offer
= System / Fast Match pushes candidate
```

但真正 Schema 只正式建立了：

```text
Offer
```

而 Offer 本身已经有：

```text
source_type
```

### Canonical Decision

Persistence 只保留：

```text
Offer
```

### Source

```text
REQUESTER_SELECTION
FAST_MATCH
TRUSTED_DIRECT
OPERATOR_ASSIST
```

具体 source enum 后续 Chapter 23 / Engineering Spec 再锁。

### UI / Command terminology

可以继续叫：

```text
Invite Agent
```

Command：

```text
InviteAgent
```

但结果创建：

```text
Offer(source_type=REQUESTER_SELECTION)
```

### Benefit

避免：

```text
Invite table
Offer table
```

维护几乎相同生命周期。

**Severity：P0-IMPORTANT**

---

# 13. Audit Finding A11
## TaskNeedProfile 与 TaskSlot requirement arrays 需要一位 Owner

Chapter 02 形成：

```text
TaskNeedProfile
```

Chapter 03 TaskSlot 又保存：

```text
must_have[]
nice_to_have[]
attribute_requirements[]
channel_requirements[]
```

两套数据有同步风险。

### Canonical Decision

Requirement Source of Truth：

```text
TaskNeedProfile
```

### Scope

因为 Matching 单位是 TaskSlot，而且 Multi-role Task 不同 SlotGroup 有不同 Role / Capability：

推荐：

```text
SlotGroup 1 → 1 TaskNeedProfile version
```

Atomic TaskSlots 默认引用：

```text
need_profile_id
```

### Why SlotGroup

例如：

```text
Greeter ×3
```

三个人要求完全一致时，不需要复制三份 requirement truth。

```text
Interpreter ×1
```

使用另一份 profile。

### Per-slot override

P0 默认：

```text
NO arbitrary per-slot requirement drift
```

如果未来需要特殊 Slot：

```text
create another SlotGroup
```

比对单个 Slot 做隐藏 override 更可控。

### TaskSlot Read Model

仍可以返回：

```text
must_have
nice_to_have
```

但来源为：

```text
TaskNeedProfile
```

**Severity：P0-IMPORTANT**

---

# 14. Audit Finding A12
## TaskSlot.current_order_id 是 Denormalized Pointer，不是独立真相

Chapter 03 TaskSlot 有：

```text
current_order_id optional
```

同时：

```text
Order.slot_id
```

已经表达关系。

### Canonical Decision

Authoritative relation：

```text
Order.slot_id
+
Order active lifecycle
```

`TaskSlot.current_order_id` 允许保留，用于性能与原子锁，但必须标记：

```text
DENORMALIZED POINTER
```

### Rules

它：

```text
cannot be patched independently
```

必须在：

```text
Atomic Slot Assignment
Order cancellation / replacement
```

同一 transaction / command 中维护。

**Severity：P0-IMPORTANT**

---

# 15. Audit Finding A13
## replacement_generation 与 order_generation 关系未明确

Chapter 03 同时定义：

```text
TaskSlot.replacement_generation
Order.order_generation
```

但没有明确二者关系。

### Canonical Decision

推荐直接锁：

```text
Order.order_generation
=
TaskSlot.replacement_generation
at Order creation
```

首单：

```text
slot.replacement_generation = 0
order.order_generation = 0
```

第一次 Replacement：

```text
slot.replacement_generation = 1
new_order.order_generation = 1
```

### Invariant

同一 Slot：

```text
UNIQUE(slot_id, order_generation)
```

**Severity：P0-IMPORTANT**

---

# 16. Audit Finding A14
## AcceptedTaskSnapshot / AcceptedCompensationSnapshot 必须进入 Canonical Object Set

Chapter 03 强制：

```text
AcceptedTaskSnapshot
```

Chapter 09 强制：

```text
AcceptedCompensationSnapshot
```

Chapter 10 还要求冻结：

```text
pricing snapshot
fee snapshot
promotion snapshot
cancellation policy snapshot
```

Round 1 Object Set 没有显式列出前两个。

### Canonical Decision

正式加入：

```text
AcceptedTaskSnapshot
AcceptedCompensationSnapshot
```

### Role

它们属于：

```text
IMMUTABLE ORDER CONTRACT EVIDENCE
```

而不是：

```text
live editable configuration
```

### Relationship

```text
Order
├── accepted_task_snapshot_id
└── accepted_compensation_snapshot_id
```

Policy snapshots 可以：

```text
embedded immutable snapshot
or
versioned referenced snapshot
```

具体 Engineering 实现后续决定。

**Severity：P0-IMPORTANT**

---

# 17. Audit Finding A15
## Venue 有两个定义，必须明确 Base Owner

Chapter 02A Future Scene Network 的 Venue 示例包含：

```text
location {}
status = OPEN
scene_capabilities[]
```

Chapter 17 Active Map Domain 后续建立：

```text
Venue
business_id optional
display_name
location_reference_id
venue_type
public_visibility
entry_instructions
status
```

### Canonical Decision

Base Venue Source of Truth：

```text
Chapter 17 Venue
```

### Chapter 02A status

```text
FUTURE / EXTENSION
```

未来 Scene Network 不得重新建立第二 `Venue` 表。

Scene-specific fields 应作为未来扩展，例如概念上：

```text
VenueSceneConfig
SceneCapability
SceneState
```

但**当前不实现**。

### OPEN

Venue 的最终 lifecycle enum 当前文档不足以可靠锁定。

进入：

```text
Chapter 22/24 or Engineering Spec
```

**Severity：P0-IMPORTANT**

---

# 18. Audit Finding A16
## Store / Venue / Location 三者关系现在可以正式锁定

Canonical：

```text
BusinessAccount
1
↓
N
Store
```

```text
Store
0..1
→ default Venue
```

但 Task 可以：

```text
use Store default Venue
or
use another Venue
or
use a standalone LocationReference
```

### Definitions

```text
Store
= business operating unit

Venue
= reusable named physical place

LocationReference
= geography/address primitive
```

### Correct relationship

```text
Venue 1 → 1 LocationReference
```

Task：

```text
task.venue_id optional
task.location_reference_id required unless REMOTE
```

如果有 Venue：

```text
Task location defaults from Venue
```

但 Order 必须保存 Accepted Snapshot。

**Severity：P0-IMPORTANT**

---

# 19. Audit Finding A17
## BusinessTaskTemplate.preferred_agents 只能引用 Known Relationships

Chapter 15 Template 可以保存：

```text
preferred agents
```

但 Proxy 有长期硬规则：

```text
No generic people directory
```

### Canonical Decision

Template 里的 preferred supply 只能引用：

```text
TrustedRelationship
```

或：

```text
known relationship produced by previous legitimate Order
```

不能保存：

```text
arbitrary platform Agent IDs discovered outside Task context
```

**Severity：P0-IMPORTANT**

---

# 20. Audit Finding A18
## Payment-related state registry Round 1 不完整

Round 1 已列：

```text
PaymentIntent
FundingHold
Agent Earnings
Payout
Settlement
```

但遗漏：

### Refund

```text
REQUESTED
PROCESSING
SUCCEEDED
FAILED
CANCELLED
```

### DisputeHold

Canonical status 来自 Chapter 10：

```text
OPEN
UNDER_REVIEW
PARTIALLY_RESOLVED
RESOLVED
CLOSED
```

### Important Naming Note

`DisputeHold.status` 实际 enum 名更像：

```text
Dispute Status
```

但当前没有独立 `Dispute` object。

Canonical 暂时保留：

```text
DisputeHold
```

作为 transaction dispute record。

是否拆出：

```text
Dispute
+
DisputeHold
```

留作 OPEN，避免现在增加对象。

**Severity：P0-IMPORTANT**

---

# 21. Audit Finding A19
## NotificationDelivery 状态需要补进 Registry

Canonical：

```text
PENDING
SENT
DELIVERED
FAILED
SUPPRESSED
EXPIRED
```

注意：

```text
SUPPRESSED
```

不是失败。

它可能来自：

```text
quiet hours
frequency cap
user preference
dedupe
stale action
```

**Severity：P1-CLEANUP**

---

# 22. Audit Finding A20
## Evidence type naming需要统一

Chapter 11 使用：

```text
REQUESTER_CONFIRMATION
BUSINESS_CONFIRMATION
DURATION
```

Round 1 Registry 曾写：

```text
REQUESTER_CONFIRM
BUSINESS_CONFIRM
```

### Canonical Decision

以 Chapter 11 原正式 enum 为准：

```text
CHECKIN
CHECKOUT
PHOTO
VIDEO
TEXT_NOTE
CHECKLIST
GPS
DURATION
REQUESTER_CONFIRMATION
BUSINESS_CONFIRMATION
EXTERNAL_LINK
```

**Severity：P1-CLEANUP**

---

# 23. Canonical ER — P0 Domain Topology

```text
UserAccount
├── AgentProfile
│   ├── AgentRole[]
│   ├── Capability records
│   └── AvailabilitySession[]
│
├── BusinessMembership[]
│   └── BusinessAccount
│       ├── Store[]
│       │   └── default Venue?
│       └── BusinessTaskTemplate[]
│
└── Individual Principal

Principal
└── RequesterTrustProfile

Capability Graph
├── GraphNode
├── GraphEdge
└── GraphPolicy

Task
├── created_by UserAccount
├── owned by Principal
├── optional Venue
├── LocationReference
├── SlotGroup[]
│   ├── TaskNeedProfile
│   └── TaskSlot[]
│       ├── CompensationTerms
│       ├── MatchAttempt[]
│       │   └── Offer[]
│       └── Order[]
│           ├── AcceptedTaskSnapshot
│           ├── AcceptedCompensationSnapshot
│           ├── SupplyReservation
│           ├── ExecutionContext
│           ├── Evidence[]
│           ├── ExecutionException[]
│           ├── Settlement
│           ├── Review[]
│           └── OutcomeRecord

Order / Principal / Agent
└── TrustedRelationship

Principal / Agent
├── MatchExclusionPreference
└── SafetyBlockRelation

Payment
├── PaymentIntent
├── FundingHold
├── PaymentLedgerEntry
├── AgentEarningsLedger
├── FeeLedger
├── Refund
├── Payout
├── Settlement
└── DisputeHold

Safety
├── RiskSignal
├── RiskDecision
├── RiskHold
├── Incident
└── Appeal

Communication
├── OrderChat
├── NotificationEvent
├── InboxItem
└── NotificationDelivery

Operations
├── OperatorCase
├── GraphGap
├── ManualAdjustmentRequest
└── OperatorAuditLog
```

---

# 24. Ownership Matrix

| Fact | Authoritative Owner |
|---|---|
| 登录身份 | UserAccount |
| Agent 是否可供给 | AgentProfile + AgentRole + Availability + Risk |
| Business 所有权 | BusinessAccount |
| Business 成员权限 | BusinessMembership + Permission Policy |
| Requester 信任 | Principal-scoped RequesterTrustProfile |
| Role/Capability 定义 | Capability Graph |
| Slot 要求 | TaskNeedProfile |
| Slot 原子生命周期 | TaskSlot |
| Slot 当前正式履约 | Order |
| Agent 空闲意愿 | AvailabilitySession |
| Agent 已占时间 | SupplyReservation |
| 正式 Compensation | CompensationTerms |
| 历史已接受 Compensation | AcceptedCompensationSnapshot |
| 历史已接受 Task Scope | AcceptedTaskSnapshot |
| 资金真实变化 | Ledger |
| 当前 Funding | FundingHold |
| 执行阶段 | Order.lifecycle_status |
| 执行配置 | ExecutionContext |
| 完成证据 | Evidence |
| 异常事实 | ExecutionException |
| 交易争议资金 | DisputeHold |
| 风险事实输入 | RiskSignal |
| 当前限制决定 | RiskDecision / RiskHold |
| 安全事件 | Incident |
| 正向复聘关系 | TrustedRelationship |
| 普通不再匹配 | MatchExclusionPreference |
| 安全封锁关系 | SafetyBlockRelation |
| 地理地址 | LocationReference |
| 可复用物理地点 | Venue |
| 商家运营单位 | Store |

---

# 25. Derived State Matrix

以下绝不能成为独立第二真相：

```text
Task.fulfillment_status
Task.execution_status

AvailabilitySession.OFFERED
AvailabilitySession.MATCHED

TaskSlot.current_order_id

Candidate card budget
Candidate card ETA
Supply heat
Demand heat

Business dashboard slot counts
Inbox Action Required count
Marketplace health score
```

它们都来自其他 authoritative facts。

---

# 26. Snapshot Matrix

以下历史事实必须冻结：

```text
Order Accepted Task Scope
Order Accepted Compensation
Pricing
Fee
Promotion
Cancellation Policy
Task Version
Slot Version
Graph Version
Relevant Safety / execution policy version
```

原则：

> Live configuration changes must not rewrite historical agreement.

---

# 27. Cross-domain Write Boundary

## Task Domain can write

```text
Task
SlotGroup
TaskSlot
TaskNeedProfile
```

不能直接写：

```text
Payment Ledger
Agent Risk
Review
```

---

## Matching Domain can write

```text
MatchAttempt
Offer
```

不能：

```text
make unqualified Agent qualified
```

---

## Order Domain can write

```text
Order
atomic slot assignment
SupplyReservation command
```

---

## Payment Domain can write

```text
PaymentIntent
FundingHold
Ledgers
Settlement
Refund
Payout
DisputeHold financial effect
```

---

## Safety Domain can write

```text
RiskSignal
RiskDecision
RiskHold
Incident
SafetyBlockRelation
```

---

## Trust Domain can write

```text
Review
OutcomeRecord
TrustedRelationship
MatchExclusionPreference
Reliability projection
```

---

## Operator

不能直接拥有业务事实。

Operator 只能：

```text
issue domain command
```

---

# 28. Open Questions After R2

这些不建议现在猜。

## OPEN-R2-01 UserAccount lifecycle enum

进入 Chapter 24。

## OPEN-R2-02 Venue lifecycle enum

当前 Chapter 17 schema 有 status，但未定义正式 enum。

## OPEN-R2-03 Dispute object split

当前 Chapter 10 使用：

```text
DisputeHold
```

同时承担 dispute lifecycle。

未来是否拆：

```text
Dispute
DisputeHold
```

待 Chapter 25 / Engineering Contract 看复杂度再决定。

## OPEN-R2-04 Snapshot physical implementation

可以：

```text
separate immutable objects
```

或：

```text
immutable JSON snapshots + version refs
```

由 Engineering Spec 决定。

## OPEN-R2-05 AgentProfile multiplicity

当前按照：

```text
one UserAccount → one AgentProfile
```

理解足够 P0。

未来多市场 / 多 persona 是否需要多个 Profile，当前不扩展。

---

# 29. Canonical Changes To Apply

Round 2 应更新 Registry：

```text
CANON-R2-001
Order.execution_status → lifecycle_status

CANON-R2-002
ExecutionContext.execution_status → derived/remove

CANON-R2-003
Task execution/fulfillment → derived only

CANON-R2-004
TaskSlot price truth → CompensationTerms

CANON-R2-005
Task location truth → LocationReference

CANON-R2-006
Add SupplyReservation

CANON-R2-007
RequesterTrustProfile → Principal scoped

CANON-R2-008
BusinessTrustedTeam → read model over TrustedRelationship

CANON-R2-009
Invite → command/source over Offer persistence

CANON-R2-010
TaskNeedProfile → requirement owner

CANON-R2-011
TaskSlot.current_order_id → denormalized pointer

CANON-R2-012
generation invariant

CANON-R2-013
Add immutable snapshots

CANON-R2-014
Venue base owner → Chapter 17

CANON-R2-015
Add Refund / DisputeHold / NotificationDelivery states

CANON-R2-016
Evidence enum correction
```

---

# 30. Final Assessment

经过 Round 2：

> **Proxy 的核心 Domain 不需要再增加大模块。**

真正应该进入下一步的条件已经满足：

```text
Core entities identified
State owners separated
Derived states identified
Duplicate truths reduced
Relationship ownership clarified
Open questions isolated
```

下一步正式进入：

> **Chapter 21 — P0 Screen Flow / Information Architecture / Page-level Product Spec**

但页面必须遵守：

```text
UI cannot invent new Domain state
UI cannot own business truth
CTA must map to Domain Command
Display fields must come from Read Model
Sensitive data must pass disclosure policy
```
