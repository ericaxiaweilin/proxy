# Proxy PRD v1.1
## Chapter 06A — Content Sharing / Short Video / Live

**文档类型**：增量细化 PRD / Strategic Product Layer  
**插入位置**：Fast Match / Offer Engine 之后  
**核心定位**：

> **内容不是 Proxy 的独立社交产品，而是连接真人、商家、场景、活动、消费与赚钱的交易入口。**

本章支持：

- 图文分享
- 短视频
- 视频直播
- 商家内容
- Activity 内容
- Agent / Creator 内容
- Live Activity
- Live Commerce / Membership CTA
- Live Human Agent Demand
- 内容转 Task
- 内容转消费
- 内容转会员
- 内容转 Agent 赚钱机会

同时继续遵守：

> **Content First / Scene First，不重新变成 People Browser。**

---

# 1. 为什么 Proxy 需要内容层

如果 Proxy 只有：

```text
Need
→ Task
→ Agent
```

它使用频率可能偏低。

内容层可以让用户在没有立即发布 Human Agent Task 时也进入真实世界：

```text
看活动
看商家
看真实场景
看内容
↓
产生消费
参加 Activity
创建 Task
成为 Agent
```

---

# 2. 内容层长期价值

完整循环：

```text
Merchant / Agent / Consumer
↓
Create Content
↓
Discovery
↓
Venue / Activity / Task / Membership
↓
Consumption or Human Agent Demand
↓
Execution
↓
New Outcome Content
```

---

# 3. Content Graph

新增：

```text
Content
↕
Venue
Activity
Business
Task
Role
Capability
Product / Service
Membership
Social Channel
Human Agent
```

重要：

> Content 必须尽量绑定一个现实上下文。

---

# 4. Content Type

P0 / P1：

```text
TEXT_IMAGE
SHORT_VIDEO
LIVE
```

未来：

```text
STORY
AUDIO
LONG_VIDEO
```

---

# 5. Post Object

```text
post_id
creator_type
creator_id

content_type

caption
media[]

venue_id optional
activity_id optional
business_id optional
task_id optional
role_ids[]
capability_ids[]

visibility
moderation_status

created_at
published_at
```

---

# 6. Creator Type

```text
USER
AGENT
BUSINESS
ACTIVITY
PLATFORM
```

---

# 7. 内容不是人才目录

禁止：

```text
People
→ sort by looks
→ endless creator directory
```

允许：

```text
Content
→ discover scene
→ discover activity
→ discover merchant
→ discover task-relevant creator capability
```

---

# 8. Feed

可以有 Feed。

但推荐：

```text
For You
Nearby Scenes
Activities
Merchant Updates
Following Topics / Businesses
```

而不是：

```text
Nearby People
Hot Girls
Top Agents
```

---

# 9. Feed Objective

排序目标：

```text
Relevant Scene
Activity Join
Reservation
Merchant Conversion
Task Creation
Membership
Useful Content
```

不是只优化：

```text
Watch Time
```

---

# 10. Content Engagement

支持：

```text
Like
Comment
Share
Save
```

但这些是内容互动信号。

不能直接作为：

```text
Human Agent Capability Score
```

---

# 11. Follow

建议 P0 优先支持：

```text
Follow Business
Follow Venue
Follow Activity Topic
```

Agent / Creator Follow：

可以 P1 做，

但必须作为：

```text
Content Follow
```

不能开放：

```text
People Search Directory
```

---

# 12. 图文分享

用户可以发布：

```text
Photo
Caption
Venue
Activity
Experience
```

例如：

```text
今天在 Tây Hồ 发现一个适合 8 人 English Meetup 的咖啡店。
```

绑定：

```text
Venue
```

---

# 13. 图文 → Activity

Post CTA：

```text
Create Activity Here
```

流程：

```text
Post
↓
Venue
↓
Create Activity
↓
Reserve
↓
Need Human Agents?
```

---

# 14. 图文 → Human Agent Task

例如 Business 发布：

```text
周六开业活动
```

可以 CTA：

```text
Work this event
```

只对 Eligible Agent 开放。

不是：

```text
所有人抢
```

---

# 15. Short Video

支持：

```text
upload video
caption
cover
venue
activity
business
```

---

# 16. Short Video 角色

可以来自：

