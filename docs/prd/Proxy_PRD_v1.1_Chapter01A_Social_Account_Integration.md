# Proxy PRD v1.1
## Chapter 01A — Social Account Bridge / 社媒打通

**文档类型**：增量细化 PRD  
**插入位置**：Chapter 01 Identity & Account 之后，Chapter 02 Capability Graph 之前  
**本章范围**：TikTok、小红书及其他社媒账号连接、社媒身份验证、作品导入、数据验证、内容任务、品牌账号授权发布、社媒 Evidence、权限与安全  
**说明**：本章不重复 Account、Industry、Task、Matching 等已有章节。

---

# 1. 产品定位

社媒打通不是单纯：

```text
Login with TikTok
```

而是 Proxy 的横向基础设施：

> **Social Account Bridge**

它连接：

```text
Human Agent
Business
Task
Content
Social Platform
Outcome
```

完整结构：

```text
Agent / Business
      ↓
Social Account Connection
      ↓
Verified Social Presence
      ↓
Portfolio / Metrics / Publishing Permission
      ↓
Task Matching
      ↓
Content Execution
      ↓
Post / Evidence / Performance
```

---

# 2. 为什么 Proxy 需要社媒层

Proxy 本身是 Human Agent Marketplace。

大量真人 Agent 任务天然与社媒有关：

- Content Talent；
- Store Reviewer；
- UGC Creator；
- Short-video Actor；
- Photographer；
- Event Creator；
- Brand Ambassador；
- Livestream Assistant；
- Influencer / KOC；
- Social Media Operator。

如果没有社媒打通，平台只能让 Agent 手工填写：

```text
我有 TikTok
我有 20k followers
我拍过探店
```

真实性和可验证性都很弱。

连接社媒后，可以形成：

```text
Claimed Capability
        ↓
Verified Social Capability
```

---

# 3. Social Bridge 的四层能力

## Layer 1 — Account Connection

用户授权连接：

```text
TikTok
Xiaohongshu
Instagram
Facebook
YouTube
Zalo
Other
```

目标：

- 确认该社媒账号属于该用户或 Business；
- 获取允许的基础身份；
- 保存授权状态。

---

## Layer 2 — Social Proof

在平台官方能力允许的情况下读取：

```text
Display Name
Avatar
Username / Handle
Follower Count
Public Content
Content Count
Views
Likes
Comments
Shares
```

用途：

- Agent Verification；
- Capability Passport；
- Portfolio；
- Task Matching；
- Content Evidence。

---

## Layer 3 — Portfolio Import

Agent 可以把授权账号中的内容导入 Proxy Portfolio。

例如：

```text
TikTok
├── Video A
├── Video B
└── Video C
```

Agent 选择：

```text
Add to Proxy Portfolio
```

而不是 Proxy 自动展示所有内容。

---

## Layer 4 — Content Publishing

如果平台官方 API 与授权范围允许：

```text
Proxy
→ User Authorization
→ Content Review
→ Social Connector
→ Publish / Draft
```

支持两类所有者：

```text
Agent Social Account
Business Social Account
```

---

# 4. 一个重要架构原则

社媒账号不是 UserAccount。

不能设计成：

```text
User
=
TikTok User
```

正确模型：

```text
UserAccount
   │
   ├── AgentProfile
   ├── BusinessMembership
   │
   └── SocialAccountConnection[]
```

一个 User 可以连接多个社媒：

```text
TikTok
Xiaohongshu
Instagram
YouTube
```

一个 Business 也可以连接自己的品牌账号。

---

# 5. Social Account Owner

社媒连接必须记录所有者。

```text
INDIVIDUAL
AGENT
BUSINESS
```

例如：

```text
TikTok @an.event
Owner = AGENT

TikTok @bonsaidon.vn
Owner = BUSINESS
```

不能把个人账号和公司账号混在一起。

---

# 6. SocialAccountConnection

推荐 Schema：

```json
{
  "social_connection_id": "soc_xxx",
  "owner_type": "AGENT",
  "owner_id": "agent_123",
  "platform": "TIKTOK",
  "external_user_id": "...",
  "handle": "@an.event",
  "display_name": "An",
  "avatar_url": "...",
  "connection_status": "ACTIVE",
  "verification_status": "VERIFIED",
  "granted_scopes": [],
  "token_reference": "...",
  "token_expires_at": "...",
  "last_synced_at": "...",
  "created_at": "..."
}
```

