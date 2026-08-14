# Proxy PRD v1.1
## Chapter 07 — Agent Capability Passport / 真人 Agent 能力护照

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 01 — Account / Identity / Role System
- Chapter 01A — Social Account Bridge
- Chapter 02 — Capability Graph
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 05 — Matching Engine / Eligibility & Ranking
- Chapter 06 — Fast Match / Invite / Offer Engine

**本章范围**：
- AgentProfile
- Capability Passport
- Role Activation
- Capability Verification
- Evidence / Credential
- Outcome-based Capability
- Availability-facing Supply Identity
- Pricing Preference
- Portfolio
- Social Capability
- Visibility / Privacy
- Progressive Disclosure
- Agent Growth
- Capability Decay
- Trust / Reliability inputs
- Business / Requester-facing views
- Agent self-management
- Analytics / Metrics

---

# 1. 本章目标

Capability Passport 要回答：

> **这个真人 Agent 到底能做什么，为什么可以相信，他现在愿不愿意做，以及这些信息在当前 Task 中可以被看到多少。**

它不是：

```text
简历
社交主页
网红主页
人才库 Profile
```

而是：

> **一个持续被真实任务、验证证据和履约结果更新的 Human Capability Record。**

---

# 2. Capability Passport 核心原则

## 2.1 Capability First

Requester 首先看到：

```text
Why this person fits the Task
```

不是：

```text
长简介
自拍
粉丝量
```

---

## 2.2 Outcome-backed

Agent 越做真实任务：

```text
Capability Passport
```

应该越强。

---

## 2.3 Task-relevant Exposure

Passport 不是全量公开。

显示内容：

```text
Task Relevance
∩ Visibility Policy
∩ Requester Permission
∩ Risk Policy
```

---

# 3. AgentProfile 与 UserAccount 分离

UserAccount 保存：

```text
Legal Identity
Phone
Email
Security
KYC
Risk
Payment Identity
```

AgentProfile 保存：

```text
Display Identity
Roles
Capabilities
Languages
Experience
Portfolio
Pricing
Work Area
Availability
Visibility
```

---

# 4. AgentProfile Schema

推荐：

```text
agent_id
user_id

display_name
avatar
headline
intro

home_city
working_areas[]

agent_status

public_identity_level

default_visibility_policy

created_at
updated_at
```

---

# 5. Agent Status

```text
DRAFT
ACTIVE
PAUSED
RESTRICTED
SUSPENDED
CLOSED
```

含义：

## DRAFT

AgentProfile 已创建，但未完成基础设置。

## ACTIVE

可以进入 Matching。

## PAUSED

保留 Agent 身份，但暂不进入供给池。

## RESTRICTED

部分角色 / 能力 /交易受限。

## SUSPENDED

停止 Matching / Offer。

## CLOSED

Agent 身份关闭。

---

# 6. Capability Passport 结构

建议分为：

```text
1. Roles
2. Capabilities
3. Languages
4. Professional Background
5. Credentials
6. Portfolio
7. Social Capability
8. Real-world Outcome
9. Pricing Preference
10. Work Area
11. Availability
12. Reliability
13. Visibility
```

---

# 7. AgentRole

AgentRole 表示：

> Agent 愿意且当前可以接什么真人角色。

Schema：

```text
agent_role_id
agent_id
role_id

status
qualification_status

source
activated_at
paused_at
```

状态：

```text
SUGGESTED
ACTIVE
PAUSED
RESTRICTED
```

---

# 8. Role Qualification

推荐：

```text
NOT_QUALIFIED
QUALIFIED
VERIFIED
PROVEN
```

解释：

## NOT_QUALIFIED

缺少必要能力。

## QUALIFIED

满足基础 Capability。

## VERIFIED

关键 Capability 已被可靠验证。

## PROVEN

已有真实 Order Outcome 支撑。

---

# 9. Role 不自动激活

系统可以根据 Capability 推导：

```text
You may qualify for Hotel Guest Support
```

但默认：

```text
SUGGESTED
```

Agent 明确选择：

```text
Activate this role
```

后才进入真实供给。

---

# 10. Capability Record

每个能力是独立对象。

