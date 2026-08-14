# Proxy PRD v1.1
## Chapter 06A — Basic Content Sharing / 基础图文与视频分享

**文档类型**：增量细化 PRD  
**状态**：当前有效版本  
**替代方向**：替代此前过早展开的 Native Live / Advanced Video 设计  
**核心原则**：

> 当前只做普通内容分享，不自建复杂视频基础设施。
> 直播、低延迟互动、多主播等能力，等真实业务需求出现后再集成成熟第三方付费组件。

---

# 1. 本章目标

Proxy 当前内容层只解决三个问题：

1. 用户 / Agent / Merchant 可以分享真实场景与经验；
2. 图文 / 视频可以连接 Venue / Activity / Business / Task；
3. 内容可以辅助产生现实行动、消费和 Human Agent Demand。

当前不把内容模块做成：

```text
TikTok
YouTube
直播平台
短视频娱乐平台
```

---

# 2. P0 Content Type

当前只支持：

```text
TEXT
IMAGE
LONG_FORM
VIDEO
```

其中：

## TEXT

普通文字动态。

## IMAGE

单图 / 多图。

## LONG_FORM

长图文内容：

```text
Title
Cover
Rich Text
Images
Sections
Links / Context Cards
```

## VIDEO

普通视频：

```text
Upload / Reference
Cover
Playback
Caption
```

不要求：

```text
low latency
live chat
real-time interaction
multi-host
gifts
```

---

# 3. Content Object

推荐统一：

```text
ContentPost
```

Schema：

```text
post_id

creator_type
creator_id

content_type

title optional
caption
body optional

media_assets[]

business_id optional
store_id optional
venue_id optional
activity_id optional
task_id optional

role_ids[]
capability_ids[]

visibility
moderation_status

created_at
published_at
updated_at
```

---

# 4. Creator Type

支持：

```text
USER
AGENT
BUSINESS
ACTIVITY
PLATFORM
```

---

# 5. 内容与 Human Agent 的关系

内容模块不是独立社交产品。

正确：

```text
Content
↓
Scene / Business / Activity / Capability
↓
Real-world Action
↓
Task / Consumption / Membership
```

---

# 6. 图文分享

普通用户可以发布：

```text
咖啡店体验
活动记录
消费体验
场地推荐
真实场景分享
```

例如：

```text
“这家店周六下午很适合 6–8 人 meetup。”
```

绑定：

```text
Venue
```

---

# 7. 长图文

支持更完整的内容表达：

```text
Title
Cover
Paragraph
Image Gallery
Subheading
Venue Card
Activity Card
Business Card
```

适合：

```text
探店
活动复盘
旅行体验
Business Story
Agent Experience
Guide
```

---

# 8. 图片

支持：

```text
1 image
multiple images
image gallery
```

图片可以作为：

```text
Content
Portfolio
Activity recap
Merchant marketing
```

但：

> Task Evidence 默认仍然不是 Public Content。

---

# 9. 普通视频

当前 Video 只做：

```text
upload / media reference
thumbnail
play
pause
seek
fullscreen if supported by client
caption
share
```

不做：

```text
Live
Real-time comments
Gifts
Co-host
RTC
```

---

# 10. 视频播放实现策略

产品层只定义：

```text
VideoAsset
PlaybackURL
Thumbnail
Duration
EncodingStatus
```

具体媒体实现不要锁死。

未来可以选择：

```text
Cloud video service
CDN
Object storage + transcoding
Third-party video component
```

根据规模决定。

---

# 11. VideoAsset

```text
video_asset_id
owner_type
owner_id

source_type
storage_reference

thumbnail
duration
aspect_ratio

processing_status
playback_reference

created_at
```

---

# 12. Video Processing Status

```text
UPLOADING
PROCESSING
READY
FAILED
REMOVED
```

只有：

```text
READY
```

可以正式播放。

---

# 13. 第三方视频组件边界

未来如果：

```text
视频量增大
需要多码率
全球 CDN
DRM
直播
低延迟
转码
```

则优先：

> **集成成熟付费视频服务。**

Proxy 不需要自己研发完整 Media Infrastructure。

---

# 14. Live 当前状态

Native Live：