---

# 7. Connection Status

```text
NOT_CONNECTED
AUTHORIZING
ACTIVE
EXPIRED
REAUTH_REQUIRED
REVOKED
RESTRICTED
ERROR
```

授权失败不能影响 Agent 的基础 Proxy Account。

---

# 8. Platform Capability Matrix

每个平台能力不同。

因此不能在业务代码里假设：

```text
all social platforms support publish()
```

必须建立：

```text
SocialPlatformCapability
```

例如：

| Capability | TikTok | Xiaohongshu | YouTube | Other |
|---|---|---|---|---|
| OAuth / Authorization | Supported if approved | Connector-dependent | Supported | Connector-dependent |
| Basic Profile | API scope dependent | Connector-dependent | Supported | Connector-dependent |
| Content List | Supported scope dependent | Connector-dependent | Supported | Connector-dependent |
| Content Metrics | Supported scope dependent | Connector-dependent | Supported | Connector-dependent |
| Direct Publish | Supported with approved API | Connector-dependent | Supported | Connector-dependent |
| Draft Upload | Supported where API allows | Connector-dependent | Platform-dependent | Connector-dependent |

原则：

> Product asks Connector what is supported.  
> Product does not hard-code platform assumptions.

---

# 9. Connector Capability Enum

```text
AUTH
PROFILE_READ
CONTENT_LIST
CONTENT_READ
METRICS_READ
DRAFT_UPLOAD
DIRECT_PUBLISH
COMMENT_READ
ANALYTICS
WEBHOOK
```

每个平台 Connector 返回：

```json
{
  "platform": "TIKTOK",
  "capabilities": [
    "AUTH",
    "PROFILE_READ",
    "CONTENT_LIST",
    "METRICS_READ",
    "DRAFT_UPLOAD",
    "DIRECT_PUBLISH"
  ]
}
```

---

# 10. TikTok Integration

TikTok 可以作为 Proxy 第一批正式 Social Connector。

产品能力可以分阶段。

## P0

```text
Connect TikTok
↓
OAuth Authorization
↓
Basic Profile
↓
Public Video List
↓
Selected Portfolio Import
```

## P1

```text
Content Metrics
Follower / Video Stats
Content Evidence
```

## P1 / P2

在应用获得相应官方权限后：

```text
Draft Upload
Direct Publish
```

---

# 11. TikTok 数据进入 Capability Passport

Agent 授权后，不应该直接把 Followers 做成“大号优先”。

应该产生：

```text
SocialCapability
```

例如：

```text
Platform: TikTok
Account Verified: Yes
Followers: Verified
Public Videos: 86
Content Category:
- F&B
- Event
- Lifestyle

Task-relevant Portfolio:
- 5 Store Videos
- 3 Event Videos
```

---

# 12. Social Metrics 使用原则

Follower Count 不是通用 Ranking Signal。

错误：

```text
Followers 越多
→ 所有 Task 排名越高
```

正确：

只有 Task 明确需要：

```text
Social Reach
Creator Distribution
Influencer Exposure
```

时才进入 Matching。

例如：

## Task A

```text
Event Greeter
```

Follower Count：

```text
NOT RELEVANT
```

## Task B

```text
TikTok Creator
Need ≥ 10k verified followers
```

Follower Count：

```text
HARD / SOFT REQUIREMENT
```

---

# 13. Xiaohongshu Integration

小红书必须使用同一套 Connector 抽象，但实现策略需要更保守。

产品层支持：

```text
CONNECT
VERIFY
PORTFOLIO
DELIVERABLE
PUBLISH
```

但 Connector 根据实际官方开放权限决定支持哪些 Capability。

MVP 不允许通过：

- 模拟网页登录；
- 保存用户密码；
- Cookie 抓取；
- 非官方爬虫；
- 绕过授权；

实现所谓“打通”。

如果官方通用 API 暂未向 Proxy 的应用类型开放：

P0 使用：