```text
agent_capability_id
agent_id
capability_id

level_type
level_value

verification_status
verification_strength

source
observed_at
expires_at

status
```

---

# 11. Capability Verification Status

正式统一：

```text
SELF_REPORTED
EVIDENCED
DOCUMENT_VERIFIED
PLATFORM_VERIFIED
OPERATOR_VERIFIED
OUTCOME_VERIFIED
STALE
EXPIRED
REVOKED
```

---

# 12. Verification Strength

可以内部映射：

```text
LOW
MEDIUM
HIGH
VERY_HIGH
```

但 Requester 不需要看到内部 Numeric Score。

---

# 13. Capability Source

```text
USER_CLAIM
CERTIFICATE
PLATFORM_TEST
PORTFOLIO
SOCIAL_CONNECTION
OPERATOR_REVIEW
ORDER_OUTCOME
BUSINESS_REFERENCE
```

---

# 14. Outcome Verified Capability

这是长期最重要的能力来源。

例如：

```text
Agent completed 8 Greeter tasks
On-time 98%
4.9 average outcome
3 repeat hires
```

系统可以提升：

```text
EVENT_RECEPTION
→ OUTCOME_VERIFIED
```

---

# 15. Capability 不等于一次标签

不能：

```text
completed one task
→ forever expert
```

需要：

```text
count
recency
quality
context
```

---

# 16. Capability Evidence

推荐对象：

```text
CapabilityEvidence
```

字段：

```text
evidence_id
agent_id
capability_id

evidence_type
source_reference

verification_status
verified_by
verified_at
expires_at

visibility
```

---

# 17. Credential

证书 / License 独立对象：

```text
credential_id
agent_id
credential_type
issuer
credential_number masked
issued_at
expires_at
verification_status
document_reference
```

---

# 18. Credential Privacy

Requester 默认不看：

```text
完整证书号码
原始身份证明
```

只显示：

```text
Verified
Issuer
Validity
```

---

# 19. Languages

语言能力建议独立结构：

```text
language_code
level_framework
level
verification_status
```

例如：

```text
English
CEFR
B2
PLATFORM_VERIFIED
```

或者：

```text
Chinese
HSK
5
DOCUMENT_VERIFIED
```

---

# 20. Professional Background

结构化：

```text
domain
years
current_status
verification
evidence
```

示例：

```text
Manufacturing
3 years
OPERATOR_VERIFIED
```

---

# 21. Work Experience

工作经历可以存在，但不是主要 Candidate Ranking 页面。

对象：

```text
AgentExperience
```

字段：

```text
organization optional
role_title
domain
start_at
end_at
verification_status
visibility
```

---

# 22. Portfolio

PortfolioItem：

```text
portfolio_item_id
agent_id

source_type
media_type
title
description

industry_ids[]
scenario_ids[]
role_ids[]
capability_ids[]

verification_status
visibility
```

---

# 23. Portfolio Source

```text
UPLOAD
SOCIAL_IMPORT
TASK_OUTCOME
BUSINESS_APPROVED
```

---

# 24. Portfolio Task Relevance

Candidate Detail 只优先展示：

> 当前 Task 相关作品。

例如：

```text
Task = Restaurant UGC Creator
```

显示：

```text
F&B video
restaurant content
short video
```

不优先显示：

```text
完全无关摄影作品
```

---

# 25. Evidence 与 Portfolio 分离

Task Evidence：

```text
Private Transaction Artifact
```

Portfolio：

```text
Agent-authorized Public / Task-visible Work Sample
```

Evidence 不能自动进入 Portfolio。

---

# 26. Social Capability

来自 Social Bridge。

例如：

```text
TikTok Connected
12k verified followers
5 relevant portfolio items
```

但只在：

```text
Social / Creator Task
```

相关时进入 Candidate View / Ranking。

---

# 27. Social Profile Privacy

默认不公开：

```text
Raw handle
Direct profile URL
Private social contact
```

除非：

```text
Task-relevant
+
Agent visibility allows
```

---

# 28. Pricing Preference

Agent 可以设置：

```text
Default Rate
Min Pay
Role-specific Rate
Hourly
Fixed
Travel Preference
Urgent Premium Preference
```

---

# 29. Pricing Preference ≠ Public Price Always

Requester 可以看到：

