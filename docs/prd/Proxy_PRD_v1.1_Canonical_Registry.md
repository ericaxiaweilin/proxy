# Proxy PRD v1.1 — Canonical Registry
## Source of Truth / Naming / State / Policy / Invariant Constitution

**状态**：ACTIVE — Canonical Consolidation v1  
**用途**：从本文件开始，Proxy 工程、UI、API、测试、运营文档引用对象/状态/术语时，以本文件为第一入口。  
**范围**：整合 Chapter 01–20 已锁定设计；不新增当前 MVP 业务范围。  
**原则**：本文件解决“叫什么、谁拥有、状态是什么、哪些规则绝不能破坏”，不替代各专题 Chapter 的详细业务解释。

---

# 0. Canonical Authority Rule

当不同历史文档出现冲突时，使用以下优先级：

```text
1. Canonical Registry
2. 最新 v1.1 专题 Chapter
3. Chapter 20 MVP Cut
4. Proxy PRD v1.0 Complete
5. v0.5–v0.9.x 增量文档
6. 原始 PRD v0.2 / MVP 功能规格 / 检索治理规则
```

如果 Canonical Registry 标记：

```text
OPEN
```

表示当前资料尚未足够支持最终定义，**禁止开发自行猜测**，必须进入后续 PRD / Engineering Spec 补齐。

---

# 1. Product Constitution

以下规则属于 Proxy 的长期硬规则。

## C-01 Human Agent

```text
Agent = real human
```

Proxy 的核心执行主体始终是真人。

AI 可以未来辅助：

```text
understand
draft
summarize
rank
explain
triage
```

但当前 AI Harness 仅保留架构 Extension Point，不属于 P0 主链。

---

## C-02 Task First

```text
Real Need
→ Task
→ TaskSlot
→ Human Matching
→ Human Execution
```

不是：

```text
Browse People
→ Find someone interesting
→ Invent a task
```

---

## C-03 No Task, No Generic People Search

禁止产品形成：

```text
Nearby People
Online Agents Map
Infinite People Feed
Generic Agent Directory
Public Human Leaderboard
```

陌生 Agent Discovery 必须来自：

```text
Valid Task Context
→ Eligibility
→ Finite Candidate Set
```

---

## C-04 Eligibility Before Ranking

```text
Eligibility = 有没有资格
Ranking = 合格以后谁更适合
```

Boost、Repeat、Popularity、AI 都不能绕过 Hard Eligibility。

---

## C-05 Task / Slot / Order Must Stay Separate

```text
Task
= 一个整体现实目标

TaskSlot
= 一个真人原子位置

Order
= 一个 Agent 与一个 Slot 的正式履约关系
```

永远不得为了 MVP 合表。

---

## C-06 One Slot = One Human Position

```text
Greeter ×3
```

必须创建：

```text
slot_g1
slot_g2
slot_g3
```

不是：

```text
slot.quantity = 3
```

---

## C-07 Funding Before Paid Order

任何需要 Requester 付费的 Order：

```text
Agent Accept
+
Eligibility Recheck
+
Atomic Slot Lock
+
Funding Secured
→ Order
```

Funding 未满足：

```text
NO ORDER
```

---

## C-08 Ledger First

任何钱的变化：

```text
append Ledger Entry
```

禁止：

```text
直接覆盖余额表达历史
```

---

## C-09 KYC ≠ Trust ≠ Risk ≠ Capability Verification

```text
KYC
= who are you

Capability Verification
= can you credibly do this

Trust / Reliability
= how did you behave historically

Risk
= what may you do now
```

四者不得合并成一个分数。

---

## C-10 Progressive Disclosure

所有真人字段暴露遵循：

```text
Purpose Allowed
∩ Viewer Permission
∩ Agent Visibility Policy
∩ Task Relevance
− Risk Restriction
=
Fields Exposed
```

后端裁剪字段，不能只靠前端隐藏。

---

## C-11 Human Data Is Purpose-bound

高敏数据访问必须知道：

```text
Who
Why
Task
Order
Until when
```

---

## C-12 Trusted Does Not Bypass Safety

```text
Trusted Proxy
Trusted Team
Repeat Relationship
```

都不能绕过：

```text
Eligibility
Availability
Risk
Safety
Location Permission
```

---

## C-13 Operator Is a Controlled Fallback

Operator：

```text
review
assist
resolve
approve
```

不能：

```text
直接改数据库
直接改余额
替 Agent 接单
绕过 Eligibility
```

所有高影响写操作必须走 Domain Command。

---

## C-14 Successful Human Execution Is the North Star

核心不是：

```text
DAU
Profile Views
Watch Time
GMV alone
```

而是：

```text
real funded Order
→ real human accepts
→ real-world execution
→ agreed core deliverable completed
```

---

# 2. Source-of-Truth Chapter Index

| Domain | Canonical Source Chapter | Status |
|---|---|---|
| Account / Identity / Principal | Chapter 01 | ACTIVE |
| Social Account Bridge | Chapter 01A | RESERVED / P1 |
| Capability Graph | Chapter 02 | ACTIVE |
| Real-world Scene Network | Chapter 02A | FUTURE / PILOT |
| Marketplace Foundations | Chapter 02B | ACTIVE |
| Task / Slot / Order | Chapter 03 | ACTIVE |
| Requester Demand Builder | Chapter 04 | ACTIVE |
| Eligibility / Ranking | Chapter 05 | ACTIVE |
| Fast Match / Invite / Offer | Chapter 06 | ACTIVE |
| Basic Content Sharing | **latest Chapter 06A Basic Content Sharing** | P0.5 / LIGHT |
| Agent Capability Passport | Chapter 07 | ACTIVE |
| Availability / Supply | Chapter 08 | ACTIVE |
| Pricing / Quote | Chapter 09 | ACTIVE |
| Payment / Settlement | Chapter 10 | ACTIVE |
| Execution / Evidence | Chapter 11 | ACTIVE |
| Review / Trust / Repeat | Chapter 12 | ACTIVE |
| Safety / Risk / Incident | Chapter 13 | ACTIVE |
| Notification / Inbox | Chapter 14 | ACTIVE |
| Business Workspace | Chapter 15 | ACTIVE |
| Membership / Earn→Spend | Chapter 16 | RESERVED / LATER |
| Map / Location | Chapter 17 | ACTIVE, P0-LITE |
| Operator Console | Chapter 18 | ACTIVE |
| Analytics / Experimentation | Chapter 19 | ACTIVE |
| MVP Cut / Launch Gate | Chapter 20 | ACTIVE |
| P0 Screen Flow / Information Architecture / Page-level Product Spec | Chapter 21 | ACTIVE |
| P0 Launch Catalog / Scenario & Role Template Pack | Chapter 22 | ACTIVE |
| Policy Defaults / Configuration Registry | Chapter 23 | ACTIVE |
| Account Security / Privacy / Consent / Data Lifecycle | Chapter 24 | ACTIVE |
| E2E Acceptance / Test Matrix / Invariant Gate | Chapter 25 | ACTIVE |
| Engineering API / Event / Schema Contract | Chapter 26 | ACTIVE |
| Provider Integration Contract / Market Launch Readiness | Chapter 27 | ACTIVE |
| Pilot Runbook / Launch Operations / Incident Drill | Chapter 28 | ACTIVE |
| Post-Pilot Scale / Governance / Continuous Readiness | Chapter 29 | ACTIVE |
| Scale Architecture / Capacity / FinOps / Multi-Region Readiness | Chapter 30 | ACTIVE |
| Enterprise / B2B Scale / Contract Governance | Chapter 31 | ACTIVE |
| Enterprise API / SSO / SCIM / Integration Contract | Chapter 32 | ACTIVE |
| Enterprise Migration / Adoption / Renewal Governance | Chapter 33 | ACTIVE |
| Enterprise Compliance / Audit / Trust Center Governance | Chapter 34 | ACTIVE |
| Multi-Market Legal Entity / Tax / Currency / Settlement Governance | Chapter 35 | ACTIVE |
| Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance | Chapter 36 | ACTIVE |
| Financial Controls / Internal Audit / Risk Appetite / Board Governance | Chapter 37 | ACTIVE |
| Regulatory Change / Policy Migration / Market Re-Approval Governance | Chapter 38 | ACTIVE |
| Policy-as-Code / Runtime Decision / Explainability Governance | Chapter 39 | ACTIVE |
| Decision Data / Model Risk / AI Governance | Chapter 40 | ACTIVE |
| AI-assisted Operations / Agentic Workflow / Delegated Action Governance | Chapter 41 | ACTIVE |
| AI-native Harness | AI Architecture Reserve | RESERVED ONLY |

