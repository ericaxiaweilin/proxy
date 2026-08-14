# Proxy PRD v1.1
## Chapter 01 — Account / Identity / Role System

**文档类型**：增量细化 PRD  
**基于版本**：Proxy PRD v1.0 Complete  
**本章范围**：账户、身份、角色、Business 主体、KYC、Trust、Risk、身份切换与权限  
**说明**：仅包含本次细化内容，不重复完整 PRD 的其他章节。

---

# 1. 目标

本章解决 Proxy 的最底层身份问题：

1. 一个用户是否可以同时是 Requester 和 Agent；
2. Individual 与 Business 如何共存；
3. Business 是否是独立实体；
4. Task 到底属于个人还是公司；
5. Requester / Agent 如何切换；
6. KYC、Trust、Risk 如何分离；
7. Agent 公开身份与真实 KYC 身份如何隔离；
8. 不同身份分别有什么权限。

---

# 2. 核心原则

Proxy 不是两个独立 App。

一个自然人可以同时拥有：

```text
User
├── Requester Identity
└── Agent Identity
```

因此：

> **Requester / Agent 是业务身份，不是两个独立登录账户。**

正确模型：

```text
Account
   ├── Requester Profile
   └── Agent Profile
```

Business 则是独立组织对象：

```text
User
   └── Business Membership
          └── Business Account
```

---

# 3. UserAccount

## 3.1 定义

```json
{
  "user_id": "usr_xxx",
  "phone": "...",
  "email": "...",
  "account_status": "ACTIVE",
  "kyc_status": "BASIC_VERIFIED",
  "risk_status": "NORMAL",
  "created_at": "..."
}
```

## 3.2 UserAccount 负责

- 登录；
- 手机号；
- Email；
- 基础实名；
- Account Risk；
- 安全设置；
- 通知设置；
- 账户关闭状态。

## 3.3 UserAccount 不负责

以下数据必须属于独立业务对象：

- Agent Skills；
- Agent Industry；
- Agent Pricing；
- Company；
- Task；
- Availability；
- Portfolio；
- Business Billing。

---

# 4. Requester Identity

注册 Proxy 后，用户默认拥有基础 Requester 能力。

推荐状态：

```text
UNVERIFIED
→ BASIC_VERIFIED
→ TRANSACTION_READY
→ TRUSTED
→ RESTRICTED
```

Requester 的“身份”与 Task 的“发布主体”分开。

Task Principal：

```text
INDIVIDUAL
BUSINESS
```

未来可扩展：

```text
ORGANIZATION
AGENCY
```

---

# 5. Individual Requester

个人主体可以：

- 创建 Task Draft；
- 发布个人 Task；
- Fast Match；
- Curated Match；
- 支付；
- Chat；
- Rating；
- Trusted Proxy；
- Repeat Task；
- Saved Location；
- Saved Template。

默认不提供：

- Corporate Billing；
- Team Member；
- Business Analytics；
- Business Permission；
- Bulk Posting。

---

# 6. Business Account

Business 不是 User Profile 里的一个公司字段，而是独立业务实体。

```json
{
  "business_id": "biz_xxx",
  "business_name": "ABC Restaurant",
  "business_type": "FNB",
  "verification_status": "VERIFIED",
  "billing_profile": {},
  "default_venues": [],
  "status": "ACTIVE"
}
```

Business Account 可承载：

- Business Name；
- Business Type；
- Verification；
- Billing；
- Tax Info；
- Saved Venues；
- Task Templates；
- Trusted Proxy Team；
- Business Wallet；
- Business Task History；
- Team Members；
- Permission。

---

# 7. Business Membership

一个 Business 未来可以有多个用户。

```text
Business
├── Owner
├── Admin
├── Manager
└── Member
```

MVP 可简化为：

```text
OWNER
MEMBER
```

数据结构：

```json
{
  "business_id": "biz_001",
  "user_id": "usr_123",
  "role": "OWNER",
  "status": "ACTIVE"
}
```

---

# 8. Business 必须独立存在的原因

## 8.1 多人管理

```text
Restaurant Manager → 发布任务
Finance            → 查看 Payment
Event Manager      → 管理 Slot
```

## 8.2 员工离职

员工离开公司后，以下数据仍然属于 Business：