```text
Task-relevant price
```

而不是 Agent 所有内部价格设置。

---

# 30. Work Area

Agent 定义：

```text
Cities
Areas
Max Distance
Preferred Areas
Avoided Areas
```

用于 Eligibility / Ranking。

---

# 31. Work Area Privacy

Requester 不需要知道：

```text
Agent home address
```

只需要：

```text
Works in Tây Hồ
Approx ETA
```

---

# 32. Availability Connection

Capability Passport 与 Availability 分开，但展示上相连。

Passport 回答：

```text
Can this person do it?
```

Availability 回答：

```text
Can this person do it now / then?
```

---

# 33. Available Now

Agent 可以快速开启：

```text
Available Now
```

并指定：

```text
Duration
Area
Active Roles
Min Pay
```

---

# 34. Scheduled Availability

支持未来时间段：

```text
Saturday 14:00–22:00
Sunday 09:00–18:00
```

---

# 35. Availability 不写死在 Profile

不要：

```text
agent.is_available = true
```

必须单独对象 / Session。

---

# 36. Reliability

Capability Passport 可以显示可信的履约摘要。

建议拆：

```text
On-time Rate
Completion Rate
Cancellation Rate
Response Reliability
Repeat Hire
```

---

# 37. 不使用一个黑盒 Trust Score

Requester 不需要：

```text
Trust 87/100
```

更适合：

```text
96% on-time
12 completed tasks
4 repeat hires
```

---

# 38. Context-specific Reliability

例如：

```text
Overall Completion 92%

Event Greeter Completion 99%
```

Task Context 下优先显示：

```text
Event Greeter
```

相关数据。

---

# 39. New Agent

新 Agent 没 Outcome：

显示：

```text
New on Proxy
Identity Verified
English B2 Verified
Portfolio Available
```

不要显示：

```text
0 tasks
```

作为负面标签。

---

# 40. Newcomer Badge

可以：

```text
New Qualified
```

表达：

> 新，但已满足任务条件。

---

# 41. Capability Growth

完成任务后：

```text
Order Outcome
↓
Capability Update
↓
Role Qualification Update
↓
Better Matching
```

---

# 42. Capability Progress

Agent Home 可以显示：

```text
Improve your chances

Verify English B2
+ unlock more interpreter tasks

Add short-video portfolio
+ improve creator matching
```

---

# 43. Capability Progress 不游戏化过度

不要做：

```text
Level 99 Human
XP farming
```

重点：

```text
真实能力
真实验证
真实收入机会
```

---

# 44. Capability Decay

部分能力会失效：

```text
License expired
Certificate stale
Social disconnected
Portfolio removed
```

状态：

```text
ACTIVE
STALE
EXPIRED
REVOKED
```

---

# 45. Outcome Recency

真实任务历史也应考虑时间。

例如：

```text
3 years ago
```

的经验不应等同于：

```text
last month
```

具体 decay 权重由 Ranking 章节配置。

---

# 46. Identity Visibility

Public Candidate Identity 建议：

```text
Display Name / First Name
Avatar
Verified badges
Task-relevant experience
```

不默认：

```text
Legal full name
phone
private email
home address
government ID
```

---

# 47. Progressive Disclosure Levels

Capability Passport 必须服从：

```text
L0 Aggregate
L1 No Task
L2 Valid Task
L3 Reviewed / Secured Task
L4 Matched
L5 Execution
```

---

# 48. L0 / L1

不展示具体 Agent。

只展示：

```text
12 qualified Agents nearby
```

---

# 49. L2 — Valid Task

可以展示有限 Candidate：

```text
Display Name
Avatar
Why Matched
Capabilities
Approx ETA
Relevant Outcome
Price
```

---

# 50. L3 — Reviewed / Secured Task

可以增加：

```text
Relevant Portfolio
More detailed capability proof
Professional background
```

---

# 51. L4 — Matched

Order 创建后：

可以解锁：

```text
Platform Chat
Execution-needed identity
More exact venue coordination
```

---

# 52. L5 — Execution

只有必要时：

```text
Precise location
Emergency contact
Execution-specific information
```

任务结束后撤回。

---

# 53. Agent Visibility Policy

Agent 可设置：