---

# 3. Deprecated / Superseded Documents

以下文档只保留历史价值，不再作为工程行为真相。

## 3.1 Historical Product Documents

```text
Proxy_PRD.md v0.2
Proxy_MVP_功能规格.md
Proxy_检索匹配与治理规则.md
Proxy_PRD_v0.5.md
Proxy_PRD_v0.6.md
Proxy_PRD_v0.7.md
Proxy_PRD_v0.8.md
Proxy_PRD_v0.9_Map_Availability_Liquidity.md
Proxy_PRD_v0.9.1_Monetization_Boost.md
Proxy_PRD_v1.0_Complete.md
```

其中成熟原则已被 v1.1 专题 Chapter 吸收。

> **2026-09-22**：清单里除 `Proxy_MVP_功能规格.md`、`Proxy_检索匹配与治理规则.md`
> 之外的文件已从仓库删除（文档整理 —— 它们被 v1.1 Canonical Registry 取代，
> 且全仓无任何代码/门禁引用）。需要回溯时从 git 历史取：
> `git log --diff-filter=D --name-only -- 'Proxy_PRD_v0.*'`。

---

## 3.2 Content Conflict

存在两个历史 Chapter 06A：

```text
Chapter06A_Content_Sharing_Video_Live
Chapter06A_Basic_Content_Sharing
```

Canonical 决定：

> **Chapter06A_Basic_Content_Sharing 为唯一当前 Source of Truth。**

旧的：

```text
Content_Sharing_Video_Live
```

状态：

```text
SUPERSEDED
```

Native Live：

```text
NOT MVP
```

未来只有真实需求后再通过第三方能力接入。

---

# 4. Canonical Actor / Principal Model

## 4.1 UserAccount

唯一登录主体。

负责：

```text
login identity
phone
email
account-level KYC
account risk
security
notification preference
account lifecycle
```

不负责：

```text
Agent capability
Business ownership data
Task ownership
Agent availability
Business billing
```

---

## 4.2 Requester

Requester 是：

```text
business identity / usage mode
```

不是第二个 Account。

Requester Principal 可以是：

```text
INDIVIDUAL
BUSINESS
```

---

## 4.3 AgentProfile

Agent 是真人供给身份。

关系：

```text
UserAccount 1
→ 0..1 active AgentProfile
```

AgentProfile 与 UserAccount 分离。

Canonical Agent Status：

```text
DRAFT
ACTIVE
PAUSED
RESTRICTED
SUSPENDED
CLOSED
```

---

## 4.4 BusinessAccount

独立交易 Principal。

Business Task / Spend / History / Trusted Team：

```text
belong to BusinessAccount
```

不属于创建 Task 的员工个人。

Canonical Business Status：

```text
DRAFT
ACTIVE
RESTRICTED
SUSPENDED
CLOSED
```

---

## 4.5 BusinessMembership

连接：

```text
UserAccount
↔
BusinessAccount
```

Canonical Membership Status：

```text
INVITED
ACTIVE
SUSPENDED
REMOVED
```

### Canonical correction

Chapter 01 早期使用过：

```text
ACTIVE → LEFT
```

Chapter 15 后续正式定义：

```text
REMOVED
```

因此 Canonical 使用：

```text
REMOVED
```

`LEFT` 作为历史命名废弃。

如果未来需要区分：

```text
USER_LEFT
ADMIN_REMOVED
```

应作为 `removal_reason`，不要增加第二套 membership lifecycle。

---

## 4.6 Principal

所有 Task 必须明确：

```text
created_by_user_id
principal_type
principal_id
```

Canonical Principal Type：

```text
INDIVIDUAL
BUSINESS
```

未来其他组织类型优先扩展 Principal Type，不创建旁路 Task 系统。

---

# 5. Canonical Identity / Trust Levels

## 5.1 Account KYC

Canonical 只有：

```text
K0 — CONTACT_VERIFIED
K1 — IDENTITY_VERIFIED
K2 — AGENT_TRANSACTION_READY
```

含义：

### K0

```text
Phone verified
```

### K1

```text
Identity verified
```

可支持 Publish / Invite / Payment 等受市场 Policy 控制的行为。

### K2

```text
Identity
+
Payout identity
```

Agent 可进入真实收入 / payout-ready 状态。

---

## 5.2 Canonical Correction — K3 Is NOT KYC

历史 Chapter 01 使用了：

```text
K3 — Capability Verification
```

但同一章节已经明确：

```text
K3 不属于 Account KYC
```

因此 Canonical：

```text
K3
```

**从 KYC enum 删除。**

能力验证统一进入：

```text
CapabilityVerificationStatus
```

---

## 5.3 Capability Verification Status

Canonical：

```text
SELF_REPORTED
DOCUMENT_VERIFIED
PLATFORM_VERIFIED
OPERATOR_VERIFIED
OUTCOME_VERIFIED
EXPIRED
REVOKED
```

---

## 5.4 Requester Trust Tier

Canonical：

```text
R0_NEW
R1_VERIFIED
R2_COMPLETED
R3_TRUSTED_BUSINESS
RX_RESTRICTED
```

说明：

Requester Trust 是：

```text
permission / disclosure / transaction-readiness signal
```

不是 Risk。

---

# 6. Canonical Capability Graph

## 6.1 GraphNode

Canonical Node Types：

```text
INDUSTRY
SCENARIO
ROLE
CAPABILITY
ATTRIBUTE
CHANNEL
```

