# Proxy PRD v1.1
## Chapter 02 — Industry / Scenario / Role / Capability Graph

**文档类型**：增量细化 PRD  
**基于版本**：Proxy PRD v1.0 Complete  
**前置依赖**：
- Chapter 01 — Account / Identity / Role System
- Chapter 01A — Social Account Bridge

**本章范围**：
- Industry
- Scenario
- Role
- Capability
- Attribute
- Verification
- Channel / Social Platform
- Requester Need Graph
- Agent Capability Graph
- Graph Matching Boundary
- Graph Governance
- Versioning
- Admin / Operator 配置

**不重复内容**：
账户、Business、KYC、Task 状态机、Matching Ranking、Availability、Map、支付、Boost 等其他章节不在本文件重复。

---

# 1. 本章目标

本章解决 Proxy 最核心的结构化问题：

> Requester 如何表达“我要什么样的人”，Agent 如何表达“我能做什么”，两边如何使用同一套结构相遇。

这不是普通 Category Tree。

它必须同时支持：

1. 一个 Agent 跨多个行业复用；
2. 一个 Role 出现在多个 Scenario；
3. 一个 Capability 被多个 Role 共用；
4. Capability 有验证级别；
5. 某些 Attribute 只有特定场景允许使用；
6. Social Platform 只作为 Channel / Capability 维度；
7. Requester 可以按 Task Context 组合 Must-have / Nice-to-have；
8. 新行业上线不要求修改核心代码；
9. Operator 可以持续扩展 Graph；
10. Matching Engine 只消费已经结构化好的 Graph，不在运行时猜业务。

---

# 2. 核心模型

完整结构：

```text
Industry
   ↓
Scenario
   ↓
Role
   ↓
Capability
   ↓
Attribute / Verification / Evidence
   ↓
Agent
```

对于 Content / Social 类任务：

```text
Industry
   ↓
Scenario
   ↓
Role
   ↓
Capability
   ↓
Channel / Social Platform
   ↓
Verification / Metrics
   ↓
Agent
```

---

# 3. 这不是单向树，而是 Graph

不能设计成：

```text
Industry
└── Scenario
    └── Role
        └── Capability
```

然后每一个 Capability 只能属于一个 Role。

因为真实世界存在大量复用。

例如：

```text
Capability: ENGLISH_B2
```

可以用于：

```text
Event Greeter
Business Interpreter
Hotel Guest Support
Store Reception
Tour Guide
```

因此：

```text
Industry ↔ Scenario
Scenario ↔ Role
Role ↔ Capability
Capability ↔ Agent
```

都应该是多对多关系。

---

# 4. Graph 的核心对象

## 4.1 Industry

代表大类业务领域。

示例：

```text
FNB_RETAIL
EVENT_EXHIBITION
HOSPITALITY_TRAVEL
BUSINESS_PROFESSIONAL
CONTENT_MARKETING
PERSONAL_ERRAND
```

Industry 不直接用于最终 Eligibility。

它主要负责：

- 导航；
- 场景组织；
- Business 定位；
- 推荐；
- Analytics；
- Supply / Demand 统计；
- Agent Experience 聚合。

---

# 5. Scenario

Scenario 表示真实业务场景。

例如：

## F&B / Retail

```text
GRAND_OPENING
STORE_OPERATION
MYSTERY_VISIT
PRODUCT_LAUNCH
PROMOTION_EVENT
```

## Event

```text
CONFERENCE
EXHIBITION
PRIVATE_EVENT
ROADSHOW
BRAND_EVENT
```

## Business

```text
BUSINESS_MEETING
SITE_VISIT
FACTORY_VISIT
CUSTOMER_RECEPTION
DOCUMENT_SUPPORT
```

Scenario 影响：

- 可选 Role；
- 可选 Attribute；
- Evidence Template；
- Risk Policy；
- Suggested Duration；
- Suggested Price Unit；
- Matching Mode；
- Sensitive Attribute Gate。

---

# 6. Role

Role 回答：

> 这个 Task Slot 里，需要一个人扮演什么角色？

示例：

```text
GREETER
EVENT_ASSISTANT
INTERPRETER
MC
QUEUE_PROXY
CONTENT_TALENT
UGC_CREATOR
SITE_VISIT_REP
LOCAL_GUIDE
STORE_REVIEWER
```