```text
Consumer
Merchant
Agent / Creator
Task Outcome
```

---

# 17. Agent Short Video

Agent 可以分享：

```text
public portfolio-like content
```

例如：

```text
活动主持片段
探店作品
摄影作品
语言介绍
```

但：

> 作品内容可以被发现，Agent 私人资料不能因此全部公开。

---

# 18. Content Portfolio Boundary

Agent 公开内容：

```text
does not equal
full AgentProfile exposure
```

Task-relevant Candidate Profile 仍按 Progressive Disclosure。

---

# 19. Business Short Video

Merchant 可以发布：

```text
店铺
新品
活动
会员
招聘 Human Agents
```

内容可以 CTA：

```text
Reserve
Join Activity
Become Member
Apply if Matched
```

---

# 20. Live 核心对象

新增：

```text
LiveSession
```

Schema：

```text
live_session_id
host_type
host_id

business_id optional
venue_id optional
activity_id optional
task_id optional

title
description

scheduled_start_at
actual_start_at
ended_at

visibility
status

commerce_context
agent_need_context
```

---

# 21. Live Status

```text
DRAFT
SCHEDULED
LIVE
PAUSED
ENDED
CANCELLED
REVIEW_BLOCKED
```

---

# 22. Live 类型

建议：

```text
MERCHANT_LIVE
ACTIVITY_LIVE
CREATOR_LIVE
SCENE_LIVE
TASK_OUTCOME_LIVE
```

---

# 23. Merchant Live

例如咖啡店：

```text
Tonight Live
New menu
Live music
Member event
```

CTA：

```text
Reserve
Join Membership
Join Activity
```

---

# 24. Activity Live

例如：

```text
English Coffee Meetup
```

直播可展示：

```text
活动内容
现场氛围
主持
嘉宾
```

CTA：

```text
Join next event
Follow venue
Reserve
```

---

# 25. Creator / Agent Live

适合：

```text
UGC Creator
Host
Interpreter
Trainer
Reviewer
```

但 Live 是：

```text
content capability
```

不是直接“陪聊”。

---

# 26. Live 禁止漂移成陪伴产品

产品必须避免：

```text
付费私聊
情感陪伴
1v1 暧昧直播
纯真人陪伴
```

Proxy Live 必须围绕：

```text
Content
Scene
Activity
Business
Capability
```

---

# 27. Live → Human Agent Demand

这是 Proxy 独有价值之一。

例如 Business 创建：

```text
Restaurant Opening Live
```

可以需要：

```text
Host Agent ×1
Camera Operator ×1
Moderator ×1
Interpreter ×1
UGC Creator ×2
```

系统：

```text
LiveSession
↓
HumanAgentNeed
↓
Task
↓
TaskSlots
↓
Matching
```

---

# 28. Live Staffing

Live 可以直接使用：

```text
Host
Moderator
Camera Operator
Interpreter
Content Assistant
Product Presenter
```

这些全部属于 Human Agent Role。

---

# 29. Live → Commerce

长期支持：

```text
Product / Service Link
Reservation
Coupon
Membership
Activity Ticket
```

重点不是复制传统电商直播，

而是：

> **真实本地消费 + 真人服务。**

---

# 30. Live → Membership

例如：

```text
Cafe Live
```

CTA：

```text
Join Gold Membership
Get event access
Reserve member night
```

---

# 31. Live → Agent Earning

Agent 可以通过：

```text
Live Host Task
Creator Task
Content Production Task
Moderation Task
```

获得收入。

不是依赖：

```text
直播打赏
```

作为第一商业模式。

---

# 32. Gifts / Tips

P0：

```text
不建议优先做
```

原因：

容易把产品带向：

```text
直播娱乐平台
```

未来若做：

必须：

```text
transparent
age-safe
anti-exploitation
```

---

# 33. Content → Task

任何 Post / Live 可以有：

```text
Need a Proxy
```

例如用户看到活动：

```text
我去不了
```

可以：

```text
Send a Proxy
```

产生现实任务。

---

# 34. “Send a Proxy” CTA

例子：

```text
展会直播
↓
我无法到现场
↓
Send a Proxy
↓
Site Visit Rep
↓
Task
```

这是非常符合 Proxy 核心的入口。

---

# 35. Content → Consumption

Merchant 内容 CTA：

```text
Reserve
Buy Ticket
Join Activity
Join Membership
```