```text
Account Link
+
User-confirmed Handle
+
Post URL Evidence
+
Manual / Operator Verification
```

后续获得正式开放平台 / Partner 权限后：

```text
MANUAL
→ PARTNER_API
```

平滑升级。

---

# 14. Generic Social Connector

技术架构：

```text
Proxy Social Service
        │
        ├── TikTokConnector
        ├── XiaohongshuConnector
        ├── InstagramConnector
        ├── FacebookConnector
        ├── YouTubeConnector
        ├── ZaloConnector
        └── ManualSocialConnector
```

统一 Interface：

```text
authorize()
refresh_token()
get_profile()
list_content()
get_content()
get_metrics()
upload_draft()
publish()
revoke()
```

如果某平台不支持：

```text
capability_not_supported
```

不能做模拟实现。

---

# 15. Agent Onboarding 新增 Social Step

Agent Onboarding：

```text
Identity
↓
Industry
↓
Role / Capability
↓
Languages
↓
Professional Background
↓
Social Accounts
↓
Portfolio
↓
Verification
```

页面：

```text
Connect your social accounts

TikTok
[ Connect ]

Xiaohongshu
[ Connect / Verify ]

Instagram
[ Connect ]

YouTube
[ Connect ]

Skip for now
```

不是所有 Agent 都必须连接。

---

# 16. Social Account Verified Badge

连接成功后：

```text
TikTok Connected
Account ownership verified
```

可以展示：

```text
✓ TikTok Verified Connection
```

注意：

这里的 Verified 表示：

> “这个 TikTok 账号确实由当前 Agent 授权连接。”

不表示：

> “TikTok 官方蓝 V”。

两个概念必须分开。

---

# 17. Agent Portfolio

Portfolio Item 来源：

```text
UPLOAD
SOCIAL_IMPORT
TASK_OUTCOME
BUSINESS_APPROVED
```

Schema：

```text
portfolio_item_id
agent_id
source_type
social_platform
external_content_id
media_snapshot
task_relevance_tags[]
visibility
verification_status
```

---

# 18. Social Capability

增加结构化对象：

```json
{
  "social_capability_id": "...",
  "agent_id": "...",
  "platform": "TIKTOK",
  "account_verified": true,
  "verified_metrics": {
    "followers": 12000
  },
  "content_categories": [
    "FNB",
    "EVENT"
  ],
  "capabilities": [
    "UGC_CREATION",
    "SHORT_VIDEO",
    "ON_CAMERA"
  ]
}
```

---

# 19. Capability Graph 中的位置

Social Platform 不是 Industry。

错误：

```text
Industry
└── TikTok
```

正确：

```text
Industry
   ↓
Scenario
   ↓
Role
   ↓
Capability
   ↓
Channel / Platform
```

例如：

```text
Content / Marketing
↓
Restaurant Launch
↓
UGC Creator
↓
Short-video Creation
↓
TikTok / Xiaohongshu
```

---

# 20. Requester 发布 Content Task

例如：

```text
Industry
Content / Marketing

Scenario
Restaurant Launch

Role
UGC Creator

Platform
TikTok

Deliverable
1 short video

Publish Requirement
Post on Agent account

Reach
≥ 10k verified followers
```

系统才允许 Social Metrics 参与匹配。

---

# 21. 两类 Social Content Task

## Type A — Agent-Owned Publishing

Agent 用自己的社媒账号发布。

例如：

```text
KOC / Creator Task
```

Task 要求：

```text
Agent owns connected account
Agent authorizes proof
```

Outcome：

```text
Published Post
+
Post URL
+
Verified Metrics
```

---

## Type B — Business-Owned Publishing

Agent 负责：

```text
Create Content
```

但最终发布到：

```text
Business Social Account
```

非常重要：

> Agent 不应该拿到 Business 的 TikTok / Instagram / 其他社媒密码。

正确流程：

```text
Business connects account to Proxy
↓
Agent creates content
↓
Agent submits draft
↓
Business reviews
↓
Business approves
↓
Proxy Social Connector publishes
```

如果平台不支持 Direct Publish：

```text
Proxy exports approved content package
↓
Business completes native-platform publish
↓
Post URL returned as Evidence
```

---