Role 是 TaskSlot 的核心字段之一。

推荐：

```text
TaskSlot.role_id
```

---

# 7. Capability

Capability 回答：

> 要胜任这个 Role，这个人需要具备什么能力？

Capability 必须结构化。

示例：

## Language

```text
LANG_VI_NATIVE
LANG_EN_A2
LANG_EN_B1
LANG_EN_B2
LANG_EN_C1
LANG_ZH_HSK4
LANG_ZH_HSK5
```

## Event

```text
EVENT_RECEPTION
EVENT_HOSTING
GUEST_CHECKIN
CROWD_GUIDANCE
VIP_RECEPTION
```

## Content

```text
ON_CAMERA
SHORT_VIDEO_CREATION
SCRIPTING
VIDEO_EDITING
PHOTO_CONTENT
LIVESTREAM
SOCIAL_PUBLISHING
```

## Professional

```text
TECHNICAL_BACKGROUND
LEGAL_BACKGROUND
MEDICAL_BACKGROUND
MANUFACTURING_BACKGROUND
DESIGN_BACKGROUND
```

## Operational

```text
QUEUE_HANDLING
STORE_VISIT
DOCUMENT_DELIVERY
PICKUP
SITE_CHECK
```

---

# 8. Capability 必须原子化

错误：

```text
Good at events
Professional
Good communication
```

这些太模糊。

正确：

```text
EVENT_RECEPTION
MC_HOSTING
ENGLISH_B2
CUSTOMER_FACING
```

每个 Capability 应尽可能满足：

```text
可定义
可验证
可匹配
可复用
可统计
```

---

# 9. Capability Category

为了管理，需要给 Capability 分组。

推荐：

```text
LANGUAGE
ROLE_SKILL
PROFESSIONAL_BACKGROUND
SOCIAL
CONTENT
PHYSICAL
STYLE
LICENSE
EQUIPMENT
OPERATIONAL
SAFETY
```

---

# 10. Attribute

Attribute 与 Capability 不完全相同。

Capability 表示：

> “会什么”

Attribute 表示：

> “是什么 / 有什么特征”

例如：

```text
Age Range
Gender
Height
City
Style
Appearance
Voice Type
Dress Style
```

这些字段风险更高，必须进入单独治理。

---

# 11. Attribute Policy

每个 Attribute 必须有 Policy。

Schema：

```text
attribute_id
name
category
sensitivity_level
allowed_scenarios[]
allowed_roles[]
requester_reason_required
agent_visibility_default
verification_type
```

---

# 12. Attribute Sensitivity Level

推荐：

```text
S0 PUBLIC_SAFE
S1 TASK_RELEVANT
S2 SENSITIVE
S3 HIGHLY_RESTRICTED
```

示例：

## S0

```text
City
Language
Role Experience
```

## S1

```text
Height
Dress Style
Voice Type
```

## S2

```text
Gender
Age Range
Appearance Style
```

## S3

禁止作为普通搜索字段：

```text
Ethnicity
Religion
Political belief
Health status
Sexual orientation
```

S3 默认不允许进入 Matching。

---

# 13. Sensitive Attribute Gate

即使某个 Attribute 存在于 Agent Profile，也不表示 Requester 可以随时筛选。

必须：

```text
Task
↓
Scenario
↓
Role
↓
Attribute Policy
↓
Reason Code
↓
Allowed
```

例如：

```text
Task:
Women-only changing room assistant

Gender requirement:
Allowed with task reason
```

而：

```text
Queue Proxy
Need attractive female
```

默认：

```text
Not Allowed
```

---

# 14. Role Requirement Template

每个 Role 应有默认 Capability Template。

例如：

## GREETER

```text
Required:
CUSTOMER_FACING

Suggested:
EVENT_RECEPTION
ENGLISH_B1+

Optional:
HOSPITALITY_BACKGROUND
```

## BUSINESS_INTERPRETER

```text
Required:
LANGUAGE_VERIFIED
INTERPRETATION

Suggested:
BUSINESS_ETIQUETTE
INDUSTRY_BACKGROUND
```

## UGC_CREATOR