---

# 36. Content → Merchant Demand

内容爆发后：

```text
Activity joins increase
Reservation increase
```

系统可以：

```text
suggest additional Human Agents
```

形成：

```text
Content
→ Demand
→ Agent Jobs
```

---

# 37. Live Demand Trigger

例如：

```text
Live viewers 500
Coupon claims 80
Reservations surge
```

Business Dashboard：

```text
Expected visitor load increased.
Suggested:
Greeter +2
Event Assistant +1
```

P0 只 Suggest。

---

# 38. Content Monetization

长期收入：

```text
Merchant Promotion
Creator / Agent Campaign Commission
Human Agent Task Commission
Reservation / Activity Fee
Business Content Tools
Sponsored Content
```

---

# 39. Sponsored Content

允许：

```text
Promoted Business Post
Promoted Activity
```

必须：

```text
Sponsored label
```

---

# 40. Sponsored People Boundary

不能卖：

```text
“热门真人榜”
```

Agent Boost 仍然只能在：

```text
Task Matching Context
```

工作。

Content Sponsored 与 Agent Matching Boost 分离。

---

# 41. Cross-post Social

通过 Social Bridge：

```text
Proxy Post
↓
TikTok
Xiaohongshu
Instagram
```

或：

```text
External Social Content
↓
Import to Proxy
```

根据 Connector Capability。

---

# 42. Proxy Live 与外部直播

长期支持：

```text
Proxy Native Live
```

以及：

```text
External Live Reference
```

例如：

```text
TikTok Live
Xiaohongshu Live
```

能否控制发布 / analytics 由 Connector 决定。

---

# 43. Native Live 技术分层

推荐：

```text
Live Session Control
Media Ingest
Transcoding
Playback
Chat
Moderation
Commerce / CTA
Analytics
```

不要把直播逻辑塞进 Social Connector。

---

# 44. Live Media Architecture

未来可：

```text
Broadcaster
→ RTMP / WebRTC ingest
→ Media service
→ HLS / Low-latency playback
```

具体技术选型后续技术设计决定。

---

# 45. Live Chat

支持：

```text
comments
reactions
moderator actions
```

P0 不做：

```text
anonymous private contact exchange optimization
```

---

# 46. Moderation

Content / Live 必须有：

```text
AUTOMATED_CHECK
HUMAN_REVIEW
REPORT
LIVE_MODERATION
```

---

# 47. Moderation Status

```text
PENDING
APPROVED
LIMITED
REMOVED
REVIEW_REQUIRED
```

---

# 48. Live Safety

支持：

```text
Report
Mute
Block
Slow Mode
Moderator
End Live
```

---

# 49. Location Privacy

Live 不自动暴露：

```text
precise private location
```

如果绑定 Public Venue：

可以显示：

```text
Venue
```

私人 Task：

默认不公开实时位置。

---

# 50. Agent Execution Privacy

Agent 正在执行私人 Task 时：

不能因为：

```text
Live
```

自动公开：

```text
Requester
Exact Location
Private Conversation
```

---

# 51. Consent

如果 Content / Live 中出现其他可识别人员：

需要：

```text
creator responsibility
scene consent policy
merchant policy
```

企业活动可通过：

```text
event notice
```

管理。

---

# 52. Task Evidence ≠ Public Content

重要：

```text
Evidence
```

默认私人。

只有：

```text
Requester + Agent explicit rights
```

允许时，才能转：

```text
Public Post / Portfolio
```

---

# 53. Content Rights

必须记录：

```text
creator
copyright_owner
commercial_usage_right
usage_scope
usage_expiry
platforms
```

尤其 Business Creator Task。

---

# 54. Business Content Task

商家可以发布：

```text
Short Video Creator
Live Host
Photographer
```

并定义：

```text
deliverable
usage rights
publish owner
channel
duration
```

---

# 55. Content Ownership

不能默认：

> 商家付了钱 = 永久获得所有版权。

必须明确：

```text
LICENSE
ASSIGNMENT
LIMITED_USAGE
```

后续 Social / Creator Task 专章细化。

---

# 56. Content Feed Data Safety

Feed 可以使用：

```text
content topic
venue
activity
user interactions
membership
```

但不应使用敏感人格属性做 People Recommendation。

---

# 57. Behavioral Habit