```text
Business Task
Business History
Business Trusted Proxy
Business Billing
```

## 8.3 Business Trusted Team

```text
Bonsaidon
Trusted Team

An
Minh
Linh
```

关系必须是：

```text
Business → Agent
```

而不是：

```text
某个 Business Member → Agent
```

---

# 9. Agent Identity

Agent 需要主动开启。

```text
User
↓
Become a Proxy
↓
Agent Onboarding
↓
Basic Profile
↓
Industry
↓
Capability
↓
Verification
↓
Agent Ready
```

状态：

```text
NOT_CREATED
ONBOARDING
PENDING_VERIFICATION
ACTIVE
PAUSED
RESTRICTED
SUSPENDED
```

---

# 10. AgentProfile 与 UserAccount 分离

## UserAccount

```text
真实姓名
手机号
Email
身份证信息
Account Risk
Security
Payment Identity
```

## AgentProfile

```text
Public Name
Avatar
Industries
Roles
Skills
Languages
Portfolio
Pricing
Working Area
Availability
Visibility Policy
```

Requester 可以看到：

```text
An
```

平台内部则知道真实 KYC 身份。

---

# 11. Agent Public Identity

推荐对外显示：

```text
Public First Name
Display Name
Avatar
```

默认不公开：

```text
Legal Full Name
Phone
Email
Facebook
Zalo
Home Address
Government ID
```

真实身份仅用于：

- KYC；
- 支付；
- 安全；
- 风控；
- 必要争议处理；
- 法规要求。

---

# 12. 一人多业务身份

一个 User 可以同时是：

```text
Thanh
├── Individual Requester
├── Agent
└── Bonsaidon Business Admin
```

因此禁止设计成：

```text
user_type = requester OR agent
```

推荐：

```text
requester capability = default
agent_profile = nullable
business_memberships = []
```

---

# 13. Requester / Agent Mode Switch

顶部建议：

```text
Proxy
[ Requester ▼ ]
```

点击：

```text
Use Proxy as

✓ Requester
○ Agent
```

如果没有 AgentProfile：

```text
Become a Proxy
```

Mode 回答的是：

> “我现在是在找人，还是在接任务？”

---

# 14. Principal Switch

Requester Mode 内还需要发布主体切换：

```text
Posting as
Individual
```

或：

```text
Posting as
Bonsaidon ▼
```

弹层：

```text
Individual
────────────
Bonsaidon
ABC Event
────────────
+ Create Business
```

Principal 回答的是：

> “我现在代表谁发布 Task？”

Mode 与 Principal 必须是两个不同概念。

---

# 15. Bottom Navigation

Requester Mode：

```text
Home
Tasks
Messages
Account
```

Agent Mode：

```text
Home
Matches
Jobs
Account
```

切换 Mode 后 IA 整体变化，但登录账户仍是同一个 UserAccount。

---

# 16. Task Ownership

Task 不能只存：

```text
requester_id
```

必须同时知道：

1. 谁创建；
2. Task 属于谁。

推荐：

```json
{
  "task_id": "task_xxx",
  "created_by_user_id": "usr_123",
  "principal_type": "BUSINESS",
  "principal_id": "biz_001"
}
```

例如：

```text
Thanh 创建 Task
但 Task 属于 Bonsaidon
```

这样 Task History、Billing、Trusted Proxy、Analytics、Refund 才不会混乱。

---

# 17. Business Member 离开后的数据行为

用户离开 Business 时，只更新：

```text
BusinessMembership
ACTIVE → LEFT
```

不能删除：

```text
UserAccount
BusinessAccount
Task
Order
Payment
TrustedProxyRelation
```

---

# 18. 首次体验

不建议注册时强迫用户选择：

> Requester or Agent?

推荐：

```text
Create Account
↓
Requester Home
```

默认：

```text
Individual Requester
```

页面另外提供：

```text
Earn with Proxy
Become a Proxy
```

只有用户主动点击后才创建 AgentProfile。

---

# 19. Create Business 入口

建议至少两个入口。

## Account

```text
Personal

Business Accounts
+ Create Business
```

## Publish Demand

```text
Who is this task for?

○ Me
○ My business

[ + Add Business ]
```

---

# 20. Business Verification

状态：

```text
DRAFT
PENDING
VERIFIED
REJECTED
SUSPENDED
```