```text
NOT P0
NOT P1 CORE
```

只保留未来接口概念：

```text
external_live_url
live_provider
live_reference_id
```

如果真实需求出现：

```text
Integrate Paid Live Provider
```

即可。

---

# 15. External Video / Social Video

通过 Social Bridge，未来可以支持：

```text
TikTok video
Xiaohongshu content
YouTube video
Instagram content
```

以：

```text
external_content_reference
```

关联。

是否内嵌播放取决于：

```text
platform permission
connector capability
```

---

# 16. Content Context

每条内容尽量绑定现实上下文：

```text
Venue
Business
Activity
Task
Capability
Role
```

例如：

```text
Long Form
“河内适合商务 meeting 的 5 家咖啡店”
```

可以绑定多个 Venue。

---

# 17. Content CTA

根据上下文显示：

```text
View Venue
Reserve
Join Activity
Follow Business
Create Similar Task
Need a Proxy
Become a Proxy
```

---

# 18. “Need a Proxy”

保留这一重要入口。

例如：

用户看到：

```text
展会内容
```

但自己无法到场。

可以：

```text
Need a Proxy
↓
Create Task Draft
↓
Site Visit Rep
```

---

# 19. Merchant Content

Business / Store 可以发布：

```text
店铺介绍
新品
优惠
会员活动
开业活动
真实场景
招聘 Human Agent 的活动内容
```

---

# 20. Merchant CTA

可绑定：

```text
Store
Membership
Reservation
Activity
Human Agent Task
```

---

# 21. Agent Content

Agent 可以发布：

```text
公开作品
任务经验
技能展示
活动片段
内容创作作品
```

但：

```text
Public Content
≠
Full AgentProfile
```

---

# 22. Agent Privacy

内容中允许公开：

```text
Display Name
Avatar
Selected Public Capability
Public Portfolio
```

不自动公开：

```text
phone
legal identity
exact private location
full work history
private social account
```

---

# 23. Content Feed

可以有普通 Feed。

建议分类：

```text
For You
Nearby Places
Activities
Businesses
Following
```

---

# 24. Feed 不做 People Feed

禁止：

```text
Nearby People
Hot Agents
Top Girls
People Ranking
```

---

# 25. Feed Ranking

内容 Feed 可以考虑：

```text
Topic relevance
Venue relevance
Activity relevance
Business relationship
Freshness
Quality
User explicit interests
```

但不要以：

```text
无限 Watch Time
```

作为唯一目标。

---

# 26. Engagement

P0 可以支持：

```text
Like
Comment
Save
Share
```

---

# 27. Share

支持：

```text
Internal Share
External Share Link
```

未来可通过 Social Bridge：

```text
Cross-post
```

但不作为当前 P0 强制能力。

---

# 28. Follow

P0 优先：

```text
Follow Business
Follow Venue
Follow Activity / Topic
```

Agent Follow：

可以后续再做。

---

# 29. Search

内容搜索支持：

```text
Business
Venue
Activity
Topic
Content
```

不把：

```text
People Search
```

作为主要入口。

---

# 30. Hashtag / Topic

支持：

```text
#Coffee
#HanoiWeekend
#GrandOpening
```

但内部建议映射到：

```text
Topic ID
Scenario
Venue
Business
```

避免完全依赖自由标签。

---

# 31. Moderation

普通内容仍然需要：

```text
PENDING
APPROVED
LIMITED
REMOVED
REVIEW_REQUIRED
```

---

# 32. Report

用户可以：

```text
Report Content
```

原因：

```text
Spam
Fraud
Unsafe
Privacy
Illegal Content
Harassment
Other
```

---

# 33. Task Evidence Boundary

正式锁定：

> **Task Evidence 默认 Private。**

不能因为 Agent 上传了任务照片，就自动：

```text
Publish to Feed
```

---

# 34. Evidence → Content

只有明确：

```text
Agent Consent
Requester / Business Usage Permission
Privacy Check
```

才可以：

```text
Convert to Public Content
```

---

# 35. Content Rights

对于普通上传：

记录：

```text
creator_id
ownership_type
usage_permission
```

对于 Business Creator Task：

未来专门细化：

```text
commercial usage rights
license duration
channels
```