---

## 6.2 GraphEdge

Canonical relation_type：

```text
CONTAINS
SUPPORTS
REQUIRES
RECOMMENDS
ALLOWS
DISALLOWS
```

---

## 6.3 GraphPolicy

用于：

```text
Sensitive Attribute
Verification
Role Eligibility
Channel
Region
Age
Legal Restriction
```

---

## 6.4 Graph Version

Canonical Graph Version Status：

```text
DRAFT
REVIEW
ACTIVE
DEPRECATED
```

Task 必须冻结：

```text
graph_version
```

---

## 6.5 AgentRole

Canonical Status：

```text
SUGGESTED
ACTIVE
PAUSED
RESTRICTED
```

Canonical Qualification：

```text
NOT_QUALIFIED
QUALIFIED
VERIFIED
PROVEN
```

---

# 7. Canonical Marketplace Core Objects

核心关系：

```text
Task
├── SlotGroup
│   └── TaskSlot[]
│
└── TaskSlot
    ├── MatchAttempt[]
    │   └── Offer[]
    └── Order[]
```

---

## 7.1 Task

定义：

> 一个 Requester 希望完成的整体现实世界目标。

Task 不直接绑定 Agent。

---

## 7.2 SlotGroup

只用于：

```text
UI aggregation
bulk create
bulk pricing
bulk operations
analytics
```

不拥有独立交易结果。

---

## 7.3 TaskSlot

定义：

> 一个真人 Agent 必须占据并完成的原子位置。

Canonical Invariant：

```text
1 TaskSlot
→ max 1 active Order
```

---

## 7.4 MatchAttempt

定义：

> 一个 TaskSlot 的一次正式撮合周期。

Canonical Status：

```text
ACTIVE
FILLED
EXHAUSTED
CANCELLED
STALE
```

---

## 7.5 Offer

Canonical Object Name：

```text
Offer
```

它统一表示系统/平台给 Agent 的可接受任务机会。

Canonical Status：

```text
CREATED
SENT
DELIVERED
VIEWED
ACCEPTING
ACCEPTED
DECLINED
EXPIRED
REVOKED
ASSIGNMENT_LOST
FAILED
```

---

## 7.6 Canonical Correction — MatchOffer

Chapter 03 在独立对象举例中出现过：

```text
MatchOffer
```

Chapter 06 后续正式定义对象名：

```text
Offer
```

因此：

```text
MatchOffer
```

废弃为对象名。

如代码已存在：

```text
MatchOffer
```

后续统一迁移到：

```text
Offer
```

---

## 7.7 Invite

Invite 与 Offer 语义分离：

```text
Invite
= Requester explicitly selects candidate

Offer
= system / Fast Match pushes opportunity
```

两者：

```text
NOT ORDER
```

实现层可以共享 delivery infrastructure，但 Domain source 必须可区分。

Canonical source：

```text
REQUESTER_SELECTION
FAST_MATCH
```

---

## 7.8 Order

定义：

> 一个 Human Agent 与一个 TaskSlot 形成的正式履约关系。

关系：

```text
1 Order
→ exactly 1 Agent
→ exactly 1 TaskSlot
```

`agent_id` 与 `slot_id` 创建后不可变。

Replacement：

```text
same TaskSlot
+
new Order
```

不创建 Replacement Slot。

---

# 8. Canonical Task State Registry

## 8.1 Task Lifecycle

```text
DRAFT
READY
COMMITTED
ACTIVE
COMPLETION_PENDING
COMPLETED
CANCELLED
EXPIRED
REJECTED
```

---

## 8.2 Task Outcome

```text
FULL_SUCCESS
PARTIAL_SUCCESS
FAILED
CANCELLED
```

注意：

```text
lifecycle_status = COMPLETED
```

可以同时：

```text
task_outcome = PARTIAL_SUCCESS
```

Lifecycle 与 Outcome 不混。

---

## 8.3 Task Admission

```text
NOT_REQUIRED
PENDING
APPROVED
REVIEW_REQUIRED
REJECTED
```

---

## 8.4 Task Funding Status

Canonical interface status：

```text
NOT_REQUIRED
PENDING
AUTHORIZED
SECURED
FAILED
RELEASED
REFUNDING
REFUNDED
```

注意：

Payment Domain 内的 FundingHold 有更细粒度状态。

Task Funding Status 是：

```text
Task read model / gate interface
```

不是资金账本真相。

---

## 8.5 Task Fulfillment Status

Derived：

```text
NONE
OPEN
PARTIAL
FULL
REPLACEMENT_REQUIRED
UNFILLED
```

禁止单独写入形成第二真相。

---

# 9. Canonical TaskSlot State Registry

```text
DRAFT
OPEN
ASSIGNED
IN_PROGRESS
COMPLETION_PENDING
COMPLETED
CANCELLED
UNFILLED
```

Candidate / Invite / Offer / Viewed 阶段：

```text
TaskSlot = OPEN
```

只有成功创建 Order 后：

```text
OPEN → ASSIGNED
```

---

# 10. Canonical Order State Registry

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

注意：

```text
Dispute
Payment
Safety Hold
```

都不是 Order Lifecycle 值。

它们必须使用独立状态对象。

---

# 11. Canonical Availability Registry

## 11.1 AvailabilitySession

Mode：

```text
NOW
SCHEDULED
```

Future reserved：

```text
RECURRING
```

Canonical Status：

```text
DRAFT
ACTIVE
PAUSED
OFFERED
MATCHED
EXPIRED
CLOSED
```

---

## 11.2 Availability Status Semantics

重要：

```text
OFFERED
MATCHED
```

在 Chapter 08 中带有明显 read-model / capacity 表达性质。

因此 Canonical 规定：

> AvailabilitySession Status 不拥有 Offer 或 Order 的交易真相。

例如：

```text
Offer.status
Order.lifecycle
```

才是交易 Source of Truth。

AvailabilitySession 的 `OFFERED / MATCHED` 只能根据真实 Offer / reservation / Order 派生或受受控命令驱动。

---

# 12. Canonical Matching Pipeline

唯一顺序：

```text
TaskSlot
↓
Requirement Resolution
↓
Account / Safety / Permission Gate
↓
Role / Capability Eligibility
↓
Verification Gate
↓
Availability Gate
↓
Time / Location Feasibility
↓
Schedule Conflict
↓
Agent Preference
↓
Qualified Pool
↓
Organic Ranking
↓
Sponsored Adjustment
↓
Finite Candidate Set
↓
Invite / Offer
```

---

## 12.1 Hard Rule

```text
Sponsored
```

永远在：

```text
Qualified
```

之后。

定义：

> Agent 可以付费买更多曝光，不能付费买资格。

---

## 12.2 Candidate Set

Requester 不看整个 Qualified Pool。

P0：

```text
finite candidate set
```

建议：

```text
4–8
```

具体值进入 Chapter 23 Policy Registry。

---

# 13. Canonical Payment Objects

必须分开：