MVP 字段：

```text
Business Name
Business Type
Tax Code / Registration
Contact Person
Phone
Business Address
```

具体越南上线材料后续单独确认，不在本章硬编码。

---

# 21. KYC 分层

## K0 — Contact Verified

```text
Phone Verified
```

允许：

- 浏览 Industry；
- 查看 Aggregate Supply；
- 创建 Task Draft。

## K1 — Identity Verified

允许：

- Publish Task；
- Invite Candidate；
- Payment。

## K2 — Agent Transaction Ready

要求：

```text
Identity + Payout Identity
```

允许：

- Accept Task；
- Receive Payout。

## K3 — Capability Verification

K3 不属于 Account KYC，而属于 Agent Capability Verification。

例如：

```text
English Verified
Chinese HSK5
Driving License
Legal Background
Medical Background
```

---

# 22. KYC ≠ Trust ≠ Risk

## KYC
回答：这个人是谁？

## Trust
回答：这个人在平台历史上有多可信？

## Risk
回答：这个账户当前是否存在风险？

三个状态不能合并成一个 `user_status`。

---

# 23. Requester Trust Tier

推荐：

```text
R0 NEW
R1 VERIFIED
R2 COMPLETED
R3 TRUSTED_BUSINESS
RX RESTRICTED
```

影响：

- Candidate Exposure；
- Sensitive Attribute；
- Invite Limit；
- Map Detail；
- Payment Requirement；
- Manual Review。

---

# 24. Account Risk State

```text
NORMAL
WATCH
RESTRICTED
SUSPENDED
BANNED
```

例如：

```text
agent_status = ACTIVE
account_risk = SUSPENDED
```

最终：

```text
transaction_allowed = false
```

---

# 25. Agent Pause

```text
AgentProfile.status = PAUSED
```

禁止：

- Available Now；
- Match Offer；
- 新 Agent Task。

不影响：

- Individual Requester；
- Business Membership；
- Existing Account；
- History。

---

# 26. Account Delete

关闭账户前必须检查：

```text
Open Task?
Open Order?
Pending Payout?
Pending Refund?
Dispute?
Business Ownership?
Legal Retention?
```

推荐状态：

```text
ACTIVE
→ CLOSING
→ CLOSED
```

---

# 27. 页面需求

本章至少产生：

```text
G01 Login / Register
G02 Account Verification
G03 Mode Switch
G04 Principal Switch
G05 Create Business
G06 Business Verification
A01 Become a Proxy
```

---

# 28. Requester Home Header

推荐：

```text
Proxy

Posting as
Bonsaidon ▼
```

或：

```text
Posting as
Individual
```

Agent Mode：

```text
Proxy Agent
```

不要把 Requester / Business / Agent 三种身份同时堆在一个页面做三个平级按钮。

---

# 29. 权限矩阵

| 功能 | Visitor | Individual | Verified Requester | Business | Agent |
|---|---:|---:|---:|---:|---:|
| 浏览 Industry | ✓ | ✓ | ✓ | ✓ | ✓ |
| Aggregate Supply | ✓ | ✓ | ✓ | ✓ | ✓ |
| Task Draft |  | ✓ | ✓ | ✓ | ✓ |
| Publish Task |  |  | ✓ | ✓ | ✓ |
| Candidate Set |  |  | ✓ | ✓ | ✓ |
| Pay |  |  | ✓ | ✓ | ✓ |
| Multi-slot |  | △ | ✓ | ✓ |  |
| Available Now |  |  |  |  | ✓ |
| Receive Offer |  |  |  |  | ✓ |
| Accept Task |  |  |  |  | ✓ |
| Receive Payout |  |  |  |  | ✓ |
| Boost |  |  |  |  | ✓ |

Agent 仍然是 User，因此可以同时拥有 Requester 权限。

---

# 30. 数据模型总览

```text
UserAccount
│
├── RequesterTrustProfile
│
├── AgentProfile
│   └── CapabilityPassport
│
└── BusinessMembership[]
        │
        └── BusinessAccount
```

Task：

```text
Task
├── created_by_user_id
├── principal_type
└── principal_id
```

---

# 31. 推荐 Schema

## UserAccount

```text
user_id
phone
email
account_status
kyc_level
risk_status
created_at
updated_at
```

## AgentProfile

