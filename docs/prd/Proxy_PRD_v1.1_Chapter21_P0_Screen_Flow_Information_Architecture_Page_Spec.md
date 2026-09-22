# Proxy PRD v1.1
## Chapter 21 — P0 Screen Flow / Information Architecture / Page-level Product Spec

**文档类型**：页面级产品规格 / Information Architecture / Surface Contract  
**状态**：ACTIVE — P0 App-first Screen Contract v1.1  
**前置依赖**：Canonical Registry、Chapter 01–20  
**后续依赖**：Chapter 22 Launch Catalog、Chapter 23 Policy Defaults、Engineering API / Event Contract  

---

# 0. 本章目标

Chapter 20 已经锁定 MVP 的业务边界，但“有哪些页面、每页显示什么、谁能看到、点完以后进入什么状态”仍不够具体。

本章把抽象架构转换为页面级产品契约：

```text
Surface
→ Route
→ Page Purpose
→ Read Model
→ Allowed Fields
→ CTA / Domain Command
→ State Variants
→ Permission
→ Deep Link
→ Next State
→ API Dependency
```

本章解决：

- Requester、Agent、Business、Operator 四类 Surface 的 P0 信息架构
- iOS / Android App 的首发范围，以及仅供内部人员使用的 Operator Console 边界
- 页面、对象和状态之间的映射
- 页面级权限和隐私边界
- 首发主链所需的 Loading / Empty / Error / Stale / Restricted 状态
- 页面操作与 Canonical Domain Command 的对应关系
- 页面级验收标准

本章不解决：

- 视觉设计稿、颜色、字体和品牌动效
- 最终 API URL、JSON 字段类型和数据库 schema
- Chapter 23 之前尚未锁定的 policy 数值
- Chapter 22 之前尚未锁定的 launch role / scenario catalog
- AI 代理自主执行或替 Agent 做决定

---

# 1. 规范性语言

本章使用以下词义：

| 词语 | 含义 |
|---|---|
| MUST | P0 必须满足，不能由实现自行删减 |
| MUST NOT | 产品红线，不能通过 UI 或运营开关绕过 |
| SHOULD | P0 推荐，若延后必须记录原因 |
| MAY | 可选实现，不构成 MVP 阻塞 |
| P0 | 首发真实 Human Execution 闭环必需 |
| P0-LITE | 首发需要，但功能深度受限 |
| P0.5 | 首发后很快补齐，不阻塞核心交易主链 |
| P1 | 验证核心闭环后再做 |

页面中的 `API_DEPENDENCY` 是逻辑依赖，不是最终 endpoint 命名。Engineering Contract 必须将其映射为正式 Query / Command / Event，并遵守 Canonical Registry 的命令和事件规则。

---

# 2. 页面级硬规则

## 2.1 Task First

所有陌生 Agent 的展示必须从合法 Task Context 进入：

```text
Valid Task
→ Requirement Resolution
→ Eligibility
→ Finite Candidate Set
→ Candidate Detail
```

禁止从任何 P0 页面进入：

```text
Generic People Search
Nearby People
Online Agents Map
Public Human Leaderboard
Infinite Agent Feed
```

## 2.2 页面不是状态真相

页面只能展示 Read Model，不能自行推导或写入业务真相。

```text
UI action
→ Domain Command
→ Domain Event
→ Read Model refresh
→ next screen state
```

禁止：

```text
按钮点击
→ 前端直接把 status 改成下一状态
```

## 2.3 交易对象必须分离

页面层也必须保持：

```text
Task ≠ TaskSlot ≠ Offer ≠ Order
```

尤其禁止：

- 用 `Order` 页面表达还未接单的 `Offer`
- 用 `Task` 一个 status 覆盖所有 `TaskSlot` 的履约状态
- 用 `TaskSlot.quantity` 代替多个原子 `TaskSlot`
- 用聊天消息隐式修改 Task、Venue、Compensation 或时间

## 2.4 Eligibility 先于 Ranking

Candidate Detail、Supply Preview、Matching 页面都必须区分：

```text
Qualified / Not Qualified
```

Boost、Repeat、Popularity 和未来 AI 只能影响合格候选人的曝光或排序，不能把不合格的人显示为可接单候选人。

## 2.5 Funding Before Paid Order

Requester 付费任务的页面主链必须满足：

```text
Agent Accept
→ Eligibility Recheck
→ Slot Lock
→ Funding Secured
→ Order Created
```

如果 Funding 未 secured：

```text
不得显示 Order Created 成功
不得给 Agent 发送“已确认履约”
不得把 TaskSlot 置为 ASSIGNED
```

## 2.6 隐私最小化

字段暴露遵循：

```text
Purpose
∩ Viewer Permission
∩ Agent Visibility Policy
∩ Task Relevance
− Risk Restriction
= Fields Exposed
```

前端隐藏不是权限控制。后端 Read Model 必须已经裁剪字段。

---

# 3. Surface 定义

## 3.1 Requester Surface

服务于创建需求、查看供给、选择或等待匹配、管理 Task / Order、完成确认和复购。

Requester 的 `principal_type` 可以是：

```text
INDIVIDUAL
BUSINESS
```

Business 员工以 Business Membership 获得 Business Surface；不能因为创建了一个 Task 就自动获得 Business 所有权。

## 3.2 Agent Surface

服务于真人供给身份、Capability Passport、Availability、Offer、Order 执行、Evidence 和 Earnings。

Agent 必须是真人 `AgentProfile`，与登录主体 `UserAccount` 分离。

## 3.3 Business Surface

服务于 BusinessAccount 的多人协作、多门店 / Venue、任务模板、预算、成员权限、Trusted Team 与批量执行。

Business Surface 的所有数据查询都必须检查：

```text
BusinessMembership.status = ACTIVE
∩ effective permission
∩ business scope
```

## 3.4 Operator Surface

服务于受控运营、异常处理、撮合辅助、支付 / 争议、安全事件和审计。

Operator 是 Controlled Fallback：

- 可以 Review、Assist、Resolve、Approve
- MUST NOT 直接修改数据库
- MUST NOT 直接改变余额或账本
- MUST NOT 替 Agent 接单
- MUST NOT 手工伪造 Evidence
- 所有高影响写操作必须进入 Domain Command 和 OperatorAuditLog

---

# 4. P0 App / Internal Console 范围

## 4.1 首发设备策略

| Surface | iOS / Android App P0 | Public Web | Internal Console | 说明 |
|---|---:|---:|---:|---|
| Requester | 是 | 否 | 否 | 创建、匹配、Task / Order 管理与现场执行全部进入 App |
| Agent | 是 | 否 | 否 | Passport、Availability、Offer、Check-in、Location、Evidence、Earnings 全部进入 App |
| Business | 是 | 否 | 否 | Workspace、Multi-slot、Members、Spend、Templates 进入同一个 App 的 Business Principal Context |
| Operator | 否 | 否 | 是 | 仅内部桌面控制台；不属于公开产品 Web Surface，不开放移动端高影响运营操作 |
| Shared Inbox | 是 | 否 | Operator Case 另行展示 | App 只保留 Order-bound / Business-context 会话 |

公开产品是 App 项目，不建设 Requester、Agent 或 Business 浏览器版，不以 responsive website、SEO、匿名 Web 页面或 PWA 作为 P0 交付物。Operator Console 是受限内部运营工具，不能被视为公开 Web 产品。

## 4.2 P0 不做的设备能力

- Native Live
- 复杂 3D 地图或持续后台轨迹
- 需要设备常驻的 Agent 自动接单
- Operator 移动端资金批准
- 以内容 Feed 为主的首页
- Requester / Agent / Business 的公开 Web、PWA 或浏览器响应式版本

## 4.3 App 约束

App 必须优先保障：

```text
当前 Task / 当前 Order / 当前下一步
```

不要把关键 CTA 放入必须横向滚动的表格或深层二级菜单。

Business 的聚合、批量和对照能力必须使用 App 适配的列表、分步操作、bottom sheet 或 drill-down，不得以“只能在 Web 使用”为前提。内部 Operator Console 可以使用桌面宽屏信息密度，但不能增加绕过 Domain 校验的操作路径。

---

# 5. 全局信息架构

## 5.1 Shared Shell

所有已登录页面共享：

```text
Account Context
Active Principal Context
Notification Inbox Entry
Help / Safety Entry
Session State
```

顶部或导航栏必须明确当前身份上下文：

```text
Requester: Individual / Business
Agent: AgentProfile active status
Business: BusinessAccount + Store / Venue scope
Operator: Operator team + permission scope
```

不能让用户在不知情的情况下从 Individual 切换到 Business 付款主体。

## 5.2 Requester IA

```text
Requester Home
├── Create Task
│   ├── Task Basics
│   ├── Role / Slot Quantity
│   ├── Time / Location
│   ├── Requirements / Deliverable
│   ├── Budget / Payment
│   └── Task Review
├── My Tasks
│   ├── Draft
│   ├── Matching
│   ├── Active
│   ├── Completion Pending
│   └── History
├── Candidate / Supply Context
│   ├── Supply Preview
│   ├── Matching
│   └── Candidate Detail
├── Inbox
├── Trusted / Repeat
└── Profile / Settings
```

## 5.3 Agent IA

```text
Agent Home
├── Become a Proxy / Passport
│   ├── Identity
│   ├── Role / Capability
│   ├── Verification
│   └── Visibility
├── Availability
│   ├── Available Now
│   └── Schedule
├── Offers
├── Upcoming Orders
├── Current Execution
│   ├── Arrival / Check-in
│   ├── Order Chat
│   ├── Evidence
│   └── Exception / Safety
├── Earnings
├── Trusted / Repeat
├── Inbox
└── Settings
```

## 5.4 Business IA

```text
Workspace Home
├── Create Task
├── Tasks
│   ├── Draft
│   ├── Matching
│   ├── Multi-slot Execution
│   └── History
├── Templates
├── Trusted Team
├── Stores / Venues
├── Spend / Payments
├── Members / Permissions
└── Inbox
```

## 5.5 Operator IA

```text
Case Queue
├── Case Detail / Timeline
├── Task Review
├── Match Assist
├── Payment / Dispute
├── Safety / Risk
└── Audit
```

Operator 首页不是业务 Dashboard 的替代品。它以待处理 Case 和风险队列为主。

---

# 6. 全局页面状态模型

## 6.1 UI 状态

每个 P0 页面至少定义以下状态：

```text
LOADING
READY
EMPTY
ERROR_RETRYABLE
ERROR_BLOCKED
STALE_REQUIRES_REFRESH
REAUTH_REQUIRED
FORBIDDEN
NOT_FOUND_OR_REDACTED
```

这些是页面呈现状态，不得替代 Domain Lifecycle。

## 6.2 Loading

Loading 页面必须：

- 保留页面标题和上下文
- 对主要内容使用结构化 Skeleton
- 不显示尚未确认的价格、候选人、Order 或余额
- 防止同一 Domain Command 被重复提交

## 6.3 Empty

Empty 必须说明：

```text
当前没有什么
为什么没有
用户能做什么
```

例如：

- 没有候选人：展示任务要求或地点导致供给不足，提供修改 Task / 联系 Operator 的路径
- 没有 Offer：说明当前没有符合资格的机会，而不是显示“系统故障”
- 没有 Earnings：显示尚未产生可结算收入，不显示 0 元余额作为唯一解释

## 6.4 Error

所有错误至少包含：

```text
human-readable reason
retry / back action
support or case path when high impact
```

错误展示必须使用统一 Error Taxonomy；页面不能把 Funding Failure、Eligibility Failure、Permission Failure 都显示为“网络错误”。

## 6.5 Stale

以下对象需要版本或时间校验：

```text
Task
TaskSlot
Offer
Order
PaymentIntent
BusinessMembership
```

当页面中的版本已过期：

1. 禁止提交旧版本写操作
2. 刷新对应 Read Model
3. 告知用户发生了什么变化
4. 如果需要重新确认，回到对应 Review 页面