```text
Required:
ON_CAMERA
SHORT_VIDEO_CREATION

Optional:
SOCIAL_ACCOUNT_CONNECTED
FNB_CONTENT_EXPERIENCE
```

---

# 15. Requirement Level

Role Template 中每个 Capability 可以定义：

```text
REQUIRED
RECOMMENDED
OPTIONAL
PROHIBITED
```

Task Builder 生成时：

```text
REQUIRED
→ 默认 Must-have

RECOMMENDED
→ 默认 Nice-to-have
```

Requester 可以修改，但不能违反 Policy。

---

# 16. Requester Need Profile

Requester 不应该直接产生自由文本匹配。

最终生成：

```json
{
  "industry_id": "EVENT_EXHIBITION",
  "scenario_id": "CONFERENCE",
  "role_id": "GREETER",
  "must_have": [
    "LANG_EN_B2",
    "EVENT_RECEPTION"
  ],
  "nice_to_have": [
    "HOSPITALITY_BACKGROUND"
  ],
  "attributes": [],
  "channel_requirements": []
}
```

这就是：

> Task Need Profile

---

# 17. Agent Capability Profile

Agent 侧形成：

```json
{
  "agent_id": "agent_123",
  "industries": [
    "EVENT_EXHIBITION",
    "FNB_RETAIL"
  ],
  "roles": [
    "GREETER",
    "INTERPRETER"
  ],
  "capabilities": [
    {
      "capability_id": "LANG_EN_B2",
      "verification_status": "VERIFIED"
    },
    {
      "capability_id": "EVENT_RECEPTION",
      "verification_status": "OUTCOME_VERIFIED"
    }
  ]
}
```

---

# 18. Capability Verification Status

每个 Capability 单独记录可信度。

推荐：

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

# 19. Verification Strength

Matching 不应该只看：

```text
has_capability = true
```

还需要：

```text
verification_strength
```

例如：

```text
English B2
SELF_REPORTED
```

与：

```text
English B2
PLATFORM_VERIFIED
```

不是同一个可信度。

---

# 20. Capability Evidence

Capability 可以由多种 Evidence 支撑：

```text
Certificate
Portfolio
Past Order
Social Account
Operator Interview
Business Reference
Platform Test
```

Schema：

```text
capability_id
agent_id
evidence_type
source
verified_at
expires_at
verification_status
```

---

# 21. Outcome Verified Capability

Proxy 最有价值的一类验证不是证书，而是真实任务结果。

例如：

```text
Agent completed:
Event Greeter ×12
On-time 98%
Rating 4.9
```

系统可以形成：

```text
EVENT_RECEPTION
OUTCOME_VERIFIED
```

这会成为长期护城河。

---

# 22. Capability Level

部分 Capability 需要等级。

例如语言：

```text
A1
A2
B1
B2
C1
C2
```

主持：

```text
BEGINNER
EXPERIENCED
ADVANCED
```

推荐统一：

```text
level_type
level_value
```

不要所有能力都硬套 1–5 星。

---

# 23. Industry Experience

Industry 经验不要只用：

```text
industry_id = FNB
```

而是：

```text
FNB
completed_tasks = 8
verified_experience = true
```

Agent 可以没有显式选择某个 Industry，但因为真实任务完成而逐步进入。

---

# 24. Role Experience

Role Experience 独立统计：

```text
role_id
completed_count
on_time_rate
completion_rate
repeat_count
last_completed_at
```

---

# 25. Capability Graph 推导

Graph 应支持推导：

```text
Capability
→ Eligible Role
→ Eligible Scenario
→ Eligible Industry
```

例如：

```text
ENGLISH_B2
+
EVENT_RECEPTION
↓
GREETER
↓
CONFERENCE
GRAND_OPENING
HOTEL_EVENT
```

这样 Agent 不需要每个场景都手工勾一遍。

---

# 26. Agent 手工选择 vs 系统推导

Agent Onboarding：

用户可以主动选择：

```text
I can do Greeter
I can do Interpreter
```

系统也可以推导：

```text
Based on your verified capabilities,
you may also qualify for:
Guest Support
Hotel Reception
```

但系统自动推导出来的 Role 应标记：

```text
SUGGESTED
```

Agent 确认后才：

```text
ACTIVE
```

---

# 27. Role Activation State

AgentRole：