```text
Requester Money
Agent Earnings
Platform Revenue
Promotion / Subsidy
```

Canonical objects：

```text
PaymentIntent
FundingHold
PaymentLedgerEntry
AgentEarningsLedger
FeeLedger
PromotionLedger
Refund
Payout
Settlement
DisputeHold
```

---

# 14. Canonical Payment State Registry

## 14.1 PaymentIntent

```text
CREATED
REQUIRES_ACTION
AUTHORIZED
CAPTURED
PARTIALLY_CAPTURED
FAILED
CANCELLED
REFUNDED
PARTIALLY_REFUNDED
```

---

## 14.2 FundingHold

```text
PENDING
AUTHORIZED
SECURED
PARTIALLY_SECURED
FAILED
RELEASED
REFUNDED
PARTIALLY_REFUNDED
```

---

## 14.3 Agent Earnings

```text
PENDING
EARNED
AVAILABLE
PAYOUT_PENDING
PAID
REVERSED
HELD
```

---

## 14.4 Payout

```text
REQUESTED
PROCESSING
PAID
FAILED
REVERSED
```

---

## 14.5 Settlement

```text
PENDING
PARTIAL
SETTLED
REVERSED
DISPUTED
```

---

# 15. Canonical Execution Objects

```text
ExecutionContext
OrderChat
TemporaryContactGrant
Evidence
ExecutionException
ExecutionEvent
```

Order Chat：

```text
must bind order_id
```

不是通用好友聊天。

---

## 15.1 Evidence

定义：

> 证明 Deliverable 被执行或完成的结构化事实。

P0 Evidence types 至少支持：

```text
CHECKIN
CHECKOUT
PHOTO
VIDEO
TEXT_NOTE
CHECKLIST
GPS
REQUESTER_CONFIRM
BUSINESS_CONFIRM
EXTERNAL_LINK
```

实际首发可在 Chapter 22/23 裁剪。

Evidence：

```text
≠ surveillance
```

---

## 15.2 ExecutionException

必须与：

```text
Dispute
```

分离。

Exception：

```text
what happened
```

Dispute：

```text
who is responsible / money disagreement
```

---

# 16. Canonical Review / Reliability / Relationship Objects

Canonical objects：

```text
Review
OutcomeRecord
TrustedRelationship
MatchExclusionPreference
SafetyBlockRelation
```

---

## 16.1 Review Status

```text
DRAFT
SUBMITTED
WITHHELD
UNDER_REVIEW
PUBLISHED
REMOVED
```

Review 不阻塞 Settlement。

Missing Review：

```text
≠ negative review
```

---

## 16.2 Reliability Dimensions

```text
Acceptance Reliability
Arrival Reliability
On-time Reliability
Completion Reliability
Cancellation Reliability
Response Reliability
Evidence Reliability
```

Reliability 优先来自系统交易事实，而非主观星级。

---

## 16.3 TrustedRelationship

Canonical relationship_type 只保留正向关系：

```text
TRUSTED_PROXY
PREFERRED_PROXY
BUSINESS_TRUSTED_TEAM
```

---

## 16.4 Canonical Correction — DO_NOT_MATCH / BLOCKED

Chapter 12 的一个 Schema 列表曾把：

```text
BLOCKED
DO_NOT_MATCH
```

放进 `TrustedRelationship.relationship_type`。

但同一 Chapter 后续明确锁定：

```text
Do Not Match Again
≠
Safety Block
```

因此 Canonical 修正：

### MatchExclusionPreference

表示：

```text
Do Not Match Again
```

特点：

```text
private
relationship preference
not global reputation
```

### SafetyBlockRelation

表示：

```text
Safety Block
```

特点：

```text
safety governed
risk / incident capable
```

因此：

```text
BLOCKED
DO_NOT_MATCH
```

从 `TrustedRelationship.relationship_type` 移除。

---

# 17. Canonical Safety / Risk Objects

```text
RiskSignal
RiskDecision
Incident
RiskHold
Appeal
ProhibitedTaskPolicy
```

---

## 17.1 Risk Status

```text
NORMAL
WATCH
REVIEW_REQUIRED
RESTRICTED
SUSPENDED
BLOCKED
```

---

## 17.2 RiskDecision

Canonical decisions：

```text
ALLOW
ALLOW_WITH_LIMIT
REVIEW
RESTRICT
SUSPEND
BLOCK
```

---

## 17.3 Safety Incident

Canonical Status：

```text
OPEN
TRIAGED
IN_REVIEW
ACTIONED
RESOLVED
CLOSED
```

Canonical Severity：

```text
LOW
MEDIUM
HIGH
CRITICAL
```

---

## 17.4 Safety Rule

Protective action：

```text
can happen before final judgment
```

例如：

```text
temporary contact revoke
temporary risk hold
execution pause
```

不等于最终定责。

---

# 18. Canonical Notification Objects

```text
NotificationEvent
InboxItem
NotificationDelivery
```

Communication Domain 必须区分：

```text
CHAT
SYSTEM_NOTIFICATION
SAFETY_ALERT
```

---

## 18.1 Notification Priority

```text
P0_CRITICAL
P1_HIGH
P2_NORMAL
P3_LOW
```

---

## 18.2 Inbox Status

```text
UNREAD
READ
ACTED
DISMISSED
EXPIRED
```

Canonical invariant：

```text
READ
≠
ACTED
```

---

## 18.3 P0 Delivery

```text
IN_APP
PUSH
```

P1：

```text
EMAIL
SMS
```

---

# 19. Canonical Business Objects

```text
BusinessAccount
BusinessMembership
Store
Venue
BusinessTaskTemplate
BusinessAuditLog
```

Trusted Team 不建立独立“Employee”系统。

它是 Marketplace Relationship。

---

## 19.1 Business Roles

Long-term canonical role set：

```text
OWNER
ADMIN
TASK_MANAGER
OPERATIONS
BILLING
SAFETY_MANAGER
VIEWER
```

Chapter 20 为 MVP UI 建议可以先减少可配置角色数量，但：

> Domain permission model 不应退化成四个硬编码 if/else。

---

## 19.2 Business Permission Names

Canonical baseline：

```text
TASK_CREATE
TASK_COMMIT
TASK_CANCEL
SLOT_MANAGE
AGENT_INVITE
TRUSTED_TEAM_MANAGE
BILLING_VIEW
BILLING_MANAGE
SAFETY_VIEW
SAFETY_MANAGE
MEMBER_MANAGE
STORE_MANAGE
ORDER_CHAT_READ
ORDER_CHAT_WRITE
```

Operator Permission 与 Business Permission 分开命名空间。

---

## 19.3 Effective Permission

```text
Role Permission Bundle
∩ Membership Scope
− Policy Restriction
− Risk Restriction
=
Effective Permission
```

---

# 20. Canonical Store / Venue Distinction

```text
Store
= Business operating unit

Venue
= Physical execution location
```

一个 Store 可以：

```text
change location
use temporary event venue
```

因此：

```text
store_id
≠
location_id
```

---

# 21. Canonical Location Objects