Content 目标建立：

```text
看到真实场景
↓
产生现实行动
```

不是：

```text
刷到停不下来
```

---

# 58. Feed CTA Priority

内容 CTA 优先：

```text
Visit
Reserve
Join
Create Activity
Need a Proxy
Become a Proxy
Join Membership
```

---

# 59. Creator Monetization

Agent / Creator 赚钱主要来自：

```text
Task
Campaign
Live Host
Content Production
Merchant Collaboration
```

而不是纯流量补贴。

---

# 60. Merchant Content Loop

```text
Merchant Post
↓
Consumer Interest
↓
Reservation / Activity / Membership
↓
Business Demand
↓
Human Agent Task
↓
Agent Execution / Creator Content
↓
New Post
```

---

# 61. Agent Content Loop

```text
Agent completes task
↓
allowed portfolio content
↓
shows capability
↓
more qualified matches
↓
more earning
```

---

# 62. Consumer Content Loop

```text
Consumer shares scene
↓
others discover venue / activity
↓
more local transactions
```

---

# 63. Content Search

允许搜索：

```text
Venue
Activity
Topic
Business
Content
```

谨慎：

```text
Agent Name Search
```

P0 不作为核心入口。

---

# 64. Hashtag / Topic

支持：

```text
#CoffeeMeetup
#HanoiWeekend
#GrandOpening
```

但内部应映射：

```text
Topic
Venue
Scenario
```

而不是只靠自由标签。

---

# 65. Nearby Content

允许：

```text
Nearby Venue Content
Nearby Activities
```

不允许：

```text
Nearby People
```

---

# 66. Live Discovery

可以：

```text
Live Now
Nearby Venue Live
Activity Live
Merchant Live
```

---

# 67. Live Recording

商家 / Creator 可选择：

```text
Save Replay
```

状态：

```text
LIVE
→ ENDED
→ REPLAY_AVAILABLE
```

---

# 68. Live Clip

P1：

```text
Generate Short Clips
```

用于：

```text
Post
Portfolio
Merchant Promotion
```

---

# 69. Content Analytics

Merchant：

```text
Views
Watch
Reservation Conversion
Membership Conversion
Activity Join
Task Demand Generated
```

---

# 70. Agent Analytics

Agent / Creator：

```text
Content Views
Portfolio Views in valid Task context
Campaign Conversion
Task Conversion
```

---

# 71. 不把 Followers 设成核心北极星

可以存在：

```text
Followers
```

但不作为 Proxy 的核心成功指标。

---

# 72. Live North Star

推荐：

```text
Live → Real-world Conversion
```

例如：

```text
Reservation
Activity Join
Membership
Task Creation
Merchant Purchase
```

---

# 73. Content North Star

```text
Content-assisted Real-world Transactions
```

不是：

```text
Total Watch Minutes
```

---

# 74. Creator Reputation

内容表现与 Human Agent 履约表现分开：

```text
Content Performance
Execution Reliability
```

不能：

```text
视频爆了
→ 自动变成高可靠 Agent
```

---

# 75. Live Host Capability

直播主持能力可以：

```text
Capability = LIVE_HOSTING
```

通过：

```text
Portfolio
Past live task outcome
Merchant rating
```

验证。

---

# 76. Moderator Capability

新增：

```text
LIVE_MODERATION
```

可以成为 Human Agent Role / Capability。

---

# 77. Remote Human Agent

内容 / Live 模块第一次引入：

```text
REMOTE Human Agent Task
```

例如：

```text
Live Moderator
Remote Interpreter
Remote Co-host
```

因此 Task 未来需要：

```text
execution_mode:
PHYSICAL
REMOTE
HYBRID
```

---

# 78. Physical vs Remote

当前 Proxy 核心仍然是现实真人执行。

但支持：

```text
REMOTE
```

不会改变：

> Agent 必须是真人。

---

# 79. Remote Availability

Remote Task：

不需要：

```text
travel ETA
```

但需要：

```text
time availability
network capability
device capability
platform access
```

---

# 80. Live Agent Matching

例如：

```text
Need Chinese-speaking Live Moderator
```

仍走：

```text
Task
→ Slot
→ Eligibility
→ Match
→ Offer
→ Order
```

不是从直播模块直接雇人。

---

# 81. Content → Remote Agent Demand