```text
SUGGESTED
ACTIVE
PAUSED
RESTRICTED
```

这样 Agent 可以：

> 我有能力，但暂时不接这个 Role。

---

# 28. Channel / Social Platform

Social Platform 不属于 Industry。

正确结构：

```text
Role
↓
Capability
↓
Channel Requirement
```

示例：

```text
UGC_CREATOR
↓
SHORT_VIDEO_CREATION
↓
TIKTOK
```

或者：

```text
SOCIAL_PUBLISHING
↓
XIAOHONGSHU
```

---

# 29. Channel Object

推荐：

```text
TIKTOK
XIAOHONGSHU
INSTAGRAM
FACEBOOK
YOUTUBE
ZALO
OTHER
```

Channel 只在相关 Role / Capability 中出现。

---

# 30. Social Capability Example

Task：

```text
Industry:
CONTENT_MARKETING

Scenario:
RESTAURANT_LAUNCH

Role:
UGC_CREATOR

Capability:
SHORT_VIDEO_CREATION

Channel:
TIKTOK
```

Must-have：

```text
TIKTOK_CONNECTED
ON_CAMERA
```

Nice-to-have：

```text
FNB_CONTENT_EXPERIENCE
FOLLOWERS >= 10000
```

---

# 31. Social Metric Requirement

不能把：

```text
followers >= 10k
```

直接设计成通用 Agent Filter。

它必须属于：

```text
Task Need
→ Social Channel Requirement
```

结构：

```json
{
  "channel": "TIKTOK",
  "metric": "FOLLOWERS",
  "operator": ">=",
  "value": 10000,
  "requirement_level": "NICE_TO_HAVE"
}
```

---

# 32. Equipment Capability

某些 Role 需要设备。

例如：

```text
Camera
Car
Motorbike
Laptop
Audio Equipment
```

这不完全属于人的能力。

建议：

```text
ResourceCapability
```

而不是塞进普通 Skill。

例如：

```text
HAS_MOTORBIKE
HAS_CAMERA
HAS_LAPTOP
```

---

# 33. License Capability

例如：

```text
DRIVING_LICENSE
MEDICAL_LICENSE
LEGAL_LICENSE
```

必须有：

```text
issuer
document
expiry
verification
```

过期后自动：

```text
EXPIRED
```

并停止作为 Must-have Eligibility。

---

# 34. Professional Background

Professional Background 不能只是一段 CV。

结构：

```text
domain
years
verification
current_status
evidence
```

例如：

```text
MANUFACTURING
3 years
OPERATOR_VERIFIED
```

---

# 35. Style / Appearance

Style 类字段必须谨慎。

建议只在明确场景使用：

```text
FORMAL
CASUAL
SPORTY
BUSINESS
LUXURY
YOUTHFUL
```

用于：

- Dress Code；
- Brand Event；
- Content Role。

不允许形成：

```text
Beauty Score
Hotness Rank
Most Attractive Agents
```

---

# 36. Voice Capability

例如：

```text
CLEAR_SPEAKING
MC_VOICE
VOICE_SAMPLE_AVAILABLE
```

Voice Sample 属于 Portfolio / Evidence，不应把“声音好听”变成全站排行榜。

---

# 37. Capability Dependency

某些 Capability 有依赖。

例如：

```text
BUSINESS_INTERPRETATION
requires:
LANG_EN_B2+
```

或者：

```text
DRIVING_TASK
requires:
DRIVING_LICENSE
```

Graph 需要支持：

```text
requires_capability
```

---

# 38. Capability Conflict

也需要支持冲突。

例如：

```text
AGE_RESTRICTED_TASK
```

可能要求：

```text
age >= legal_threshold
```

或者某些 Role 不允许未成年人。

结构：

```text
conflict_rule
```

---

# 39. Graph Rule

推荐：

```text
ALLOW
REQUIRE
RECOMMEND
DISALLOW
CONDITIONAL
```

例如：

```text
Scenario: Medical Escort
Role: Medical-background Agent
Capability: Medical Background
Rule: REQUIRE
```

---

# 40. Graph Configuration

Graph 不应该硬编码在客户端。

需要平台配置对象：

```text
GraphNode
GraphEdge
GraphPolicy
```

注意：