```text
LocationReference
GeoZone
LocationVisibilityGrant
SupplyHeatCell
DemandHeatCell
```

P0 Heatmap 可以只做轻量 read model。

---

## 21.1 Location Visibility Levels

```text
L0_AGGREGATE
L1_APPROXIMATE
L2_TASK_CONTEXT
L3_MATCHED
L4_EXECUTION_PRECISE
```

---

## 21.2 LocationVisibilityGrant Status

```text
ACTIVE
EXPIRED
REVOKED
DENIED
```

---

## 21.3 Location Purpose

```text
MATCHING
ETA
ARRIVAL_COORDINATION
CHECKIN
EXECUTION
SAFETY
```

---

## 21.4 No Permanent Location Through Trust

```text
Trusted Proxy
```

永远不等于：

```text
permanent location access
```

---

# 22. Canonical Data Classification

## D0 — Public

```text
Industry
Scenario
Venue
Aggregate Supply
General Price
General Match ETA
Public Activity
```

---

## D1 — Task Context

```text
Agent Nickname
Task-relevant Capability
Approx Distance
Availability
Relevant Verification
```

只有合法 Task Context 才能访问。

---

## D2 — Private Profile

```text
Portfolio
Professional Proof
Some Attributes
Social Metrics
```

受 Task / Trust / Visibility 控制。

---

## D3 — Transaction Data

```text
Task Chat
Venue Detail
Arrival Information
Order Information
```

Match / Order 后才访问。

---

## D4 — Execution Sensitive

```text
Precise Location
Live Location
Emergency Contact
Exact Meeting Point
Execution Trajectory
```

必须：

```text
Valid Order
+
Purpose
+
TTL
+
Audit
```

---

## D5 — Restricted Identity

```text
Government ID
Legal Full Name
Bank / Payout Account
KYC Document
OAuth Token
Device Credential
```

禁止进入：

```text
Candidate API
ordinary Business API
```

---

# 23. Canonical Operator Objects

```text
OperatorCase
GraphGap
ManualAdjustmentRequest
OperatorAuditLog
```

---

## 23.1 OperatorCase Status

```text
OPEN
TRIAGED
ASSIGNED
IN_PROGRESS
WAITING_USER
WAITING_PROVIDER
WAITING_INTERNAL
RESOLVED
CLOSED
```

---

## 23.2 Operator Priority

```text
P0_CRITICAL
P1_HIGH
P2_NORMAL
P3_LOW
```

---

## 23.3 Operator Teams

```text
MARKETPLACE_OPS
TRUST_SAFETY
PAYMENTS
IDENTITY
BUSINESS_SUPPORT
GRAPH_GOVERNANCE
ADMIN
```

---

## 23.4 Operator Permission Baseline

```text
CASE_VIEW
CASE_ASSIGN
CASE_RESOLVE

TASK_REVIEW
TASK_LIMITED_EDIT

MATCH_ASSIST
REPLACEMENT_ASSIST

GRAPH_GAP_REVIEW

PAYMENT_VIEW
PAYMENT_HOLD
REFUND_PROPOSE
REFUND_APPROVE

IDENTITY_VIEW
IDENTITY_DECIDE

SAFETY_VIEW
SAFETY_ACTION

RISK_RESTRICT

MANUAL_ADJUST_PROPOSE
MANUAL_ADJUST_APPROVE
```

---

# 24. Canonical Command Rule

所有高影响写操作必须表达为 Domain Command。

例如：

```text
CommitTask
AcceptOffer
AssignSlot
CancelOrder
ConfirmArrival
SubmitEvidence
ConfirmCompletion
OpenDispute
ApproveRefund
ResolveIncident
RestrictAccount
```

禁止：

```text
PATCH status = ...
```

Canonical Registry 当前只规定命名原则。

完整 Command Catalog 后续进入 Engineering Contract。

---

# 25. Canonical Domain Event Naming Rule

事件采用：

```text
<PastTenseBusinessFact>
```

例如：

```text
TaskCommitted
SlotOpened
OfferSent
OfferAccepted
OrderCreated
AgentArrived
EvidenceSubmitted
OrderCompleted
SettlementCreated
PayoutPaid
IncidentOpened
RiskDecisionMade
```

Domain Event：

```text
must describe fact that happened
```

不能使用：

```text
DoSomething
HandleTask
ProcessOrder
```

作为事件名。

完整 Event Registry 后续由 Engineering Contract 生成，但所有实现必须遵守该命名规则。

---

# 26. Core Cross-domain Invariants

## INV-001

```text
UserAccount = only login principal
```

Requester / Agent 不是两套账户。

---

## INV-002

Business Task：

```text
principal = Business
```

员工离开 Business 不删除 Task / Order / Payment / Trusted Team。

---

## INV-003

```text
1 TaskSlot = 1 atomic human position
```

---

## INV-004

```text
1 TaskSlot
→ max 1 active Order
```

---

## INV-005

Replacement：

```text
same Slot
→ new Order
```

---

## INV-006

Candidate / Invite / Offer：

```text
NOT Order
```

---

## INV-007

Offer Accept 前必须 recheck：

```text
Agent active
Risk clear
Availability valid
No schedule conflict
Task/Slot version current
Offer not expired
Slot OPEN
Funding valid
```

---

## INV-008

所有 Paid Order：

```text
Funding Protected before creation
```

---

## INV-009

任何资金变化：

```text
Ledger
```

不能直接改 Balance。

---

## INV-010

Review：

```text
does not block settlement
```

---

## INV-011

Unsafe / Material Mismatch：

Agent 合理 Safe Exit：

```text
must not automatically become normal Agent cancellation fault
```

---

## INV-012

Order Chat：

```text
order-bound
```

不能成为通用社交 Chat。

---

## INV-013

重大 Task / Venue / Compensation 变更：

```text
cannot be silently changed in chat
```

需要重新 consent / version。

---

## INV-014

Order Closed：

必须撤销：

```text
precise location
temporary contact
execution-specific grants
```

---

## INV-015

Trusted：

```text
never bypasses current eligibility
```

---

## INV-016

Boost：

```text
can adjust exposure
cannot adjust qualification
```

---

## INV-017

Agent Min Pay：

属于：

```text
eligibility
```

不是单纯 ranking preference。

---

## INV-018

Requester 无 Task：

```text
cannot access generic people candidate API
```

---

## INV-019

D4 / D5：

```text
never ordinary candidate data
```

---

## INV-020

Operator：

```text
cannot accept Task for Agent
cannot directly alter ledger
cannot manually invent evidence
```

---

# 27. Canonical Policy Registry

以下 Policy 为正式产品概念。

## Core Graph

```text
GraphPolicy
```

## Matching

```text
MatchingPolicy
CandidateSetPolicy
OfferWavePolicy
ExposureFairnessPolicy
SponsoredPolicy
```

## Availability

```text
AvailabilityPolicy
TravelFeasibilityPolicy
```

## Pricing

```text
PricingMarketPolicy
CompensationPolicy
```

## Payment