---

# 7. 全局权限与字段暴露

## 7.1 页面权限层级

页面访问按以下顺序判断：

```text
Authenticated UserAccount
→ Active Principal
→ Role / Membership
→ Object Ownership / Order Context
→ Action Permission
→ Risk / Policy Gate
```

## 7.2 数据分类与页面默认字段

| 数据级别 | 默认可出现的页面 | 示例 | 约束 |
|---|---|---|---|
| D0 | 首页、任务创建、供给聚合 | Scenario、Venue 名称、概略价格 | 可公开或广泛展示 |
| D1 | Supply Preview、Candidate Detail、Offer | Nickname、相关 Capability、Approx Distance | 必须有合法 Task Context |
| D2 | Candidate Detail、Agent Passport、Trusted | Portfolio、Professional Proof | 按 Visibility Policy 裁剪 |
| D3 | Task / Order / Business Workspace / Inbox | Chat、Venue Detail、Arrival Information | 必须有匹配、Order 或 Business scope |
| D4 | Execution、Safety、Operator Case | Precise Location、Live Location、Emergency Contact | Valid Order + purpose + TTL + audit |
| D5 | KYC、Payout、Operator 受限区域 | Government ID、Bank、OAuth Token | 不进入 Candidate API 或普通 Business API |

## 7.3 Agent 字段暴露

Candidate Detail P0 默认只展示：

```text
Agent nickname
Relevant role / capability
Verification relevant to task
Availability fit
Approx distance or travel feasibility
Task-relevant proof
Reliability summary when policy allows
```

默认不展示：

```text
legal full name
government ID
bank / payout account
precise home location
live location before valid Order
private contact
unrelated social account token
```

---

# 8. Route / Deep Link 规则

## 8.1 Route 命名

路由使用资源语义，不使用页面内部状态作为主路由：

```text
/requester/tasks/{task_id}
/requester/tasks/{task_id}/matching
/requester/orders/{order_id}
/agent/offers/{offer_id}
/agent/orders/{order_id}/execution
/business/{business_id}/tasks/{task_id}
/operator/cases/{case_id}
```

禁止：

```text
/status/assigned
/page/complete
/people/nearby
```

## 8.2 Deep Link 安全

打开 Deep Link 时必须重新检查：

- 当前 Session 是否有效
- 当前 Principal 是否正确
- 当前用户是否仍有 Object / Business scope
- Object 是否已被删除、关闭或隐私裁剪
- 页面动作是否仍符合当前版本和 Policy

Deep Link 只提供导航便利，不能成为权限旁路。

## 8.3 Deep Link 过期

以下链接必须带短期 token 或通过 Order Context 重新授权：

```text
precise meeting point
live location
emergency contact
one-time evidence upload
payment provider return
KYC provider return
```

Order 关闭后，执行相关 Deep Link 必须失效或显示已撤销。

---

# 9. Shared P0 页面

## S-01 — Inbox

| 项目 | 规格 |
|---|---|
| PURPOSE | 汇总与当前用户有合法上下文关系的 NotificationEvent 和 Order-bound conversation |
| ENTRY | Shared Shell、Push、Email / SMS fallback、Task / Order 页面 |
| FIELDS | unread count、priority、title、object reference、created_at、read status、action label |
| READ MODEL | `NotificationInboxReadModel`，按 principal 和权限裁剪 |
| PRIMARY CTA | 打开关联 Task / Offer / Order / Case |
| SECONDARY CTA | 标记已读、批量已读；不得删除审计所需的通知事实 |
| STATES | Loading、Empty、Error、Notification expired、Object no longer accessible |
| PERMISSION | 登录用户只能查看自己的 Inbox；Business 仅查看业务范围内通知；Operator 按 team scope |
| DEEP LINK | `/inbox/{notification_id}`，打开后再次检查权限与对象状态 |
| NEXT STATE | 进入关联页面或显示已失效说明 |
| API_DEPENDENCY | `GetInbox`、`MarkNotificationRead`、`NotificationEvent` |
| AI_EXTENSION_POINT | 未来可总结通知，但不得替用户确认 Offer、支付或安全动作 |

## S-02 — Profile / Settings

| 项目 | 规格 |
|---|---|
| PURPOSE | 管理 UserAccount 安全、通知偏好、隐私与身份入口 |
| ENTRY | Shared Shell、登录后首次进入、Restricted / Reauth 导航 |
| FIELDS | display name、phone / email masked、session devices、notification preference、consent status、Agent / Business entry |
| READ MODEL | `AccountSecurityReadModel`、`ConsentReadModel` |
| PRIMARY CTA | 管理登录安全或进入 Agent / Business 设置 |
| SECONDARY CTA | Logout current device、Logout all devices、Export request、Delete account request |
| STATES | Loading、Unauthenticated、Reauth required、Deletion pending、Restricted |
| PERMISSION | 仅本人；Operator 不在普通页面查看 D5 |
| DEEP LINK | `/settings`、`/settings/security`、`/settings/privacy` |
| NEXT STATE | `SessionRevoked`、`ConsentRecorded` 或进入受控 Account Lifecycle 流程 |
| API_DEPENDENCY | `GetAccountSecurity`、`UpdateNotificationPreference`、`RevokeSession`、`RecordConsent` |
| AI_EXTENSION_POINT | 未来解释隐私设置，不得替用户授予敏感权限 |

## S-03 — Help / Safety Entry

| 项目 | 规格 |
|---|---|
| PURPOSE | 在任何合法上下文中提供帮助、举报和安全停止入口 |
| ENTRY | Shared Shell、Order Detail、Execution、Case |
| FIELDS | current object context、emergency instruction、report categories、support status、available contact path |
| READ MODEL | `SafetyContextReadModel`、`OperatorCaseReadModel` |
| PRIMARY CTA | Safety Stop / Report Incident（按场景显示） |
| SECONDARY CTA | Help article、Contact support、查看已有 Case |
| STATES | Context unavailable、Safety action submitted、Duplicate report、Operator unavailable |
| PERMISSION | 当前用户只能为自己有权访问的 Task / Order 报告；高危任务可触发更高优先级 |
| DEEP LINK | `/safety/report?order_id=...`，必须重新验证 Order Context |
| NEXT STATE | `IncidentOpened`、Order safety hold 或 OperatorCase `OPEN` |
| API_DEPENDENCY | `OpenIncident`、`SafetyStopOrder`、`GetSafetyContext` |
| AI_EXTENSION_POINT | 未来做分类和摘要，不得自动判定责任或关闭安全 Case |

---

# 10. Requester Surface 页面规格

## R-01 — Requester Home

| 项目 | 规格 |
|---|---|
| PURPOSE | 让 Requester 快速创建新 Task，继续处理现有 Task，查看需要行动的 Order |
| ENTRY | 登录后默认入口、Requester Shell、完成 Task 后返回 |
| FIELDS | active principal、draft count、Task summary by lifecycle、action-required orders、recent trusted relations、launch scenario shortcut |
| READ MODEL | `RequesterHomeReadModel` |
| PRIMARY CTA | Create Task |
| SECONDARY CTA | Continue Draft、打开 Matching、打开 Completion Pending、Repeat previous task（如 policy 允许） |
| STATES | First-use empty、Active tasks、No supply / delayed match、Payment action required、Restricted requester |
| PERMISSION | Individual 仅个人；Business context 需有效 BusinessMembership 和对应权限 |
| DEEP LINK | `/requester/home` |
| NEXT STATE | Create Task、Task Detail、Matching、Payment 或 Repeat Flow |
| API_DEPENDENCY | `GetRequesterHome`、`GetActivePrincipal` |
| AI_EXTENSION_POINT | 未来可帮助整理需求草稿，但不能自动 CommitTask 或选择付款主体 |

## R-02 — Create Task / Task Basics

这是 Task Builder 的第一阶段，不在此页面直接产生正式 Task。

| 项目 | 规格 |
|---|---|
| PURPOSE | 选择 Industry、Scenario、Role，并建立一个可继续编辑的 Task Draft |
| ENTRY | Requester Home、Repeat、Business Template |
| FIELDS | principal、industry、scenario、role、slot quantity、task title、draft id、catalog version |
| READ MODEL | `LaunchCatalogReadModel`、`TaskDraftReadModel` |
| PRIMARY CTA | Continue to time / location |
| SECONDARY CTA | Save Draft、Back、Change principal |
| STATES | Catalog loading、No matching launch scenario、Role unavailable、Draft conflict、Draft saved |
| PERMISSION | 可创建 Task 的 Individual / Business requester；Business 需 `TASK_CREATE` |
| DEEP LINK | `/requester/tasks/new`、`/business/{business_id}/tasks/new` |
| NEXT STATE | Task Draft → Time / Location；无效选择保持 Draft，不进入 READY |
| API_DEPENDENCY | `GetLaunchCatalog`、`CreateTaskDraft`、`UpdateTaskDraftBasics` |
| AI_EXTENSION_POINT | 未来把自然语言转为候选字段草稿，必须逐项让用户确认 |

### R-02 业务规则

- `slot quantity` 生成多个独立 `TaskSlot`，不能只保存一个 quantity 作为履约对象。
- Role 只能来自当前 catalog / GraphPolicy 允许的 `AgentRole`。
- 创建 Draft 不代表 Task 已发布，不触发 Offer，不锁定资金。
- 更换 Scenario 或 Role 后，必须清理不再适用的 Requirements、Deliverable 和 Pricing defaults，并提示用户复核。

## R-03 — Create Task / Time & Location

| 项目 | 规格 |
|---|---|
| PURPOSE | 收集 Task 执行时间窗口、Venue 类型、地点和到达边界 |
| ENTRY | R-02、编辑已有 Draft |
| FIELDS | start / end、timezone、venue type、venue reference、approx location、meeting instruction、travel constraint、location visibility level |
| READ MODEL | `TaskDraftReadModel`、`VenueReadModel`、`LocationPolicyReadModel` |
| PRIMARY CTA | Continue to requirements |
| SECONDARY CTA | Save Draft、Use Business Store / Venue、Back |
| STATES | Geocoding pending、Location permission denied、Private address restricted、Time invalid、Travel feasibility unknown |
| PERMISSION | Task creator；D4 精确位置不得在尚未有合法 Order 的 Candidate API 中暴露 |
| DEEP LINK | `/requester/tasks/{task_id}/time-location` |
| NEXT STATE | Draft → Requirements；若地点 / 时间高风险，进入 Task Admission `REVIEW_REQUIRED` |
| API_DEPENDENCY | `UpdateTaskSchedule`、`ResolveVenue`、`EstimateTravelFeasibility`、`GetLocationPolicy` |
| AI_EXTENSION_POINT | 未来可从文字中提取地点和时间，但必须显示解析结果并要求确认 |

### R-03 业务规则

- Location 采集必须区分 Venue、Store 和精确 meeting point。
- 精确地址不是永久共享授权；只有 Valid Order + Purpose + TTL 才能访问 D4。
- 不允许用“信任关系”替代当前 Order 的 LocationVisibilityGrant。
- Schedule 与 timezone 必须在提交前明确，不能依赖设备本地时区猜测。

## R-04 — Create Task / Requirements & Deliverable

| 项目 | 规格 |
|---|---|
| PURPOSE | 定义 Must / Nice、Capability requirement、核心交付物和 Evidence 要求 |
| ENTRY | R-03、编辑 Draft |
| FIELDS | must requirements、nice requirements、language / role constraints、deliverable description、acceptance criteria、evidence policy preview、safety questions |
| READ MODEL | `GraphRequirementReadModel`、`EvidencePolicyReadModel`、`SafetyPolicyReadModel` |
| PRIMARY CTA | Continue to price / payment |
| SECONDARY CTA | Save Draft、Back、Remove optional requirement |
| STATES | Requirement unresolved、Unsupported capability、High-risk review、Evidence policy unavailable |
| PERMISSION | Task creator；Business 需 `TASK_CREATE`，高风险场景可能需要 `TASK_REVIEW` |
| DEEP LINK | `/requester/tasks/{task_id}/requirements` |
| NEXT STATE | Draft → Pricing / Payment；若 Admission 未通过则停留在 Review Required |
| API_DEPENDENCY | `ResolveRequirements`、`ValidateTaskAdmission`、`GetEvidencePolicy` |
| AI_EXTENSION_POINT | 未来可帮助补全结构化 Requirements，但不能降低 Must 条件或自动移除风险检查 |