这里是产品配置 Graph，不是业务事实影子库。

它定义：

```text
哪个 Scenario 可以用哪些 Role
哪个 Role 需要哪些 Capability
哪个 Attribute 在什么场景允许
```

---

# 41. GraphNode

```text
node_id
node_type
code
name
description
status
version
```

node_type：

```text
INDUSTRY
SCENARIO
ROLE
CAPABILITY
ATTRIBUTE
CHANNEL
```

---

# 42. GraphEdge

```text
edge_id
from_node_id
to_node_id
relation_type
requirement_level
policy_id
status
version
```

relation_type：

```text
CONTAINS
SUPPORTS
REQUIRES
RECOMMENDS
ALLOWS
DISALLOWS
```

---

# 43. GraphPolicy

用于：

- Sensitive Attribute；
- Verification；
- Role eligibility；
- Channel；
- Region；
- Age；
- Legal restrictions。

Schema：

```text
policy_id
policy_type
conditions
action
reason_required
review_required
```

---

# 44. Graph Versioning

Graph 一定会持续修改。

不能直接改线上规则而没有版本。

推荐：

```text
graph_version
effective_from
effective_to
status
```

状态：

```text
DRAFT
REVIEW
ACTIVE
DEPRECATED
```

---

# 45. Task 必须绑定 Graph Version

Task 创建时记录：

```text
graph_version
```

避免：

> 今天平台修改了 Role 定义，昨天创建的 Task 突然变成另一个解释。

---

# 46. Agent Capability 也需要 Version Reference

例如：

```text
capability_definition_version
```

如果 Capability 定义重大变化：

```text
old capability
→ deprecated
→ migration
```

不能无声覆盖。

---

# 47. Graph Admin Console

Operator / Product 需要能够配置：

```text
Industry
Scenario
Role
Capability
Attribute
Channel
Relationship
Policy
Verification
```

并能预览：

```text
Requester Builder
Agent Onboarding
Matching Eligibility
```

---

# 48. Graph Change Review

高风险修改必须审批。

例如：

```text
Enable Gender Filter
Enable Age Filter
Add Medical Role
Add Driving Role
```

需要：

```text
Product Review
Risk Review
Legal Review if needed
```

---

# 49. 新行业扩展流程

例如以后新增：

```text
Real Estate
```

流程：

```text
Create Industry
↓
Create Scenarios
↓
Map Roles
↓
Reuse Existing Capabilities
↓
Create Missing Capabilities
↓
Define Attribute Policy
↓
Define Evidence
↓
Supply Mapping
↓
Pilot
↓
Activate
```

原则：

> 优先复用已有 Capability，不重复造 Skill。

---

# 50. 避免 Capability Explosion

错误：

```text
Restaurant English
Hotel English
Event English
Business English
```

正确：

```text
LANG_EN_B2
```

然后通过 Scenario / Role 组合使用。

---

# 51. Capability Alias

不同市场、语言可能叫法不同。

例如：

```text
Greeter
Reception
迎宾
接待
Lễ tân sự kiện
```

但内部只有：

```text
ROLE_GREETER
```

支持：

```text
display_name_by_locale
alias[]
```

---

# 52. 多语言 Graph

至少支持：

```text
Vietnamese
English
Chinese
```

所有节点：

```text
code
name_en
name_vi
name_zh
```

业务逻辑只用：

```text
code / id
```

不使用展示文本判断。

---

# 53. Search / Natural Language Mapping

Requester 可以自然语言输入：

> 周六开业，需要三个会英语的迎宾。

模型可以解析成：

```text
Industry: FNB_RETAIL
Scenario: GRAND_OPENING
Role: GREETER
Quantity: 3
Capability: LANG_EN_B2
```

但：

> 模型只能提出 Graph Candidate。

最终必须绑定：

```text
exact graph node IDs
```

不能产生未注册 Skill 直接进入生产 Matching。

---

# 54. Unknown Requirement

如果用户说：

> 要一个懂红酒礼仪的人。

Graph 没有对应 Capability 时：

系统可以：

```text
1. semantic candidate
2. search graph
3. no exact node
4. create free-text requirement temporarily
5. mark GRAPH_GAP
```

P0：

```text
operator review
```

之后决定：

```text
create new capability
or
map to existing capability
```