# 22. Business Social Account

BusinessAccount 可以连接：

```text
TikTok
Xiaohongshu
Instagram
Facebook
YouTube
Zalo
```

Schema 与 Agent 相同：

```text
owner_type = BUSINESS
owner_id = biz_xxx
```

Business Members 通过 Business Permission 管理，而不是共享社媒密码。

---

# 23. Business Permission

未来 Business Team 可拆：

```text
SOCIAL_VIEW
SOCIAL_CONNECT
SOCIAL_APPROVE
SOCIAL_PUBLISH
SOCIAL_ANALYTICS
```

MVP：

```text
Business Owner
```

拥有全部权限。

---

# 24. Content Approval Flow

```text
DRAFT
↓
AGENT_SUBMITTED
↓
REQUESTER_REVIEW
├── REVISION_REQUIRED
│      ↓
│   AGENT_SUBMITTED
│
└── APPROVED
       ↓
   READY_TO_PUBLISH
       ↓
     PUBLISHED
```

---

# 25. SocialTaskDeliverable

```json
{
  "deliverable_id": "...",
  "task_id": "...",
  "slot_id": "...",
  "agent_id": "...",
  "platform": "TIKTOK",
  "content_type": "SHORT_VIDEO",
  "publishing_owner": "AGENT",
  "required_publish": true,
  "approval_required": true,
  "status": "PUBLISHED",
  "external_content_id": "...",
  "post_url": "...",
  "published_at": "..."
}
```

---

# 26. Social Evidence

社媒 Task 的 Evidence 可以包括：

```text
Connected Account
Published Content ID
Post URL
Publish Time
Caption
Hashtags
Views
Likes
Comments
Shares
```

注意：

指标是否可自动验证，取决于 Platform Connector Capability。

---

# 27. Social Performance Snapshot

Task 完成后，可以形成：

```text
T+1h
T+24h
T+72h
T+7d
```

Performance Snapshot。

例如：

```text
Views       18,200
Likes        1,430
Comments        76
Shares          92
```

这可以成为新的 Outcome Data。

---

# 28. Outcome Graph 扩展

增加：

```text
Task
× Agent
× Social Channel
× Content
× Audience Outcome
```

例如：

```text
F&B Launch
+
Agent An
+
TikTok
+
Short Video
→
18k Views
```

长期可帮助 Proxy 判断：

> 什么类型的 Agent 在什么行业 / 场景 / 平台表现更好。

---

# 29. Social 数据不能污染所有 Match

Social Outcome 只能用于相关 Task。

例如：

```text
TikTok Restaurant Content
```

可以学习：

```text
F&B Content Performance
```

不能因此提高：

```text
Queue Proxy
Interpreter
Document Runner
```

的排名。

---

# 30. Social Account Visibility

Agent 可以控制：

```text
PRIVATE
TASK_RELEVANT_ONLY
CONNECTED_BADGE_ONLY
PORTFOLIO_ONLY
PUBLIC_TO_VERIFIED_REQUESTER
```

默认建议：

```text
TASK_RELEVANT_ONLY
```

---

# 31. Social Profile 暴露规则

Candidate Card 默认不展示：

```text
TikTok Handle
Xiaohongshu Handle
Instagram Handle
```

除非当前 Task 需要 Social Capability。

例如：

```text
UGC Creator Task
```

才可以显示：

```text
TikTok Connected
12k verified followers
5 relevant portfolio items
```

是否直接显示 Handle，由 Visibility Policy 决定。

---

# 32. Anti-Bypass

不能因为 Social Account 已连接，就允许 Requester：

```text
点击 TikTok
→ 找到 Agent
→ 私下联系
```

所以 P0 推荐：

Candidate 阶段显示：

```text
TikTok Connected
Verified Metrics
Portfolio Preview
```

不默认显示：

```text
Raw username / direct profile link
```

直到产品定义允许的 Visibility Level。

---

# 33. OAuth / Token Security

绝不存储：

```text
TikTok Password
Xiaohongshu Password
Instagram Password
```

只使用：

```text
OAuth / Official Authorization
```

Token：

```text
Encrypted Server-side
Never exposed to mobile client unnecessarily
Refresh managed server-side
Revocable
Scope-limited
```