```text
agent_id
user_id
display_name
avatar
status
visibility_policy
created_at
```

## RequesterTrustProfile

```text
user_id
trust_tier
completed_orders
dispute_rate
restricted_features
```

## BusinessAccount

```text
business_id
business_name
business_type
verification_status
billing_profile
status
```

## BusinessMembership

```text
business_id
user_id
membership_role
status
joined_at
left_at
```

---

# 32. Backend Permission Boundary

后端不应该：

```text
if user.role == ...
```

应该分别读取：

```text
account_status
kyc_level
agent_status
business_membership
trust_tier
risk_status
principal
```

最终计算：

```text
effective_permission
```

---

# 33. 安全边界

Requester 查看 Agent 只能通过：

```text
Valid Task
→ Qualified Candidate
→ Visibility Policy
```

不能因为 Requester 已验证，就直接搜索所有 Agent。

Agent 看 Requester 时只展示：

- Requester Trust；
- Principal Type；
- Business Verification；
- Task Context。

---

# 34. Notification Identity Routing

一个 User 同时拥有多个身份时，通知必须记录：

```text
context_type
context_id
```

例如：

```text
Requester:
Task #P1001 has a new match

Agent:
New English Greeter Offer

Business:
Saturday Opening still has 1 open slot
```

---

# 35. Analytics Identity Dimension

埋点除 `user_id` 外，还应记录：

```text
mode
principal_type
principal_id
agent_id
business_id
```

否则无法区分同一个人在不同身份下的行为。

---

# 36. Future-proof

身份模型必须支持：

```text
User
├── Individual Requester
├── Agent
├── Business A Member
├── Business B Owner
└── Agency C Manager
```

而不需要重新创建多个账户。

---

# 37. Acceptance Criteria

## AC-IDENTITY-01
一个 User 可以同时作为 Requester 和 Agent。

## AC-IDENTITY-02
开启 Agent 不创建第二个登录账户。

## AC-IDENTITY-03
Business 是独立实体，不属于某个个人 Profile。

## AC-IDENTITY-04
Task 必须同时记录：

```text
created_by + principal
```

## AC-IDENTITY-05
Requester / Agent Mode 可以切换。

## AC-IDENTITY-06
Requester Mode 下可以切换：

```text
Individual
Business A
Business B
```

## AC-IDENTITY-07
没有 AgentProfile 的用户不能进入：

```text
Available Now
Offer
Payout
Boost
```

## AC-IDENTITY-08
Agent Pause 不影响 Requester 身份。

## AC-IDENTITY-09
Business Member 离开后，Business / Task / Order / Payment / Trusted Team 不得丢失。

## AC-IDENTITY-10
Agent Public Identity 与 KYC Identity 必须隔离。

## AC-IDENTITY-11
KYC、Trust、Risk 必须是三个独立维度。

## AC-IDENTITY-12
Business Task 所有权属于 Business Principal，而不是 Task Creator。

## AC-IDENTITY-13
一个 User 可以加入多个 Business。

## AC-IDENTITY-14
账户存在未完成 Task / Payment / Dispute 时不能直接物理删除。

## AC-IDENTITY-15
身份相关 API 必须基于 Effective Permission 判断，而不是单一 role 字段。

---

# 38. 本章锁定结论

1. **UserAccount 是唯一登录主体。**
2. **Requester / Agent 是业务身份，不是两个账户。**
3. **Requester 默认存在；Agent 需要主动创建。**
4. **Business 是独立实体。**
5. **User 与 Business 通过 Membership 建立关系。**
6. **Task 同时记录 Creator 与 Principal。**
7. **Requester / Agent Mode 与 Requester Principal 是两个独立切换维度。**
8. **User / AgentProfile / BusinessAccount 数据严格分离。**
9. **KYC / Trust / Risk 严格分离。**
10. **Agent Public Identity 不等于真实 KYC Identity。**
11. **Agent Pause 不影响用户其他身份。**
12. **身份架构必须支持一人多身份、多 Business。**

---

# 39. 下一章

下一份增量 PRD：

> **Chapter 02 — Industry / Scenario / Role / Capability Graph**

重点解决：

```text
Requester 如何描述“我要什么人”
Agent 如何描述“我能做什么”
两边如何使用同一套 Graph 相遇
```