```text
FundingPolicy
SettlementPolicy
CancellationPolicy
RefundPolicy
PayoutPolicy
```

## Execution

```text
CheckinPolicy
EvidencePolicy
CompletionPolicy
AutoConfirmPolicy
```

## Safety

```text
ProhibitedTaskPolicy
TaskAdmissionPolicy
RiskPolicy
HighRiskTaskPolicy
LocationAccessPolicy
ContactAccessPolicy
```

## Notification

```text
NotificationPolicy
FrequencyCapPolicy
QuietHoursPolicy
```

## Business

```text
BusinessPermissionPolicy
BusinessApprovalPolicy
BudgetPolicy
```

## Operator

```text
OperatorAccessPolicy
ManualAdjustmentPolicy
CaseRoutingPolicy
```

---

# 28. Policy Versioning Rule

任何会影响：

```text
money
eligibility
safety
cancellation
data exposure
```

的 Policy 必须：

```text
versioned
effective_at
auditable
```

交易创建时需要的 Policy：

必须保存 Snapshot / Version。

---

# 29. Objects Reserved but NOT P0 Launch Blockers

以下对象允许保留 Schema / foreign key / interface，但当前不应拉入 MVP 主开发范围。

## Social

```text
SocialAccountConnection
SocialContentReference
```

## Content

```text
ContentPost
```

仅 Basic Text / Image / Long-form / Ordinary Video。

## Merchant

```text
MerchantCustomerRelation
MembershipProgram
MembershipTier
PointsLedger
MembershipBenefit
```

## Scene

```text
Activity
HumanAgentNeed
SceneState
SceneConnector
```

## AI

```text
AI_EXTENSION_POINT
Provider / Model Adapter boundary
```

---

# 30. Explicitly NOT P0

```text
Full AI Harness
Native Live
Full CRM
POS
Inventory
Payroll
Storefront Builder
Advanced Reservation
CCTV / Scene Network
Learning-to-rank dependency
AI pricing
AI autonomous safety decision
AI autonomous dispute resolution
Advanced heatmap
Earn → Spend wallet
```

---

# 31. Explicit Product Red Lines — Not “P1 Later”

以下不是简单延期，而是默认与核心方向冲突：

```text
Generic People Search
Nearby People
Infinite Candidate Feed
Public Human Leaderboard
Beauty Ranking
Companion / Dating
Lowest-price Public Bidding
Permanent Precise Location Access
Off-task Sensitive Attribute Filtering
```

如果未来有人提出，必须重新通过 Product Constitution Review，不能直接进入 Roadmap。

---

# 32. Canonical Naming Style

## Entity

使用 singular noun：

```text
Task
Order
Offer
Evidence
Incident
```

---

## ID

统一：

```text
task_id
slot_id
order_id
agent_id
business_id
```

不要混：

```text
taskId
TaskID
task_uuid
```

除非实现语言 serializer 统一转换。

---

## Status

字段名称必须带 Domain 语义。

优先：

```text
lifecycle_status
funding_status
admission_status
risk_status
verification_status
```

避免：

```text
status
```

承载多个正交状态。

---

## Derived State

凡是可从其他真实对象推导的状态，标记：

```text
DERIVED / READ MODEL
```

例如：

```text
Task fulfillment_status
Availability OFFERED
some dashboard counts
```

---

# 33. Canonical Conflict Log v1

## Conflict 01 — K3

Before：

```text
K3 Capability Verification
```

Decision：

```text
REMOVE from KYC enum
```

Use：

```text
CapabilityVerificationStatus
```

Status：

```text
RESOLVED
```

---

## Conflict 02 — Business Membership LEFT vs REMOVED

Decision：

```text
REMOVED
```

Reason：

Chapter 15 later formalized Membership Status.

Status：

```text
RESOLVED
```

---

## Conflict 03 — MatchOffer vs Offer

Decision：

```text
Offer
```

Status：

```text
RESOLVED
```

---

## Conflict 04 — TrustedRelationship includes BLOCKED / DO_NOT_MATCH

Decision：

```text
TrustedRelationship
= positive repeat relationship

MatchExclusionPreference
= Do Not Match Again

SafetyBlockRelation
= Safety Block
```

Status：

```text
RESOLVED
```

---

## Conflict 05 — Content / Video / Live Chapter

Decision：

```text
Basic Content Sharing
```

supersedes：

```text
Content Sharing / Video / Live
```

Native Live：

```text
NOT MVP
```

Status：

```text
RESOLVED
```

---

## Conflict 06 — Business Role MVP Cut vs Full Role Set

Chapter 15 full role set：

```text
OWNER
ADMIN
TASK_MANAGER
OPERATIONS
BILLING
SAFETY_MANAGER
VIEWER
```

Chapter 20 suggests MVP UI may initially expose fewer roles.

Decision：

> Domain keeps full permission-capable architecture; MVP UI may expose a reduced preset set.

禁止退化为：

```text
if role == owner ...
```

Status：

```text
RESOLVED
```

---

## Conflict 07 — Task Funding Status vs FundingHold Status

Decision：

```text
Task.funding_status
= gate/read-model interface

FundingHold.status
= payment domain truth
```

不能把两套 enum 强行合成一个。

Status：

```text
RESOLVED
```

---

## Conflict 08 — Availability OFFERED / MATCHED

Decision：

这些状态不能拥有 Offer / Order 交易真相。

Canonical semantics：

```text
Availability OFFERED / MATCHED
= supply state / derived capacity expression
```

Status：

```text
RESOLVED WITH SEMANTIC CONSTRAINT
```

---

# 34. Open Canonical Questions

以下内容当前文档还没有足够依据最终锁定，进入后续章节。

## OPEN-01 UserAccount Lifecycle Enum — RESOLVED IN CHAPTER 24

Chapter 01 明确存在：

```text
account_status
```

但当前没有完整最终 enum。

已由 Chapter 24 锁定为：

```text
PROVISIONAL
ACTIVE
RESTRICTED
SUSPENDED
CLOSING
CLOSED
```

`BANNED` 不属于 UserAccount lifecycle；永久或范围性封禁由 Risk / Restriction Object 表达。

---

## OPEN-02 Exact P0 Policy Values

Chapter 23 已定义首发默认 PolicySet：

```text
PSET_LAUNCH_V1
```

状态：

```text
DEFAULTS_DEFINED
MARKET_OVERRIDE_REQUIRED
```

例如：

```text
Offer TTL
Wave Size
Candidate Count
Auto-confirm Window
Dispute Window
No-show Grace
Cancellation Ratio
Location TTL
```

默认值进入：

```text
Chapter 23 Policy Defaults
```

具体 Market 的 currency、earnings floor、fee、tax、payout threshold、法律 / KYC 覆盖仍必须在 Launch approval 中补齐。

---

## OPEN-03 Launch Graph Seed Data

具体：

```text
Industry
Scenario
Role
Capability
Evidence
Verification
```

进入：

```text
Chapter 22 Launch Catalog
```

---

## OPEN-04 Complete Command / Event Catalog — RESOLVED IN CHAPTER 26