## R-05 — Task Review / Pricing & Payment

| 项目 | 规格 |
|---|---|
| PURPOSE | 在 CommitTask 前展示完整 Task、Slot、价格、取消和资金保护规则 |
| ENTRY | R-04、Business Template、Repeat Flow |
| FIELDS | task summary、slot list、schedule、venue summary、must / nice、deliverable、quote、service fee、tax if applicable、funding timing、cancellation summary、refund summary、policy version |
| READ MODEL | `TaskReviewReadModel`、`QuoteReadModel`、`FundingPolicyReadModel` |
| PRIMARY CTA | Commit Task / Secure Funding（文案随 payment policy） |
| SECONDARY CTA | Edit section、Save Draft、Cancel |
| STATES | Quote expired、Funding method missing、Funding failed、Admission pending、Policy changed、Slot validation error |
| PERMISSION | Task creator；Business 需 `TASK_COMMIT` 与 `PAYMENT_CREATE`，必要时 `BUDGET_APPROVE` |
| DEEP LINK | `/requester/tasks/{task_id}/review` |
| NEXT STATE | 成功后 Task `COMMITTED`；进入 Supply Preview / Matching；失败保持 Draft 或进入 Funding action required |
| API_DEPENDENCY | `GetTaskReview`、`GetQuote`、`CommitTask`、`SecureFunding`、`PaymentIntent` |
| AI_EXTENSION_POINT | 未来解释报价组成和 policy，不得隐藏费用或代替付款确认 |

### R-05 硬规则

- 用户必须主动确认主要价格、Task 时间地点、核心 Deliverable 和取消摘要。
- `CommitTask` 的成功不能仅由前端 optimistic state 表示，必须等待服务端确认。
- 如果 Task 不需要付费，必须显式展示 `funding_status = NOT_REQUIRED`，不能用空白掩盖。
- 价格、补偿和政策进入 Task / Slot 的版本快照，不能只读取当前全局默认值。

## R-06 — Supply Preview

| 项目 | 规格 |
|---|---|
| PURPOSE | 在正式等待撮合前，展示当前 TaskSlot 的供给可行性和预计匹配情况 |
| ENTRY | R-05 成功、Task Detail、Create Task 中的 preview |
| FIELDS | slot count、filled / open summary、estimated match time、qualified supply band、price / availability guidance、constraints、last calculated at |
| READ MODEL | `SupplyPreviewReadModel`、`TaskFulfillmentReadModel` |
| PRIMARY CTA | Start Matching / Request Fast Match |
| SECONDARY CTA | Adjust Task、View policy explanation、Contact Operator when supported |
| STATES | No qualified supply、Partial supply、Preview stale、Matching already active、Task not committed |
| PERMISSION | Task creator / permitted Business member；不暴露完整 Qualified Pool |
| DEEP LINK | `/requester/tasks/{task_id}/supply-preview` |
| NEXT STATE | Matching pipeline；或回到 Task Review 修改条件 |
| API_DEPENDENCY | `GetSupplyPreview`、`GetTaskFulfillment`、`StartMatching` |
| AI_EXTENSION_POINT | 未来预测 ETA 或解释供需缺口，不能制造候选人或绕过 Eligibility |

### R-06 业务规则

- Preview 不是保证，也不是 Order。
- 展示 `qualified supply band` 时不得反推出具体 Agent 名单。
- 任何候选人列表都必须由 Finite Candidate Set 产生。

## R-07 — Matching

| 项目 | 规格 |
|---|---|
| PURPOSE | 展示 MatchAttempt、Invite / Offer 进度、每个 TaskSlot 的撮合状态 |
| ENTRY | R-06、Task Detail、Push、Deep Link |
| FIELDS | Task / Slot summary、MatchAttempt status、wave progress、candidate count、Offer / Invite status、TTL、next retry / deadline、filled slots、unfilled slots |
| READ MODEL | `MatchingReadModel`、`TaskSlotReadModel`、`OfferReadModel` |
| PRIMARY CTA | Review Candidate、Approve Invite、Extend / Adjust Task、Request Replacement（按状态） |
| SECONDARY CTA | Open Task Detail、Contact support、Cancel Task |
| STATES | Matching active、Partial fill、Full fill、Exhausted、Offer expired、Funding issue、Safety / Admission hold |
| PERMISSION | Task creator / Business permitted requester；Candidate Detail 仍受 Task Context 约束 |
| DEEP LINK | `/requester/tasks/{task_id}/matching`、`/requester/tasks/{task_id}/slots/{slot_id}/matching` |
| NEXT STATE | Offer / Invite accepted → Order；Exhausted → unfilled / operator rescue；full fill → upcoming execution |
| API_DEPENDENCY | `GetMatching`、`SendInvite`、`AcceptRequesterSelection`（如有）、`CancelMatchAttempt`、`RequestReplacement` |
| AI_EXTENSION_POINT | 未来可解释排序原因或建议调整条件，但不改变 Hard Eligibility |

### R-07 业务规则

- `Candidate / Invite / Offer` 全部不是 Order。
- 多 Slot 必须逐 Slot 展示，不能只显示“3 人已匹配”。
- 同一 Slot 并发操作时，页面必须处理 stale version / assignment lost。
- Requester 只能选择当前 Qualified Candidate Set 内允许的候选人。

## R-08 — Candidate Detail

| 项目 | 规格 |
|---|---|
| PURPOSE | 在合法 Task Context 中帮助 Requester 判断候选人的 Task-relevant fit |
| ENTRY | R-07 Candidate card、Requester curated match、Business Trusted Team recommendation |
| FIELDS | nickname、relevant role、relevant capabilities、verification relevant to task、availability fit、approx distance、task-relevant proof、reliability summary、response / completion summary when policy allows |
| READ MODEL | `CandidateDetailReadModel`，后端按 D1 / D2 裁剪 |
| PRIMARY CTA | Invite / Select Candidate（仅在当前 Task 与 policy 允许时） |
| SECONDARY CTA | Back to Candidate Set、Report concern、Do not match preference |
| STATES | Candidate qualified、Candidate no longer eligible、Candidate unavailable、Profile restricted、Profile redacted |
| PERMISSION | Requester 只能查看当前合法 Task Context 的 Candidate Detail；没有 Task 不得访问 |
| DEEP LINK | `/requester/tasks/{task_id}/candidates/{agent_id}` |
| NEXT STATE | Invite created / MatchAttempt updated；或返回列表 |
| API_DEPENDENCY | `GetCandidateDetail`、`CreateInvite`、`CreateMatchExclusionPreference` |
| AI_EXTENSION_POINT | 未来总结相关证明，不得生成未提供的履历或替用户判断安全风险 |

### R-08 禁止字段

```text
legal_full_name
government_id
bank_account
precise_home_location
live_location_before_valid_order
private_contact
unrelated_social_token
```

## R-09 — Task Detail

| 项目 | 规格 |
|---|---|
| PURPOSE | 作为 Requester 对整体现实目标的单一操作入口，聚合 Task、Slot、Order、资金和异常 |
| ENTRY | Home、My Tasks、Notification、Deep Link、完成创建后 |
| FIELDS | task lifecycle、outcome、funding interface status、fulfillment status、task summary、slot cards、order cards、next action、change history、policy snapshot reference |
| READ MODEL | `TaskDetailReadModel`、`TaskSlotReadModel`、`OrderSummaryReadModel` |
| PRIMARY CTA | 根据状态进入 Matching、Order、Completion 或 Payment |
| SECONDARY CTA | Edit permitted fields、Cancel Task、Open Inbox、Open Safety |
| STATES | Draft、Ready、Committed、Active、Completion Pending、Completed、Cancelled、Expired、Partial Success |
| PERMISSION | Task principal owner 或 Business permitted member；员工离开 Business 后按历史访问 policy 处理，不删除业务事实 |
| DEEP LINK | `/requester/tasks/{task_id}` |
| NEXT STATE | 由 Task / Slot / Order 状态决定，不由页面本地状态决定 |
| API_DEPENDENCY | `GetTaskDetail`、`GetTaskTimeline`、`UpdateTask`、`CancelTask` |
| AI_EXTENSION_POINT | 未来生成 Task 摘要或异常解释，不得隐藏未完成 Slot |

## R-10 — Order Detail

| 项目 | 规格 |
|---|---|
| PURPOSE | 展示一对一 Agent–TaskSlot 的正式履约关系 |
| ENTRY | Task Detail、Matching 成功、Inbox、Push、Repeat |
| FIELDS | order lifecycle、slot role、agent nickname、confirmed compensation、schedule、venue detail according to grant、check-in state、evidence state、payment state summary、safety entry、order chat entry |
| READ MODEL | `OrderDetailReadModel`、`ExecutionContextReadModel`、`PaymentSummaryReadModel` |
| PRIMARY CTA | View Execution / Check-in / Confirm Completion（随 Order 状态） |
| SECONDARY CTA | Order Chat、Cancel / Request Support、Open Safety、View receipt |
| STATES | Confirmed、En Route、Arrived、In Progress、Evidence Submitted、Completion Review、Completed、Closed、Cancelled |
| PERMISSION | Requester 与当前 Order 对方 Agent；Business 成员需 Business scope；D4 字段需有效 grant |
| DEEP LINK | `/requester/orders/{order_id}` |
| NEXT STATE | Execution、Completion、Dispute / Case、Closed |
| API_DEPENDENCY | `GetOrderDetail`、`GetExecutionContext`、`CancelOrder`、`OpenDispute` |
| AI_EXTENSION_POINT | 未来总结履约进度，不得代替 ConfirmCompletion 或 OpenDispute |

## R-11 — Requester Execution View

| 项目 | 规格 |
|---|---|
| PURPOSE | 让 Requester 实时了解当前 Order 是否到达、是否开始、是否有异常 |
| ENTRY | Order Detail、Upcoming、Push、Deep Link |
| FIELDS | Order status、agent nickname、arrival / check-in state、meeting point allowed by grant、task checklist、chat entry、evidence pending、exception banner、safety entry |
| READ MODEL | `ExecutionReadModel`、`LocationVisibilityGrantReadModel` |
| PRIMARY CTA | Confirm Arrival / Continue to Completion Review / Report Issue（按权限与状态） |
| SECONDARY CTA | Order Chat、View permitted route / meeting point、Safety Stop |
| STATES | Before arrival、En Route、Arrived、In Progress、Late / No-show suspected、Safety Hold、Location grant expired |
| PERMISSION | Valid Order participant / Business scope；D4 只在 purpose 和 TTL 内显示 |
| DEEP LINK | `/requester/orders/{order_id}/execution` |
| NEXT STATE | Order `IN_PROGRESS`、`COMPLETION_REVIEW`、Incident / OperatorCase |
| API_DEPENDENCY | `GetExecutionContext`、`GetLocationGrant`、`ConfirmCompletion`、`OpenIncident` |
| AI_EXTENSION_POINT | 未来提醒下一步，不得持续追踪或扩大 Location grant |

## R-12 — Completion & Review