---

# 55. Graph Gap Metrics

必须记录：

```text
unmapped_requirement_rate
new_capability_requests
unknown_role_requests
unknown_scenario_requests
```

这些数据决定下一轮扩 Graph。

---

# 56. Task Builder 动态表单

Task Builder 不应该是固定几十个字段。

它应该由 Graph 动态生成。

例如：

```text
Industry = Event
Scenario = Conference
Role = Interpreter
```

系统返回：

```text
Language
Time
Professional Background
Interpretation Experience
Dress Code
Evidence
```

而：

```text
Role = Queue Proxy
```

则返回：

```text
Time
Location
Queue Duration
Check-in Evidence
```

---

# 57. Agent Onboarding 动态表单

Agent 选择：

```text
UGC Creator
```

系统显示：

```text
On-camera
Short-video
Social Channel
Portfolio
```

Agent 选择：

```text
Interpreter
```

系统显示：

```text
Languages
Level
Certificate
Industry Background
```

---

# 58. Eligibility 与 Graph 的关系

Graph 只负责：

```text
what is required / allowed
```

Matching Engine 负责：

```text
who satisfies it
```

必须分层。

Graph 不计算：

```text
谁排名第一
```

---

# 59. Ranking 与 Graph 的关系

Graph 产生：

```text
Requirement Set
```

Ranking 再消费：

```text
Fit
Reliability
Distance
Availability
Price
Sponsored
```

Graph 本身不带商业排序权重。

---

# 60. Sponsored 与 Graph

Boost 不能改变 Graph。

例如：

```text
Task requires:
LANG_EN_B2
```

Agent 只有：

```text
LANG_EN_A2
```

即使 Boost：

```text
still ineligible
```

---

# 61. Availability 与 Graph

Agent Available Now 时，可以选择：

```text
active_roles[]
```

这些 Role 必须属于：

```text
AgentRole.status = ACTIVE
```

不能挂：

```text
自己没有资格的 Role
```

---

# 62. Pricing 与 Graph

未来 Pricing 可以按：

```text
Role
Capability scarcity
Industry
Scenario
Time
Location
```

但 Graph 只提供结构标签。

价格规则属于 Pricing Engine。

---

# 63. Liquidity 与 Graph

Liquidity Cell：

```text
Geo
× Time
× Role
```

必要时加：

```text
Critical Capability
```

例如：

```text
Tây Hồ
× Sat 18–22
× Greeter
× English B2
```

---

# 64. Analytics Dimension

Graph 节点必须成为核心 Analytics Dimension。

例如：

```text
Fill Rate by Industry
Fill Rate by Scenario
Fill Rate by Role
Supply Gap by Capability
Repeat Rate by Role
Agent Reuse by Industry
```

---

# 65. Cross-scene Reuse

核心网络效应指标：

```text
Agent Cross-Scenario Reuse Rate
Agent Cross-Industry Reuse Rate
Capability Reuse Rate
```

例如：

```text
An
Event Greeter
↓
F&B Grand Opening
↓
Hotel Reception
```

说明 Capability Graph 真正在创造网络效应。

---

# 66. Capability Scarcity

系统可以识别：

```text
High-demand + Low-supply Capability
```

例如：

```text
Chinese HSK5
+
Event Reception
```

用于：

- Agent 招募；
- Demand Pulse；
- Verification Campaign；
- Boost；
- Pricing。

---

# 67. Capability Discovery

Agent 完成任务后，系统可以提示：

```text
You may qualify for:
Hotel Guest Support
```

来源：

```text
existing capabilities
+
outcome history
```

但需要 Agent 确认。

---

# 68. Capability Decay

部分能力会过期。

例如：

```text
Certificate expires
License expires
Social Account disconnected
```

状态：

```text
ACTIVE
→ STALE
→ EXPIRED
```

不再满足高要求 Task。

---

# 69. Portfolio 与 Capability

Portfolio Item 必须关联：

```text
role_id
capability_ids[]
industry_ids[]
scenario_ids[]
```

这样 Candidate Detail 才能只展示：

> 当前 Task 相关作品。

---

# 70. Capability Privacy

Agent 可以有某个 Capability，但不希望公开浏览。

默认：