Chapter 25 已定义行为验收；Chapter 26 已锁定 P0 Command、Domain Event、Error、Idempotency、Outbox 和 Consumer Contract 的语义。

```text
Engineering API / Event / Schema Contract
```

---

## OPEN-05 Authentication / Session / Deletion / Consent Lifecycle — RESOLVED IN CHAPTER 24

已由以下 Chapter 24 对象和流程锁定：

```text
Session
ConsentRecord
PermissionGrant
KYCProfile / KYCDocument
RetentionPolicy / LegalHold
DeletionRequest / DataExport
AccountRecovery
```

---

## OPEN-06 Provider-specific State Mapping — RESOLVED IN CHAPTER 27

Chapter 27 已锁定 Payment、KYC、Geo、Media、Notification 的：

```text
Adapter boundary
normalized state
callback authentication
webhook dedupe
retryability
reconciliation
failover / cutover
market-specific connection
```

Provider-specific credential、实际供应商、市场合同和生产连接信息进入 Launch approval / Secret Manager，不写入 Domain truth。

```text
Provider Integration Contract
```

---

# 35. MVP Canonical Object Set

如果开发今天开始建 Domain，P0 第一阶段至少认以下对象：

```text
Identity
--------
UserAccount
AgentProfile
BusinessAccount
BusinessMembership
RequesterTrustProfile

Account Security / Privacy
--------------------------
LoginIdentity
Session
Device
AccountRecovery
ConsentRecord
PermissionGrant
KYCProfile
IdentityVerificationAttempt
KYCDocument
RetentionPolicy
LegalHold
DeletionRequest
ExportRequest
OperatorAccessGrant

Graph
-----
GraphNode
GraphEdge
GraphPolicy
AgentRole

Demand
------
Task
SlotGroup
TaskSlot
TaskNeedProfile

Supply / Match
--------------
AvailabilitySession
MatchAttempt
Offer

Transaction
-----------
Order
CompensationTerms

Payment
-------
PaymentIntent
FundingHold
PaymentLedgerEntry
AgentEarningsLedger
FeeLedger
Refund
Payout
Settlement
DisputeHold

Execution
---------
ExecutionContext
OrderChat
TemporaryContactGrant
Evidence
ExecutionException

Trust
-----
Review
OutcomeRecord
TrustedRelationship
MatchExclusionPreference
SafetyBlockRelation

Safety
------
RiskSignal
RiskDecision
Incident
RiskHold
Appeal

Notification
------------
NotificationEvent
InboxItem
NotificationDelivery

Business
--------
Store
Venue
BusinessTaskTemplate
BusinessAuditLog

Location
--------
LocationReference
GeoZone
LocationVisibilityGrant

Operations
----------
OperatorCase
GraphGap
ManualAdjustmentRequest
OperatorAuditLog

Provider / Launch
-----------------
ProviderConnection
ProviderCapability
ProviderWebhookEndpoint
ReconciliationCase
MarketLaunchProfile
MarketKYCRequirement
RetentionOverride
PilotCohort
PilotRunbook
LaunchDecision
LaunchIncident
GuardrailCase
PostPilotReview
ConfigChange

Scale Governance
----------------
ScaleDecision
ScaleReadinessProfile
SLOProfile
ErrorBudget
ChangeRequest
ExperimentApproval
CapacityProfile
MarketExpansionReview
ReadinessSnapshot
GovernanceReview
DecommissionPlan

Scale Architecture
------------------
Region
MarketCell
DataResidencyZone
TrafficRoute
RegionOwnershipBinding
DRProfile
CostAllocationProfile
FinOpsBudget
RegionExpansionReview
RegionMigrationPlan

Enterprise / B2B
---------------
EnterpriseOrganization
EnterpriseBusinessRelationship
EnterpriseMembership
EnterpriseContract
EnterpriseSLAProfile
PurchaseOrder
BusinessApprovalPolicy
BudgetReservation
BillingAccount
Invoice
EnterpriseSecurityProfile
EnterpriseAuditLog
SupportEntitlement
EnterpriseOnboardingProfile
EnterpriseExitPlan

Enterprise Integration
----------------------
EnterpriseApiClient
EnterpriseIntegrationOperation
EnterpriseWebhookEndpoint
EnterpriseSSOProfile
EnterpriseSCIMProfile
EnterpriseExportRequest
RateLimitProfile
IntegrationIncident

Enterprise Lifecycle
--------------------
MigrationProgram
MigrationSource
MappingProfile
MigrationBatch
MigrationRecord
CutoverDecision
IdentityMatchDecision
ReconciliationResult
AdoptionPlan
TrainingPlan
EnterpriseHealthScorecard
ContractRenewalReview

Enterprise Compliance
---------------------
ComplianceProgram
ComplianceFramework
ComplianceScope
ControlDefinition
ControlImplementation
ComplianceEvidence
EvidenceCollection
ComplianceReview
ControlAssessment
ComplianceFinding
ComplianceException
RemediationPlan
ComplianceAttestation
TrustCenterProfile
TrustCenterArtifact
AuditRequest
AuditResponsePackage
ExternalAssuranceReport
ComplianceSignal

Multi-Market Finance
--------------------
LegalEntity
LegalEntityAssignment
MarketEntityProfile
MarketTaxProfile
TaxRegistration
TaxRuleSet
TaxDetermination
TaxLine
CurrencyProfile
FXRateSet
FXRateQuote
MoneyConversion
PaymentRailProfile
SettlementAccount
InvoiceGenerationRun
InvoiceAdjustment
CreditNote
SettlementInstruction
SettlementBatch
SettlementRecord
SettlementDisputeCase
FinancialClose
TaxFilingPeriod
RemittanceRecord

Cross-Market Reporting & Treasury
---------------------------------
ReportingScope
ReportingPeriod
ChartOfAccountsProfile
ReportingMapping
ReportSourceSnapshot
ReportRun
FinancialReport
ConsolidationGroup
ConsolidationRun
IntercompanyElimination
FXTranslationRun
ReportPublication
ReportRestatement
TreasuryPosition
CashAccountPosition
LiquidityForecast
TreasuryMovement
ReservePolicy
TreasuryRiskExposure
RevenueRecognitionPolicy
RevenueContract
PerformanceObligation
RevenueAssessment
RevenueSchedule
RecognitionProposal
CostAllocationRun
CostAllocationResult
ManagementReport
FinancialMetricDefinition

Governance & Internal Audit
---------------------------
RiskAppetiteStatement
RiskTaxonomy
RiskCategory
RiskLimit
RiskIndicator
RiskMeasurement
RiskAssessment
RiskAcceptance
RiskEvent
ControlHealthSnapshot
InternalAuditPlan
InternalAuditEngagement
AuditProcedure
AuditWorkpaper
AuditObservation
AuditReport
ManagementActionPlan
AccountabilityAssignment
BoardEscalation
BoardCommittee
BoardMeeting
BoardPack
BoardDecision

Regulatory Change & Policy Migration
------------------------------------
PolicySetVersion
PolicyDefinition
PolicySnapshot
RegulatoryChangeNotice
RegulatoryRequirement
LegalInterpretation
ObligationMapping
ChangeImpactAssessment
ChangeMaterialityDecision
PolicyChangeProposal
PolicyImpactAssessment
PolicyMapping
PolicyMigrationPlan
PolicyMigrationBatch
EffectivePolicyBinding
PolicyCompatibilityWindow
PolicyDeprecationRecord
MarketReapprovalReview
ChangeCommunicationPlan
TrainingMigrationPlan
ChangeReadinessSnapshot
CloseoutDecision

Decision Data & AI Governance
----------------------------
DataAsset
DataUseApproval
Dataset
DatasetSnapshot
DatasetSplit
LabelDefinition
DataQualityProfile
DataLineage
DataSubjectRestriction
FeatureDefinition
FeatureSnapshot
ModelRegistryEntry
ModelVersion
ModelIntendedUse
ModelDependency
ModelRelease
PromptTemplate
RetrievalProfile
TrainingRun
ModelEvaluation
ModelRiskAssessment
FailureModeRecord
BiasAssessment
DriftMonitor
ModelIncident
ModelMonitoringProfile
VendorModelProfile

AI-assisted Operations & Delegated Action
-----------------------------------------
AIOperatorProfile
WorkflowDefinition
WorkflowVersion
WorkflowContext
WorkflowRun
WorkflowStep
ToolDefinition
ToolPermission
ToolInvocation
DelegationGrant
ApprovalRequest
ApprovalChain
ActionSandbox
DelegatedAction
ActionReceipt
HumanHandoff
AutomationBudget
AutomationRateLimit
AgentIncident
AgentEvaluation

Policy Runtime & Explainability
-------------------------------
PolicyCodePackage
PolicyRule
PolicyExpression
PolicyInputSchema
PolicyOutputSchema
PolicyEvaluationContext
PolicyEvaluationRun
PolicyDecision
DecisionTrace
DecisionExplanation
GuardrailEvaluation
CommandProposal
PolicySimulation
PolicyReplay
PolicyTestCase
PolicyTestRun
HumanOverrideRequest
DecisionReview
RuntimeDecisionCacheEntry
DecisionObservation
```