| 项目 | 规格 |
|---|---|
| PURPOSE | 检查核心 Deliverable、查看 Evidence，并完成确认、问题申诉和 Review |
| ENTRY | Order Detail、Push、Requester Execution |
| FIELDS | deliverable checklist、submitted evidence summary、missing evidence warning、completion policy、auto-confirm deadline、review form、issue categories |
| READ MODEL | `CompletionReviewReadModel`、`EvidenceReadModel`、`AutoConfirmPolicyReadModel` |
| PRIMARY CTA | Confirm Completion |
| SECONDARY CTA | Request Correction、Open Dispute、Leave Review、Skip Review（如 policy 允许） |
| STATES | Awaiting evidence、Evidence submitted、Completion review、Auto-confirm pending、Completed、Disputed |
| PERMISSION | Requester / authorized Business member；Review 不应阻塞 Settlement，除非独立 Payment / Safety policy 明确要求 |
| DEEP LINK | `/requester/orders/{order_id}/completion` |
| NEXT STATE | `OrderCompleted` / independent dispute / review created / auto-confirmed |
| API_DEPENDENCY | `GetCompletionReview`、`ConfirmCompletion`、`RequestCorrection`、`OpenDispute`、`CreateReview` |
| AI_EXTENSION_POINT | 未来帮助归纳 Evidence，不得替用户确认完成或决定责任 |

## R-13 — Payment / Receipt

| 项目 | 规格 |
|---|---|
| PURPOSE | 展示 Requester 侧 PaymentIntent、FundingHold、refund / fee / receipt 摘要 |
| ENTRY | Task Review、Task Detail、Order Detail、Spend |
| FIELDS | amount、currency、line items、funding status、authorization / capture summary、refund status、receipt reference、policy snapshot、failure reason |
| READ MODEL | `RequesterPaymentReadModel`、`LedgerSummaryReadModel` |
| PRIMARY CTA | Add / Retry Funding、View Receipt、Request Support |
| SECONDARY CTA | View cancellation / refund details、Open Payment Case |
| STATES | Not required、Pending、Authorized、Secured、Failed、Released、Refunding、Refunded、Provider unavailable |
| PERMISSION | 付款主体本人或 Business `PAYMENT_VIEW`；Agent 不能看 Requester 的付款工具和账户敏感信息 |
| DEEP LINK | `/requester/tasks/{task_id}/payment`、`/requester/orders/{order_id}/receipt` |
| NEXT STATE | Funding secured → Matching / Order；refund resolved → Task / Case |
| API_DEPENDENCY | `GetPaymentSummary`、`CreateFundingIntent`、`RetryFunding`、`GetReceipt` |
| AI_EXTENSION_POINT | 未来解释账单，不得修改金额或自动批准退款 |

## R-14 — Repeat / Trusted

| 项目 | 规格 |
|---|---|
| PURPOSE | 在成功履约后发起重复需求或建立受政策约束的 TrustedRelationship |
| ENTRY | Completed Order、Task History、Requester Home |
| FIELDS | prior task summary、repeatable fields、agent / team relationship status、current eligibility reminder、new Task draft preview |
| READ MODEL | `RepeatRelationshipReadModel`、`TaskHistoryReadModel` |
| PRIMARY CTA | Repeat Task / Invite Trusted Agent |
| SECONDARY CTA | Edit schedule、Edit compensation、Do Not Match、Report concern |
| STATES | Eligible to repeat、Agent unavailable、Role / capability changed、Relationship blocked、Task needs re-qualification |
| PERMISSION | 原 Task / Order 合法参与者；Business 按 Business scope；Trusted 不绕过当前 Eligibility / Safety |
| DEEP LINK | `/requester/relationships/{relationship_id}`、`/requester/orders/{order_id}/repeat` |
| NEXT STATE | New Task Draft、Invite、或显示需重新匹配 |
| API_DEPENDENCY | `GetRepeatOptions`、`CreateTaskFromHistory`、`CreateInvite`、`CreateMatchExclusionPreference` |
| AI_EXTENSION_POINT | 未来建议可复用字段，不得自动复用私人地点或旧的敏感信息 |

## R-15 — Requester Task History

| 项目 | 规格 |
|---|---|
| PURPOSE | 按 Task / Order / outcome 查看历史，支持复用和问题追溯 |
| ENTRY | Requester Home、Task Detail、Business Workspace |
| FIELDS | task title、scenario、created_at、principal、fulfillment summary、outcome、payment summary、repeat action、case / dispute marker |
| READ MODEL | `TaskHistoryReadModel` |
| PRIMARY CTA | Open Task、Repeat |
| SECONDARY CTA | View receipt、View review、Open resolved case |
| STATES | Empty、Paginated、History partially redacted、Business membership removed |
| PERMISSION | Object owner / Business scope；不得因历史关系暴露当前 D4 位置 |
| DEEP LINK | `/requester/tasks/history` |
| NEXT STATE | Task Detail、Repeat Draft、Receipt |
| API_DEPENDENCY | `ListTaskHistory`、`GetTaskSummary` |
| AI_EXTENSION_POINT | 未来可总结复购模式，不得把历史信息默认公开给其他用户 |

---

# 11. Agent Surface 页面规格

## A-01 — Agent Home

| 项目 | 规格 |
|---|---|
| PURPOSE | 展示 Agent 当前可行动的 Offer、Upcoming Order、Availability 状态和 Earnings 摘要 |
| ENTRY | 登录后 Agent 入口、完成 Onboarding、Order 关闭后 |
| FIELDS | Agent status、verification blockers、availability status、new Offer count、upcoming orders、current execution、earnings summary、safety banner |
| READ MODEL | `AgentHomeReadModel` |
| PRIMARY CTA | Review Offer / Set Available Now / Continue Execution |
| SECONDARY CTA | Open Passport、Open Availability、Earnings、Inbox |
| STATES | No AgentProfile、Draft、Active、Paused、Restricted、Suspended、No Offer、On Order |
| PERMISSION | 当前 UserAccount 的 AgentProfile；Operator 不通过 Agent Home 操作 |
| DEEP LINK | `/agent/home` |
| NEXT STATE | Become a Proxy、Offer Detail、Upcoming、Execution、Availability |
| API_DEPENDENCY | `GetAgentHome`、`GetAgentStatus` |
| AI_EXTENSION_POINT | 未来解释 Offer 适配度，不得替 Agent 接受 Offer |

## A-02 — Become a Proxy / Onboarding

| 项目 | 规格 |
|---|---|
| PURPOSE | 建立 AgentProfile，完成基础身份、角色和能力信息收集 |
| ENTRY | Agent Home 无 Profile、Profile DRAFT、邀请链接 |
| FIELDS | identity status、display / nickname、role selection、capability claims、availability intent、KYC / verification progress、visibility preferences、consent |
| READ MODEL | `AgentOnboardingReadModel`、`GraphCatalogReadModel`、`IdentityStatusReadModel` |
| PRIMARY CTA | Save and Continue / Submit Verification |
| SECONDARY CTA | Save Draft、Exit、Privacy explanation |
| STATES | Draft、Verification pending、Rejected / needs correction、Active、Restricted、Provider unavailable |
| PERMISSION | 本人；D5 写入走受控 Identity / KYC Provider，不能展示给普通 Candidate API |
| DEEP LINK | `/agent/onboarding`、`/agent/passport/onboarding` |
| NEXT STATE | AgentProfile `ACTIVE` 或继续 DRAFT / `RESTRICTED` |
| API_DEPENDENCY | `CreateAgentProfile`、`UpdateAgentPassport`、`StartVerification`、`RecordConsent` |
| AI_EXTENSION_POINT | 未来帮助理解 Role 要求，不得自动声明能力或上传伪造证明 |

### A-02 业务规则

- `KYC` 只回答“你是谁”，Capability Verification 回答“你是否能做这件事”，Trust / Reliability 与 Risk 必须单独展示。
- 不得用一个“综合可信分”代替上述多个维度。
- Agent 尚未 Active 时，不得接收可创建 Order 的 Offer。

## A-03 — Agent Passport

| 项目 | 规格 |
|---|---|
| PURPOSE | 查看和维护 Agent 的 Role、Capability、Verification、Evidence 和 Visibility |
| ENTRY | Agent Home、Onboarding 完成、Offer 要求缺口 |
| FIELDS | active roles、capability status、verification status、proof items、reliability dimensions、visibility policy、profile completeness、restricted fields indicator |
| READ MODEL | `AgentCapabilityPassportReadModel` |
| PRIMARY CTA | Add / Edit Capability、Start Verification、Update Visibility |
| SECONDARY CTA | View requirements、Pause Profile、Open settings |
| STATES | Incomplete、Pending verification、Active、Capability expired、Restricted、Suspended |
| PERMISSION | 本人可编辑自己的 Passport；Requester 只能看任务相关裁剪版 |
| DEEP LINK | `/agent/passport` |
| NEXT STATE | Updated passport、Verification pending、Availability eligibility refreshed |
| API_DEPENDENCY | `GetAgentPassport`、`UpdateCapability`、`SubmitCapabilityProof`、`UpdateVisibilityPolicy` |
| AI_EXTENSION_POINT | 未来总结证明与缺口，不得自动提升 Verification Status |

## A-04 — Roles / Capabilities Detail

| 项目 | 规格 |
|---|---|
| PURPOSE | 从 Graph Catalog 选择可声明的 AgentRole 和原子 Capability，并查看验证要求 |
| ENTRY | Onboarding、Passport、Offer 不匹配提示 |
| FIELDS | role、atomic capabilities、must / nice verification、expiry、evidence examples、scenario applicability |
| READ MODEL | `GraphNodeReadModel`、`GraphPolicyReadModel` |
| PRIMARY CTA | Claim Capability / Submit Proof |
| SECONDARY CTA | Remove Capability、View verification rules |
| STATES | Available、Already claimed、Verification required、Retired graph version、Not eligible |
| PERMISSION | 本人编辑；系统按 GraphPolicy 校验；Operator 仅通过 Graph Governance 页面审阅 |
| DEEP LINK | `/agent/passport/roles/{role_id}` |
| NEXT STATE | Passport updated / verification pending |
| API_DEPENDENCY | `GetRoleDetail`、`ClaimCapability`、`SubmitCapabilityProof` |
| AI_EXTENSION_POINT | 未来推荐可能适配的 Role，但不得自动 claim |

## A-05 — Availability Home / Available Now

| 项目 | 规格 |
|---|---|
| PURPOSE | 设置当前是否可接收符合资格的任务，并清楚表达有效期 |
| ENTRY | Agent Home、Offer readiness、Availability |
| FIELDS | current status、available now TTL、role scope、geo cell / service area、travel buffer、last updated、conflict warning |
| READ MODEL | `AvailabilitySessionReadModel` |
| PRIMARY CTA | Become Available Now / Pause Availability |
| SECONDARY CTA | Edit schedule、Set travel buffer、View matching impact |
| STATES | Not available、Available、Expired、Paused、Conflict、Location permission needed |
| PERMISSION | 本人；Availability 不直接创建 Offer 或 Order |
| DEEP LINK | `/agent/availability/now` |
| NEXT STATE | AvailabilitySession `ACTIVE` / `EXPIRED` / `PAUSED`；匹配 Read Model 异步刷新 |
| API_DEPENDENCY | `OpenAvailabilitySession`、`CloseAvailabilitySession`、`GetAvailability` |
| AI_EXTENSION_POINT | 未来提醒可用时间，不得未经明确同意持续打开 Available Now |

## A-06 — Availability Schedule

| 项目 | 规格 |
|---|---|
| PURPOSE | 维护未来时间段、服务区域、Travel Buffer 和不可用窗口 |
| ENTRY | Availability Home、Agent Home |
| FIELDS | date、time window、timezone、role scope、service area、travel buffer、conflict markers、recurring rule if enabled |
| READ MODEL | `AvailabilityCalendarReadModel` |
| PRIMARY CTA | Add Availability Window / Save Schedule |
| SECONDARY CTA | Edit、Delete future window、Pause all |
| STATES | Empty、Overlapping、Past window、Offer reserved、Order conflict、Policy limit reached |
| PERMISSION | 本人；已有 Order 的冲突窗口不能静默删除影响履约 |
| DEEP LINK | `/agent/availability/schedule` |
| NEXT STATE | Availability updated；已有 Offer / Order 按 policy re-evaluate |
| API_DEPENDENCY | `ListAvailabilityWindows`、`CreateAvailabilityWindow`、`UpdateAvailabilityWindow`、`CloseAvailabilityWindow` |
| AI_EXTENSION_POINT | 未来建议时间窗口，不得自动覆盖 Agent 已承诺的 Order |