```text
MATCHED_TASK_ONLY
VERIFIED_REQUESTER_ONLY
BUSINESS_ONLY
PAUSED
```

---

# 54. Per-field Visibility

部分字段可单独配置：

```text
Portfolio
Social
Professional Background
Appearance-related field
Voice Sample
```

---

# 55. Privacy Default

默认：

> **最小必要可见。**

不是：

```text
profile public by default
```

---

# 56. Candidate Summary

Requester 看到的不是“完整 Passport”。

而是：

```text
Task-specific Passport View
```

---

# 57. Candidate Card Example

```text
An
Strong Match

✓ English B2 verified
✓ 9 similar event tasks
✓ 96% on-time
✓ Available full shift

Approx ETA: 18 min
Pay: 650k
```

---

# 58. Candidate Detail Example

```text
Why An matches

Capabilities
- English B2 verified
- Event reception proven

Relevant Experience
- 9 event greeter tasks
- 4 F&B openings

Relevant Portfolio
- 3 event photos

Reliability
- 96% on-time
- 100% completion last 10 tasks

Availability
- Full shift

Price
- 650k
```

---

# 59. 不优先展示

Candidate Detail 不要优先：

```text
Birthday
Followers
Long bio
Home district
Personal lifestyle
Random social posts
```

除非 Task 相关且允许。

---

# 60. Agent Self-view

Agent 自己看到完整 Passport：

```text
Identity
Roles
Capabilities
Verification
Portfolio
Social
Pricing
Areas
Availability
Outcome
Visibility
```

---

# 61. Agent Edit Policy

Agent 可以修改：

```text
Intro
Role Preference
Work Area
Pricing
Portfolio
Availability
Visibility
```

不能修改：

```text
Verified Outcome
Platform-generated Reliability
KYC result
Audit history
```

---

# 62. Capability Claim

Agent 可以：

```text
Add Capability
```

初始：

```text
SELF_REPORTED
```

---

# 63. Verification CTA

如果某 Capability 常被 Task 要求验证：

系统提示：

```text
Verify this capability
```

---

# 64. Verification Route

可能：

```text
Upload Certificate
Take Platform Test
Connect Social
Operator Review
Complete First Task
```

---

# 65. Verification Cost

未来某些：

```text
premium verification
```

可以收费。

但不能：

> 付费就直接 Verified。

收费只能覆盖：

```text
assessment
document review
test
```

---

# 66. Business Reference

Business 完成合作后：

可以提供：

```text
Role reference
```

但参考不等于最终平台验证。

---

# 67. Outcome Source of Truth

只有正式：

```text
Order
```

产生：

```text
Outcome Verified Capability
```

手工描述的线下经验：

```text
SELF_REPORTED / EVIDENCED
```

不能伪装成 Proxy Outcome。

---

# 68. Reputation Separation

必须区分：

```text
Capability
Reliability
Safety
Content Performance
Popularity
```

这些不能混成一个总分。

---

# 69. Content Performance

Agent 视频很火：

```text
Content Performance high
```

不代表：

```text
Execution Reliability high
```

---

# 70. Safety Record

Safety / Incident 不直接公开所有细节。

Matching Engine 可以使用：

```text
risk eligibility
```

Requester 只看到必要结果。

---

# 71. Business Trusted Team

Business 可以：

```text
Add to Trusted Team
```

关系：

```text
Business
↔
Agent
```

不修改 Agent 的全局 Capability。

---

# 72. Trusted Team Benefits

以后：

```text
Direct Invite
Repeat Task
Preferred Ranking
Reduced friction
```

仍需：

```text
current eligibility
availability
acceptance
```

---

# 73. Consumer / Member 身份不自动成为 Agent

即使某用户：

```text
is Cafe Gold Member
```

也不能因为会员身份进入供给池。

必须：

```text
Become a Proxy
```

---

# 74. Data Ownership

Agent 可以：

```text
manage self-reported data
revoke portfolio
disconnect social
pause supply
```

平台保留：

```text
transaction outcome
audit
legal retention
```

---

# 75. Delete Capability

如果 Capability 从未用于正式交易：

可以：

```text
remove claim
```

如果已有：

```text
Order history
```

则：

```text
deactivate / hide
```