```text
Capability usable for matching
≠
Capability always publicly visible
```

Candidate API 仍遵守：

```text
Task Relevance
∩ Visibility Policy
```

---

# 71. Graph API

推荐至少提供：

## Requester

```text
GET /industries
GET /industries/{id}/scenarios
GET /scenarios/{id}/roles
GET /roles/{id}/requirement-template
```

## Agent

```text
GET /agent-role-catalog
GET /roles/{id}/capability-template
POST /agent/roles
POST /agent/capabilities
```

## Internal

```text
POST /graph/resolve
GET /graph/version
```

---

# 72. Graph Resolve Contract

输入：

```json
{
  "industry": "...",
  "scenario": "...",
  "role": "...",
  "requirements": [...]
}
```

输出：

```json
{
  "graph_version": "v12",
  "industry_id": "...",
  "scenario_id": "...",
  "role_id": "...",
  "resolved_capabilities": [],
  "resolved_attributes": [],
  "policy_results": [],
  "unresolved_items": []
}
```

---

# 73. Graph Resolve 不能做的事

不能：

- 查真人；
- 排名 Agent；
- 决定价格；
- 决定 Payment；
- 推测没有注册的 Capability；
- 绕过 Policy。

---

# 74. Requester UI 建议

主链：

```text
Industry
↓
Scenario
↓
Role
↓
Requirements
```

但用户不应该感觉自己在填数据库。

UI 文案：

```text
你要完成什么？
↓
需要这个人做什么？
↓
必须会什么？
↓
还有什么偏好？
```

内部才映射 Graph。

---

# 75. Agent UI 建议

```text
Which industries do you know?
↓
What roles can you do?
↓
Show us your capabilities
↓
Verify the important ones
```

系统提示：

```text
Based on your capabilities,
you may also qualify for...
```

---

# 76. 示例 A — Event Greeter

Requester：

```text
Industry:
EVENT_EXHIBITION

Scenario:
CONFERENCE

Role:
GREETER
```

Role Template：

```text
Required:
CUSTOMER_FACING

Recommended:
EVENT_RECEPTION
LANG_EN_B1
```

Requester 加：

```text
LANG_EN_B2 = MUST
```

结果：

```text
TaskNeedProfile
```

---

# 77. 示例 B — Business Interpreter

```text
Industry:
BUSINESS_PROFESSIONAL

Scenario:
BUSINESS_MEETING

Role:
INTERPRETER
```

Must：

```text
LANG_ZH_HSK5
INTERPRETATION
```

Nice：

```text
MANUFACTURING_BACKGROUND
```

---

# 78. 示例 C — TikTok UGC Creator

```text
Industry:
CONTENT_MARKETING

Scenario:
RESTAURANT_LAUNCH

Role:
UGC_CREATOR

Capability:
SHORT_VIDEO_CREATION
ON_CAMERA

Channel:
TIKTOK
```

Nice：

```text
FNB_CONTENT_EXPERIENCE
FOLLOWERS >= 10000
```

---

# 79. 示例 D — Queue Proxy

```text
Industry:
PERSONAL_ERRAND

Scenario:
QUEUE

Role:
QUEUE_PROXY
```

Required：

```text
FULL_AVAILABILITY
```

不需要：

```text
Follower Count
Height
Style
Professional Background
```

这就是 Purpose-bound Matching。

---

# 80. MVP P0 Graph 范围

P0 不追求覆盖全部职业。

建议先锁定：

## Industries

```text
FNB_RETAIL
EVENT_EXHIBITION
BUSINESS_PROFESSIONAL
CONTENT_MARKETING
PERSONAL_ERRAND
```

## Scenarios

约 10–15 个。

## Roles

约 20–30 个。

## Capabilities

约 50–80 个原子 Capability。

原则：

> Graph 要足以覆盖首发场景，但不能一开始做成职业百科。

---

# 81. P1

- Hospitality / Travel 扩展；
- Advanced Professional Roles；
- More social channels；
- Advanced license；
- Auto capability discovery；
- Dynamic graph suggestion；
- Region-specific graph；
- Enterprise custom roles。

---

# 82. 关键指标

## Graph Quality

```text
Requirement Resolution Rate
Unknown Requirement Rate
Graph Gap Rate
```

## Matching Relevance