---

# 36. MVP Canonical Mainline

```text
User / Business Principal
↓
Create Task Draft
↓
Resolve Graph
↓
Create Atomic Slots
↓
Validate / Admission
↓
Commit + Funding Authorization
↓
Open Slots
↓
Resolve Qualified Supply
↓
Organic Ranking
↓
Optional Sponsored Adjustment
↓
Candidate / Offer
↓
Agent Accept
↓
Final Recheck
↓
Atomic Slot Lock
↓
Funding Secured
↓
Order Created
↓
Execution
↓
Evidence
↓
Completion
↓
Settlement
↓
Outcome
↓
Review / Trusted / Repeat
```

---

# 37. What Engineering Must NOT Infer

开发不得自行推断：

```text
Task COMPLETED means all slots perfect
Agent KYC means capability verified
Trusted means always eligible
Offer ACCEPTED means Order always exists
PaymentIntent CAPTURED means settlement complete
Review means reliability truth
Location shown in UI means permission exists
Business employee created Task means employee owns Task
Operator screen has a button means DB patch is allowed
```

这些全部有独立 Domain 语义。

---

# 38. Registry Change Process

以后如果要改 Canonical：

必须写：

```text
Change ID
Old Definition
New Definition
Reason
Affected Objects
Migration Impact
Effective Version
```

例如：

```text
CANON-CHANGE-001
```

不能只在某个新 Chapter 偷偷换一个 enum。

---

# 39. Next Work After This Registry

本 Registry、Chapter 21 页面规格、Chapter 22 Launch Catalog、Chapter 23 Policy Defaults、Chapter 24 Account Security / Privacy / Consent / Data Lifecycle、Chapter 25 E2E Acceptance / Test Matrix / Invariant Gate、Chapter 26 Engineering API / Event / Schema Contract、Chapter 27 Provider Integration / Market Launch Readiness、Chapter 28 Pilot Runbook / Launch Operations / Incident Drill、Chapter 29 Post-Pilot Scale / Governance / Continuous Readiness、Chapter 30 Scale Architecture / Capacity / FinOps / Multi-Region Readiness、Chapter 31 Enterprise / B2B Scale / Contract Governance、Chapter 32 Enterprise API / SSO / SCIM / Integration Contract、Chapter 33 Enterprise Migration / Adoption / Renewal Governance、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance、Chapter 35 Multi-Market Legal Entity / Tax / Currency / Settlement Governance、Chapter 36 Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance、Chapter 37 Financial Controls / Internal Audit / Risk Appetite / Board Governance、Chapter 38 Regulatory Change / Policy Migration / Market Re-Approval Governance、Chapter 39 Policy-as-Code / Runtime Decision / Explainability Governance、Chapter 40 Decision Data / Model Risk / AI Governance 及 Chapter 41 AI-assisted Operations / Agentic Workflow / Delegated Action Governance 完成后，停止新增横向核心 PRD，进入 implementation handoff：

```text
Implementation Handoff / Contract Tests / Provider Certification / Pilot Readiness
```

页面设计只能引用本 Registry 的：

```text
Object
State
Permission
Invariant
```

如果页面需要 Registry 不存在的新交易概念：

> 先回 Registry 评审，不允许 UI 自己发明 Domain。

---

# 40. Final Lock

从 v1.1 Canonical Registry 起：

> **Proxy 已从“很多设计文档”进入“一个 Domain Truth + 多个专题解释”的阶段。**

后续工作重点不再是继续增加抽象架构，而是：

```text
Canonical Truth
→ P0 Screens / Page Contract
→ Launch Catalog / Scenario Templates
→ Concrete Policy Values / PolicySet Snapshot
→ Account Security / Privacy / Consent / Data Lifecycle
→ E2E Acceptance / Test Matrix / Invariant Gate
→ Engineering API / Event / Schema Contract
→ Provider Integration Contract / Market Launch Readiness
→ Pilot Runbook / Launch Operations / Incident Drill
→ Post-Pilot Scale / Governance / Continuous Readiness
→ Scale Architecture / Capacity / FinOps / Multi-Region Readiness
→ Enterprise / B2B Scale / Contract Governance
→ Enterprise API / SSO / SCIM / Integration Contract
→ Enterprise Migration / Adoption / Renewal Governance
→ Enterprise Compliance / Audit / Trust Center Governance
→ Multi-Market Legal Entity / Tax / Currency / Settlement Governance
→ Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance
→ Financial Controls / Internal Audit / Risk Appetite / Board Governance
→ Regulatory Change / Policy Migration / Market Re-Approval Governance
→ Policy-as-Code / Runtime Decision / Explainability Governance
→ Decision Data / Model Risk / AI Governance
→ AI-assisted Operations / Agentic Workflow / Delegated Action Governance
→ Implementation Handoff / Contract Tests / Provider Certification / Pilot Readiness
→ Pilot
```