## A-07 — Offer Detail

| 项目 | 规格 |
|---|---|
| PURPOSE | 让 Agent 在 Accept 前完整理解一次 Offer 的任务、Slot、补偿、时间地点和约束 |
| ENTRY | Agent Home、Inbox、Push、Offers |
| FIELDS | offer status、source (`REQUESTER_SELECTION` / `FAST_MATCH`)、expires_at、task summary、slot role、schedule、location visibility summary、compensation、must requirements、deliverable、evidence requirement、cancellation / safety summary |
| READ MODEL | `OfferDetailReadModel`，不展示不必要 D5 |
| PRIMARY CTA | Accept Offer |
| SECONDARY CTA | Decline、Ask / order-bound clarification、Report concern、Open Safety |
| STATES | Created、Sent、Delivered、Viewed、Accepting、Accepted、Declined、Expired、Revoked、Assignment Lost、Failed |
| PERMISSION | Offer recipient；非 recipient 不能通过 Deep Link 查看 |
| DEEP LINK | `/agent/offers/{offer_id}` |
| NEXT STATE | Accepting → recheck → Order Created，或 Declined / Expired / Assignment Lost |
| API_DEPENDENCY | `GetOfferDetail`、`AcceptOffer`、`DeclineOffer`、`GetOfferEligibility` |
| AI_EXTENSION_POINT | 未来解释条件、补偿和风险提示，不得代替 AcceptOffer |

### A-07 Accept 交互

Accept 必须明确告诉 Agent：

```text
当前接受的是一个 Offer
成功后可能创建一个 Order
系统会重新检查资格、Availability、冲突、Slot 和 Funding
```

服务端返回 `ASSIGNMENT_LOST`、`EXPIRED`、`FAILED` 等结果时，页面必须显示具体原因，不得显示“已接受”后再回滚。

## A-08 — Upcoming Orders

| 项目 | 规格 |
|---|---|
| PURPOSE | 展示 Agent 已确认、待执行或正在执行的 Order |
| ENTRY | Agent Home、Offer Accept 成功、Inbox |
| FIELDS | order lifecycle、task role、schedule、venue summary、arrival instructions、compensation summary、check-in readiness、conflict / policy alerts |
| READ MODEL | `AgentUpcomingOrdersReadModel` |
| PRIMARY CTA | Open Order / Start Execution |
| SECONDARY CTA | Order Chat、Request Safe Exit、Cancel / Support、Add to calendar if enabled |
| STATES | Empty、Confirmed、En Route、Arrived、In Progress、Completion Review、Cancelled、Safety Hold |
| PERMISSION | 当前 Agent；D3 / D4 按 Order 与 TTL 暴露 |
| DEEP LINK | `/agent/orders/upcoming`、`/agent/orders/{order_id}` |
| NEXT STATE | Execution、Evidence、Case / Safety |
| API_DEPENDENCY | `ListAgentOrders`、`GetOrderSummary` |
| AI_EXTENSION_POINT | 未来行程摘要，不得改变 Order 时间或自动发送外部信息 |

## A-09 — Agent Execution

| 项目 | 规格 |
|---|---|
| PURPOSE | 让 Agent 完成到达、Check-in、执行、异常和沟通 |
| ENTRY | Upcoming、Order Detail、提醒通知 |
| FIELDS | order status、check-in window、meeting point、location permission status、task checklist、deliverable、chat、evidence requirement、safety stop |
| READ MODEL | `AgentExecutionReadModel`、`LocationVisibilityGrantReadModel` |
| PRIMARY CTA | Check In / Start Execution / Submit Evidence |
| SECONDARY CTA | Mark issue、Request Safe Exit、Order Chat、Safety Stop |
| STATES | Not started、En Route、Check-in available、Arrived、Late、In Progress、Location grant expired、Safety Hold |
| PERMISSION | 当前 Order Agent；Check-in 必须通过 CheckinPolicy / Order 状态验证 |
| DEEP LINK | `/agent/orders/{order_id}/execution` |
| NEXT STATE | `AgentArrived`、`Order IN_PROGRESS`、`Evidence Submitted`、Incident / Exception |
| API_DEPENDENCY | `ConfirmArrival`、`StartExecution`、`CreateExecutionException`、`GetExecutionContext` |
| AI_EXTENSION_POINT | 未来提醒 checklist，不得代替真人 Check-in 或伪造到场事实 |

## A-10 — Evidence

| 项目 | 规格 |
|---|---|
| PURPOSE | 收集和提交与 Deliverable 对应的 Evidence |
| ENTRY | Agent Execution、Order Detail、Evidence reminder |
| FIELDS | evidence type、media / text item、timestamp、task relation、required / optional flag、upload progress、visibility note、retention note |
| READ MODEL | `EvidenceSubmissionReadModel`、`EvidencePolicyReadModel` |
| PRIMARY CTA | Add Evidence / Submit Evidence |
| SECONDARY CTA | Save Draft、Remove unsent item、Report unsafe evidence request |
| STATES | Empty required、Draft、Uploading、Submitted、Rejected / needs correction、Storage unavailable |
| PERMISSION | 当前 Order Agent；Requester 只能看允许暴露的 Evidence；Operator 不得手工创建 Evidence |
| DEEP LINK | `/agent/orders/{order_id}/evidence` |
| NEXT STATE | Order `EVIDENCE_SUBMITTED` / `COMPLETION_REVIEW` 或补交 |
| API_DEPENDENCY | `CreateEvidenceUpload`、`FinalizeEvidence`、`SubmitEvidence`、`GetEvidencePolicy` |
| AI_EXTENSION_POINT | 未来做媒体摘要或缺项提示，不得生成现场证据或修改原始媒体事实 |

## A-11 — Earnings

| 项目 | 规格 |
|---|---|
| PURPOSE | 展示 Agent Earnings、Settlement、Payout 和可用余额的可解释摘要 |
| ENTRY | Agent Home、Order Completed、Payout notification |
| FIELDS | gross compensation、platform fee if applicable、adjustment、settlement status、payout status、available / pending amount、ledger references、payout account masked |
| READ MODEL | `AgentEarningsReadModel`、`AgentEarningsLedgerReadModel`、`PayoutReadModel` |
| PRIMARY CTA | Complete Payout Setup / View Payout Detail |
| SECONDARY CTA | Filter history、Open Payment Case、Download statement if enabled |
| STATES | Empty、Pending settlement、Available、Payout failed、Payout delayed、Identity / payout setup blocked |
| PERMISSION | 本人；Operator 按 `PAYMENT_VIEW` 只读；Requester 不可查看 Agent payout account |
| DEEP LINK | `/agent/earnings`、`/agent/earnings/{settlement_id}` |
| NEXT STATE | Payout setup、Case、retry provider flow |
| API_DEPENDENCY | `GetAgentEarnings`、`GetSettlement`、`GetPayout`、`StartPayoutSetup` |
| AI_EXTENSION_POINT | 未来解释收入变化，不得修改 Ledger 或余额 |

## A-12 — Agent Trusted / Repeat

| 项目 | 规格 |
|---|---|
| PURPOSE | 查看可复用的 TrustedRelationship 和历史合作，但提醒每次任务仍需重新资格判断 |
| ENTRY | Agent Home、Completed Order、Requester repeat invite |
| FIELDS | relationship status、counterparty type、prior completed orders、current capability fit、current availability fit、block / do-not-match status |
| READ MODEL | `AgentRelationshipReadModel` |
| PRIMARY CTA | Accept Repeat Invite / Update Availability |
| SECONDARY CTA | Do Not Match、Report concern、View history |
| STATES | Active、Pending consent、Blocked、Capability changed、Unavailable |
| PERMISSION | 关系双方合法上下文；不开放通用人脉目录 |
| DEEP LINK | `/agent/relationships`、`/agent/relationships/{relationship_id}` |
| NEXT STATE | Offer / Order flow 或 exclusion preference |
| API_DEPENDENCY | `ListRelationships`、`AcceptRepeatInvite`、`CreateMatchExclusionPreference` |
| AI_EXTENSION_POINT | 未来提供合作摘要，不得自动接受 repeat invite |

## A-13 — Agent Inbox

| 项目 | 规格 |
|---|---|
| PURPOSE | 提供 Offer、Order、Execution 和 Earnings 相关通知的操作入口 |
| ENTRY | Agent Shell、Push |
| FIELDS | priority、Offer expiry、Order reminder、safety alert、payout update、read status、object ref |
| READ MODEL | `NotificationInboxReadModel` |
| PRIMARY CTA | Open Offer / Order / Earnings |
| SECONDARY CTA | Mark read、Notification settings |
| STATES | Empty、Unread、Expired Offer、Object changed、Delivery delayed |
| PERMISSION | 本人 |
| DEEP LINK | `/agent/inbox` |
| NEXT STATE | Offer Detail、Execution、Earnings、Safety |
| API_DEPENDENCY | `GetInbox`、`MarkNotificationRead` |
| AI_EXTENSION_POINT | 未来按紧急程度总结，不得自动执行 Offer 或 Safety 动作 |

---

# 12. Business Surface 页面规格

## B-01 — Workspace Home

| 项目 | 规格 |
|---|---|
| PURPOSE | 聚合 BusinessAccount 的活跃 Task、人员、预算、门店和需要审批的动作 |
| ENTRY | Business switcher、登录后 Business 入口 |
| FIELDS | business identity、member role、active tasks、slot fulfillment、spend summary、approval queue、stores、trusted team、alerts |
| READ MODEL | `BusinessWorkspaceHomeReadModel` |
| PRIMARY CTA | Create Business Task |
| SECONDARY CTA | Open Multi-slot、Templates、Members、Spend、Stores、Inbox |
| STATES | No Business membership、Invited、Active、Restricted、Suspended、No tasks |
| PERMISSION | BusinessMembership `ACTIVE`；各卡片按 effective permission 单独裁剪 |
| DEEP LINK | `/business/{business_id}/home` |
| NEXT STATE | Business Task、Spend、Members、Store、Case |
| API_DEPENDENCY | `GetBusinessWorkspaceHome`、`GetEffectivePermissions` |
| AI_EXTENSION_POINT | 未来总结运营异常，不得自动批准预算或提交 Task |

## B-02 — Business Create Task

| 项目 | 规格 |
|---|---|
| PURPOSE | 使用 Launch Catalog 或 BusinessTaskTemplate 创建以 BusinessAccount 为 Principal 的 Task |
| ENTRY | Workspace Home、Templates、Repeat |
| FIELDS | business principal、store / venue、scenario、role、slot quantity、schedule、requirements、deliverable、budget source、approver |
| READ MODEL | `LaunchCatalogReadModel`、`BusinessTaskTemplateReadModel`、`BudgetPolicyReadModel` |
| PRIMARY CTA | Continue to Review |
| SECONDARY CTA | Save Template Draft、Save Task Draft、Switch Store |
| STATES | Permission missing、Budget unavailable、Store inactive、Scenario unavailable、Draft conflict |
| PERMISSION | `TASK_CREATE`；涉及付款还需 `PAYMENT_CREATE` 或进入审批 |
| DEEP LINK | `/business/{business_id}/tasks/new` |
| NEXT STATE | Business Task Draft → Review；审批未完成不得 CommitTask |
| API_DEPENDENCY | `GetBusinessTaskTemplates`、`CreateBusinessTaskDraft`、`ValidateBudget` |
| AI_EXTENSION_POINT | 未来从历史模板生成草稿，不得自动选择 Business principal 或审批人 |