---

# 36. Content Data

内容可以产生：

```text
Views
Likes
Comments
Shares
Saves
CTA Click
Reservation Conversion
Activity Join
Task Creation
Membership Conversion
```

---

# 37. Content Success Metric

Proxy 不应只看：

```text
Watch Time
```

更重要：

```text
Content-assisted Real-world Action
```

例如：

```text
Venue Visit
Reservation
Activity Join
Task Creation
Membership
```

---

# 38. Agent Content Metric Boundary

视频播放高：

```text
does not automatically mean
better Human Agent
```

内容表现与：

```text
Execution Reliability
```

严格分离。

---

# 39. Content → Human Agent Demand

例如 Business 发布：

```text
Grand Opening
```

可以带 CTA：

```text
Need Human Agents
```

最终仍然：

```text
Task Draft
→ Task
→ Slot
→ Match
```

---

# 40. Long-term Live Extension

未来只有出现真实需求时再启用：

```text
LiveSession
```

届时建议优先接：

```text
paid live provider
```

Proxy 只维护：

```text
Business Context
Activity Context
Human Agent Need
Commerce CTA
Membership CTA
```

而媒体传输交给第三方。

---

# 41. 架构预留

现在只预留：

```text
media_type
provider_type
external_media_id
playback_reference
live_reference optional
```

不要现在实现：

```text
RTMP ingest
WebRTC
HLS pipeline
transcoding cluster
live chat infra
```

---

# 42. P0

当前建议：

```text
Text
Single / Multi Image
Long-form Post
Video Upload / Playback
Like
Comment
Save
Share
Business / Venue / Activity Binding
Need a Proxy CTA
Basic Moderation
```

---

# 43. P1

如果数据验证值得：

```text
Advanced Content Feed
Social Import
Merchant Campaign Content
Creator Portfolio Integration
External Video Embed
```

---

# 44. Future / On Demand

只有真实需求出现时：

```text
Native Live
Third-party Live Integration
Low-latency Streaming
Live Chat
Multi-host
Live Commerce
Remote Live Agents
```

---

# 45. Acceptance Criteria

## AC-CONTENT-BASIC-01
必须支持文字、图片、长图文、普通视频。

## AC-CONTENT-BASIC-02
视频 P0 只要求正常播放，不要求 Native Live。

## AC-CONTENT-BASIC-03
当前不得为直播建设复杂自研 Media Infrastructure。

## AC-CONTENT-BASIC-04
未来直播优先采用成熟第三方付费组件。

## AC-CONTENT-BASIC-05
Content 应支持绑定 Venue / Business / Activity / Task Context。

## AC-CONTENT-BASIC-06
Agent Public Content 不得自动公开 Full AgentProfile。

## AC-CONTENT-BASIC-07
Task Evidence 默认不得进入公共 Feed。

## AC-CONTENT-BASIC-08
Evidence 转公共内容必须经过权限检查。

## AC-CONTENT-BASIC-09
Feed 不得演变为 Nearby People。

## AC-CONTENT-BASIC-10
必须支持基础 Like / Comment / Save / Share。

## AC-CONTENT-BASIC-11
Content Engagement 不得直接作为 Human Agent Reliability。

## AC-CONTENT-BASIC-12
必须支持 Need a Proxy CTA 进入标准 Task Draft。

## AC-CONTENT-BASIC-13
Content Success Metric 应包含现实行为转化。

## AC-CONTENT-BASIC-14
视频底层 Provider 必须可替换，不与核心业务强耦合。

---

# 46. 本章锁定结论

1. **现在只做基础内容分享。**
2. **支持普通文字、图片、长图文、视频播放。**
3. **暂时不做 Native Live。**
4. **直播未来按真实需求集成成熟付费组件。**
5. **媒体基础设施必须和 Proxy 核心交易解耦。**
6. **Content 主要服务 Venue / Activity / Business / Human Agent 现实闭环。**
7. **内容 Feed 不允许重新变成 People Browser。**
8. **Task Evidence 与 Public Content 严格分离。**
9. **内容指标不能污染 Human Agent 的履约信誉。**
10. **Need a Proxy 是内容到真人 Agent Task 的核心连接入口。**