```text
Must-have Satisfaction
Role Fit
Capability Fit
```

## Reuse

```text
Cross-role Reuse
Cross-scenario Reuse
Cross-industry Reuse
```

## Supply Health

```text
Supply by Role
Supply by Capability
Verified Supply Ratio
```

---

# 83. Acceptance Criteria

## AC-GRAPH-01
Industry / Scenario / Role / Capability 必须是独立对象。

## AC-GRAPH-02
Graph 必须支持多对多关系。

## AC-GRAPH-03
同一个 Capability 可以被多个 Role 复用。

## AC-GRAPH-04
Agent 可以跨多个 Industry / Scenario / Role。

## AC-GRAPH-05
TaskSlot 必须绑定一个 Role。

## AC-GRAPH-06
Must-have 与 Nice-to-have 必须由 Graph Requirement Set 表达。

## AC-GRAPH-07
Sensitive Attribute 必须经过 Policy Gate。

## AC-GRAPH-08
S3 Highly Restricted Attribute 默认不能进入普通 Matching。

## AC-GRAPH-09
每个 Capability 必须记录 Verification Status。

## AC-GRAPH-10
Outcome Verified Capability 必须能够从真实 Order 产生。

## AC-GRAPH-11
Social Platform 只能作为 Channel / Capability 维度，不能作为顶层 Industry。

## AC-GRAPH-12
Follower / Views 等 Social Metric 只有相关 Task 才能使用。

## AC-GRAPH-13
Role Template 必须支持 Required / Recommended / Optional / Prohibited。

## AC-GRAPH-14
Graph 配置不得硬编码在客户端。

## AC-GRAPH-15
Task 创建时必须记录 graph_version。

## AC-GRAPH-16
Graph 修改必须支持版本和回滚。

## AC-GRAPH-17
Unknown Requirement 必须产生 GRAPH_GAP，而不是静默丢弃。

## AC-GRAPH-18
自然语言解析结果必须绑定已注册 Graph Node。

## AC-GRAPH-19
Boost 不能改变 Eligibility Graph。

## AC-GRAPH-20
Agent Availability 只能激活自己已 ACTIVE 的 Role。

## AC-GRAPH-21
Portfolio 必须可以绑定 Role / Capability / Industry / Scenario。

## AC-GRAPH-22
Graph API 不能负责 Agent 排名。

## AC-GRAPH-23
Graph Admin 必须支持 Operator 配置和审核。

## AC-GRAPH-24
Graph 必须支持至少中文、越南语、英文显示名。

## AC-GRAPH-25
业务逻辑只能使用稳定 code / id，不得依赖展示文本。

---

# 84. 本章锁定结论

1. **Proxy 核心不是 Category Tree，而是 Capability Graph。**
2. **Industry / Scenario / Role / Capability / Attribute / Channel 是独立对象。**
3. **Graph 核心关系必须支持多对多。**
4. **TaskSlot 以 Role 为中心。**
5. **Requester Need 和 Agent Capability 使用同一套 Graph。**
6. **Capability 必须原子化、可验证、可复用。**
7. **Attribute 与 Capability 分离，并单独治理敏感属性。**
8. **Social Platform 属于 Channel，不属于 Industry。**
9. **Verification 是 Capability 级别属性，不是一个全局 Verified Badge。**
10. **真实 Order Outcome 可以升级 Capability 可信度。**
11. **Graph 负责“需要什么 / 允许什么”，Matching Engine 负责“谁最合适”。**
12. **Graph 必须版本化。**
13. **Task 必须记录 Graph Version。**
14. **Unknown Requirement 必须形成 Graph Gap。**
15. **Requester / Agent 表单都应由 Graph 动态生成。**
16. **Boost、Pricing、Availability、Liquidity 都消费 Graph，但不得修改 Graph 规则。**

---

# 85. 下一章

下一份增量 PRD：

> **Chapter 03 — Task / TaskSlot / Order State Machine**

重点解决：

```text
Task 到底什么时候算发布
Slot 怎么从 Open 走到 Assigned
Order 什么时候真正生成
多人任务怎么部分成交
取消 / Replacement / Dispute 怎么进入状态机
```

这是下一步把 Proxy 从“信息结构”推进到“交易系统”的关键章节。