但历史 Outcome 保留。

---

# 76. Capability Merge / Taxonomy Migration

如果 Graph 中 Capability 被合并：

```text
old capability
→ deprecated
→ canonical capability
```

Agent Passport 必须迁移。

---

# 77. Agent Passport Version

推荐：

```text
passport_version
```

用于：

```text
matching audit
candidate snapshot
```

---

# 78. Candidate Snapshot

Invite / Offer 时保存：

```text
passport_snapshot_version
```

避免争议：

> 当时系统为什么认为这个 Agent 合格？

---

# 79. Passport API

建议：

```text
GET /agents/me/passport
PATCH /agents/me/profile
POST /agents/me/roles
POST /agents/me/capabilities
POST /agents/me/portfolio
POST /agents/me/credentials
```

---

# 80. Candidate-facing API

必须要求：

```text
task_id
slot_id
match_snapshot_id
```

例如：

```text
GET /tasks/{task_id}/slots/{slot_id}/candidates/{agent_id}
```

---

# 81. No Generic Public Agent API

不提供：

```text
GET /agents?city=...
GET /agents?gender=...
GET /agents?followers=...
```

这种通用人物搜索 API。

---

# 82. Agent Profile Search Exception

P1 可支持：

```text
Known Trusted Proxy
```

通过：

```text
existing relationship
```

直接找到。

不是公开搜索陌生真人。

---

# 83. Availability API Boundary

Passport 可以展示 Availability Summary。

真实详细 Availability：

由 Availability Service 管理。

---

# 84. Analytics

Agent 侧：

```text
Profile Completion
Capability Verification Rate
Role Activation
Portfolio Coverage
Time to First Offer
Time to First Order
Earnings
Repeat Hire
```

---

# 85. Passport Quality

平台侧：

```text
Verified Capability Ratio
Outcome-backed Capability Ratio
Stale Capability Ratio
Role Qualification Coverage
```

---

# 86. Supply Growth

重要指标：

```text
New Agent → Qualified
Qualified → First Offer
First Offer → First Order
First Order → Repeat
```

---

# 87. Passport Conversion

例如：

```text
Verify English
→ +32% eligible task pool
```

可以提示 Agent。

---

# 88. 不用虚假承诺

不能显示：

```text
Verify now and earn 2M today
```

可以：

```text
This verification may unlock more interpreter tasks.
```

---

# 89. Data Security

Passport 包含：

```text
identity-adjacent data
professional proof
portfolio
social
location preferences
```

必须按 Chapter 02B D0–D5 分级。

---

# 90. Sensitive Attributes

如果 Agent 自愿填写：

```text
gender
age range
appearance style
```

默认：

```text
not publicly searchable
```

只有合法 Task Policy 激活时可参与匹配。

---

# 91. Agent Consent

Agent 必须知道：

```text
哪些字段会参与 Matching
哪些字段什么时候可见
```

---

# 92. Visibility Preview

Agent Settings 可以：

```text
Preview what a Requester sees
```

按：

```text
Task context
```

预览。

---

# 93. Content / Portfolio Rights

如果作品来自：

```text
Business Task
```

加入 Portfolio 前要检查：

```text
usage right
business approval
privacy
```

---

# 94. Capability Passport 不做社交粉丝页

禁止把 Passport 做成：

```text
followers
fan count
likes ranking
profile popularity
```

---

# 95. Agent Public Identity

长期可以有：

```text
shareable professional card
```

但只展示：

```text
publicly opted-in capability
portfolio
```

不能成为公开人才库。

---

# 96. Marketplace Purpose

Capability Passport 的唯一核心目的：

```text
Improve Qualification
Improve Matching
Improve Trust
Improve Earnings
Improve Repeat
```

---

# 97. MVP P0

必须实现：

```text
AgentProfile
AgentRole
Capability Record
Language
Credential
Portfolio
Role Qualification
Verification Status
Pricing Preference
Work Area
Availability Summary
Outcome Summary
Visibility Policy
Candidate Task-specific View
Agent Self-view
Passport Version
```

---

# 98. P1

```text
Platform Tests
Advanced Verification
Business Reference
Voice Sample
Professional Card
Capability Recommendation
Advanced Portfolio
Verification Marketplace
```