## B-03 — Business Task Detail

| 项目 | 规格 |
|---|---|
| PURPOSE | 让 Business 成员从业务视角管理 Task、Slot、Order、预算和履约结果 |
| ENTRY | Workspace Home、Task list、Inbox |
| FIELDS | task lifecycle、business principal、creator、store / venue、slot fulfillment、order summary、funding status、budget consumption、approvals、audit markers |
| READ MODEL | `BusinessTaskDetailReadModel` |
| PRIMARY CTA | Open Multi-slot / Matching / Review Completion |
| SECONDARY CTA | Edit allowed fields、Cancel Task、Add member context、Open Case |
| STATES | Draft、Pending Approval、Committed、Matching、Partial、Full、Completion Pending、Completed、Cancelled |
| PERMISSION | 按 `TASK_VIEW`、`TASK_EDIT`、`TASK_CANCEL`、`PAYMENT_VIEW` 等细粒度权限 |
| DEEP LINK | `/business/{business_id}/tasks/{task_id}` |
| NEXT STATE | Slot / Order / Spend / Case |
| API_DEPENDENCY | `GetBusinessTaskDetail`、`UpdateBusinessTask`、`CancelTask`、`GetAuditSummary` |
| AI_EXTENSION_POINT | 未来总结多 Slot 风险，不得静默编辑 Task |

## B-04 — Multi-slot Execution

| 项目 | 规格 |
|---|---|
| PURPOSE | 以 Slot 为最小粒度管理多人到场、缺口、替换和整体结果 |
| ENTRY | Business Task Detail、Requester Matching、Execution alert |
| FIELDS | slot id / role、slot lifecycle、agent nickname、order lifecycle、arrival、evidence、completion、replacement needed、compensation summary |
| READ MODEL | `BusinessMultiSlotExecutionReadModel` |
| PRIMARY CTA | Open Slot / Assist Replacement / Review Evidence |
| SECONDARY CTA | Contact Order、Mark issue、Open Safety、Cancel affected Slot if allowed |
| STATES | Open、Assigned、In Progress、Completion Pending、Completed、Unfilled、Replacement Required、Cancelled |
| PERMISSION | `TASK_EXECUTION_VIEW`；替换需 `MATCH_ASSIST` 或业务 policy；不得批量跳过 Slot 规则 |
| DEEP LINK | `/business/{business_id}/tasks/{task_id}/slots` |
| NEXT STATE | Slot Detail、Replacement MatchAttempt、Completion Review |
| API_DEPENDENCY | `GetMultiSlotExecution`、`RequestReplacement`、`GetSlotTimeline` |
| AI_EXTENSION_POINT | 未来标注最可能缺口，不得自动替换 Agent |

## B-05 — Trusted Team

| 项目 | 规格 |
|---|---|
| PURPOSE | 管理 Business 可复用的合作 Agent 关系和团队视图 |
| ENTRY | Workspace Home、Completed Task、Task Matching |
| FIELDS | agent nickname、relevant roles、completed orders、reliability summary、current eligibility indicator、relationship status、last used context |
| READ MODEL | `BusinessTrustedTeamReadModel` |
| PRIMARY CTA | Invite to Task / Repeat Task |
| SECONDARY CTA | Remove from team view、Do Not Match、View history |
| STATES | Empty、Active、Agent unavailable、Capability changed、Blocked、Relationship pending |
| PERMISSION | Business `TRUSTED_TEAM_VIEW` / `TRUSTED_TEAM_MANAGE`；不显示 D5 |
| DEEP LINK | `/business/{business_id}/trusted-team` |
| NEXT STATE | Invite / Task Draft / exclusion preference |
| API_DEPENDENCY | `ListTrustedRelationships`、`CreateInvite`、`UpdateTrustedRelationship` |
| AI_EXTENSION_POINT | 未来按历史协作摘要排序，不得以 Trusted 绕过 Eligibility |

## B-06 — Business Task Templates

| 项目 | 规格 |
|---|---|
| PURPOSE | 保存可复用的 Task 创建字段，缩短 Business 重复需求的创建时间 |
| ENTRY | Workspace Home、Create Task、Task History |
| FIELDS | template name、scenario、role / slot defaults、requirements、deliverable、pricing unit、cancellation binding、last used、version |
| READ MODEL | `BusinessTaskTemplateReadModel` |
| PRIMARY CTA | Use Template |
| SECONDARY CTA | Create、Edit、Archive、Duplicate as new version |
| STATES | Empty、Active、Archived、Catalog version outdated、Permission denied |
| PERMISSION | `TEMPLATE_VIEW` / `TEMPLATE_MANAGE`；模板不能保存 D4 / D5 私人数据 |
| DEEP LINK | `/business/{business_id}/templates` |
| NEXT STATE | New Task Draft；旧模板字段需重新校验 |
| API_DEPENDENCY | `ListBusinessTaskTemplates`、`CreateTaskTemplate`、`UpdateTaskTemplate`、`ArchiveTaskTemplate` |
| AI_EXTENSION_POINT | 未来建议从历史 Task 生成模板，不得带入敏感地点和支付凭据 |

## B-07 — Spend / Payments

| 项目 | 规格 |
|---|---|
| PURPOSE | 查看 Business 预算、PaymentIntent、FundingHold、Refund 和可审计账单 |
| ENTRY | Workspace Home、Task Detail、Approval notification |
| FIELDS | business budget、pending authorization、secured funding、settlement、refund、invoice / receipt、approver、ledger reference |
| READ MODEL | `BusinessSpendReadModel`、`BusinessLedgerSummaryReadModel` |
| PRIMARY CTA | Approve Funding / Add Payment Method / View Statement |
| SECONDARY CTA | Filter by Store / Task、Open Payment Case、Export statement |
| STATES | No payment setup、Approval pending、Funding failed、Secured、Refunding、Provider outage |
| PERMISSION | `PAYMENT_VIEW`、`PAYMENT_CREATE`、`BUDGET_APPROVE`；权限分离必须可审计 |
| DEEP LINK | `/business/{business_id}/spend` |
| NEXT STATE | Funding secured → Task matching；approval rejected → Task remains pending |
| API_DEPENDENCY | `GetBusinessSpend`、`ApproveFunding`、`CreateFundingIntent`、`GetBusinessStatement` |
| AI_EXTENSION_POINT | 未来解释 spend anomaly，不得自动批准或发起付款 |

## B-08 — Members / Permissions

| 项目 | 规格 |
|---|---|
| PURPOSE | 管理 BusinessMembership、角色、邀请、暂停和移除 |
| ENTRY | Workspace Home、Settings、Member notification |
| FIELDS | member display name、membership status、business role、effective permission summary、store scope、invited_at、last active、removal reason |
| READ MODEL | `BusinessMembersReadModel`、`EffectivePermissionReadModel` |
| PRIMARY CTA | Invite Member / Change Role |
| SECONDARY CTA | Suspend、Remove、Change Store Scope、View Audit |
| STATES | Invited、Active、Suspended、Removed、Invitation expired、Permission conflict |
| PERMISSION | `MEMBER_VIEW`、`MEMBER_MANAGE`；不能把个人 Account 的敏感字段展示给其他成员 |
| DEEP LINK | `/business/{business_id}/members` |
| NEXT STATE | Membership `ACTIVE` / `SUSPENDED` / `REMOVED`；既有业务事实不被删除 |
| API_DEPENDENCY | `ListBusinessMembers`、`InviteBusinessMember`、`UpdateBusinessMembership`、`GetEffectivePermissions` |
| AI_EXTENSION_POINT | 未来解释权限差异，不得自动授予高影响权限 |

## B-09 — Stores / Venues

| 项目 | 规格 |
|---|---|
| PURPOSE | 管理 Business 的 Store 与 Venue 业务对象，并为 Task 提供位置上下文 |
| ENTRY | Workspace Home、Create Task、Task Detail |
| FIELDS | store name、venue type、service area、active status、address visibility level、operating hours、task usage、location policy |
| READ MODEL | `BusinessStoreReadModel`、`VenueReadModel` |
| PRIMARY CTA | Add Store / Use Store in Task |
| SECONDARY CTA | Edit、Deactivate、Manage Venue aliases |
| STATES | Empty、Active、Inactive、Address verification pending、Restricted location |
| PERMISSION | `STORE_VIEW` / `STORE_MANAGE`；精确地址按 Task / Order grant 暴露 |
| DEEP LINK | `/business/{business_id}/stores` |
| NEXT STATE | Task Draft with venue reference；不得自动授权 Agent 永久访问地址 |
| API_DEPENDENCY | `ListStores`、`CreateStore`、`UpdateStore`、`ResolveVenue` |
| AI_EXTENSION_POINT | 未来清理地址和场地别名，不得自动发布精确位置 |

## B-10 — Business Inbox

| 项目 | 规格 |
|---|---|
| PURPOSE | 聚合 Business Task、审批、Order 异常、付款和安全通知 |
| ENTRY | Business Shell、Push、Workspace Home |
| FIELDS | business scope、notification priority、task / slot ref、approval ref、payment ref、case ref、read status |
| READ MODEL | `BusinessInboxReadModel` |
| PRIMARY CTA | Open Task / Approve / Case |
| SECONDARY CTA | Mark read、Filter Store / Team |
| STATES | Empty、Unread、Expired approval、Permission removed、Object redacted |
| PERMISSION | Business `INBOX_VIEW`，按 store / task scope 裁剪 |
| DEEP LINK | `/business/{business_id}/inbox` |
| NEXT STATE | Task、Spend、Members、Case |
| API_DEPENDENCY | `GetBusinessInbox`、`MarkNotificationRead` |
| AI_EXTENSION_POINT | 未来归纳需要审批事项，不得自动审批或关闭告警 |

---

# 13. Operator Surface 页面规格

Operator 页面全部使用仅内部人员可访问的桌面 Console，所有写操作必须生成 OperatorAuditLog，并通过受控 Domain Command 执行。该 Console 不属于 Requester / Agent / Business 的公开 Web 产品。

## O-01 — Case Queue

| 项目 | 规格 |
|---|---|
| PURPOSE | 按优先级、团队、状态和 SLA 管理 OperatorCase |
| ENTRY | Operator 登录、Push、团队导航 |
| FIELDS | case id、priority、team、type、related object、risk marker、age、SLA、assignee、status、last event |
| READ MODEL | `OperatorCaseQueueReadModel` |
| PRIMARY CTA | Open Case / Assign Case |
| SECONDARY CTA | Filter、Sort、Bulk assign（仅低风险分派）、Escalation |
| STATES | Empty、Loading、Stale、Permission denied、Provider outage |
| PERMISSION | `CASE_VIEW` / `CASE_ASSIGN`；按 Operator team scope |
| DEEP LINK | `/operator/cases`、`/operator/cases/{case_id}` |
| NEXT STATE | Case Detail、Task Review、Payment、Safety |
| API_DEPENDENCY | `ListOperatorCases`、`AssignOperatorCase`、`GetCaseSLA` |
| AI_EXTENSION_POINT | 未来做 Case triage / 摘要，不得自动 Resolve P0 safety / payment Case |

## O-02 — Case Detail / Timeline

| 项目 | 规格 |
|---|---|
| PURPOSE | 展示一个 OperatorCase 的来源、对象时间线、允许的处理动作和审计记录 |
| ENTRY | Case Queue、Notification、Deep Link |
| FIELDS | case status、priority、team、related Task / Slot / Order、domain events、user reports、provider events、audit log、allowed commands、sensitive-data access reason |
| READ MODEL | `OperatorCaseDetailReadModel`、`DomainTimelineReadModel` |
| PRIMARY CTA | Triage / Resolve / Execute allowed command |
| SECONDARY CTA | Assign、Request user info、Escalate、Add internal note |
| STATES | Open、Triaged、Assigned、In Progress、Waiting User / Provider / Internal、Resolved、Closed |
| PERMISSION | 细粒度 Operator permission；查看 D4 / D5 必须记录 reason / task / order / expiry |
| DEEP LINK | `/operator/cases/{case_id}` |
| NEXT STATE | Case status updated；相关 Domain Object 经事件刷新 |
| API_DEPENDENCY | `GetCaseDetail`、`TriageCase`、`ResolveCase`、`AddOperatorNote`、`IssueDomainCommand` |
| AI_EXTENSION_POINT | 未来汇总时间线，不得虚构事实或执行高影响 Command |