---

# 34. Scope 最小化

Proxy 只申请任务需要的权限。

例如：

Profile：

```text
PROFILE_READ
```

不需要发布权限。

只有用户主动开启：

```text
Publish through Proxy
```

才申请：

```text
DIRECT_PUBLISH
```

避免一次申请全部权限。

---

# 35. Disconnect Social Account

用户可以随时：

```text
Disconnect
```

流程：

```text
Connection ACTIVE
↓
Revoke Platform Token
↓
Proxy Token Deleted / Invalidated
↓
Connection REVOKED
```

已完成 Task 的历史 Evidence：

按照数据保留与争议规则保留必要快照，

但：

```text
cannot continue refreshing social data
```

---

# 36. 数据刷新

不是实时疯狂抓数据。

推荐：

## Agent Profile

```text
On connect
On user refresh
Scheduled low-frequency refresh
Before social-task matching if stale
```

## Task Performance

```text
Task-defined snapshots
```

例如：

```text
T+1h
T+24h
T+72h
```

---

# 37. 社媒数据可信状态

每个字段标记：

```text
SELF_REPORTED
PLATFORM_VERIFIED
OPERATOR_VERIFIED
STALE
UNAVAILABLE
```

例如：

```text
Followers: 12,380
Source: PLATFORM_VERIFIED
Synced: 2h ago
```

---

# 38. Social Data 不等于永久真值

Follower、Views 等持续变化。

因此必须记录：

```text
value
observed_at
source
```

而不是覆盖成一个永久静态字段。

---

# 39. Platform Adapter Fallback

如果一个平台没有正式 API：

```text
ManualSocialConnector
```

支持：

```text
Handle Submission
Profile URL
Post URL
Screenshot Evidence
Operator Verification
```

但 UI 必须明确：

```text
Verified by Proxy
```

与：

```text
Platform Connected
```

不同。

---

# 40. 社媒任务新的 Role / Capability

建议新增：

## Roles

```text
UGC Creator
KOC
Content Talent
Social Reviewer
Livestream Host
Social Media Operator
Short-video Creator
```

## Capabilities

```text
ON_CAMERA
SHORT_VIDEO
PHOTO_CONTENT
SCRIPTING
VIDEO_EDITING
SOCIAL_PUBLISHING
LIVESTREAM
SOCIAL_DISTRIBUTION
```

## Channels

```text
TIKTOK
XIAOHONGSHU
INSTAGRAM
FACEBOOK
YOUTUBE
ZALO
```

---

# 41. Requester UI

发布 Content Task 时新增：

```text
Which social channel?

TikTok
Xiaohongshu
Instagram
YouTube
Other
```

然后：

```text
What do you need?

○ Create content only
○ Create + publish on Agent account
○ Create + publish on my Business account
```

---

# 42. Agent UI

Capability Passport：

```text
Social

TikTok
✓ Connected
12k Followers
5 relevant portfolio items

Xiaohongshu
Verified by Proxy
3 portfolio items

[Manage Social Accounts]
```

---

# 43. Business UI

Business Settings：

```text
Connected Channels

TikTok
Connected

Instagram
Connected

Xiaohongshu
Manual / Partner connection

[Manage]
```

Content Task：

```text
Publish to
Bonsaidon TikTok

Approval
Required
```

---

# 44. Social Account Connection Page

页面结构：

```text
Social Accounts

TikTok
Connected
Last synced 2h ago
[Manage]

Xiaohongshu
Not connected
[Connect / Verify]

Instagram
Not connected
[Connect]

YouTube
Not connected
[Connect]
```

---

# 45. Matching Signal

Social Matching Signal 只在 Task Schema 明确启用。

例如：

```json
{
  "role": "UGC_CREATOR",
  "channel": "TIKTOK",
  "must_have": {
    "platform_connected": true
  },
  "nice_to_have": {
    "verified_followers_min": 10000,
    "fnb_content_experience": true
  }
}
```

---

# 46. Sponsored / Boost 与 Social

允许：

```text
Boost TikTok Creator Capability
```

前提：

```text
Task requires TikTok Creator
+
Agent qualified
```

禁止：