---

# 99. Acceptance Criteria

## AC-PASSPORT-01
AgentProfile 必须与 UserAccount 分离。

## AC-PASSPORT-02
Capability Passport 不能作为公开人才库。

## AC-PASSPORT-03
Role 必须有独立 Activation State。

## AC-PASSPORT-04
系统推导 Role 默认只能是 SUGGESTED。

## AC-PASSPORT-05
Agent 必须主动激活 Role 后才能进入真实供给。

## AC-PASSPORT-06
每个 Capability 必须有 Verification Status。

## AC-PASSPORT-07
Capability Claim 与 Outcome Verified 必须区分。

## AC-PASSPORT-08
只有真实 Order 可以形成平台 Outcome-backed Capability。

## AC-PASSPORT-09
Credential 必须支持 Expiry。

## AC-PASSPORT-10
过期 Credential 不得继续作为强 Eligibility 证据。

## AC-PASSPORT-11
Portfolio 与 Task Evidence 必须分离。

## AC-PASSPORT-12
Task Evidence 不得自动进入 Portfolio。

## AC-PASSPORT-13
Social Capability 只在相关 Task 使用。

## AC-PASSPORT-14
Requester 默认不得看到 Agent 私人 Social Handle。

## AC-PASSPORT-15
Agent Home Address 不得进入 Candidate View。

## AC-PASSPORT-16
Reliability 必须尽量拆成可解释指标，而非单一黑盒分数。

## AC-PASSPORT-17
New Agent 不得因无历史被标为低质量。

## AC-PASSPORT-18
必须支持 New Qualified 状态。

## AC-PASSPORT-19
Agent Capability 必须支持 STALE / EXPIRED / REVOKED。

## AC-PASSPORT-20
Candidate View 必须遵守 Progressive Disclosure。

## AC-PASSPORT-21
Candidate API 必须要求 Task / Slot Context。

## AC-PASSPORT-22
不得提供通用公开 Agent Search API。

## AC-PASSPORT-23
Agent 可以管理自报数据，但不能修改平台生成 Outcome。

## AC-PASSPORT-24
Business Trusted Team 不得改变 Agent 全局 Capability。

## AC-PASSPORT-25
Membership 身份不得自动转化为 Agent 身份。

## AC-PASSPORT-26
Passport 必须版本化。

## AC-PASSPORT-27
Matching Snapshot 必须能引用 Passport Version。

## AC-PASSPORT-28
Sensitive Attribute 默认不得公开搜索。

## AC-PASSPORT-29
Agent 必须可以预览自己的可见信息。

## AC-PASSPORT-30
Capability Passport 的核心目标必须是 Qualification / Matching / Earnings / Repeat，而非 Social Popularity。

---

# 100. 本章锁定结论

1. **Capability Passport 是真人供给侧的核心资产，不是简历。**
2. **AgentProfile 与 Legal UserAccount 分离。**
3. **Role 必须主动激活。**
4. **Capability 必须可验证、可过期、可撤销。**
5. **真实 Order Outcome 是最重要的长期验证来源。**
6. **Portfolio 与 Evidence 严格分离。**
7. **Social 只作为 Task-relevant Capability 证据。**
8. **Requester 看到的是 Task-specific Passport View，不是完整个人档案。**
9. **Reliability、Capability、Safety、Popularity、Content Performance 必须分开。**
10. **新 Agent 必须能凭 Verification / Portfolio 获得第一次真实机会。**
11. **Agent 越做真实任务，Passport 越强，未来 Earnings 越高。**
12. **Passport 必须服从 Progressive Disclosure 与 Purpose-bound Data Safety。**
13. **No Task, No Generic People Search 继续保持。**

---

# 101. 下一章

下一份增量 PRD：

> **Chapter 08 — Availability / Supply Capacity / “我现在有空”**

重点解决：

```text
Agent 什么时间可以接
在哪里可以接
挂多久
哪些 Role 当前愿意接
Available Now 如何工作
Scheduled Availability 如何工作
如何避免超卖真人时间
如何形成真正的实时 Human Supply
```

这会把 Capability Passport 从“会做什么”推进到：

> **“什么时候真的可以被交易。”**