## O-03 — Task Review

| 项目 | 规格 |
|---|---|
| PURPOSE | 审核 Admission、风险、材料变更和异常 Task，不替代 Task Owner 创建业务数据 |
| ENTRY | Case Detail、Review queue |
| FIELDS | Task / Slot summary、principal、admission status、risk decision、requirements、location level、funding interface status、change history、policy version |
| READ MODEL | `OperatorTaskReviewReadModel` |
| PRIMARY CTA | Approve Admission / Restrict Task / Request Correction |
| SECONDARY CTA | Limit edit、Open Safety Case、View requester context |
| STATES | Pending、Approved、Review Required、Rejected、Expired、Already committed |
| PERMISSION | `TASK_REVIEW`、`TASK_LIMITED_EDIT`；不能直接 PATCH status |
| DEEP LINK | `/operator/tasks/{task_id}/review` |
| NEXT STATE | Admission updated，或 Task 保持受限并建立 Case |
| API_DEPENDENCY | `GetTaskReview`、`ApproveTaskAdmission`、`RequestTaskCorrection`、`RestrictTask` |
| AI_EXTENSION_POINT | 未来指出规则冲突，不得自动批准高风险 Task |

## O-04 — Match Assist

| 项目 | 规格 |
|---|---|
| PURPOSE | 在供需不足、替换或异常情况下辅助 MatchAttempt，不绕过资格和资金规则 |
| ENTRY | Case Detail、Matching alert、Unfilled Slot |
| FIELDS | TaskSlot、MatchAttempt、current candidate set、eligibility reasons、availability、risk gates、Offer status、replacement history |
| READ MODEL | `OperatorMatchAssistReadModel` |
| PRIMARY CTA | Re-run Matching / Send permitted Offer / Assist Replacement |
| SECONDARY CTA | Explain eligibility、Escalate graph gap、Mark exhausted |
| STATES | Active、Exhausted、Slot already filled、Funding invalid、No eligible supply、Policy hold |
| PERMISSION | `MATCH_ASSIST`、`REPLACEMENT_ASSIST`；不能替 Agent AcceptOffer |
| DEEP LINK | `/operator/tasks/{task_id}/slots/{slot_id}/match-assist` |
| NEXT STATE | New MatchAttempt / Offer sent / Replacement pending |
| API_DEPENDENCY | `GetMatchAssist`、`StartMatching`、`SendOffer`、`RequestReplacement` |
| AI_EXTENSION_POINT | 未来推荐人工排查顺序，但不得让 AI 越过 Hard Eligibility |

## O-05 — Payment / Dispute

| 项目 | 规格 |
|---|---|
| PURPOSE | 查看 PaymentIntent、FundingHold、Ledger、Refund、Settlement、Payout 异常并处理受权动作 |
| ENTRY | Case Queue、Task / Order Payment alert |
| FIELDS | payment state、funding hold、ledger entries、provider ref、amount、currency、refund policy、dispute evidence、settlement / payout status、idempotency info |
| READ MODEL | `OperatorPaymentCaseReadModel` |
| PRIMARY CTA | Propose Refund / Approve Refund / Place Payment Hold / Reconcile |
| SECONDARY CTA | Retry provider operation、Open user case、View ledger timeline |
| STATES | Pending、Authorized、Secured、Failed、Refunding、Refunded、Payout failed、Reconciliation required |
| PERMISSION | `PAYMENT_VIEW`、`PAYMENT_HOLD`、`REFUND_PROPOSE`、`REFUND_APPROVE`；权限分离时必须双人 / policy 控制 |
| DEEP LINK | `/operator/cases/{case_id}/payment` |
| NEXT STATE | Payment state / Ledger event / Case updated |
| API_DEPENDENCY | `GetPaymentCase`、`ProposeRefund`、`ApproveRefund`、`PlacePaymentHold`、`ReconcilePayment` |
| AI_EXTENSION_POINT | 未来识别重复 webhook 或异常模式，不得直接改 Ledger 或批准退款 |

## O-06 — Safety / Risk

| 项目 | 规格 |
|---|---|
| PURPOSE | 处理 Incident、RiskDecision、SafetyStop、账号 / Task / Order 限制 |
| ENTRY | Safety Entry、Case Queue、automated risk alert |
| FIELDS | incident type、severity、related object、reports、risk status、location / contact access、prior actions、current safety hold、audit reason |
| READ MODEL | `OperatorSafetyCaseReadModel`、`RiskDecisionReadModel` |
| PRIMARY CTA | Safety Stop / Restrict Account / Restrict Task / Resolve Incident |
| SECONDARY CTA | Request evidence、Escalate、Notify affected party、Reopen |
| STATES | Open、Triaged、In Progress、Waiting、Resolved、Closed、Appeal pending |
| PERMISSION | `SAFETY_VIEW`、`SAFETY_ACTION`、`RISK_RESTRICT`；D4 / D5 访问必须审计 |
| DEEP LINK | `/operator/cases/{case_id}/safety` |
| NEXT STATE | Incident updated、RiskDecision made、access revoked / restored |
| API_DEPENDENCY | `GetSafetyCase`、`OpenIncident`、`SafetyStopOrder`、`RestrictAccount`、`MakeRiskDecision` |
| AI_EXTENSION_POINT | 未来聚合相似事件，不得自动判定责任、处罚或恢复访问 |

## O-07 — Audit

| 项目 | 规格 |
|---|---|
| PURPOSE | 查询 OperatorAuditLog、Domain Event、权限访问和高影响命令结果 |
| ENTRY | Operator Shell、Case Detail、Payment / Safety actions |
| FIELDS | actor、team、permission、reason、task / order / case、command、result、before / after read-only diff、timestamp、provider ref |
| READ MODEL | `OperatorAuditReadModel`、`DomainEventReadModel` |
| PRIMARY CTA | Filter / Export controlled report |
| SECONDARY CTA | Open source Case / Command / Event |
| STATES | Empty、Paginated、Sensitive fields redacted、Retention expired |
| PERMISSION | `AUDIT_VIEW`；导出需额外 permission 和审计 |
| DEEP LINK | `/operator/audit`、`/operator/audit/{audit_id}` |
| NEXT STATE | Case / object detail；Audit 本身只读 |
| API_DEPENDENCY | `ListOperatorAudit`、`GetDomainEvent`、`GetCommandResult` |
| AI_EXTENSION_POINT | 未来生成审计摘要，不得删除、重写或补造 AuditLog |

---

# 14. 关键跨页面流程

## 14.1 Requester 创建并完成单 Slot Task

```text
R-01 Requester Home
  ↓
R-02 Task Basics
  ↓
R-03 Time & Location
  ↓
R-04 Requirements & Deliverable
  ↓
R-05 Task Review / Funding
  ↓ CommitTask
R-06 Supply Preview
  ↓
R-07 Matching
  ↓ Invite / Offer
R-08 Candidate Detail（如 Requester Selection）
  ↓
R-10 Order Detail
  ↓
R-11 Requester Execution
  ↓
R-12 Completion & Review
  ↓
R-13 Payment / Receipt + R-14 Repeat
```

## 14.2 Agent 接收 Offer 并执行

```text
A-01 Agent Home
  ↓
A-07 Offer Detail
  ↓ AcceptOffer
Eligibility / Availability / Slot / Funding recheck
  ↓ success
A-08 Upcoming Orders
  ↓
A-09 Agent Execution
  ↓ ConfirmArrival / StartExecution
A-10 Evidence
  ↓ SubmitEvidence
Order Completion Review
  ↓
A-11 Earnings
```

任何 recheck 失败都不得进入 Order Created 成功分支。

## 14.3 Business 多 Slot Task

```text
B-01 Workspace Home
  ↓
B-02 Business Create Task
  ↓
R-05 Task Review（Business principal）
  ↓ CommitTask / Funding
B-03 Business Task Detail
  ↓
B-04 Multi-slot Execution
  ├── filled slot → Order Detail
  ├── open slot → Match Assist / Matching
  ├── failed slot → Replacement
  └── all required slots complete → Completion Review
```

## 14.4 Operator Rescue

```text
O-01 Case Queue
  ↓
O-02 Case Detail
  ├── task admission → O-03 Task Review
  ├── unfilled / replacement → O-04 Match Assist
  ├── payment / refund → O-05 Payment / Dispute
  └── safety → O-06 Safety / Risk
  ↓
O-07 Audit
```

## 14.5 Material change

Task 的以下变化视为 Material Change：

```text
time window
venue / precise meeting point
role / must capability
core deliverable
compensation
slot quantity
risk classification
```

页面行为：

1. 标记当前 Task / Slot / Order 版本变化
2. 显示变更前后摘要
3. 要求受影响主体重新 consent
4. 需要时暂停 Offer / Order 或进入 Replacement / Safety 流程
5. 禁止仅通过 Order Chat 口头修改

---

# 15. 状态到页面映射

## 15.1 Task Lifecycle

| Task Lifecycle | Requester 页面 | Business 页面 | Operator 页面 | 主 CTA |
|---|---|---|---|---|
| DRAFT | Task Builder / Review | Create Task / Templates | Task Review（如需） | Continue / Commit |
| READY | Review / Supply Preview | Task Detail | Task Review | CommitTask |
| COMMITTED | Supply Preview / Matching | Task Detail | Case / Match Assist | Start Matching |
| ACTIVE | Task / Order / Execution | Multi-slot Execution | Case | Track / Assist |
| COMPLETION_PENDING | Completion & Review | Multi-slot / Completion | Case if overdue | Confirm / Review |
| COMPLETED | History / Repeat / Receipt | History / Spend | Close Case if any | Repeat |
| CANCELLED | Task / Receipt / Case | Task / Spend | Cancellation Case | View outcome |
| EXPIRED | Task / History | Task / History | Review if policy breach | Recreate / Contact |
| REJECTED | Correction / Support | Correction / Support | Task Review | Fix / Close |

## 15.2 TaskSlot Lifecycle

| TaskSlot | Requester | Agent | Business | Operator |
|---|---|---|---|---|
| DRAFT | Builder | — | Create Task | — |
| OPEN | Supply / Matching | Offer only | Multi-slot | Match Assist |
| ASSIGNED | Order Detail | Upcoming | Multi-slot | Case |
| IN_PROGRESS | Execution | Execution | Multi-slot | Safety / Case |
| COMPLETION_PENDING | Completion | Evidence / Order | Multi-slot | Case |
| COMPLETED | History | Earnings | History | Audit |
| CANCELLED | Task / Case | Upcoming / Case | Task | Audit |
| UNFILLED | Matching | — | Multi-slot | Match Assist |

## 15.3 Order Lifecycle

| Order | Requester | Agent | Business | Safety / Payment |
|---|---|---|---|---|
| CONFIRMED | Order Detail | Upcoming | Multi-slot | Funding summary |
| EN_ROUTE | Execution | Execution | Multi-slot | Location grant |
| ARRIVED | Execution | Execution | Multi-slot | Check-in event |
| IN_PROGRESS | Execution | Execution | Multi-slot | Safety entry |
| EVIDENCE_SUBMITTED | Completion | Evidence | Multi-slot | Evidence read model |
| COMPLETION_REVIEW | Completion | Order | Multi-slot | Dispute entry |
| COMPLETED | Receipt / Repeat | Earnings | Spend / History | Settlement |
| CLOSED | History | Earnings / History | History | Audit |
| CANCELLED | Case / Refund | Case / Earnings | Spend / Case | Refund / incident |