```text
购买 Followers 排名
购买全站网红榜
无 Task 公开达人榜
```

仍然遵守：

> Sponsored 买曝光，不买资格。

---

# 47. 商业模式扩展

未来可以产生：

```text
Social Capability Verification
Creator Boost
Managed Publishing Fee
Business Social Workspace
Content Performance Analytics
Campaign Management
```

P0 不必全部收费。

---

# 48. 平台接入优先级

## P0

### TikTok
优先做正式 Connector：

```text
AUTH
PROFILE_READ
CONTENT_LIST
PORTFOLIO_IMPORT
```

### Xiaohongshu
产品结构先支持：

```text
ACCOUNT_REFERENCE
PORTFOLIO
POST_URL_EVIDENCE
OPERATOR_VERIFICATION
```

如获得正式开放平台能力，再升级 Connector。

---

## P1

```text
TikTok METRICS
TikTok DRAFT / PUBLISH
Instagram
Facebook
YouTube
```

---

## P2

```text
Zalo
Advanced Analytics
Cross-platform Campaign
Unified Social Inbox
Automated Performance Optimization
```

实际优先级按越南首发市场需求调整。

---

# 49. Acceptance Criteria

## AC-SOCIAL-01
一个 User / Agent / Business 可以连接多个 Social Account。

## AC-SOCIAL-02
Social AccountConnection 与 UserAccount 分离。

## AC-SOCIAL-03
绝不存储用户社媒密码。

## AC-SOCIAL-04
每个 Platform Connector 必须声明实际支持的 Capability。

## AC-SOCIAL-05
不允许通过非官方模拟登录伪造 API 打通。

## AC-SOCIAL-06
Agent 必须主动选择哪些 Social Content 进入 Portfolio。

## AC-SOCIAL-07
Follower / Views 等 Social Metrics 只有相关 Task 才参与 Matching。

## AC-SOCIAL-08
Candidate 默认不能通过 Social Handle 绕过 Proxy 联系 Agent。

## AC-SOCIAL-09
Business Social Account 不向 Agent 暴露密码或 Token。

## AC-SOCIAL-10
Business-owned Content Task 必须有 Content Approval。

## AC-SOCIAL-11
Platform API 不支持 Direct Publish 时必须有 Manual / Native Publish Fallback。

## AC-SOCIAL-12
Social Evidence 必须记录 Source 与 observed_at。

## AC-SOCIAL-13
Disconnect 后停止继续读取平台数据。

## AC-SOCIAL-14
Social Verified Connection 与平台官方认证 Badge 必须语义分离。

## AC-SOCIAL-15
Social Connector 失败不能阻断用户基本 Proxy Account。

---

# 50. 本章锁定结论

1. **增加 Social Account Bridge 作为横向平台能力。**
2. **TikTok / Xiaohongshu / Instagram / Facebook / YouTube / Zalo 使用统一 Connector 架构。**
3. **社媒连接同时支持 Agent、Individual、Business Owner。**
4. **社媒不是独立 Industry，而是 Capability / Channel 维度。**
5. **Social Metrics 只有在 Task 明确需要时才能参与匹配。**
6. **Agent 可从授权社媒导入 Portfolio。**
7. **Business 可连接品牌社媒账号。**
8. **Agent 创建内容、Business 审核、Proxy 负责授权发布，是重要长期流程。**
9. **平台不存社媒密码，只使用官方授权。**
10. **没有正式 API 的平台使用 Manual / Partner Connector，不做灰色模拟打通。**
11. **Social Post 可成为 Task Evidence 和 Outcome 数据。**
12. **Social Outcome 只反哺相关 Content / Marketing Task，不污染其他任务排名。**

---

# 51. 与下一章的连接

Chapter 02 — Capability Graph 需要正式加入：

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
```

例如：

```text
Content / Marketing
↓
Restaurant Launch
↓
UGC Creator
↓
Short-video Creation
↓
TikTok
```

以及：

```text
Agent
↓
Social Capability
↓
Verified Social Account
↓
Verified Portfolio / Metrics
```

这样 Requester 的“我要 TikTok 探店达人”和 Agent 的“我有 TikTok + F&B 内容能力”才能在同一张 Graph 上真正匹配。