例如 Business Live：

```text
Need:
Vietnamese moderator
Chinese interpreter
```

可以实时创建：

```text
Urgent Remote Task
```

---

# 82. Mid-live Agent Replacement

如果 Moderator 断线：

```text
Order Exception
↓
Replacement
↓
Fast Match
```

未来可支持。

---

# 83. Content API

核心：

```text
POST /posts
GET /feed
GET /posts/{id}
POST /posts/{id}/like
POST /posts/{id}/comment
POST /posts/{id}/share
```

---

# 84. Live API

```text
POST /live-sessions
POST /live-sessions/{id}/start
POST /live-sessions/{id}/end
GET /live-sessions/{id}
POST /live-sessions/{id}/report
```

媒体传输用独立服务。

---

# 85. Content-to-Task API

```text
POST /posts/{id}/create-task
POST /live-sessions/{id}/create-agent-need
```

最终仍创建：

```text
Task Draft
```

---

# 86. MVP Boundary

建议不要现在就完整开发 Native Live。

## P0

先支持：

```text
图文
短视频
Merchant / Activity Content
Content → Venue / Activity / Task
External social linking
```

## P1

```text
Native Live
Live Chat
Merchant Live
Activity Live
Live Agent Staffing
```

## P2

```text
Low-latency live
Live commerce
Multi-host
Remote live agents
Advanced replay / clips
```

---

# 87. Acceptance Criteria

## AC-CONTENT-01
Proxy 必须支持图文与短视频内容对象。

## AC-CONTENT-02
Content 必须尽量绑定 Venue / Activity / Business / Task / Capability Context。

## AC-CONTENT-03
内容发现不得演变为 Nearby People。

## AC-CONTENT-04
Feed 目标必须偏向现实行动与交易，而不是纯 Watch Time。

## AC-CONTENT-05
Agent Public Content 不得自动公开完整 AgentProfile。

## AC-CONTENT-06
Merchant Content 必须支持 Reservation / Activity / Membership 等 CTA。

## AC-CONTENT-07
必须支持 LiveSession 独立对象。

## AC-CONTENT-08
Live 可以产生 Human Agent Need。

## AC-CONTENT-09
Live Host / Moderator / Interpreter 等真人需求必须进入统一 Task / Slot / Order 主链。

## AC-CONTENT-10
Live 不得漂移成付费陪伴产品。

## AC-CONTENT-11
Content Engagement 不得直接作为 Human Agent Reliability。

## AC-CONTENT-12
Task Evidence 默认不公开。

## AC-CONTENT-13
Evidence 转 Public Content 必须有合法权限。

## AC-CONTENT-14
Business Creator Task 必须记录内容使用权。

## AC-CONTENT-15
Sponsored Content 与 Agent Matching Boost 必须分离。

## AC-CONTENT-16
Social Cross-post 必须遵守 Connector Capability。

## AC-CONTENT-17
直播位置不得自动暴露私人 Task 精确地点。

## AC-CONTENT-18
必须支持 Report / Moderation。

## AC-CONTENT-19
Content Analytics 必须包含现实转化指标。

## AC-CONTENT-20
Live North Star 应是 Real-world Conversion，而非单纯观看时长。

## AC-CONTENT-21
允许 Remote Human Agent Task，但 Agent 必须仍然是真人。

## AC-CONTENT-22
Remote Live Agent 仍必须通过标准 Matching / Offer / Order。

---

# 88. 本章锁定结论

1. **Proxy 支持图文、短视频、直播。**
2. **内容层服务现实场景、消费、活动、商家和真人赚钱。**
3. **Content First / Scene First，不变成人才浏览 Feed。**
4. **Merchant / Activity / Agent 都可以成为内容生产者。**
5. **内容可以转 Reservation / Activity / Membership / Task。**
6. **直播可以直接产生 Host / Moderator / Interpreter 等 Human Agent 需求。**
7. **内容表现与真人履约信誉分离。**
8. **Task Evidence 默认不是 Public Content。**
9. **Creator 内容版权 / 商业使用权必须结构化。**
10. **P0 先做图文 + 短视频，Native Live 建议 P1。**
11. **Remote 真人 Agent 可以支持，但仍进入统一 Task / Slot / Order。**
12. **内容层最终优化 Content-assisted Real-world Transactions。**