---

# 16. Notification 到页面的映射

| Notification 类型 | 目标页面 | 紧急程度 | 过期后行为 |
|---|---|---:|---|
| Offer received | A-07 Offer Detail | P1 | Offer expired / revoked |
| Offer expiry soon | A-07 Offer Detail | P1 | 仍需重新读取 Offer 状态 |
| Order confirmed | R-10 / A-08 / B-03 | P1 | 打开当前 Order 状态 |
| Arrival / check-in | R-11 / A-09 / B-04 | P1 | 显示最新 Execution 状态 |
| Evidence submitted | R-12 / B-04 | P1 | 若已 auto-confirm，显示已完成及时间 |
| Completion pending | R-12 / B-04 | P1 | 超过 deadline 进入 Auto-confirm / Case |
| Funding failed | R-05 / R-13 / B-07 | P0 | 不能继续显示 Order 创建成功 |
| Replacement needed | R-07 / B-04 / O-04 | P1 | 进入 Replacement MatchAttempt |
| Safety incident | S-03 / O-06 | P0 | 深链需重新验证，不能显示已撤销的 D4 |
| Payout failed | A-11 / O-05 | P1 | 保留 Ledger 事实，允许 provider retry / Case |

通知必须是事实或受控提醒，不能通过通知文本制造另一套业务状态。

---

# 17. API / Read Model 边界

## 17.1 页面只依赖两类接口

```text
Query / Read Model
Command
```

页面不直接依赖：

- 数据库表
- 账本余额字段
- 其他页面的 local state
- 未经权限裁剪的原始实体

## 17.2 Command 规则

P0 高影响操作必须使用语义化 Command：

```text
CreateTaskDraft
UpdateTaskDraft
CommitTask
SecureFunding
SendInvite
AcceptOffer
DeclineOffer
CancelTask
CancelOrder
ConfirmArrival
StartExecution
SubmitEvidence
ConfirmCompletion
OpenDispute
RequestReplacement
ApproveRefund
ResolveIncident
RestrictAccount
```

实现必须支持：

```text
idempotency key
principal context
object version
policy version where needed
authorization result
domain event result
```

## 17.3 Query 规则

所有页面 Read Model 至少应该能表达：

```text
object id
object version
read_at
source status
available actions
permission summary
redaction reason if fields omitted
```

页面不应根据“按钮是否显示”猜测权限；后端应返回 `available_actions`，服务端仍需对 Command 做最终校验。

## 17.4 事件刷新

关键 Domain Event 到达后，相关页面需要刷新：

| Event | 需要刷新的页面 |
|---|---|
| TaskCommitted | R-05、R-06、R-09、B-02、B-03 |
| OfferSent | A-01、A-07、A-13、O-04 |
| OfferAccepted | A-07、A-08、R-07、R-10、B-04 |
| OrderCreated | R-10、A-08、B-04、Payment summary |
| AgentArrived | R-11、A-09、B-04、Inbox |
| EvidenceSubmitted | R-12、A-10、B-04、O-02 if Case |
| OrderCompleted | R-12、R-13、R-14、A-11、B-07 |
| IncidentOpened | S-03、O-01、O-02、O-06、相关 Order |
| PayoutPaid | A-11、A-13、O-05 |

---

# 18. 页面级埋点最低要求

页面埋点必须是产品事件或交互事实，不能把敏感字段放入 analytics payload。

## 18.1 通用事件

```text
page_viewed
page_loaded
page_empty_viewed
page_error_viewed
cta_clicked
command_submitted
command_succeeded
command_failed
deep_link_opened
permission_denied_viewed
redaction_viewed
```

## 18.2 核心闭环事件

```text
task_draft_created
task_review_viewed
task_committed
supply_preview_viewed
matching_started
candidate_detail_viewed
invite_sent
offer_viewed
offer_accepted
order_detail_viewed
arrival_confirmed
evidence_submitted
completion_confirmed
refund_viewed
repeat_started
```

## 18.3 埋点红线

不得将以下内容放入普通 analytics：

```text
government ID
full payout account
OAuth token
precise location
live trajectory
private contact
raw evidence media
```

---

# 19. P0 页面边界

## 19.1 P0 必须完成

```text
Requester:
Home
Task Builder
Task Review
Supply Preview
Matching
Candidate Detail
Task Detail
Order Detail
Execution
Completion
Payment / Receipt
Repeat
Inbox

Agent:
Home
Onboarding
Passport
Roles / Capabilities
Availability Now
Availability Schedule
Offer Detail
Upcoming Orders
Execution
Evidence
Earnings
Trusted / Repeat
Inbox

Business:
Workspace Home
Create Task
Task Detail
Multi-slot Execution
Trusted Team
Templates
Spend
Members
Stores / Venues
Inbox

Operator:
Case Queue
Case Detail
Task Review
Match Assist
Payment / Dispute
Safety / Risk
Audit

Shared:
Inbox foundation
Profile / Settings
Help / Safety
```

## 19.2 P0-LITE

- Map / location：只做地点选择、Approx Distance、合法 Order 下的精确位置 grant
- Content：只做任务相关 Evidence / Basic Content，不做公共 Feed
- Business：只做有限角色和有限 store scope
- Notification：Push + Inbox，Email / SMS 作为 provider-dependent fallback
- Operator：只做需要支持真实 Pilot 的队列和命令

## 19.3 P1 / 不阻塞本章

- 高级 Candidate compare
- Full Merchant OS
- Native Live
- Social Cross-post
- Advanced content recommendation
- Membership UI
- Earn → Spend wallet
- AI Copilot 自动执行
- 高级热力地图
- 通用社交聊天

---

# 20. 页面级验收标准

## AC-21-01 Surface Context

Given 用户进入任意已登录 P0 页面，  
When 页面加载完成，  
Then 页面必须显示当前 Principal / Surface context，且不能把 Individual、Business、Agent 混成一个无上下文身份。

## AC-21-02 No Generic People Search

Given 用户没有合法 Task Context，  
When 用户浏览 Requester / Business 页面，  
Then 系统不得提供通用 Agent 候选 API、附近真人地图或无限 Agent 列表。

## AC-21-03 Task Builder Draft

Given 用户填写 Create Task，  
When 用户尚未 CommitTask，  
Then 数据只能处于 Draft / 未提交状态，不得创建 Offer、Order 或扣除受保护资金。

## AC-21-04 Slot Atomicity

Given Task 需要 N 个真人，  
When Task Draft 或 Task Review 展示需求，  
Then页面必须可追踪 N 个独立 TaskSlot，且每个 Slot 最多一个 active Order。

## AC-21-05 Funding Gate

Given Agent 尝试 AcceptOffer，  
When Funding 未 Secured 或 PaymentIntent 失效，  
Then不得创建 Paid Order，页面必须显示 Funding Failure / Action Required。

## AC-21-06 Offer / Order Separation

Given Agent 查看 Offer Detail，  
When Offer 尚未成功接受，  
Then页面不得显示 Order Confirmed，不得显示已获得正式履约关系。

## AC-21-07 Offer Recheck

Given Offer 已存在但 Agent、Slot、Availability 或 Task 版本发生变化，  
When Agent 点击 Accept，  
Then服务端必须重新检查资格、风险、冲突、版本、过期时间和资金保护，并返回明确结果。

## AC-21-08 Candidate Privacy

Given Requester 查看 Candidate Detail，  
When页面返回候选人数据，  
Then不得返回 D5、未授权 D4 或与当前 Task 无关的私密字段。

## AC-21-09 Location TTL

Given Order 已关闭或 LocationVisibilityGrant 已过期，  
When用户打开旧 Deep Link，  
Then精确位置、Live Location 和临时联系方式必须撤销或显示已失效。

## AC-21-10 Material Change

Given Task 的时间、地点、核心交付物、补偿或 Slot 数量发生重大变化，  
When用户尝试保存变更，  
Then页面必须显示变更摘要并要求受影响方重新 consent；不能只写入聊天记录。

## AC-21-11 Multi-slot View

Given Business Task 有多个 Slot，  
When用户打开 Multi-slot Execution，  
Then页面必须按 Slot 显示 Open、Assigned、In Progress、Completed、Unfilled 和 Replacement Required 等状态。

## AC-21-12 Business Isolation

Given Business 成员属于 Business A，  
When成员访问 Business B 的 Task、Spend、Members 或 Store，  
Then服务端必须拒绝访问，不能仅在前端隐藏导航。

## AC-21-13 Operator Command Boundary

Given Operator 使用 Task Review、Match Assist、Payment 或 Safety 页面，  
When Operator 提交高影响动作，  
Then动作必须生成受控 Domain Command 和 OperatorAuditLog，不能直接 PATCH 数据库或余额。

## AC-21-14 Operator Agent Boundary

Given Operator 使用 Match Assist，  
When需要 Agent 接受 Offer，  
ThenOperator 只能发送合法 Offer 或协助流程，不能代表 Agent 调用 AcceptOffer。

## AC-21-15 Evidence Integrity

Given Agent 提交 Evidence，  
When上传或提交完成，  
Then系统必须保留原始提交事实、提交人、Order、时间和 policy context；Operator 不能手工补造 Evidence。

## AC-21-16 Review Does Not Imply Settlement

Given Requester 提交 Review 或跳过 Review，  
When Review 状态变化，  
Then页面不得把 Review 当成 Settlement 或直接修改 Earnings Ledger。

## AC-21-17 Empty / Error Specificity

Given Supply、Offer、Earnings 或 History 为空或失败，  
When页面展示状态，  
Then页面必须区分真实 Empty、Eligibility 无结果、Provider Failure、Permission Denied 和过期对象。

## AC-21-18 Stale Command

Given页面加载的 Task、Slot、Offer 或 Order 版本已过期，  
When用户点击 CTA，  
Then命令不得覆盖新状态，页面必须刷新并解释冲突。

## AC-21-19 Deep Link Authorization

Given用户打开带 object id 的 Deep Link，  
When当前 Principal 或权限不再有效，  
Then服务端必须返回 Forbidden 或 Not Found / Redacted，不得泄露对象是否存在以外的敏感信息。

## AC-21-20 AI Extension Boundary

Given页面存在 AI_EXTENSION_POINT，  
When未来接入 AI，  
Then AI 输出只能作为 draft、summary、explanation 或 triage，不能成为 Eligibility、Payment、Safety、Order 或 Ledger 的唯一真相。

---

# 21. 本章锁定结论

## 21.1 页面层最终原则

```text
页面是用户行动入口
Read Model 是页面事实来源
Domain Command 是高影响写操作入口
Domain Event 是跨页面同步事实
Policy Snapshot 是交易时约束
Audit 是高影响动作的可追溯证据
```

## 21.2 P0 主线

```text
Task Builder
→ Task Review
→ Funding / Commit
→ Supply Preview
→ Matching
→ Offer / Invite
→ Order
→ Arrival
→ Execution
→ Evidence
→ Completion
→ Settlement / Payout
→ Repeat
```

## 21.3 不可被页面设计破坏的产品红线

```text
No Task, No Generic People Search
Eligibility Before Ranking
Task / Slot / Order Separate
One Slot = One Human Position
Funding Before Paid Order
Ledger First
Trusted Does Not Bypass Safety
Location Is Purpose-bound and TTL-bound
Operator Uses Commands, Not Database Patches
AI Does Not Become System Truth
```

## 21.4 下一章

根据 Gap Audit，下一步进入：

```text
Chapter 22 — P0 Launch Catalog / Scenario & Role Template Pack
```

下一章必须将本章页面中出现的：

```text
Industry
Scenario
AgentRole
Atomic Capability
Must / Nice
Verification
Deliverable
Evidence
Pricing Unit
Risk Class
Check-in Method
Location Type
Cancellation Policy
Matching Policy
```

落成真正可配置的首发 Catalog，而不是继续增加抽象概念。
