# Proxy PRD v1.3 — R15.12.7 Experience / Opportunity / Activity + Map Parity Freeze
## Experience / Opportunity / Activity Market Freeze / User + Business Identity / Social Baseline / Time Commitment / Safety

**状态**：SOCIAL BASELINE FREEZE / ANDROID LAUNCH CANDIDATE / GROUP ≤50 FREEZE / MESSAGING ROOT FREEZE / RELATIONSHIP GRAPH FREEZE / PERSONAL SOCIAL OS FREEZE / MARKET IA FREEZE / TIME COMMITMENT FREEZE / PRIVACY BOUNDARY FREEZE / UI RUNTIME FREEZE / ARCHITECTURE ALIGNMENT  
**基线**：Proxy Brand Final Handoff v1.0 + PRD v1.1 Canonical Registry + R15 Product Freeze / Model-Driven UI + R15.3 Generated UI Runtime  
**本文件性质**：增量修订，不重写 Canonical Registry 中已经冻结的 Identity / Task / Order / Payment / Permission / Outcome Truth。

**R15.12.7 最高优先级说明**：本版本是当前 Launch Candidate 的市场 IA 冻结结论。若历史章节与本节冲突，以 R15.12.7 为准。
- 前台身份继续只保留 `USER / BUSINESS`；Creator / Host / 接机会 / 开放能力均不是第三身份；
- Market 一级对象冻结为 `EXPERIENCE / OPPORTUNITY / ACTIVITY`，前台分别称为 **体验 / 机会 / 活动**；
- **体验**是定义清晰、可预约、可交付的合法业务对象；可在体验详情中选择符合资格的 Host / Creator，但人物本身不是 Market Inventory；
- **机会**继续保留客户 / 商家发布的真实 Demand；时间、地点、预算、能力、结果等约束继续由 Opportunity / Order Runtime 管理；
- **活动**继续承接多人、兴趣、品牌、商家与本地场景；Creator / Host 可以参与、主理或承接活动协作位；
- People Discovery 继续存在于 Feed / Search / Profile / Relationship Graph，但不再单独组织为“人物市场”；
- 本版本不新增 Store 一级 Market Tab，不重做 Feed / Messaging / Me / Business OS；后续 UI 与排序优化由真实运营数据触发。
- Market 保留 `LIST / MAP` 双模式；右上角使用地图图标进行切换，三类对象共享同一个视图模式规则；Map 只展示 Experience 地点 / Opportunity 允许公开的任务区域 / Activity Venue，不展示 Creator / Host / Participant 真人实时 GPS。


**R15.10 优先级说明**：本文件继续继承 R15.9.0、R15.8.0 及此前 Canonical Truth；**§155 起的 R15.10 Messaging / Relationship / Video Boundary 规则优先于历史章节中把聊天藏在业务页、把外部关系自动等同为好友、或把视频独立成刷流 Surface 的描述**。R15.9 Personal Social OS 与 R15.8 Market / Time Commitment 冻结继续有效。  
- `Agent / Provider / Executor` 可继续作为内部能力、履约角色或兼容字段存在，但不再是前台身份；
- Market 前台在 R15.12.7 重新冻结为 `体验 / 机会 / 活动` 三个一级对象；
- 未成交的现实需求前台统一称为 **机会**；接受后才进入 Order / Execution；
- 真人发现继续由 Feed / Search / Profile 承接；人物可作为体验 Host / 活动参与者被发现和选择，但不作为独立 Market Inventory。


---

# 0. 本次修订解决什么

本次修订集中解决七件事：

1. **把 Feed 从“轻量内容附属模块”升级为正式核心 Surface**；
2. **把 Search / Explicit Intent 提升为推荐、Agent 发现和广告画像的最高优先级信号**；
3. **明确 Feed 的传播、用户显式调教、Agent 曝光、内容混合与机会分发机制**，避免被单一高 CTR 内容劫持；
4. **冻结 Universal Home Intent Composer：REQUESTER / AGENT / BUSINESS 的 Home 第一屏都必须能直接“和 Proxy 说一句”**，不要求用户先找菜单或先理解系统分类；
5. **修正 Feed → Task 的转化表达：不在普通动态卡上强推“形成需求”，而采用 Content → Profile / Chat → Explicit Intent → Need / Task 的渐进式转化**；
6. **补齐真实 Post Composer：照片 / 视频 / 拍摄 / 地点 / 服务能力 / 活动上下文由用户明确选择，AI 只辅助，不自动把生活内容商业化**；
7. **把 R15 的 Server-Driven + Model-Driven UI 写成可工程落地的运行时架构**，做到：
   - 服务器更新 Experience / Ranking / UI Composition 后，多端自动获得新体验；
   - 前端不依赖每一个业务场景都提前写死完整页面；
   - 模型可生成部分 UI 结构与组合；
   - 但模型不能生成任意代码、任意路由、任意权限或 Domain Truth。

本修订显式修改 v1.1 Chapter 20 中以下旧判断：

```text
旧：Content = P0.5 / parallel lightweight module
旧：P0 不做内容推荐算法

新：Feed = Root Stable Surface
新：推荐算法 = Feed 核心能力
新：Feed 不阻塞 Human Execution Truth，但进入正式产品主循环
```

Business Workspace 也从原来的：

```text
Business / Members / Store / Tasks / Today / Trusted Team / Spend
```

扩展为可长期演进的 Business OS，但仍遵守“Stable Surface + Component Registry”，不按功能无限增加页面。

---

# 1. 产品定位重新冻结

Proxy 不做：

```text
朋友圈
纯内容社区
纯商业广告流
小红书低配版
TikTok 低配版
同事社交 App
低价团购 App
Alibaba 低配版
企业 ERP
```

Proxy 的 Feed 也不是单纯为了“给商业铺路”。

正式定义：

> **Proxy 是现实人物、关系、机会、活动、信息与真实履约的发现层；Feed 负责形成发现与信任，Search 暴露主动意图，Agent / Task / Activity / Business Runtime 负责把意图转成现实行动。**

其中 Agent 获得真实订单 / 任务，是重要经济闭环之一，但不能反向把整个 Feed 做成“Agent 广告墙”。

核心循环：

```text
Search / Ask / Browse / Follow
        ↓
Intent + Interest + Relationship
        ↓
Feed Discovery
        ↓
Person / Agent / Opportunity / Activity / Intelligence
        ↓
Trust / Conversation / Participation
        ↓
Task / Lead / Order / Real-world Action
        ↓
Outcome
        ↓
Intent / Trust / Reputation 回流
```

因此产品必须同时维护三种价值：

```text
Content Value       内容值得不值得看
Relationship Value  人与人的连接是否有意义
Opportunity Value   是否能产生现实机会 / 任务 / 合作
```

任何一种都不得单独吞掉整个 Feed。

特别冻结：

> **Popularity ≠ Qualification**

漂亮、会修图、会写标题、粉丝多，可以提高普通内容吸引力；但不得直接提高 Agent 在真实任务匹配、报价排序、履约资格中的权重。

同样：

> **Feed Preference ≠ Task Matching Preference**

用户“少看摄影 Agent 日常自拍”，不能导致用户真正发布摄影需求时系统不再匹配合格摄影 Agent。

---

# 2. 社交关系原则

## 2.1 不把“同厂”当作天然关系

正式原则：

> **Coworker is not automatically friend.**

同一企业 / 同一工厂关系默认只是一种 Context，不是强正向推荐信号。

对于以下内容，同厂关系甚至应为负向或敏感信号：

```text
跳槽
薪资
老板 / 部门评价
副业
找客户
匿名情报
职场吐槽
私人人脉
异性交友 / 兴趣社交
```

系统可以知道组织关系，但不应因为“同厂”自动推给同事。

## 2.2 优先关系

推荐关系优先：

```text
跨公司同行
二度关系
共同兴趣
共同目标
共同活动
历史真实合作
可信执行记录
相同职业轨迹
相同客户 / 行业，但不同直接组织
```

## 2.3 Same-Org Privacy Gate

Feed 在 Candidate Eligibility 阶段必须支持：

```text
same_org_exposure_policy
same_org_sensitive_topic_gate
employment_visibility
anonymous_verified_identity
block / mute / do_not_recommend
```

用户可配置：

```text
允许同公司看到公开内容
不向同公司推荐我的个人动态
仅关注者可见
匿名发布但平台验证职业身份
```

---

# 3. Root Navigation

R15 继续冻结：

```text
Home / Tasks / Feed / Me
```

Active Context：

```text
REQUESTER
AGENT
BUSINESS
```

Root 不因为场景扩张。

新增稳定 Workspace（非 Root）：

```text
SEARCH_WORKSPACE
```

用于承接 People / Agent / Opportunity / Activity / Intelligence / Business / Content 的组合搜索结果；查询类型变化不新建 Route。

Feed 是统一 Root Surface，但 Candidate Source / Content Weight 会根据 Active Context 调整。

例如：

```text
REQUESTER → 机会、人脉、工作、情报、活动
AGENT     → 可赚钱任务、客户需求、同行关系、活动
BUSINESS  → 客户需求、执行者、商家情报、活动、经营机会
```

---

# 3A. Universal Home Intent Composer — 所有身份统一的一等入口

## 3A.1 产品冻结

R15.4 新增硬规则：

> **任何 Active Context 的 Home 第一屏都必须提供 Universal Intent Composer。**

适用：

```text
REQUESTER
AGENT
BUSINESS
```

不是三个不同的聊天产品，而是：

```text
One App
One Account
One Intent Entry
Different Active Context
```

Home 的区别只在：

```text
Context Pack
Available Capabilities
Suggested Examples
Read Models
Allowed Actions
```

不在“有没有输入框”。

## 3A.2 Home 第一屏固定骨架

三个 Home 统一：

```text
Identity / Active Context
        ↓
Universal Intent Composer
        ↓
AI / Runtime Attention
        ↓
Active Work / Current State
        ↓
Recommended / Recent / Quick Entry
```

`Universal Intent Composer` 属于 Stable Home Skeleton，模型不得删除、隐藏或移动到第二屏。

## 3A.3 Composer 文案

REQUESTER：

```text
现在想做什么？
说说你现在需要什么……
```

AGENT：

```text
今天想做什么？
看看有没有适合我的单子、处理订单或更新可用时间……
```

BUSINESS：

```text
今天想推进什么？
告诉 Proxy 你想处理的经营问题、活动、人员或店铺事项……
```

提示文案由 Server Experience Manifest 版本化，但语义保持“自然语言优先”。

## 3A.4 不要求用户先选 Category

禁止默认流程：

```text
先选行业
→ 再选场景
→ 再选需求类型
→ 再填字段
```

正常路径应为：

```text
Natural-language / Multimodal Input
        ↓
Intent Runtime
        ↓
内部 Category / Archetype / Capability Resolution
        ↓
对应 Workspace
```

Hard Category 继续作为系统内部治理边界，不要求普通用户理解它。

## 3A.5 Composer 不是 Conversation 的同义词

用户在 Home 输入一句话后，目标 Surface 由 Intent 决定：

```text
“附近有什么羽毛球活动？”
→ SEARCH_WORKSPACE

“周六下午找个摄影师”
→ FULFILLMENT_WORKSPACE

“下午门店客流太低，想做点活动”
→ SKILL_WORKSPACE / Business Generated View

“Linh 周六有空吗？”
→ CONVERSATION
```

冻结：

> **Input is a universal intent entry. Conversation is only one possible destination Surface.**

## 3A.6 Multimodal Composer

Home Composer 支持：

```text
TEXT
IMAGE
CAMERA
FILE
LOCATION_REF
ENTITY_MENTION
ACTIVITY_REF
BUSINESS_REF
```

附件进入：

```text
IntentContextAttachment
```

而不是自动进入：

```text
Public Post
Business Truth
Task Truth
```

例如 Business 上传 Excel：

```text
“看看这个月哪个活动效果最差”
```

文件只作为当前分析 Context，除非后续用户明确确认写入 Domain。

## 3A.7 Context-specific Suggestion Chips

建议示例只做启发，不是菜单：

REQUESTER：

```text
周六想找人拍照
附近有什么活动
帮我找一个工作机会
```

AGENT：

```text
今天有哪些适合我的单
我下午有空
帮我整理最近履约结果
```

BUSINESS：

```text
下午客流太低
周六还缺 1 个执行者
复盘最近活动效果
更新门店菜单
```

Server 可按 Context / Intent / History 动态更新，但不得成为强制路径。

## 3A.8 Home Generated UI 边界

模型可以动态生成 Composer 下方：

```text
Attention Summary
Opportunity Rail
Active Task Summary
Business Diagnostic
Recommended People
Recent Search
Suggested Action
```

模型不能动态生成：

```text
是否存在 Composer
Composer 主提交动作
附件权限边界
身份切换能力
Root Navigation
```

这些属于稳定 Product Contract。


---

# 4. Feed 产品定义：对齐 X 的信息效率，不复制 X 的传播逻辑

## 4.1 顶层入口

Root Navigation 继续冻结：

```text
Home / Tasks / Feed / Me
```

Search 不新增 Root Tab，但成为跨 Surface 的一级入口：

```text
Feed Header Search
Home Search Entry
Global Search Command
AI Ask → Search Intent Bridge
```

搜索结果进入 `SEARCH_WORKSPACE`（稳定 Workspace，不按查询类型造新页面）。

Feed 顶部保留：

```text
推荐 | 关注
```

Context Filter 可包含：

```text
人
机会
活动
情报
工作
附近
同行
```

“附近”“同厂”都只是 Context，不是产品人格。

## 4.2 X-like Interaction Pattern

内容卡保持高信息密度：

```text
作者 / 身份可信标签
正文
可选媒体
上下文标签
推荐理由

回复
引用
转发 / Repost
收藏
分享
```

结构化对象可增加 Domain Action：

```text
真实需求：我能做 / 介绍一个人 / 私聊
Agent Capability：查看服务 / 联系 / 收藏
招聘：问内部人 / 申请
活动：加入 / 邀请
情报：查看上下文 / 追问 / 收藏
商家活动：预约 / 领取
```

但默认卡片不能全部变成 CTA 广告。

正式原则：

> **Social Action 维持自然内容生态；Domain Action 在“有明确下一步”时出现。**

## 4.3 Thread / Relationship / Action

驻留不是靠无限视频吞时间，而是：

```text
Post
→ Reply / Quote
→ Person / Thread
→ Follow / Conversation / Activity
→ Need / Task / Lead
→ Real-world Action
→ Return
```

Feed 的内容价值可以存在于“看完即可”，不强迫每条内容产生商业转化。

---

# 5. Signal Taxonomy：先判断“这是什么”，再决定“推多远”

Feed 不把所有东西统一抽象成普通 Post。

底层对象可能是：

```text
Person
Agent Capability
Need
Task
Opportunity
Activity
Business
Offer
Outcome
Relationship Request
Content Post
Intelligence Claim
```

Feed Item 是上述对象的 Projection。

P0 冻结 8 类 Signal：

## S1 — PERSONAL_EXPRESSION

普通生活、观点、照片、经验表达。

价值：

```text
人格感
关系维持
社区自然度
```

默认传播窄，不因高点赞自动获得无限传播。

## S2 — CAPABILITY_SIGNAL

Agent / 个人表达自己可以提供什么：

```text
本周可接摄影
可做中文陪同
可以接活动执行
可以帮做某类设计
```

可以比普通表达传播更广，但只向相关需求人群扩散。

## S3 — OPPORTUNITY_NEED

真实需求、任务、工作、合作、客户需求。

这是高价值 Signal，可跨 Feed / Task Inbox / Notification 多通路分发。

## S4 — ACTIVITY

团体活动、兴趣局、行业局、真实线下活动。

核心目标：

```text
共同目标
→ 真实参与
→ 弱关系形成
```

## S5 — INTELLIGENCE

工作经验、公司信息、避坑、行业变化、合作经验、公开事实及个人体验。

必须携带 Claim / Trust Metadata。

## S6 — RELATIONSHIP_SIGNAL

找人、求介绍、二度关系、共同经历、合作邀请。

## S7 — OUTCOME_REPUTATION

真实完成结果、履约、活动结果、可信评价。

不允许每一次小结果都刷屏；支持聚合投影。

## S8 — BUSINESS_PUBLIC

企业公开活动、招聘、公开需求、品牌故事、经营事件。

商业身份不天然获得更高 Feed 权重。

---

# 6. 内容供给与 AI 边界

## 6.1 Content Source

```text
Human-authored UGC
Agent-authored Signal
Business-authored Content
Domain Object Projection
System-generated factual projection
AI-assisted draft
```

模型可以：

```text
改写
摘要
结构化
翻译
标签建议
把真实 Outcome 生成展示摘要
把 Availability 生成 Capability Card 草案
```

模型不能：

```text
自动伪造生活内容
为了增长自动高频发帖
伪造结果
伪造观点
伪造客户
把私有业务对象自动公开
```

## 6.2 Provenance

系统内部必须记录：

```text
HUMAN_AUTHORED
AI_ASSISTED
SYSTEM_PROJECTED_VERIFIED_EVENT
BUSINESS_GENERATED
```

是否对用户显示“AI辅助”由产品策略决定，但 Ranking / Spam / Trust 必须能识别来源。

## 6.3 Agent 不是内容农场

Agent Assistant 允许帮助创作，但默认不允许 Autonomous Publishing。

服务端支持：

```text
agent_promo_frequency_cap
ai_generated_frequency_cap
creator_exposure_cap
```

防止 Agent 为抢单变成高频自拍 / 标题党 / AI 内容农场。

---

# 6A. Feed Action Hierarchy 与 Post Composer — 内容先于交易

## 6A.1 Feed 不直接把普通动态变成 Task CTA

R15.4 修正原型中的高压动作：

```text
[聊一下] [形成需求]
```

不再作为普通 Agent 动态的默认底部双主按钮。

原因：

```text
Feed 首先承担发现 / 内容 / 信任
Agent Opportunity 是后续结果
不是每一次内容消费都等于交易意图
```

正式转化链：

```text
Post
→ Reply / Save / Follow / Profile
→ Chat / Service Context
→ Explicit Intent
→ Need Draft
→ User Confirm
→ Task / Order
```

冻结：

> **“形成需求”属于 Domain 语言，不应在用户只有轻度兴趣时作为一级 CTA。**

## 6A.2 不同 Signal 使用不同轻量 Action

PERSONAL_EXPRESSION：

```text
回复
查看主页
```

CAPABILITY_SIGNAL：

```text
问问档期
查看服务
```

OPPORTUNITY_NEED：

```text
我能做
了解详情
```

ACTIVITY：

```text
感兴趣
查看活动
```

BUSINESS_PUBLIC：

```text
看看店铺
了解活动
```

只有已经存在明确 Task Intent 时才允许：

```text
确认需求
确认任务
提交需求
```

## 6A.3 Agent Context 作为轻量底流

普通 Feed Card 可在 Social Actions 下方显示轻量 Context：

```text
Linh · 城市同行 / 摄影
周六可用
                    了解一下 ›
```

要求：

```text
不是巨型商业 CTA
不是默认双按钮
不抢正文 / Media 的视觉层级
```

点击后进入：

```text
Profile / Capability / Conversation
```

再根据后续 Intent 进入 Need / Task。

## 6A.4 Social Proof 可以保留

例如：

```text
3 人从这条动态开始聊天
1 个城市同行需求已确认
```

这属于：

```text
Outcome Projection
```

可以作为轻量 Trust Signal，但不得伪造，也不得反向制造虚假紧迫感。

数据必须来自真实 Event / Outcome Read Model。

## 6A.5 Post Composer 必须支持真实媒体输入

发布动态最低支持：

```text
TEXT
PHOTO_LIBRARY
CAMERA
VIDEO
LOCATION_REF
OPTIONAL_CAPABILITY_REF
OPTIONAL_ACTIVITY_REF
```

P0 图片规则：

```text
最多 9 张
支持预览
支持删除
支持重新排序
发布前明确可见
```

移动端可提供：

```text
选择照片
拍摄
选择视频
```

## 6A.6 Media Layout

媒体展示不允许任意生成 CSS。

模型 / Server 只能从 `MediaLayoutRegistry` 选择：

```text
ONE_HERO
TWO_COLUMN
THREE_RAIL
FOUR_GRID
HERO_PLUS_GRID
VIDEO_HERO
```

例如：

```text
1 张 → ONE_HERO
2 张 → TWO_COLUMN
3 张 → THREE_RAIL
4 张 → FOUR_GRID
5–9 张 → HERO_PLUS_GRID
```

模型可根据内容和尺寸选择兼容 Variant，但客户端决定最终可渲染布局。

## 6A.7 AI 可以辅助，不可以自动商业化

用户选择照片并写正文后，模型可以建议：

```text
文案润色
摘要
标签
地点候选
图片顺序
Media Layout
可能关联的服务 / 活动
```

但服务关联必须由用户明确确认。

例如：

```text
检测到：
河内 / 摄影 / 西湖

建议：
#城市同行
#摄影
#河内路线

可能关联：
城市同行服务
```

只有用户主动选择：

```text
关联我的城市同行服务 = ON
```

才写入：

```text
context_ref = agent_capability:...
```

禁止：

```text
Agent 发一张生活照片
→ AI 自动判断为接单广告
→ 自动扩大商业分发
```

## 6A.8 Composer Privacy

从相册 / 文件 / 相机加入的素材在点击“发布”前：

```text
只属于 Draft
不进入 Public Feed
不建立公开 Context
不自动用于广告 Audience
```

取消 Draft 后按照 Draft Retention Policy 处理。

## 6A.9 Post 与业务对象继续分离

```text
Post Body / Media
= Durable Content

Service Price / Availability / Qualification
= Live Read Model

Need / Task
= Domain Truth
```

Post 可以引用业务 Context，但不能成为业务真相副本。


---

# 7. 推荐系统总目标：不是一个 Score

Proxy Feed 不采用“一个 engagement score 排全部内容”。

必须至少隔离：

```text
ContentEngagementScore
RelationshipValueScore
OpportunityValueScore
TrustScore
DistributionNeedScore
```

真实任务另有：

```text
AgentQualificationScore
TaskMatchScore
```

明确禁止：

```text
Content Likes
Follower Count
Photo CTR
Creator Popularity
```

直接进入高权重 Agent Task Matching。

可以作为很弱的 Social Signal，但不能成为 Qualification Truth。

算法目标优先级：

```text
1. Explicit Search / Explicit Intent Satisfaction
2. Explicit User Preference
3. Real-world Outcome Relevance
4. Opportunity / Relationship Relevance
5. Trust / Safety
6. Content Quality / Freshness / Novelty
7. Passive Engagement
```

其中第 1 项是全产品最高质量行为信号。

---

# 8. Search-First Feed Algorithm Architecture

## 8.1 为什么 Search 第一优先

搜索不是普通 Engagement Event，而是用户主动告诉系统：

> **“我现在正在找什么。”**

因此信号强度原则：

```text
Search / Explicit Query / Need / Ask
    > Apply / Contact / Quote / Join
    > Save / Profile Open
    > Reply / Quote Post
    > Dwell / Like
    > Impression
```

具体权重不在 PRD 写死，全部服务端版本化。

## 8.2 Search 不是只搜帖子

Search 统一查询：

```text
People
Agents
Capabilities
Jobs
Opportunities
Activities
Businesses
Intelligence
Threads
Content
Relationships / 2nd degree paths
```

例如：

```text
“Cooler Master ODM PM”
```

结果可以组合：

```text
相关人员
相关岗位
公司情报
相关讨论
二度关系
相关活动
```

Search 输出 `SearchResultPlan`，由稳定 `SEARCH_WORKSPACE` + Component Registry 渲染，不为每种 Query 手写页面。

## 8.3 Unified Intent Event Layer

所有主动 / 半主动行为统一进入：

```text
IntentEvent
- actor_id
- event_type
- query / entity refs
- intent_type
- topics[]
- geo_context optional
- strength
- source
- created_at
- expires_at
- confidence
- privacy_class
```

来源至少：

```text
SEARCH
ASK_AI
OPEN_ENTITY
SAVE
CONTACT
FOLLOW
JOIN_ACTIVITY
CREATE_NEED
CREATE_TASK
APPLY_JOB
ORDER
OUTCOME
```

不同 Intent 有不同 TTL：

```text
“附近咖啡” → 小时级
“找工作”   → 周 / 月级
“换行业”   → 月级
“长期爱好” → 长期但可衰减
```

不得把一次搜索永久写死成人格标签。

## 8.4 Canonical Pipeline

```text
Domain / Content / Search Events
            ↓
Signal Classification
            ↓
Search + Intent Graph Update
            ↓
Eligibility Gate
            ↓
Multi-source Candidate Retrieval
            ↓
Explicit User Preference Policy
            ↓
Feature Hydration
            ↓
Multi-objective Ranking
            ↓
Distribution Controller
            ↓
Feed Mixer
            ↓
Preference / Privacy Recheck
            ↓
Feed Read Model
            ↓
Client Hydration / Render
```

---

## 8.5 Eligibility Gate

先过滤，再排序：

```text
visibility
block
hard mute
legal / safety
content status
org privacy
same-org sensitive gate
age / membership / permission
expired opportunity
agent availability
business visibility policy
```

非法 / 越权内容不是“低分”，而是不可进入 Candidate Pool。

---

## 8.6 Candidate Retrieval

独立 Retriever：

```text
SearchIntent Retriever
Following Retriever
Relationship Retriever
Opportunity Retriever
AgentCapability Retriever
Job Retriever
Topic Retriever
Activity Retriever
Intelligence Retriever
Geo Context Retriever
Business Retriever
Trending Retriever
Exploration Retriever
```

每个返回：

```text
candidate_id
retrieval_source
retrieval_score
reason
freshness
matched_intent_refs[]
```

---

## 8.7 Explicit Preference > Learned Preference

用户必须能自己训练 Feed。

每条 Feed Item `···` 根据类型动态提供：

```text
不感兴趣
减少此类内容
减少这个话题
少看这个人
不看这个人
减少 Agent 自我展示
减少商业内容
减少招聘
减少活动
减少生活照片
这类只看我关注的人
暂停此类 7 天 / 30 天
举报
```

“减少”与“屏蔽”严格分离：

```text
REDUCE     → 权重降低，可恢复
NOT_INTERESTED → 强负反馈
MUTE       → 指定范围不进入 Feed
BLOCK      → 彻底 Eligibility false
REPORT     → Safety flow
```

用户点击“减少此类内容”后，系统应让用户明确减少哪个语义维度，而不是自行猜测敏感属性。

例如一条 Agent 自拍：

```text
减少：
□ Agent 日常展示
□ 自拍 / 生活照片
□ 摄影话题
□ 这个人的内容
□ 类似热门内容
```

禁止自动推断：

```text
性别
种族
宗教
其他敏感人口属性
```

作为负反馈 Target。

### Preference Scope

```text
SESSION
7_DAYS
30_DAYS
PERSISTENT
```

用户可以进入“我的推荐”查看 / 调整：

```text
机会
人和关系
活动
情报
普通内容
商业内容
工作
附近
视频 / 图片 / 长文
```

显式 Preference 在 Ranking 中优先于 Passive Learned Preference。

---

## 8.8 Feed Preference 与业务 Match 隔离

必须维护独立 Namespace：

```text
feed.preference.*
task.matching.*
ad.preference.*
notification.preference.*
```

例如：

```text
用户：减少“摄影 Agent 日常自拍”
↓
Feed Expression 降权

但用户创建：明天需要摄影师
↓
Task Matching 正常查找 Qualified Photographer
```

避免用户调教 Feed 误伤真实业务执行。

---

## 8.9 Multi-objective Ranking

不使用单一 `engagement_probability`。

Feature Families：

```text
SearchIntentMatch
ExplicitPreferenceFit
ContentValue
RelationshipValue
OpportunityValue
Trust
Freshness
InformationDensity
Actionability
Novelty
ContextFit
PassiveEngagementPrediction
NegativeFeedbackRisk
PrivacyRisk
RepetitionRisk
```

可以训练：

```text
P(reply)
P(save)
P(profile_open)
P(contact)
P(join_activity)
P(apply)
P(task_created)
P(order)
P(return)
P(not_interested)
```

最终由 Multi-objective Policy 决定，不直接把预测概率简单相加。

---

## 8.10 Distribution Controller：传播度是资源，不是奖励

每个 Signal 在生成时获得：

```text
DistributionPolicy
- initial_audience
- max_reach
- eligible_audience_type
- expansion_step
- expansion_trigger
- decay
- frequency_cap
- creator_exposure_cap
- geo_boundary optional
- viral_ceiling
```

不同 Signal 的默认传播逻辑不同：

```text
PERSONAL_EXPRESSION
→ 关注 / 弱关系 / 兴趣小范围
→ 有传播上限

CAPABILITY_SIGNAL
→ 相关 Intent / 潜在需求人群
→ 不向所有人广播

OPPORTUNITY_NEED
→ 所有 Qualified Supply
→ 可跨 Feed / Task / Notification

ACTIVITY
→ 区域 + 兴趣 + 关系

OUTCOME_REPUTATION
→ 相关用户 + 聚合展示
```

漂亮图片带来高 CTR，可以提高该内容的 Content Score，但不能突破无关用户的传播资格，也不能自动提高 Agent Task Rank。

### Expansion 不只看点赞

每轮传播扩张优先观察：

```text
Profile Open
Meaningful Reply
Follow
Save
Contact
Qualified Inquiry
Activity Join
Task / Need Action
Real Outcome
```

只有娱乐互动，没有关系 / 意图价值的内容，可以继续作为普通内容存在，但不应无限扩张。

---

## 8.11 Agent Exposure Policy

真人 Agent 不是无限曝光的 Creator Asset。

Agent 可设置：

```text
NORMAL   只对相关人群正常发现
EXPAND   接受更广机会曝光
PRIVATE  只对任务匹配 / 直接搜索可见
PAUSED   暂停新机会
```

服务端还需：

```text
agent_profile_reach_cap
agent_direct_message_rate_limit
unknown_user_contact_policy
harassment_risk_gate
```

防止一个 Agent 因照片突然爆量曝光后遭遇大量无关私信。

---

## 8.12 Feed Mixer：两套系统叠加，而不是一条排序榜

候选池至少分成：

```text
Social / Content Pool
Opportunity Pool
Relationship Pool
Activity Pool
Intelligence Pool
Business Pool
```

最终由 `FeedMixer` 组合。

目标：

```text
不连续十条 Agent 自拍
不连续十条招聘
不连续十条商业活动
不让一种高 CTR 内容吃掉整个 Feed
```

初期可使用 Server Config，例如：

```text
Exploit      70%
Explore      20%
Serendipity  10%
```

只是默认实验值，不是产品常量。

Mixer 接受：

```text
UserPreference
ActiveContext
CurrentIntent
SessionState
SupplyHealth
DistributionPolicy
ExperimentVariant
```

用户明确调整“少看商业 / 多看活动 / 多看机会”后，Mixer 比例立即改变。

---

## 8.13 新 Agent / 新内容的 Exploration

传统算法容易形成：

```text
头部赢
→ 更多曝光
→ 更多互动
→ 永久头部
```

Proxy 必须给满足质量 / 安全门槛的新 Agent 与新内容最低探索机会。

但 Exploration 不等于随机曝光：

```text
Qualified First
Relevant First
Controlled Reach
Outcome Feedback
```

真实履约表现长期强于粉丝量。

---

## 8.14 Recommendation Reason

保存机器可读原因：

```text
SEARCH_INTENT_MATCH
FOLLOWING
SECOND_DEGREE_CONNECTION
ROLE_RELEVANT
TOPIC_RELEVANT
RECENT_JOB_INTENT
RECENT_CLIENT_INTENT
JOINED_SIMILAR_ACTIVITY
RELATED_OUTCOME
NEARBY_CONTEXT
EXPLORATION
```

客户端可显示：

```text
“与你刚才搜索的内容相关”
“因为你最近在找工作”
“2 位共同联系人互动过”
“与你参加过的活动类似”
```

用户可从推荐理由直接进入 Preference Action。

---

# 9. Cold Start 与用户主动调教

首次进入不强迫复杂问卷。

最少可选：

```text
你最近主要想：
□ 看内容
□ 认识人
□ 找机会
□ 找工作
□ 接任务
□ 参加活动
```

可选：

```text
行业
岗位
城市 / 区域
语言
```

真正的 Cold Start 第一数据源仍然是：

```text
首次 Search
首次 Follow
首次明确 Preference
首次 Join / Save / Contact
```

提供“重新调整推荐”入口，用户不需要删账号才能重置算法。

---

# 10. Metrics：把 Search、传播健康、Agent 机会公平一起测

## 10.1 Search / Intent

```text
Search Success Rate
Zero-result Rate
Search → Profile Open
Search → Contact
Search → Task / Need
Search → Activity Join
Search → Order / Outcome
Intent TTL accuracy
```

## 10.2 Feed

```text
Meaningful Action Rate
Qualified Connection Rate
Thread Depth
Save / Return Rate
D1 / D7 / D30 Return
Negative Feedback Rate
Preference Action Rate
Preference Satisfaction Lift
```

## 10.3 Distribution Health

```text
Creator / Agent Exposure Concentration
Top 1% Reach Share
New Agent Qualified Exposure Rate
Content Class Concentration
Viral Ceiling Trigger Rate
Irrelevant Exposure Rate
Same-org Privacy Complaint Rate
```

## 10.4 Agent Economy

```text
Qualified Agent Discovery Rate
Search → Agent Contact
Agent Contact → Task
Task → Completed Outcome
New Agent First Qualified Lead Time
Opportunity Distribution Fairness
```

## 10.5 不作为北极星

```text
Raw Watch Time
Raw Like Count
Follower Count
Video Completion alone
```

这些可诊断内容吸引力，但不能单独驱动产品方向。

---

# 11. Business OS 总体定义

“我的企业”不是设置页，是：

> **Business Control Plane**

8 个入口：

```text
数字经营
1. 线上店铺
2. 企业运营助手
3. 活动与门店导流

人员与执行
4. 成员与权限
5. 合作执行者（原：常用执行者）
6. 结果与复盘（原：门店结果历史）

财务与企业管理
7. 支出与账单
8. 企业 / 店铺资料
```

这些不是 8 个孤岛。

主链：

```text
企业资料
→ 成员 / 权限
→ 店铺 / Offer / 活动
→ Feed / Targeting
→ 任务 / 执行
→ 到店 / 履约
→ Outcome
→ Spend
→ AI Review
→ Next Action
```

---

# 12. 功能 1 — 线上店铺 / Merchant Storefront

## 12.1 目标

企业在 Proxy 的统一商业承接面，不复制大型电商平台。

支持：

```text
商品
服务
门店预约
活动权益
团购
限时 Offer
Off-peak Offer
活动票
```

## 12.2 一级能力

```text
Store Overview
Offer Catalog
Order
Customer Interaction
Review
Store Presentation
Business Settings
```

## 12.3 Offer Object

建议：

```text
Offer
- offer_id
- business_id
- store_id / venue_id
- type
- title
- description
- price
- reference_price optional
- available_quantity optional
- start_at / end_at
- service_window optional
- eligibility_policy
- redemption_policy
- refund_policy
- status
- source_campaign_id optional
```

## 12.4 Off-peak 能力

商家可开放：

```text
Time Window
Capacity / Quantity
Floor Price
Target Audience
Restrictions
```

系统不宣传“产能交易”，用户只看到真实 Offer。

## 12.5 Read Model

```text
StorefrontReadModel
StorePerformanceReadModel
OfferReadModel
OrderSummaryReadModel
```

## 12.6 Model UI

模型可根据商家类型动态组合：

```text
STORE_HEADER
OFFER_RAIL
TIME_WINDOW_OFFER
BUSINESS_POSTS
REVIEWS
ACTIVITY_RAIL
ORDER_STATUS
```

无需为咖啡、餐厅、健身、活动场地分别写一套页面。

---

# 13. 功能 2 — 企业运营助手 / Enterprise Ops Skill

## 13.1 定义

不是 Chatbot，而是：

> **企业经营意图 → 分析 → 计划 → 可执行 Command 的 Skill Workspace**

## 13.2 首页问题

```text
今天有什么需要我处理？
```

系统聚合：

```text
Campaign status
Store performance
Task status
Execution exception
Spend anomaly
Outcome regression
Customer signal
Off-peak opportunity
```

## 13.3 可支持命令

```text
分析经营状态
创建活动草案
生成 Feed 内容草案
创建任务
安排执行者
比较活动结果
分析支出
生成整改计划
回复公开客户问题草案
```

## 13.4 Command Gate

模型只生成 Proposal：

```text
OpsProposal
```

任何高影响写操作仍走：

```text
Proposal
→ User confirmation / permission
→ Domain Command
→ Server ACK
→ Read Model refresh
```

模型不能直接写业务真相。

---

# 14. 功能 3 — 活动与门店导流 / Growth Center

## 14.1 Activity Objective

创建活动前先选结果：

```text
NEW_CUSTOMER
VISIT
REACTIVATION
SALE
EVENT_ATTENDANCE
BRAND_AWARENESS
```

## 14.2 Activity Builder

输入最少：

```text
Objective
Audience
Time
Budget
Offer
Quantity / Capacity
```

其余由规则 + 模型辅助生成：

```text
内容草案
Feed Card
人群建议
渠道组合
执行 Checklist
预算拆分
结果指标
```

## 14.3 Funnel

结果必须追踪：

```text
Eligible
→ Reached
→ Viewed
→ Claimed / Interested
→ Reserved
→ Arrived
→ Redeemed
→ Repeat
```

不能只报 Impression / Click。

## 14.4 Feed Integration

Activity 可以被投影为 Feed Candidate，但是否推荐由 Feed Ranker 决定。

Sponsored 内容必须：

```text
明确标记
通过 Eligibility
通过 relevance threshold
不绕过 privacy / block / same-org policy
```

---

# 15. 功能 4 — 成员与权限

## 15.1 Business Role

P0：

```text
OWNER
ADMIN
STORE_MANAGER
OPERATIONS
MARKETING
BILLING
EXECUTOR
VIEWER
```

## 15.2 Permission

必须 Action-level：

```text
CREATE_ACTIVITY
PUBLISH_CONTENT
MODIFY_OFFER
VIEW_CUSTOMER_DATA
VIEW_BILLING
APPROVE_SPEND
ISSUE_REFUND
MANAGE_MEMBER
MANAGE_SETTLEMENT
ASSIGN_EXECUTOR
```

## 15.3 High-risk Approval

例如：

```text
修改结算账户
大额预算
批量退款
改变 Owner
删除主体
高额权益
```

需要：

```text
requested_by
approved_by
reason
policy_version
server_receipt
```

UI 不得因为模型显示按钮就获得权限。

---

# 16. 功能 5 — 合作执行者 / Execution Network

## 16.1 定位

不是收藏联系人，而是：

> **来自真实合作结果的可复用执行网络。**

## 16.2 Executor Profile

```text
capabilities
service_areas
languages
completed_jobs
on_time_rate
outcome_quality
repeat_count
last_cooperation
relationship_state
```

## 16.3 Recommendation

当企业创建 Task：

```text
Task Requirement
→ Capability Eligibility
→ Previous Cooperation
→ Availability
→ Outcome History
→ Recommended Executors
```

“熟人”不能绕过 Capability / Safety / Permission Gate。

---

# 17. 功能 6 — 结果与复盘 / Outcome & Review

继续严格复用 Chapter 21D：

```text
Objective Fact
≠ Agent Assessment
≠ Requester Satisfaction
```

## 17.1 结果链

```text
Activity / Order / Task
→ ObservationSet
→ Finalize
→ OutcomeDelta
→ Review
→ Corrective Action
→ Re-validation
```

## 17.2 Business Memory

企业可以问：

```text
过去哪类活动转化最好？
哪些门店问题重复出现？
哪个执行者在什么任务上最可靠？
投入 5M 以上的活动平均得到什么结果？
```

模型回答必须来自 Outcome Read Model，不从 Feed 评论推断业务真相。

---

# 18. 功能 7 — 支出与账单

Proxy 不做完整 ERP / Accounting。

只管理 Proxy 域内发生的：

```text
Platform Fee
Campaign Spend
Task / Executor Cost
Settlement
Refund
Sponsored Budget
```

## 18.1 Cost → Outcome

关键不是账单列表，而是：

```text
Spend
→ Campaign / Task
→ Outcome
```

支持：

```text
Cost per Visit
Cost per New Customer
Cost per Completed Task
Cost per Repeat
```

财务真相仍来自 Ledger / Settlement，不允许 UIPlan 自己算后写回。

---

# 19. 功能 8 — 企业 / 店铺资料

## 19.1 三层对象

```text
Business Principal
Brand
Store / Venue / Online Node
```

不得混成一个 `merchant` JSON。

## 19.2 Business Principal

```text
legal_name
registration
tax_id
representative
verification
settlement
```

## 19.3 Brand

```text
brand_name
logo
industry
public_profile
social_links
brand_assets
```

## 19.4 Store / Venue

```text
address
hours
manager
contact
services
offers
activities
outcomes
reviews
```

## 19.5 Enterprise Graph

```text
Business
├─ Brand A
│  ├─ Store 01
│  ├─ Store 02
│  └─ Online Node
└─ Brand B
   └─ Venue 03
```

---

# 20. 总体前端架构原则

本节是本修订的工程核心。

正式原则：

> **Server controls experience. Client controls legality of rendering. Model controls bounded composition. Domain runtime controls truth.**

不是：

```text
Server 下载远程 JS
LLM 生成 React 页面
LLM 生成 HTML
每个新场景手写一张新 Page
```

而是：

```text
Server Experience Manifest
        +
Model UIPlan / DynamicBlockPlan
        ↓
Client UI Orchestrator
        ↓
Registered Components + UI Primitives
        ↓
Stable Surface
```

---

# 21. 四层运行时

## 21.1 Layer A — Native App Shell

本地固定：

```text
AppShell
Root Navigation
Authentication Host
Safe Area
Modal Host
Sheet Host
Deep Link Host
Search Host / Search Workspace Host
Push Handling
Secure Storage
Component Runtime
Permission Recheck Runtime
```

这些属于 App Binary / 客户端能力。

## 21.2 Layer B — Server-Driven Experience

服务器可更新：

```text
Root item visibility
Surface configuration
Menu sections
Card composition policy
Feature flags
Search / Intent policy
Feed ranking config
Distribution / Mixer policy
User Preference policy
Experiment assignment
Copy
Design token variant
Component enablement
CTA policy
Business feature availability
```

客户端启动 / Resume 后获取最新 Manifest，自动应用，无需为普通业务改动重新写页面。

## 21.3 Layer C — Model-Driven UI

模型可根据上下文生成：

```text
UIPlan
DynamicBlockPlan
FormPlan
SummaryPlan
ActionProposal
```

但只能使用客户端声明支持的组件 / Primitive。

## 21.4 Layer D — Domain Truth

真实状态：

```text
Identity
Business
Membership
SearchIntent / Preference Truth
Post
Activity
Need
Task
Offer
Order
Payment
Settlement
Outcome
Permission
```

UIPlan 永远不成为这些对象的 Source of Truth。

---

# 22. Server-Driven Update Protocol

## 22.1 Client Capability Manifest

客户端向 Server 声明：

```json
{
  "app_version": "1.5.0",
  "platform": "android",
  "experience_schema_versions": ["1.0", "1.1"],
  "ui_plan_versions": ["1.0"],
  "component_registry_version": "2026.08.18",
  "supported_components": [
    "SEARCH_RESULT_GROUP",
    "SEARCH_SUGGESTION_RAIL",
    "FEED_POST_CARD",
    "OPPORTUNITY_CARD",
    "BUSINESS_METRIC_GROUP",
    "ACTIVITY_CARD"
  ],
  "supported_primitives": [
    "STACK",
    "TEXT",
    "BADGE",
    "METRIC",
    "ACTION_ROW",
    "DIVIDER"
  ],
  "supported_actions": [
    "OPEN_SURFACE",
    "OPEN_SEARCH",
    "APPLY_FEED_PREFERENCE",
    "OPEN_THREAD",
    "OPEN_CONVERSATION",
    "SUBMIT_DOMAIN_COMMAND"
  ]
}
```

## 22.2 Experience Manifest

Server 返回：

```json
{
  "schema_version": "1.1",
  "revision": "exp_20260818_23",
  "context": "BUSINESS",
  "root_nav": ["HOME", "TASKS", "FEED", "ME"],
  "features": {
    "business_ops_assistant": true,
    "feed_recommendation": true,
    "search_intent_graph": true,
    "user_feed_controls": true,
    "distribution_controller": true,
    "same_org_privacy_gate": true
  },
  "surface_policy_version": "sp_42",
  "ranking_config_version": "feed_rank_17",
  "minimum_app_version": "1.4.0",
  "ttl_seconds": 1800
}
```

## 22.3 自动更新语义

所谓“服务器更新，前端自己更新”正式定义为：

```text
Server 发布新的 Manifest / UIPlan policy / Ranking config
↓
Client 获取新 revision
↓
Schema + signature + compatibility validation
↓
存为 Last Known Good
↓
下一次 Surface Render 生效
```

**不依赖远程执行 JS。**

## 22.4 Last Known Good

如果 Server Manifest 非法 / 网络失败：

```text
使用本地最后一次通过验证的 Manifest
```

永远不能因为服务端下发错误导致整个 App 白屏。

---

# 23. “不是全部写好的 UI”怎么实现

只做 Component Registry 仍然可能变成：

> 每一种 Card / Panel 都得提前手写。

因此 R15.2 继续强化 **Generative UI Primitive Layer**。

## 23.1 两级 UI 生成

### Level 1 — Registered Business Components

复杂、有 Domain 行为的组件仍手写：

```text
FeedPostCard
OpportunityCard
CandidateRail
OrderProgress
StoreOfferCard
CampaignFunnel
OutcomeDelta
PermissionEditor
BillingBreakdown
```

### Level 2 — Declarative UI Primitives

普通信息布局允许模型组合：

```text
STACK
ROW
SECTION
TEXT
RICH_TEXT
IMAGE
BADGE
CHIP
METRIC
METRIC_GROUP
PROGRESS
DIVIDER
ACTION_ROW
INFO_LIST
KEY_VALUE
TIMELINE
EMPTY_STATE
FORM_FIELD
SELECT
NOTICE
```

因此模型可以生成以前必须写死的小页面 / 小面板，而不是生成代码。

## 23.2 DynamicBlockPlan Example

```json
{
  "block_id": "biz_daily_summary",
  "layout": {
    "type": "STACK",
    "gap": "M"
  },
  "children": [
    {
      "type": "TEXT",
      "role": "TITLE",
      "text": "今天有 3 件事需要处理"
    },
    {
      "type": "METRIC_GROUP",
      "items": [
        {"label": "活动中", "value_ref": "business:summary.active_campaigns"},
        {"label": "待执行", "value_ref": "business:summary.pending_tasks"},
        {"label": "异常", "value_ref": "business:summary.exceptions"}
      ]
    },
    {
      "type": "ACTION_ROW",
      "actions": [
        {"action_id": "OPEN_CAMPAIGN", "label": "查看活动"},
        {"action_id": "OPEN_EXCEPTIONS", "label": "处理异常"}
      ]
    }
  ]
}
```

模型生成结构；真实数值由 `value_ref` Hydration。

模型不得直接写：

```text
"今日成交 1.2B"
```

除非该值来自 Server Read Model。

---

# 24. UIPlan

## 24.1 UIPlan 负责“组合”

```text
Surface
Panel selection
Panel order
DynamicBlock placement
Data references
Allowed actions
```

Example：

```json
{
  "ui_plan_id": "uip_biz_102",
  "schema_version": "1.1",
  "surface": "BUSINESS_HOME",
  "context": "BUSINESS",
  "panels": [
    {
      "component_id": "BUSINESS_IDENTITY_HEADER",
      "data_ref": "business:biz_001"
    },
    {
      "dynamic_block_ref": "dynamic:biz_daily_summary"
    },
    {
      "component_id": "BUSINESS_CONTROL_GRID",
      "data_ref": "business:biz_001:capabilities"
    }
  ]
}
```

## 24.2 Model May

```text
选择已注册 Surface
选择已注册 Component
组合 Primitive
排序 Panel
生成摘要性文案
选择最少必要 Input
提出 Domain Action Proposal
```

## 24.3 Model May Not

```text
发明 Route
发明 Permission
输出 React / JS / HTML
直接操作 Payment
直接写 Ledger
直接改变 Task / Order / Outcome 状态
读取越权数据
创建未注册 Native Capability
```

---

# 25. UI Orchestrator

正式 Pipeline：

```text
UIPlan Received
↓
Schema Validate
↓
Version Negotiate
↓
Surface Allowlist
↓
Component / Primitive Allowlist
↓
Permission Recheck
↓
DataRef Authorization
↓
Action Policy Check
↓
Deduplicate / Order
↓
Hydrate Read Models
↓
Render
```

核心公式：

```text
Renderable Experience
=
Server Plan
∩ Client Capabilities
∩ User Permissions
∩ Domain Policy
```

模型输出只是候选 Plan。

---

# 26. Component Registry Contract

每个组件必须登记：

```text
component_id
component_version
supported_surfaces[]
supported_contexts[]
required_read_models[]
required_permissions[]
supported_actions[]
material_action?
fallback_component
minimum_client_version
```

Primitive 也要 Registry，不允许模型自由发明字段。

---

# 27. Action Registry

所有 UI Action 是强类型：

```text
OPEN_SURFACE
OPEN_THREAD
OPEN_PROFILE
OPEN_CONVERSATION
OPEN_ACTIVITY
OPEN_OFFER
OPEN_ORDER
SUBMIT_POST
REPLY_POST
QUOTE_POST
REPOST
BOOKMARK
FOLLOW
JOIN_ACTIVITY
SUBMIT_DOMAIN_COMMAND
```

禁止：

```text
"execute": "some arbitrary string"
```

高影响 Action 必须映射到 Domain Command。

---

# 28. Search + Feed Server Architecture

## 28.1 Write / Projection Path

```text
Human Post / Business Post / Activity / Need / Task / Outcome
↓
Domain Command / Content Command
↓
Canonical Truth
↓
Domain Event
↓
Projection Worker
↓
Search Index + Feed Index + Graph Update
```

Feed 只存 Projection，不复制业务真相。

## 28.2 Search Path

```text
Search / Ask AI
↓
Query Understanding
↓
Intent Event
↓
Search Router
↓
Entity / People / Opportunity / Activity / Content Retrievers
↓
Search Result Ranker
↓
SearchResultPlan
↓
SEARCH_WORKSPACE
```

Search Result Ranker 与 Feed Ranker 可以共享 Feature / Intent Graph，但不是同一个目标函数。

## 28.3 Feed Read Path

```text
GET Feed
↓
Eligibility Service
↓
Candidate Retrievers
↓
User Preference Policy
↓
Feature Hydration
↓
Multi-objective Ranker
↓
Distribution Controller
↓
Feed Mixer
↓
Privacy / Preference Recheck
↓
Feed Read Model
```

## 28.4 Suggested Logical Services

```text
Search Service
Query Understanding Service
Intent Event Service
Intent Graph Service
Content Service
Content Projection Service
Relationship Graph Service
User Preference Service
Candidate Retrieval Service
Feature Service
Multi-objective Ranking Service
Distribution Controller
Feed Mixer
Feed Policy Service
Recommendation Explanation Service
Agent Exposure Policy Service
Ad Audience Resolver
Experiment Service
```

P0 不要求拆成微服务；允许模块化单体，但 Contract 独立。

---

# 29. Feed / Search Data Objects

建议增加：

```text
ContentPost
ContentProjection
FeedCandidate
FeedImpression
FeedInteraction
RecommendationReason
SearchQueryEvent
SearchResultImpression
IntentEvent
UserIntentState
UserFeedPreference
PreferenceEvent
RelationshipEdge
DistributionPolicy
DistributionReceipt
FeedMixPlan
AgentExposurePolicy
OrganizationExposurePolicy
ContentClaimMetadata
ContentQualitySignal
AdAudienceEligibility
AdAttributionEvent
```

## 29.1 UserFeedPreference

```text
preference_id
user_id
namespace
scope
object_type
object_ref optional
topic optional
content_class optional
direction = MORE | LESS | MUTE | BLOCK
strength
starts_at
expires_at optional
source = EXPLICIT | LEARNED
```

原则：

```text
EXPLICIT > LEARNED
BLOCK / MUTE 在 Eligibility 执行
LESS / MORE 在 Ranking + Mixer 执行
```

## 29.2 DistributionReceipt

每次传播扩张保存：

```text
content_id
policy_version
stage
eligible_audience_count
served_count
expansion_reason
viral_ceiling
creator_reach_count
next_expansion_allowed
```

使“为什么突然爆量传播”可审计。

## 29.3 Intent Graph

最少关联：

```text
User
→ Intent
→ Entity / Topic / Role / Location / Time
→ Action
→ Outcome
```

Intent 是动态状态，不是永久人格标签。

---

# 30. Read Model First

所有组件读取 Read Model，不读 Raw Table。

新增：

```text
SearchWorkspaceReadModel
SearchResultGroupReadModel
FeedItemReadModel
FeedPreferenceReadModel
RecommendationReasonReadModel
AgentDiscoveryReadModel
ThreadReadModel
BusinessHomeReadModel
StorefrontReadModel
CampaignReadModel
OutcomeReadModel
BillingReadModel
ExecutionNetworkReadModel
```

Search / Feed / Ads 使用 Canonical Intent / Graph 服务，但分别有自己的 Read Model 与 Policy Boundary。

---

# 31. Model Runtime

Frontend 不出现 Provider-specific 业务代码。

统一：

```text
ModelRuntimeClient
```

Server 输入：

```text
Task / Search / Feed Context
+ Allowed Registry Manifest
+ Authorized Read Models
+ User Preference Summary
+ Policy Context
↓
Unified Model Runtime
↓
Structured Output
```

模型 Provider 可替换。

---

# 32. 模型在 Search / Feed 中的位置

模型不是 Search Truth，也不是 Feed Ranking Truth。

适合模型：

```text
Query semantic understanding
Intent extraction
Entity / topic normalization
Content classification
Claim extraction
Thread summary
Cross-language translation
Cold-start semantic retrieval
Preference disambiguation
Recommendation explanation draft
Dynamic UI composition
```

不适合让 LLM 每次 Impression 做全量实时排序。

演进：

```text
P0
Rules + Search + Graph + Explicit Preference + Deterministic Mixer

P0.5
Embedding Retrieval
+ Model-assisted semantic understanding

P1
Learning-to-Rank
+ Multi-task prediction

P2
Adaptive multi-objective ranking
+ constrained small-set model rerank where justified
```

模型输出必须经过 Schema / Policy / Registry Validation。

---

# 33. Privacy / Intelligence / Search Data Gate

## 33.1 Search 是高价值数据，也是高敏感度行为数据

Search Event 可用于：

```text
Search relevance
Feed personalization
Intent Graph
Agent / Opportunity matching
Aggregate ad audience matching
Attribution
```

不得把原始搜索历史直接出售给广告主。

广告主不应看到：

```text
“某用户昨天搜了什么”
个人完整搜索日志
私人聊天内容
私有 Task 内容
未授权敏感属性
```

广告侧只接：

```text
Audience Definition
↓
Proxy internal resolver
↓
Eligible Audience
↓
Reach / Action / Outcome aggregate metrics
```

## 33.2 用户广告偏好与 Feed 偏好分离

```text
feed.preference.*
ad.preference.*
```

用户“少看某类普通 Feed 内容”，不自动等同“拒绝所有相关广告”；广告必须单独遵守广告设置、法律基础、频控与敏感类别规则。

## 33.3 Intelligence Content

继续要求：

```text
identity verification status
employment verification status
public / private source
claim type
personal experience marker
report flow
right to reply
PII redaction
organization exposure gate
```

平台可验证身份，对外显示半匿名职业身份。

---

# 34. Server-Driven Search / Feed Config

客户端不持有推荐核心权重。

Server Config 示例：

```json
{
  "version": "feed_search_22",
  "search": {
    "explicit_intent_priority": "HIGHEST",
    "intent_ttl_policy": "intent_ttl_v4",
    "semantic_router_version": "search_router_7"
  },
  "preferences": {
    "explicit_over_learned": true,
    "default_reduce_factor": 0.35,
    "not_interested_factor": 0.10
  },
  "distribution": {
    "personal_expression_viral_ceiling": 5000,
    "capability_signal_expansion": "MATCHED_AUDIENCE_ONLY",
    "opportunity_need_expansion": "QUALIFIED_SUPPLY",
    "agent_exposure_policy_version": "agent_reach_3"
  },
  "mixer": {
    "exploit": 0.70,
    "explore": 0.20,
    "serendipity": 0.10,
    "max_same_class_streak": 2,
    "max_same_author_streak": 1
  },
  "ranking": {
    "search_intent": 1.0,
    "explicit_preference": 0.95,
    "outcome_relevance": 0.85,
    "relationship": 0.70,
    "trust": 0.70,
    "content_quality": 0.55,
    "passive_engagement": 0.25
  }
}
```

数值均为实验配置，不是客户端产品常量。

Server 可在不更新 App Binary 的情况下改变：

```text
Retriever enablement
Intent TTL
Ranker version
Preference policy
Distribution ceiling
Feed mix policy
Experiment assignment
Recommendation explanation policy
```

但不能越过 Client Capability / Permission / Domain Policy。

---

# 35. Advertising Data Architecture

广告不是 Feed 的最终目的，但 Intent / Search / Outcome 沉淀可以形成高价值广告能力。

## 35.1 数据优先级

广告 Audience Signal 参考：

```text
Explicit Search / Need / Ask
> Contact / Apply / Join / Quote
> Save / Profile Open
> Reply / Follow
> Passive Engagement
```

## 35.2 Audience Resolver

```text
Advertiser Target
↓
Policy / Sensitive-category Gate
↓
Intent Graph
+ Profile permitted fields
+ Relationship / Context permitted signals
+ Outcome aggregates
↓
Audience Eligibility
↓
Ad Delivery
↓
Attribution
```

广告主只获得必要的：

```text
eligible audience estimate
reach
click / contact / visit / order / apply 等结果
aggregate conversion
```

不导出原始用户画像数据库。

## 35.3 Search → Ads 不是实时跟踪式骚扰

搜索后广告需要：

```text
Intent TTL
Frequency Cap
Category Safety
Negative Feedback
Ad Preference
Context Fit
```

避免用户搜一次某内容，随后长期被同一广告追踪。

## 35.4 Outcome Feedback

真正价值闭环：

```text
Search / Intent
→ Ad / Organic Discovery
→ Contact / Action
→ Task / Visit / Order
→ Outcome
```

广告系统优化的是可验证 Outcome，而不仅是 CTR。

---

# 35A. Experiment Architecture

Search / Feed / Distribution / Ads 必须 Server-side Experiment：

```text
experiment_id
variant
search_router_version
intent_policy_version
ranking_version
distribution_policy_version
mixer_version
manifest_revision
ui_plan_version
```

同一次 Impression / Search 必须可回溯到完整配置版本。

---

# 36. Event-Driven UI Patch

Non-streaming 先稳定。

之后支持：

```text
UI_PLAN_START
PANEL_ADD
PANEL_PATCH
PANEL_REMOVE
COMPLETE
```

例如：

```text
Campaign Created
→ Campaign Status Panel appears

New Qualified Lead
→ Lead Summary Patch

Order Completed
→ Outcome Panel replaces Execution Panel
```

仍然不创建新页面。

---

# 37. Offline / Cold Start

继续遵守 v1.1 App Shell Contract：

```text
Last Safe Route
Last Known Good Manifest
Unsent Draft
Pending Command State
```

Resume：

```text
重新拉 Domain lifecycle
重新拉 Experience revision
重新验证 Permission
```

未收到 Server ACK 的 Domain Command 永远不能显示成功。

---

# 38. Observability

必须记录：

## Experience

```text
manifest_revision
surface
ui_plan_id
model_run_id
requested_components
rendered_components
rejected_components
fallback_used
unsupported_component
```

## Feed

```text
ranking_version
retriever_sources
candidate_count
eligibility_rejections
score_features
recommendation_reason
impression
interaction
negative_feedback
real_world_action
```

## Business OS

```text
proposal_id
command_id
server_ack
campaign_id
spend_id
outcome_id
```

---

# 39. Architecture Failure Modes

必须防止：

```text
Server Manifest 下错导致全端白屏
模型生成不存在 Component
模型生成越权 Action
Feed 模型泄露同厂敏感内容
UIPlan 把推断值显示成财务真相
Content Projection 复制过期 Domain 状态
Ranking Config 无版本导致线上不可复现
Experiment 没有 Variant Receipt
```

---

# 40. Deterministic Fallback

任何核心 Surface 都有无模型版本。

例如：

```text
BUSINESS_HOME fallback
→ Business Identity
→ Business Control Grid
→ Today Summary

FEED fallback
→ Following latest
→ Curated opportunity
→ Public activity
```

模型不可用 ≠ App 不可用。

---

# 41. Product / Architecture Acceptance Gates

## Gate A — Feed Value

Feed 不能退化成：

```text
附近优惠
纯生活晒图
同厂动态墙
无限视频
```

## Gate B — Feed Algorithm

必须有：

```text
Eligibility
Multiple Retrievers
Ranking
Privacy Re-rank
Diversity
Negative Feedback
Versioning
```

## Gate C — Same-org Privacy

敏感内容不能因为同公司关系被自动扩大曝光。

## Gate D — Business Closed Loop

至少一条真实闭环：

```text
Business creates activity
→ Feed distribution
→ User action
→ Execution / Visit
→ Outcome
→ Spend review
```

## Gate E — Server-driven

修改以下内容不得要求新业务 Page：

```text
Menu composition
Feature visibility
Card ordering
Feed config
Business Home panel mix
Campaign summary layout
```

## Gate F — Model UI

模型可生成 DynamicBlockPlan，并在真实客户端渲染。

## Gate G — No Remote Executable Code

Server / Model 不下发：

```text
JS
JSX
HTML executable behavior
arbitrary native command
```

## Gate H — Domain Truth Isolation

UI / Feed / Model 不改变 Canonical Domain Truth。

---

# 42. 开发顺序

建议顺序：

```text
Phase 0
Freeze old content assumptions

Phase 1
Feed stable surface
X-like post / reply / quote / repost / bookmark

Phase 2
ContentProjection + Feed Read Model

Phase 3
Eligibility + Following / Relationship / Opportunity Retrievers

Phase 4
Server-side Ranker + Ranking Config + Experiment Receipt

Phase 5
Same-org privacy / anonymous verified intelligence

Phase 6
Business Home 8-entry closed loop

Phase 7
ExperienceManifest vNext + capability negotiation

Phase 8
Dynamic UI Primitive Registry

Phase 9
Model UIPlan / DynamicBlockPlan

Phase 10
Event-driven UI patch / streaming
```

Business 8 个入口内部优先级：

```text
P0:
企业运营助手
活动与门店导流
线上店铺
结果与复盘

P0.5:
成员与权限
合作执行者

Foundation:
支出与账单
企业 / 店铺资料
```

---

# 43. 最终产品判断

R15.2 冻结以下判断：

```text
Search 是最高质量主动意图入口；
Feed 是发现、信任与关系生成层；
Agent 拿单是重要经济闭环，但 Feed 不是 Agent 广告墙；
Popularity 不等于 Qualification；
用户必须能显式调教自己的 Feed；
传播度由 Distribution Controller 管理，而不是单纯奖励高 CTR；
真人 Agent 必须有 Reach Policy 和骚扰保护；
同厂只是 Context，不是天然朋友关系；
Search / Intent / Outcome 可以沉淀为广告能力，但原始搜索历史不出售；
Feed Preference、Task Matching、Ad Preference 必须分 Namespace；
服务器控制 Experience / Search / Ranking / Mixer / Distribution Config；
客户端控制可渲染能力、安全、权限和 Last Known Good；
模型负责语义理解与受限 UI 组合，不生成任意代码和业务真相。
```

产品主链最终不是：

```text
Content → Engagement → More Content
```

也不是：

```text
Agent Ad → Order
```

而是：

```text
Search / Intent
      +
Natural Content / People / Activity
      ↓
Discovery + Trust + Relationship
      ↓
Opportunity / Agent / Task / Business Action
      ↓
Real Outcome
      ↓
Intent / Reputation / Ad Attribution / Feed Learning
```

最终目标：

> **用户觉得 Proxy 里既“有人、有人味、有传播”，又不会被最会拍照、最会营销的人劫持；Agent 能通过真实能力和相关性获得订单；Search 暴露高质量意图；用户始终能够自己决定“多看什么、少看什么、不看什么”；而 Server + Model Runtime 让这套体验持续演进，不依赖每次都发新版客户端或提前写死全部 UI。**

---

# 44. R15.3 UI Runtime Finalization — 本次新增冻结

本节显式补强并覆盖 R15.2 第 20–27 节中仍然不够明确的部分，重点回答四个问题：

```text
1. 模型到底可以生成什么 UI？
2. 这些 UI 在什么 Surface / 场景里使用？
3. 怎么保证模型生成质量，不让客户端出现垃圾页 / 越权页 / 不可用页？
4. 后端能不能接受、保存、复用这些 UI，而不是每次都重新生成？
```

最终原则继续冻结：

> **Model does not own pages. Model proposes bounded views. Server compiles and accepts them. Client renders only legal artifacts. Domain runtime owns truth.**

换句话说，产品允许模型做出“像页面一样完整”的 UI，但它在架构上仍然不是任意新 Route，也不是模型生成 React 页面。

---

# 45. UI 产品层重新定义

## 45.1 三层 UI

Proxy UI 分成三层：

```text
A. Stable Shell
   AppShell / RootNav / Search Host / Modal Host / Sheet Host

B. Stable Business Surfaces
   HOME / TASKS / FEED / ME
   SEARCH_WORKSPACE
   FULFILLMENT_WORKSPACE
   SKILL_WORKSPACE
   CONVERSATION
   AGENT_PROFILE
   MERCHANT_STOREFRONT
   ACTIVITY_DETAIL
   ORDER_EXECUTION
   OUTCOME

C. Generated Views / Blocks
   模型根据当前目标和数据，在稳定 Surface 内生成受限组合
```

A / B 由产品与客户端拥有。

C 可以由模型动态生成，但必须经过后端 UI Compiler。

## 45.2 “模型生成页面”正式语义

产品文案中可以说：

> 模型生成 UI 页面。

工程语义必须是：

```text
Generated Page-like Experience
=
GeneratedViewPlan
hosted by
Registered Stable Surface
```

即：

```text
模型可以生成一张完整视图
但不能生成一个任意 Route
```

例如：

```text
用户：帮我分析今天门店为什么转化差

SkillWorkspace
↓
模型生成：
经营摘要
关键指标
原因假设
异常列表
建议动作
执行按钮

用户体感：一张完整分析页
工程实际：SKILL_WORKSPACE 内的 GeneratedView
```

## 45.3 页面级 UI 不再等于 Route

允许 Workspace 内维护轻量 View Stack：

```text
Workspace
├─ View A
├─ View B
└─ View C
```

使用强类型动作：

```text
PUSH_GENERATED_VIEW
POP_GENERATED_VIEW
REPLACE_GENERATED_VIEW
```

但这些动作：

```text
不能跨越 Stable Surface Allowlist
不能创建任意 URI / Route
不能绕过 Navigation Budget
```

---

# 46. 模型可以生成什么 UI

R15.3 将模型 UI 输出冻结为六级能力。

## G0 — Deterministic UI

完全不调用模型。

用于：

```text
登录
权限失败
支付结果
订单关键状态
系统错误
安全确认
无网络 fallback
```

这些必须稳定、确定、可测试。

## G1 — UIPlan Composition

模型只选择已有 Business Component：

```text
BUSINESS_IDENTITY_HEADER
CAMPAIGN_FUNNEL
OPPORTUNITY_CARD
CANDIDATE_RAIL
OUTCOME_DELTA
THREAD_SUMMARY
SEARCH_RESULT_GROUP
```

模型决定：

```text
显示哪些
顺序
优先级
是否折叠
数据引用
允许动作
```

适合：

```text
Home
Search
Business Home
Agent discovery
Task workspace
```

## G2 — DynamicBlockPlan

模型使用 UI Primitive 生成新的信息块：

```text
STACK
ROW
GRID
SECTION
TEXT
RICH_TEXT
IMAGE
BADGE
CHIP
METRIC
METRIC_GROUP
PROGRESS
KEY_VALUE
INFO_LIST
TIMELINE
NOTICE
DIVIDER
ACTION_ROW
```

适合：

```text
AI 摘要
经营诊断
搜索解释
任务说明
结果复盘
个性化信息板
```

## G3 — FormPlan

模型可以根据 Domain Command Schema 生成表单。

例如：

```text
创建活动
创建需求
编辑公开服务
提交反馈
创建推广 Offer
```

模型只能从后端声明的字段契约生成：

```text
TEXT_INPUT
NUMBER_INPUT
SELECT
MULTI_SELECT
DATE
TIME
DATE_TIME
BOOLEAN
LOCATION_REF
ENTITY_REF
MEDIA_PICKER_REF
```

模型不能自己发明后端不存在的业务字段。

## G4 — Decision / Compare / Result View

模型可以生成完整决策型视图，例如：

```text
3 个 Agent 怎么选
哪个 Campaign 效果最好
本周经营问题优先处理什么
搜索结果怎么归纳
多个 Offer 怎么比较
```

允许：

```text
SUMMARY
COMPARE_MATRIX
PROS_CONS
METRIC_GROUP
RECOMMENDATION
EVIDENCE_LIST
ACTION_ROW
```

但所有事实字段必须来自 Read Model / Evidence Ref。

## G5 — Bounded Generated View Sequence

模型允许在同一 Workspace 内生成最多 N 步的小流程。

P0 建议：

```text
默认 max_generated_views = 3
默认 max_generated_interactions = 5
```

例如：

```text
创建门店活动
↓
确认目标 / 预算
↓
确认 Offer / Audience
↓
提交 Campaign Command
```

这在用户体验上是一条“小页面流程”，但工程上仍在一个 Stable Workspace 内。

## G6 — 禁止生成

模型永远不能生成：

```text
新的 Root Tab
新的 Native Route
登录 / 身份认证流程
账号恢复流程
支付最终确认页
银行卡 / 钱包能力
权限授予逻辑
法律协议原文
隐私同意逻辑
高风险财务审批页
任意 HTML / JS / JSX
任意 Native API 调用
未注册 WebView
```

高风险界面只能由产品注册 Component 承接。

---

# 47. 不同 Surface 允许模型生成到什么程度

## 47.1 HOME

允许：

```text
G1 + G2
```

但 Home 使用固定 Skeleton：

```text
Identity / Active Context
Universal Intent Composer
Dynamic Attention / Work Area
Recommended / Recent
```

其中：

```text
Universal Intent Composer
```

是不可删除、不可下沉、不可由模型替换的一等入口。

模型可调整 Composer 下方：

```text
摘要
机会 Rail
推荐人
经营摘要
当前任务
最近搜索
快捷动作
```

模型可根据 Active Context 改变：

```text
placeholder
suggestion chips
attachment capability visibility
recommended follow-up
```

但不能改变：

```text
Composer 存在性
主提交语义
附件隐私边界
Root / Context Switch
```

禁止把 Home 生成成完全不同的信息架构。

## 47.2 FEED

允许：

```text
G1
部分 G2
```

Feed Item 主体必须使用注册 Card。

模型可以生成：

```text
推荐理由
上下文摘要
Thread 摘要
Why this / Why now
轻量 Action Hint
```

模型不能随意重新发明 Feed Card 交互结构，避免 Feed 视觉漂移。

## 47.3 SEARCH_WORKSPACE

允许：

```text
G1 + G2 + G4
```

这是模型生成 UI 的高价值区域。

例如搜索：

```text
Cooler Master ODM PM
```

模型可根据真实结果动态组织：

```text
People
Jobs
Company Intelligence
Threads
2nd-degree Connections
Activities
Summary
```

不同 Query 可以长成不同视图，但都承载在 SEARCH_WORKSPACE。

## 47.4 FULFILLMENT_WORKSPACE

允许：

```text
G1 + G2 + G3 + G4 + G5
```

这是 Requester / Task 场景的主要 Generated View Host。

## 47.5 SKILL_WORKSPACE

允许：

```text
G1–G5 全部
```

这是模型生成“完整工作页”的最主要 Host。

例如：

```text
企业运营诊断
Campaign 创建
经营复盘
结构化计划
Agent 工作台
复杂表单
```

## 47.6 BUSINESS_HOME

允许：

```text
G1 + G2
```

Business Home 是稳定控制台，模型可以改变内容组合，但不能把企业入口结构完全自由生成。

## 47.7 AGENT_PROFILE / MERCHANT_STOREFRONT

外壳固定。

模型可生成：

```text
Why Match
能力摘要
历史结果摘要
相关内容组合
推荐理由
```

但：

```text
身份
价格真相
资质
评价真相
营业状态
```

必须来自后端 Read Model。

## 47.8 ORDER_EXECUTION / Payment / Permission

只允许：

```text
G0 + Registered Components
```

模型最多生成解释性 Summary，不控制关键行为结构。

---

# 48. GeneratedViewPlan Contract

新增正式对象：

```text
GeneratedViewPlan
```

示例：

```json
{
  "view_id": "gv_biz_diag_83",
  "schema_version": "1.0",
  "surface": "SKILL_WORKSPACE",
  "view_archetype": "BUSINESS_DIAGNOSTIC",
  "purpose": "explain_and_act",
  "title": "今天门店转化为什么下降",
  "layout_density": "COMPACT",
  "root": {
    "type": "STACK",
    "children": [
      {
        "type": "METRIC_GROUP",
        "items": [
          {"label": "到店", "value_ref": "campaign:cmp_17.visits"},
          {"label": "核销", "value_ref": "campaign:cmp_17.redemptions"}
        ]
      },
      {
        "type": "NOTICE",
        "semantic_role": "INSIGHT",
        "text_ref": "model_text:insight_1"
      },
      {
        "component_id": "CAMPAIGN_FUNNEL",
        "data_ref": "campaign:cmp_17"
      }
    ]
  },
  "actions": [
    {
      "action_id": "CREATE_OPTIMIZATION_DRAFT",
      "type": "SUBMIT_DOMAIN_COMMAND_PROPOSAL",
      "command_schema_ref": "campaign.optimize.v1"
    }
  ],
  "provenance": {
    "model_run_id": "mr_9021",
    "prompt_contract_version": "ui_gen_12",
    "registry_version": "ui_registry_20260819"
  },
  "reuse": {
    "reuse_class": "EPHEMERAL",
    "recipe_candidate": true
  }
}
```

冻结：

```text
value_ref      → 数据真相
text_ref       → 模型文字 / server copy
component_id   → 注册组件
primitive type → 注册 Primitive
action         → Action Registry
```

模型不能把这几种概念混在一起。

---

# 49. UI 视觉系统也必须 Server-Driven，但不能让模型自由设计

模型可以决定：

```text
信息层级
布局结构
内容顺序
密度
强调关系
```

模型不能决定：

```text
任意 hex color
任意 font
任意 font size
任意 border radius
任意 animation
任意 shadow
任意 absolute positioning
```

所有视觉参数必须来自 Design Token Registry。

例如：

```text
semantic_role:
PRIMARY
SECONDARY
MUTED
POSITIVE
WARNING
DANGER
INFO

layout_density:
COMPACT
STANDARD
SPACIOUS

spacing:
XS / S / M / L / XL

text_role:
DISPLAY
TITLE
SECTION
BODY
META
CAPTION

surface_role:
PLAIN
SUBTLE
ELEVATED
```

Server 可以更新：

```text
DesignTokenManifest revision
Component style variant
Feed density
Business Home density
Search group spacing
```

但 Client 仍只渲染自己支持的 Token。

---

# 50. 模型 UI 不直接发送到 Client：必须先经过 Server UI Compiler

正式链路：

```text
User Goal / Domain Context
        ↓
Unified Model Runtime
        ↓
UI Draft
        ↓
Server UI Compiler
        ↓
UI Policy Engine
        ↓
DataRef / Action Binding
        ↓
Quality Gates
        ↓
Compiled UI Artifact
        ↓
Experience API
        ↓
Client UI Orchestrator
        ↓
Render
```

禁止：

```text
Model → Client direct render
```

这是 R15.3 新的强约束。

原因：

```text
后端才能做统一版本治理
后端才能做权限与数据绑定
后端才能做缓存 / 复用
后端才能做灰度 / 回滚
后端才能留下审计记录
```

---

# 51. Server UI Compiler

建议逻辑模块：

```text
UIContractRegistry
UICompiler
UIQualityGate
UIArtifactStore
UIRecipeRegistry
UIExperimentRuntime
UIObservability
```

P0 不要求拆微服务。

## 51.1 Compiler Input

```text
Model UI Draft
ClientCapabilityBucket
ActiveContext
UserPermissionSnapshot
SurfacePolicy
ReadModelCatalog
ActionRegistry
DesignTokenManifest
```

## 51.2 Compiler Output

```text
CompiledUIArtifact
RejectedUIArtifact
FallbackUIArtifact
```

## 51.3 Compiler 不允许“修业务真相”

Compiler 只允许：

```text
删除非法节点
替换 fallback component
调整安全顺序
标准化 token
绑定合法 data_ref
裁剪 unsupported primitive
```

不能：

```text
自己猜数字
修改订单
修改任务
替用户下单
自动提升权限
```

---

# 52. 模型生成质量控制：必须是确定性 Gate + 统计质量，不靠“第二个模型觉得好看”

R15.3 冻结：

> **LLM Judge 可以做辅助评估，但不能成为唯一 Production Gate。**

## 52.1 Gate Q1 — Schema Quality

检查：

```text
JSON Schema
required fields
unknown fields
node type
primitive props
action args
```

失败：直接 Reject / Fallback。

## 52.2 Gate Q2 — Capability Quality

```text
客户端是否支持该 Component
客户端是否支持该 Primitive
客户端版本是否满足
Surface 是否允许
```

不支持：

```text
降级到兼容 Variant
或 fallback
```

## 52.3 Gate Q3 — Truth / Provenance Quality

任何事实型内容必须分类：

```text
DATA_BOUND
MODEL_SUMMARY
MODEL_INFERENCE
STATIC_COPY
```

必须做到：

```text
金额 / 数量 / 状态 / 权限 / 时间
→ DATA_BOUND
```

模型推断不得伪装成 DATA_BOUND。

## 52.4 Gate Q4 — Action Safety

每个 Action 验证：

```text
Action Registry
Permission
Domain command schema
Idempotency
Material action confirmation
Risk level
```

模型提出 ActionProposal，不代表 Action 已执行。

## 52.5 Gate Q5 — Layout Budget

P0 建议硬限制：

```text
max_tree_depth            = 6
max_nodes_per_view        = 60
max_primary_cta           = 1
max_visible_actions       = 8
max_form_fields           = 12
max_compare_columns       = 4
max_media_items           = 6
max_generated_view_stack  = 3
```

具体参数 Server 版本化，不写死在 App。

## 52.6 Gate Q6 — Interaction Quality

确定性规则：

```text
不能没有返回路径
不能出现死 CTA
不能两个 Primary CTA 冲突
不能要求用户重复输入 Server 已知值
不能把确认按钮放在高风险信息之前
不能出现不可恢复的隐藏操作
```

## 52.7 Gate Q7 — Visual Consistency

```text
只允许 Token
只允许注册布局
禁止任意绝对定位
禁止任意颜色
禁止超出组件密度预算
```

## 52.8 Gate Q8 — Accessibility / Localization

检查：

```text
文本可访问标签
图标有语义
触摸目标可用
文案语言一致
数值 / 币种 / 日期 Locale 正确
```

## 52.9 Gate Q9 — Goal Faithfulness

验证 Generated View 的 Purpose 是否仍然服务当前 Goal。

例如用户问：

```text
“帮我看今天活动为什么失败”
```

模型不能生成：

```text
“创建新活动”占据整页
```

Goal Faithfulness 可由：

```text
规则 + semantic classifier + optional model evaluator
```

共同判断。

## 52.10 Gate Q10 — Backend Resolvability

必须验证：

```text
所有 data_ref 可解析
所有 entity_ref 存在或可 lazy hydrate
所有 command_schema_ref 存在
所有 action args 可解析
```

Backend 无法接受的 UI，不允许 Client 先显示再报错。

---

# 53. UI Quality Score 不替代硬 Gate

硬 Gate 通过后，可计算：

```text
UIQualityScore
```

建议维度：

```text
GoalFit
InformationDensity
ActionClarity
VisualConsistency
DataGrounding
InteractionCompleteness
Accessibility
ExpectedTaskEfficiency
```

用于：

```text
A/B
模型版本比较
Recipe Promotion
异常监控
```

不能用于绕过：

```text
权限
安全
数据真实性
兼容性
```

---

# 54. Backend 能不能接受模型 UI？答案：能，但接受的是 Compiled Artifact，不接受原始模型输出

新增对象：

```text
UIArtifact
```

生命周期：

```text
MODEL_DRAFT
↓
SCHEMA_VALID
↓
POLICY_VALID
↓
COMPILED
↓
RUNTIME_ELIGIBLE
↓
SERVED
```

如果需要复用：

```text
RUNTIME_ELIGIBLE
↓
REUSE_CANDIDATE
↓
CANARY
↓
PROMOTED_RECIPE
```

失败：

```text
REJECTED
```

后端永远保存：

```text
artifact_id
model_run_id
source_goal
surface
context
schema_version
registry_version
client_capability_bucket
compiled_spec_hash
quality_receipt
policy_receipt
created_at
expires_at
reuse_class
```

---

# 55. 三种 UI Artifact：一次性、缓存、长期复用必须分开

## 55.1 EPHEMERAL

针对一个用户 / 一次会话生成。

例如：

```text
“总结我今天门店经营异常”
```

TTL 短。

不进入长期 Recipe。

## 55.2 CACHEABLE

同一类输入可以短期复用结构。

例如：

```text
Search Result Summary
Business Daily Summary
Task Compare View
```

结构可缓存，数据重新 Hydrate。

## 55.3 REUSABLE_RECIPE

成熟模式进入 Recipe Registry。

例如：

```text
BUSINESS_DAILY_DIAGNOSTIC
AGENT_COMPARE
SEARCH_COMPANY_ROLE
CAMPAIGN_POST_MORTEM
ACTIVITY_CREATE
```

Recipe 不是一张保存死数据的页面，而是：

```text
结构 + 参数槽 + data_ref contract + action contract
```

---

# 56. UIRecipe Contract

示例：

```json
{
  "recipe_id": "recipe_business_daily_diag_v3",
  "view_archetype": "BUSINESS_DIAGNOSTIC",
  "supported_surfaces": ["SKILL_WORKSPACE"],
  "supported_contexts": ["BUSINESS"],
  "input_contract": {
    "required": ["business_summary_ref", "exception_list_ref"]
  },
  "layout_template": {
    "type": "STACK",
    "slots": [
      "summary",
      "metrics",
      "exceptions",
      "recommendation",
      "actions"
    ]
  },
  "allowed_components": [
    "BUSINESS_METRIC_GROUP",
    "EXCEPTION_LIST",
    "ACTION_PROPOSAL"
  ],
  "allowed_actions": [
    "OPEN_EXCEPTION",
    "CREATE_OPTIMIZATION_DRAFT"
  ]
}
```

模型下一次面对相似 Goal 时优先：

```text
Recipe Retrieval
↓
Recipe Adaptation
↓
Compiler
```

而不是每次从空白生成。

---

# 57. 复用策略：模型先检索 Recipe，再决定生成

正式链路：

```text
Goal
↓
View Archetype Classification
↓
UI Recipe Retrieval
↓
┌─────────────────────────┐
│ 有高质量 Recipe         │
│ → 参数化 Adapt          │
└─────────────────────────┘
            or
┌─────────────────────────┐
│ 没有合适 Recipe         │
│ → Model Generate Draft  │
└─────────────────────────┘
↓
Compiler
↓
Artifact
```

这样可以同时得到：

```text
一致性
生成能力
性能
成本控制
可回滚
```

而不是每次随机重新“画一张页面”。

---

# 58. Recipe 什么时候可以从模型输出升级为长期复用

禁止：

```text
模型生成一次不错
→ 自动进入全量生产 Recipe
```

Promotion 至少需要：

```text
hard gates 全部通过
render success 达标
fallback rate 低
用户退出率正常
dead action = 0
重复使用次数达到阈值
多个输入 fixture 通过
多客户端 capability bucket 通过
无 privacy / permission incident
```

高价值 / 高风险 Recipe 还需要产品人工批准。

例如：

```text
普通 Search Summary
→ 可自动 Canary Promotion

财务 / 权限 / 支付
→ 不允许模型 Recipe Promotion
```

---

# 59. Backend Reuse 不等于保存客户端截图

后端保存：

```text
Declarative UI Artifact
UI Recipe
Quality Receipt
Policy Receipt
```

不保存为：

```text
PNG 页面
HTML 字符串
React Component 源码
```

客户端按自己的 Component / Primitive Registry 渲染。

因此同一个 Recipe 可用于：

```text
iOS
Android
Web
未来桌面端
```

前提是对应客户端声明支持。

---

# 60. Capability Bucket：后端必须知道“这个客户端吃不吃得下”

不能只看 app_version。

Server 将客户端归到 Capability Bucket：

```text
bucket_native_r15_basic
bucket_native_r15_dynamic_form
bucket_native_r15_generated_view_v2
bucket_web_r15_generated_view_v2
```

Artifact 编译时明确 target：

```text
target_capability_bucket
```

同一 Goal 可以编译多个 Variant：

```text
V2 客户端
→ Compare Matrix + Timeline + Dynamic Form

旧客户端
→ Info List + Registered Form Component
```

这比简单的 `minimum_app_version` 更可靠。

---

# 61. Generated UI 的数据绑定规则

UI 不能携带业务真相副本。

正式分三类：

```text
Reference Binding
Derived Presentation
Model Narrative
```

## Reference Binding

```text
value_ref
data_ref
entity_ref
```

来自 Read Model。

## Derived Presentation

例如：

```text
百分比显示
排序显示
格式化时间
本地化币种
```

必须来自注册 Formatter / Derived Read Model。

## Model Narrative

例如：

```text
“今天下午的转化下降主要集中在 14:00–16:00。”
```

必须带：

```text
source_refs[]
inference = true
```

如果没有证据引用，不允许表现成事实。

---

# 62. ActionProposal 与真正 Domain Command 分离

模型 UI 中所有高价值按钮先生成：

```text
ActionProposal
```

例如：

```text
“创建一个下午低峰活动”
```

点击后：

```text
Client
↓
Action Intent
↓
Server Action Resolver
↓
Permission Recheck
↓
Command Schema Validate
↓
需要确认？
↓
Domain Command
↓
Server ACK
```

模型永远不能把：

```text
“建议做”
```

直接变成：

```text
“已经做了”
```

---

# 63. Event-driven UI Patch

已有 UI Artifact 可以随着 Domain Event 更新，而不重新生成整个页面。

例如：

```text
ORDER_CONFIRMED
→ PATCH component data_ref

CAMPAIGN_RESULT_UPDATED
→ PATCH metric group

AGENT_ACCEPTED
→ replace waiting block
```

Patch 类型必须强类型：

```text
ADD_NODE
REMOVE_NODE
REPLACE_NODE
PATCH_BINDING
PATCH_TEXT_REF
PATCH_ACTION_STATE
```

禁止：

```text
执行任意 JSON Patch 到任意字段
```

客户端每个 Patch 仍重新验证 Registry / Permission。

---

# 64. UI Quality Telemetry

必须新增：

```text
artifact_id
recipe_id optional
view_archetype
render_success
render_latency
fallback_used
unsupported_node_count
layout_overflow
first_meaningful_action
back_without_action
view_abandonment
form_abandonment
regenerate_requested
user_explicit_negative_feedback
command_submit_rate
command_success_rate
```

模型生成 UI 的质量不能只看：

```text
“好不好看”
```

而要看：

```text
有没有帮助用户更快完成真实目标
```

---

# 65. Generated UI Online Quality Loop

```text
Artifact Served
↓
Render / Interaction / Outcome Telemetry
↓
UI Quality Dataset
↓
Recipe Evaluation
↓
Prompt / Policy / Recipe Upgrade
```

冻结：

> **模型不能根据线上数据直接自修改生产 UI Policy。**

所有升级必须产生：

```text
new prompt contract version
new recipe version
new policy version
new experiment receipt
```

---

# 66. Canary / Rollback

所有新 Recipe / UI Policy：

```text
Internal Fixture
↓
Dogfood
↓
1% Canary
↓
5%
↓
25%
↓
100%
```

出现：

```text
render failure
permission reject spike
fallback spike
user back-out spike
command error spike
```

自动停止扩量。

Server 可瞬间回滚：

```text
ExperienceManifest revision
UIRecipe revision
UI Policy revision
```

客户端回到 Last Known Good。

---

# 67. UI 与 Feed / Search / Agent 算法同步后的实际页面体验

## 67.1 Feed

视觉继续对齐 X 的高信息密度：

```text
Author / Identity
Text
Media optional
Context
Reason optional
Reply / Quote / Repost / Bookmark / Share
Light Context Action when relevant
··· Preference Controls
```

Feed Card 主体是注册组件，模型不自由生成 Card 框架。

普通动态禁止默认出现：

```text
[聊一下] [形成需求]
```

这种高压双主 CTA。

Agent / Business Context 应使用轻量入口，例如：

```text
Linh · 城市同行 / 摄影
周六可用
                     了解一下 ›
```

后续再进入：

```text
Profile / Service
→ Conversation
→ Explicit Intent
→ Need Draft
→ User Confirm
```

模型主要参与：

```text
recommendation reason
thread summary
contextual explanation
intent bridge
light action suggestion
```

是否真正创建 Need / Task 必须由后端 Intent / Domain Runtime + 用户确认决定。

用户 `···` 明确控制：

```text
不感兴趣
减少此类
减少话题
少看这个人
屏蔽
暂停 7 / 30 天
举报
```

这些 UI 应由服务器下发 Action Policy + 注册 Bottom Sheet 渲染，不让模型临时发明。

## 67.2 Search

Search Workspace UI 高度动态。

模型可以根据 Query 生成：

```text
People Group
Job Group
Opportunity Group
Intelligence Group
Relationship Paths
Activity Group
Summary / Compare
```

Search 是最适合 Generated View 的核心场景之一。

## 67.3 Agent

Agent Profile Shell 固定。

动态区域：

```text
Why this Agent
Matched Capability
Relevant Outcome
Available Slot
Mutual Context
```

内容热度不进入 Qualification Truth。

## 67.4 Business OS

8 个入口继续固定为企业能力入口。

进入内部功能后优先采用：

```text
SKILL_WORKSPACE
+ UI Recipe
+ Generated View
```

避免每一个企业运营场景继续写新 Page。

例如：

```text
活动复盘
→ CAMPAIGN_POST_MORTEM Recipe

今日经营诊断
→ BUSINESS_DAILY_DIAGNOSTIC Recipe

创建活动
→ ACTIVITY_CREATE FormPlan
```

---

# 68. 后端 Suggested Logical Architecture — R15.3

```text
                        ┌─────────────────────────┐
                        │ Canonical Domain Truth  │
                        └────────────┬────────────┘
                                     │
                              Read Model Layer
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
      Search                       Feed                      Business/Task
        │                            │                            │
        └────────────────────────────┼────────────────────────────┘
                                     ↓
                            Unified Context Pack
                                     ↓
                              Model Runtime
                                     ↓
                              UI Draft Plan
                                     ↓
        ┌─────────────────────────────────────────────────────┐
        │                  Server UI Runtime                  │
        │                                                     │
        │  UI Contract Registry                               │
        │  UI Recipe Retrieval                                │
        │  UI Compiler                                        │
        │  Permission / DataRef / Action Binding              │
        │  Quality Gate                                       │
        │  UI Artifact Store                                  │
        │  Experiment / Promotion / Rollback                  │
        └───────────────────────┬─────────────────────────────┘
                                ↓
                         Experience API
                                ↓
                         Client Orchestrator
                                ↓
            Stable Surface + Components + Primitives
```

P0 可以是模块化单体，但边界必须在 Contract 上独立。

---

# 69. 新增后端对象

建议增加：

```text
UIContractManifest
DesignTokenManifest
GeneratedViewPlan
FormPlan
ViewSequencePlan
CompiledUIArtifact
UIArtifactQualityReceipt
UIArtifactPolicyReceipt
UIRecipe
UIRecipeVersion
UIRecipePromotionReceipt
ClientCapabilityBucket
UIExperimentAssignment
UIPatchEvent
```

其中：

```text
GeneratedViewPlan
= 模型草案

CompiledUIArtifact
= 后端认可后可以真正服务给客户端的版本

UIRecipe
= 可以参数化复用的成熟结构
```

这三个对象禁止混用。

---

# 70. 新增 API / Command 语义

建议读取接口：

```text
GetExperienceManifest
GetUIArtifact
GetUIRecipeManifest
GetDesignTokenManifest
GetClientCapabilityPolicy
```

模型运行：

```text
GenerateUIArtifact
RegenerateUIArtifact
```

后台内部：

```text
CompileUIArtifact
EvaluateUIArtifact
PromoteUIRecipe
RollbackUIRecipe
```

客户端动作：

```text
OpenGeneratedView
ApplyGeneratedViewPatch
SubmitUIActionIntent
```

注意：

```text
PromoteUIRecipe
RollbackUIRecipe
```

不是普通用户客户端可调用命令。

---

# 71. R15.3 UI Acceptance Gates

新增以下 Gate：

## Gate UI-A — No Direct Model Render

```text
Model output 必须先经过 Server UI Compiler。
```

## Gate UI-B — Page-like Without New Route

模型可以生成完整 Page-like View，但只能承载于注册 Stable Surface / Workspace。

## Gate UI-C — Truth Binding

金额 / 状态 /数量 / 权限 /时间等事实全部来自 data_ref。

## Gate UI-D — Quality Hard Gates

至少：

```text
Schema
Capability
Permission
DataRef
Action
Layout
Accessibility
Goal Fit
```

通过后才能 Serve。

## Gate UI-E — Backend Acceptance

客户端只能消费：

```text
CompiledUIArtifact
```

不能消费：

```text
Raw Model Draft
```

## Gate UI-F — Reuse

相似场景优先 Recipe Retrieval，不默认重新生成。

## Gate UI-G — Recipe Promotion

Model Draft 不能自动成为全量长期模板。

## Gate UI-H — Capability Negotiation

旧客户端必须获得可渲染 Variant / Fallback。

## Gate UI-I — No Visual Free-for-all

模型只能使用 Design Token Registry，不允许任意视觉属性。

## Gate UI-J — High-risk Fixed UX

支付、权限、账户、安全、法律流程仍使用注册固定 UI。

## Gate UI-K — Rollback

任何 Server UI revision / Recipe 必须可即时回退 Last Known Good。

---

# 72. 开发顺序同步更新

R15.2 原 Phase 0–10 保留，但 UI 部分细化为：

```text
Phase 7A
ExperienceManifest vNext
ClientCapabilityManifest
Capability Bucket

Phase 7B
Design Token Registry
Component / Primitive Registry versioning

Phase 8A
GeneratedViewPlan / FormPlan Schema

Phase 8B
Server UI Compiler
Quality Hard Gates

Phase 8C
CompiledUIArtifact Store
Experience API

Phase 9A
Model UI Draft Generator

Phase 9B
Recipe Retrieval / Adaptation

Phase 9C
Search Generated View
Business Skill Generated View

Phase 10A
UI Patch Runtime

Phase 10B
Artifact Telemetry
Recipe Promotion / Canary / Rollback
```

第一个必须真正跑通的模型生成 UI Vertical Slice：

```text
Search Query
→ SearchResultReadModel
→ Model GeneratedViewPlan
→ Server UI Compiler
→ CompiledUIArtifact
→ SEARCH_WORKSPACE
→ User Action
→ Telemetry
```

第二条：

```text
Business Daily Diagnostic
→ Read Models
→ Recipe Retrieval / Model Adapt
→ Compiled Artifact
→ SKILL_WORKSPACE
→ Action Proposal
→ Domain Command
→ Outcome
```

只有这两条都真实工作后，才扩大 Generated UI 使用范围。

---

# 72A. R15.4 新增 Contract — Home Intent / Media Draft / Intent Routing

## 72A.1 HomeIntentEnvelope

Home 输入统一提交：

```text
HomeIntentEnvelope
- request_id
- actor_id
- active_context
- text optional
- attachment_refs[]
- entity_mentions[]
- location_ref optional
- source = HOME_COMPOSER
- client_capability_bucket
- created_at
```

不得把不同 Persona 拆成三套不兼容请求协议。

## 72A.2 IntentRoutingResult

后端 / Model Runtime 输出：

```text
intent_id
intent_class
confidence
destination_surface
task_archetype optional
search_query optional
required_context[]
missing_material_fact[]
suggested_ui_archetype
```

`destination_surface` 只能来自 Stable Surface Registry。

## 72A.3 IntentContextAttachment

```text
attachment_id
owner_id
media_type
storage_ref
purpose = INTENT_CONTEXT | POST_DRAFT | BUSINESS_SOURCE_ASSET
visibility
retention_policy
scan_status
created_at
```

同一张照片可在用户明确操作后从：

```text
INTENT_CONTEXT
```

重新引用到：

```text
POST_DRAFT
```

但不能后台静默把私有附件发布出去。

## 72A.4 PostDraft

发布动态先产生 Draft：

```text
draft_id
author_id
body
media_refs[]
media_order[]
location_ref optional
capability_ref optional
activity_ref optional
business_ref optional
visibility
created_at
updated_at
```

`PostDraft` 不是 `ContentPost`。

只有：

```text
PublishPost
→ Server ACK
```

后才产生正式公开 Post。

## 72A.5 FeedContextActionPlan

Feed 轻量业务动作使用：

```text
FeedContextActionPlan
- signal_type
- object_ref
- primary_light_action
- secondary_action optional
- allow_need_creation = false by default
- escalation_policy
```

只有已经存在强 Explicit Intent 时：

```text
allow_need_creation = true
```

且仍需要用户确认。

---

# 72B. R15.4 新增 UI / Product Acceptance Gates

## Gate HOME-A — Universal Intent Entry

REQUESTER / AGENT / BUSINESS Home 第一屏都必须存在 Universal Intent Composer。

## Gate HOME-B — No Menu-before-Intent

普通自然语言目标不能被强制要求先选择内部 Category / Scenario。

## Gate HOME-C — Intent Does Not Equal Chat

Home 输入可以路由 Search / Fulfillment / Skill / Conversation，不得一律进入聊天页。

## Gate HOME-D — Attachment Privacy

Home Composer 图片 / 文件默认只进入 Intent Context，不自动公开。

## Gate FEED-I — No Premature Task CTA

普通动态不得默认以“形成需求 / 创建订单”为一级主 CTA。

## Gate FEED-J — Progressive Opportunity

必须支持：

```text
Content
→ Profile / Chat
→ Explicit Intent
→ Need / Task
```

## Gate POST-A — Media Composer

发布动态必须支持真实照片选择 / 拍摄，并允许发布前预览和删除。

## Gate POST-B — User-owned Commercial Context

AI 不得自动把普通生活 Post 绑定 Agent Capability / Business Offer。

## Gate POST-C — Draft Before Publish

Media / Context 在发布前只属于 PostDraft。

## Gate POST-D — Registered Media Layout

Feed Media 只能使用 MediaLayoutRegistry 中受支持布局。

---

# 72C. R15.4 Observability

Home Intent：

```text
home_composer_impression
home_intent_submit
home_attachment_added
intent_route_surface
intent_route_success
intent_clarification_required
intent_to_real_action
```

Feed Progressive Conversion：

```text
feed_profile_open
feed_context_action_open
feed_to_conversation
conversation_to_need_draft
need_draft_confirmed
feed_direct_task_cta_exposure
```

其中目标是：

```text
feed_direct_task_cta_exposure
```

在普通内容 Signal 上接近 0。

Post Composer：

```text
post_draft_started
media_picker_open
media_added_count
media_removed
capability_context_selected
ai_suggestion_accepted
post_publish
draft_abandon
```

必须能区分：

```text
Human-selected Context
AI-suggested + Human-confirmed Context
```

---

# 72D. R15.4 Vertical Slice

第三条必须跑通的体验链：

```text
Any Active Context Home
→ Universal Intent Composer
→ IntentRoutingResult
→ Search / Fulfillment / Skill / Conversation
→ Generated / Registered UI
→ User Action
→ Domain Outcome
```

第四条：

```text
Create Post
→ Select Photos / Camera
→ PostDraft
→ Optional Context Suggestion
→ Human Confirm
→ PublishPost
→ Feed Projection
→ Light Context Action
→ Profile / Conversation
→ Explicit Need
```

这两条验证后，Universal Intent 与 Social → Opportunity 才算真正落地。


---

# 73. R15.4 最终 UI / Interaction 冻结

```text
Stable Surface 不无限增加；
REQUESTER / AGENT / BUSINESS Home 第一屏统一保留 Universal Intent Composer；
自然语言 / 多模态 Intent 优先于菜单分类；
Home Input 不等于 Chat，按 Intent 路由到 Search / Fulfillment / Skill / Conversation；
Feed 内容先于交易，普通动态不默认暴露“形成需求”主 CTA；
Task / Need 采用 Profile / Chat → Explicit Intent → Confirm 的渐进式转化；
Post Composer 支持照片 / 拍摄 / 视频 / 可选 Context；
AI 可以建议服务关联，但必须由用户明确确认后才能绑定；
模型可以生成 Page-like View，但不是 Route；
模型优先复用 Recipe，不是每次从空白生成；
Raw Model UI 永远不直达客户端；
后端 UI Compiler 决定是否接受；
客户端最终决定是否能渲染；
Domain Runtime 永远决定业务真相；
Design Token Registry 决定视觉合法空间；
Compiled Artifact 可以缓存、灰度、回滚；
成熟 Artifact 可以升级为可参数化 UI Recipe；
支付 / 权限 / 安全等高风险 UI 永远固定；
Server 更新普通体验不需要重新发版；
需要新 Native Capability 时才需要客户端更新。
```

最终运行关系：

```text
                 Product / Server Policy
                         ↓
User Goal → Model Draft → Server UI Compiler
                         ↓
                    UI Artifact
                         ↓
          ┌──────────────┴──────────────┐
          ↓                             ↓
    Runtime Serve                  Recipe Learning
          ↓                             ↓
 Client Capability Gate         Canary / Promotion
          ↓                             ↓
 Stable Surface              Reusable UI Recipe
          ↓
     User Action
          ↓
   Domain Command
          ↓
      Outcome
```

最终判断：

> **Proxy 的前端不应该演化成“工程师把所有页面预先写完”，也不能演化成“LLM 想怎么画就怎么画”。正确中间态是：稳定 App Shell + Universal Intent Entry + Stable Surfaces + Registered Business Components + Generative UI Primitives + Server UI Compiler + Reusable UI Recipes。Home 让任何身份先直接表达目的；Feed 负责自然发现与信任，不强迫过早交易；明确 Intent 再进入真实 Need / Task。服务器持续更新体验，模型生成有用的页面级 UI，但生成结果必须被后端验证、绑定、缓存、复用、灰度和回滚。**

---

# 74. R15.6.4 Market / Activity / Geo Amendment

本章覆盖并优先于此前与 Market UI、Requester / Agent 市场视角、Activity 归属、地图展示冲突的旧描述。

本次新增冻结：

```text
需求方 / Business：
    找人 → Agent Supply Market
    活动 → Public Activity Market

Agent：
    接单 → Demand Order Market

三个核心模块：
    找人
    需求
    活动
均支持：
    LIST
    MAP
```

但三者的地图语义不同，不允许为了“统一组件”把真实业务对象混成同一种 Pin。

---

# 75. 双边市场正式改为非对称体验

## 75.1 数据可以统一，用户市场不能强行统一

底层继续共享：

```text
User
Capability
Availability
Demand
Response
Order
Outcome
Relationship
BusinessAuthority
```

但市场前台必须是非对称的：

```text
Demand Owner / Business                   Agent
        ↓                                  ↓
Agent Supply Market                 Demand Order Market
        ↓                                  ↓
看“谁能做 / 谁有空”                    看“有什么单 / 多少钱”
```

正式原则：

> **Demand Owner 逛供给；Agent 逛订单。**

不能为了技术架构统一，把两边都做成同一张“Market Listing”页面。

## 75.2 Business 的市场身份

Business 在“找执行者”这件事上等同于一个带 `BusinessAuthority` 的 Demand Owner：

```text
Business
→ Agent Supply Market
```

但以下 Business OS 保持原结构：

```text
线上店铺
企业运营助手
活动与门店导流
成员与权限
合作执行网络
结果与复盘
支出与账单
企业 / 店铺资料
```

因此：

> **Business OS ≠ Market。Business 只在需要真人执行时进入 Agent Supply Market。**

---

# 76. Agent Supply Market — 需求方看的“人”

## 76.1 核心库存

Agent Supply Market 的库存是：

```text
Agent Capability
+
Availability
+
Service Area
+
Outcome / Reliability
+
Contextual Ranking
```

不是价格表。

## 76.2 不挂固定价格

正式冻结：

```text
Agent Profile
≠ Permanent Price List
```

Agent 的本次报价属于：

```text
Agent
× Concrete Demand
× Date / Time
× Duration
× Location
× Scope
× Complexity
× Supply / Demand Context
→ Quote
```

因此 Supply Market Card 默认只展示：

```text
Identity
Capability / Theme
Language
Service Area
Current / Future Availability
Reliability
Completed Outcome
Repeat
Response Behavior
Contextual Rank / Reason
```

不展示永久：

```text
800k
1.2M / day
fixed hourly price
```

除非某一服务产品本身确实是确定性 SKU，且 Domain 明确定义其固定价格。

## 76.3 Topic-based Supply

供给按主题挂载，例如：

```text
商务谈判
商务接待
口译
活动执行
摄影
城市同行
门店体验
临时补位
...
```

同一个 Agent 可以挂多个 Topic。

Topic 不等于永久职业标签，只表示当前可匹配 Capability。

## 76.4 Ranking 暂不锁定单一公式

R15.6.4 不冻结全站永久 Agent Score。

允许：

```text
综合靠前
商务主题靠前
近期可用
履约表现强
语言能力相关
新供给探索
```

Ranking 必须 Context-bound。

例如：

```text
商务谈判 Ranking
≠ 摄影 Ranking
≠ 代驾 Ranking
```

长期候选维度包括：

```text
Capability Fit
Availability
Reliability
Outcome
Repeat
Response
Relationship
Distance / Service Area
Freshness
Exploration
Safety
Theme-specific Evidence
```

但具体公式后续单独冻结。

---

# 77. Demand Order Market — Agent 看的“单”

## 77.1 核心库存

Agent 的市场货架是大量真实 Demand / Order Opportunity。

每张 Listing 至少表达：

```text
Theme
Title
Date
Time
Location / Service Area
Reward / Budget
Demand Owner
Verification
Hard Requirements
Current Response State
Agent Match Context
Published At
```

## 77.2 价格在 Demand Market 中是重要字段

和 Agent Supply Market 相反：

> **Agent 看单时，价格 / 预算必须明显。**

Agent 的主要决策包括：

```text
我会不会做
时间是否合适
地点是否合适
多少钱
客户是否可信
竞争情况
投入是否值得
```

因此需求市场可以支持：

```text
推荐
最新
高价
附近
日期
主题
客户
技能
```

## 77.3 Agent Response

Agent 对具体 Demand 可以提交：

```text
Response
- quote
- scope
- availability confirmation
- note
- evidence refs optional
```

本次 Quote 只属于该 Demand。

不得反向把它写成 Agent 的长期固定价格。

---

# 78. Public Activity Network

## 78.1 Activity 是公共现实对象

Activity 不属于 Requester、Agent、Business 中任何一个身份。

可发起人：

```text
Person
Agent
Business
Platform
```

统一产生：

```text
Activity
```

不拆成：

```text
UserActivity
AgentActivity
MerchantActivity
PlatformActivity
```

除非权限 / 资金 / 审计上确实需要不同 Policy。

## 78.2 Activity 前台

需求方 / Business 的市场入口支持：

```text
找人 | 活动
```

Activity 列表至少展示：

```text
title
origin / initiator
time
area / venue
topic
joined / capacity
interest
public visibility
```

Agent 也可以通过：

```text
Home
Feed
Search
Activity links
```

创建或参加 Activity。

Agent 的第二核心入口仍优先保留 Demand Order Market，因为接单是高频经济行为。

---

# 79. 找人 / 需求 / 活动统一支持 LIST | MAP

## 79.1 产品规则

三个模块都支持：

```text
LIST
MAP
```

默认建议：

```text
LIST
```

地图是探索与区域理解工具，不替代高信息密度列表。

每个页面顶部保留轻量切换：

```text
[列表] [地图]
```

地图模式继续保留一行筛选，不增加第二、第三排控制器。

## 79.2 三种地图语义

### 找人地图

展示：

```text
Agent service area
coarse availability area
capability / topic
availability
ranking context
```

不展示：

```text
实时精确坐标
家庭住址
持续移动轨迹
```

地图回答：

> **这个区域有哪些当前可服务的人？**

### 需求地图

展示：

```text
Demand service area
task location context
date / time
theme
budget / reward
```

地图回答：

> **哪里现在有单？**

### 活动地图

展示：

```text
Activity area / public venue
time
topic
initiator type
participants / capacity
```

地图回答：

> **哪里正在发生什么？**

---

# 80. Geo Precision Policy

## 80.1 位置精度分级

正式对象：

```text
GeoPrecision
```

P0 支持：

```text
CITY
DISTRICT
AREA
VENUE
EXACT
```

推荐默认：

```text
Agent Supply:
    AREA / DISTRICT

Open Demand:
    AREA / VENUE depending policy

Public Activity:
    AREA / VENUE

Confirmed Order:
    VENUE / EXACT if execution requires

Private Residence / Sensitive Place:
    never public EXACT
```

## 80.2 UI 文案必须反映精度

例如：

```text
西湖附近
还剑湖附近
北宁 Yên Phong 工业区
Cầu Giấy 附近
```

不要在实际上只有 AREA 精度时画出一个看似精确的家庭门牌 Pin。

## 80.3 Exact Location 提升

详细地址可以在以下阶段按权限提升：

```text
Demand Confirmed
Order Confirmed
Activity Joined
Execution Check-in
Business-authorized Venue
```

具体提升条件由：

```text
GeoPolicy
+
Domain State
+
Permission
```

共同决定。

---

# 81. Geo 数据 Contract

新增：

```text
GeoDisplayRef
```

建议字段：

```text
geo_ref_id
entity_ref
entity_type
precision
country
city
district optional
area_label
venue_ref optional
lat_bucket optional
lng_bucket optional
exact_location_ref optional
visibility_policy
expires_at optional
```

注意：

```text
lat_bucket / lng_bucket
```

用于粗粒度展示，不要求客户端拿到真实高精度坐标。

新增：

```text
MapEntityProjection
```

```text
projection_id
entity_ref
entity_type = AGENT | DEMAND | ACTIVITY
geo_display_ref
title
subtitle
badge_refs[]
map_label
card_ref
action_policy_ref
```

新增：

```text
MapViewportPlan
```

```text
viewport_id
surface
entity_type
region_ref
zoom_policy
cluster_policy
result_count
projection_refs[]
selected_projection_ref optional
```

---

# 82. Map Component Runtime

## 82.1 地图是注册能力，不是模型自由生成

客户端提供注册组件：

```text
MAP_VIEW
MAP_PIN
MAP_CLUSTER
MAP_RESULT_CARD
MAP_BOTTOM_SHEET
LIST_MAP_SWITCH
```

模型不得：

```text
生成任意地图 JS
控制原生定位权限
获取未授权精确位置
绕过 GeoPolicy
创建未知 Pin Action
```

## 82.2 Server / Model 可以做什么

Server 可以：

```text
决定默认 viewport
下发 coarse Geo Projection
聚合 Pins
排序当前区域结果
切换不同 Map Card Variant
```

Model 可以辅助：

```text
解释为什么推荐这个区域 / 人 / 单 / 活动
生成区域摘要
选择已注册 Map Result Card 内容组合
建议用户缩小搜索区域
```

但：

> **Map Core Interaction 由注册 Runtime 决定。**

## 82.3 Server-driven 更新

地图行为策略可以 Server-driven：

```text
cluster threshold
default zoom policy
area label
pin density
map card variant
result cap
privacy precision
```

但客户端只执行支持的 `MapCapabilityManifest`。

---

# 83. Map Privacy / Safety

必须冻结：

```text
Agent Map ≠ Real-time People Tracking
```

禁止默认公开：

```text
Agent 实时 GPS
家庭地址
酒店房号
私人住宅精确 Pin
持续移动轨迹
未确认订单集合点
```

允许：

```text
service area
coarse availability area
public venue
business venue
confirmed-task location with permission
```

地图结果还必须继续执行：

```text
Block
Mute
Same-org Privacy
Reach Policy
Availability Policy
Safety Eligibility
```

地图不能成为绕过 Feed / Search 隐私 Gate 的旁路。

---

# 84. Map Interaction Budget

移动端地图模式目标：

```text
Header
Search
1 row filter
Map
Selected Result Card
Bottom Navigation
```

禁止：

```text
3 rows filters
永久 Legend 占大空间
大段产品解释
地图 + 完整长列表同时占满首屏
```

Pin 点击：

```text
Pin
→ Selected Result Card
→ Detail / Profile / Activity
```

地图拖动后：

```text
Map viewport change
→ optional "搜索此区域"
→ query / hydrate
```

P0 不要求：

```text
实时路线导航
Turn-by-turn
司机轨迹
高精度 POI 编辑
3D map
```

---

# 85. R15.6.4 Geo Acceptance Gates

## Gate GEO-A — Three Module Coverage

```text
Agent Supply Market
Demand Order Market
Public Activity Market
```

都必须支持 LIST / MAP。

## Gate GEO-B — Coarse by Default

Agent Supply 默认不得使用 EXACT。

## Gate GEO-C — No Tracking

地图不得提供未经明确业务授权的真人实时追踪。

## Gate GEO-D — Precision Truth

显示文案、Pin 和后端 precision 必须一致。

AREA 数据不能伪装成 EXACT。

## Gate GEO-E — Map Is Registered Runtime

Model / Server 不得下发可执行地图代码。

## Gate GEO-F — One-row Controls

地图 / 列表模式都只保留一行主筛选；高级筛选进入 Sheet。

## Gate GEO-G — Same Eligibility

地图和列表必须使用同一套：

```text
Eligibility
Permission
Privacy
Ranking Candidate Set
```

不得出现：

```text
列表里看不到
但地图里能看到
```

的隐私旁路。

## Gate GEO-H — Domain Separation

```text
Agent map pin
≠ Agent live GPS truth

Demand map pin
≠ Order exact location unless allowed

Activity map pin
≠ private attendee location
```

---

# 86. R15.6.4 Vertical Slice

必须分别跑通：

```text
Requester / Business
→ Agent Supply Market
→ MAP
→ coarse area pins
→ Agent Card
→ Profile / Conversation
→ explicit Demand
```

```text
Agent
→ Demand Order Market
→ MAP
→ task area pins + reward
→ Demand Detail
→ Response / Quote
→ Order
```

```text
Any eligible user
→ Public Activity
→ MAP
→ Activity Pin
→ Activity Detail
→ Join / Interested
```

三条都验证后，再考虑：

```text
heatmap
route awareness
travel-time ranking
map-sponsored placement
area-demand forecasting
```

---

# 87. R15.6.4 最终市场冻结

```text
Demand Owner 看 Agent；
Agent 看 Demand / Order；
Business 找人时等同 Demand Owner，但 Business OS 不合并进 Market；

Agent Supply Market 不挂永久固定价格；
Quote 只针对具体 Demand；
Demand Order Market 必须明确展示价格 / 预算；

Activity 是公共对象；
Person / Agent / Business / Platform 均可发起；

找人 / 需求 / 活动均支持 LIST / MAP；
地图默认粗粒度；
地图不做真人实时追踪；
精确位置按 Domain State + Permission 逐步提升；

市场页默认展示库存；
搜索 + 一排筛选后立即进入人 / 单 / 活动；
地图是 Registered Runtime，不由模型自由生成代码；
Map 与 List 使用同一 Eligibility / Privacy / Ranking Candidate Set。
```

---

# 88. R15.7 产品收敛：前台只保留 USER / BUSINESS

本章覆盖此前将 Requester / Agent / Business 作为三个前台身份的设计。

正式冻结：

```text
Frontstage Identity
├─ USER
└─ BUSINESS
```

不再把以下概念作为前台身份：

```text
Requester
Agent
Executor
Demand Owner
Activity Organizer
```

这些变成：

```text
行为
能力
权限
市场角色
Domain Object Ownership
```

例如同一个 USER 可以同时：

```text
找服务
发布订单
对订单应答 / 报价
开放自己的可用时间
发起活动
参加活动
发布动态
```

不需要切换“需求方 / 执行者”。

BUSINESS 仍然代表：

```text
Business Principal / Merchant / Enterprise Authority
```

用于店铺、成员权限、经营、账单、企业数据真源。

---

# 89. Root Navigation 最终收敛

正式 Root：

```text
Home
Market
Feed
Me
```

中文：

```text
首页
市场
动态
我的
```

`Tasks` 不再作为 Root 名称。

订单 / 服务 / 活动进入统一 Market。

---

# 90. Home 产品原则：操作路径必须极简

Home 的唯一职责：

```text
1. 让用户直接表达目标
2. 让用户继续当前最重要的事
3. 给 Market 一个清晰入口
```

Home 不承担：

```text
完整功能目录
产品架构说明
长篇 AI 能力解释
全部 Business OS 菜单
三排快捷入口
内部 Domain 名词教育
```

## 90.1 USER Home

固定结构：

```text
当前城市 / Identity
        ↓
Universal Intent Composer
        ↓
3 个快捷动作
服务 | 订单 | 活动
        ↓
Continue / Resume
最多 2 个重要事项
        ↓
Market Pulse
```

快捷动作不是新的业务系统，只是 Intent Shortcut：

```text
找服务
看订单
找活动
```

## 90.2 BUSINESS Home

固定结构：

```text
Business identity
        ↓
Universal Intent Composer
        ↓
3 个高频市场动作
找服务 | 发订单 | 发活动
        ↓
Priority Queue
最多 3 项
        ↓
Compact Business Shortcuts
运营助手 | 线上店铺 | 结果复盘
```

完整 Business OS 继续放在：

```text
Me / Business Workspace
```

不堆在 Home。

## 90.3 Home 文案预算

普通首屏：

```text
一个主标题
一个 Composer
最多 3 个快捷动作
最多 3 个状态卡
```

禁止同一屏出现多个大段解释文本。

---

# 91. Market 成为核心吸引力模块

正式定义：

> **Market 是 Proxy 最主要的现实供需与线下机会发现入口。**

Market 不按身份分裂。

统一三种核心库存：

```text
SERVICE
ORDER
ACTIVITY
```

前台 Tab：

```text
服务
订单
活动
```

任何 USER 都可以进入三者。

BUSINESS 也可以进入三者，但根据 Business Authority 获得额外发布 / 管理能力。

---

# 92. SERVICE — 服务供给市场

SERVICE 表示：

```text
User
+
Capability
+
Availability
+
Service Area
+
Outcome / Reliability
```

不需要存在 Agent 身份。

进入服务市场的条件是：

```text
用户声明能力
+
允许被发现
+
存在有效 Availability / Service State
+
满足 Safety / Eligibility
```

服务卡重点：

```text
姓名 / Profile
能力主题
语言
粗粒度区域
当前空闲
下一段可用时间
履约
完成次数
复购
Ranking Reason
```

不挂永久固定价格。

报价：

```text
Service Provider
× Concrete Order
× Time
× Duration
× Location
× Scope
→ Quote
```

---

# 93. ORDER — 订单市场

ORDER 是具体的现实需求对象。

订单卡必须高信息密度显示：

```text
主题
日期
时间
地点
报酬 / 预算
Owner
Owner Verification
要求
应答状态
发布时间
```

用户不需要成为“Agent”才能查看订单。

当用户满足：

```text
Capability
Availability
Eligibility
```

即可：

```text
应答
报价
沟通
```

---

# 94. ACTIVITY — 公共活动市场

Activity 继续保持公共对象：

```text
Initiator:
USER
BUSINESS
PLATFORM
```

“提供服务的人”仍然只是 USER，所以不再有 `AGENT_ACTIVITY` 概念。

Activity Card 优先视觉化展示：

```text
活动主题
时间
区域 / Venue
发起方
已参加 / Capacity
Interest
```

活动页允许更强视觉表达，避免 Market 全部像工作任务列表。

---

# 95. Market 必须“吸引人”的 UI 原则

Market 的价值不是靠长说明文字，而是靠：

```text
高质量库存
鲜明视觉层级
真实时间性
位置感
状态感
可探索性
```

P0 视觉要求：

```text
SERVICE
→ 真人 / Profile 感
→ Availability 高亮
→ Trust 紧凑展示

ORDER
→ Reward / Budget 强视觉锚点
→ Time / Location 一眼可扫
→ Verification 清晰

ACTIVITY
→ Hero Media / Visual Block
→ Time + Place + People
→ Origin 清晰
```

Market 首屏控制项限制：

```text
Title
3-way Tab
Search
List/Map icon switch
1 row filters
Inventory immediately
```

禁止：

```text
3 rows filters
大段市场解释
大面积无信息 Hero
首屏看不到第一张库存卡
```

---

# 96. Market 发布入口

Market 顶部保留一个统一 `+`：

```text
发布订单
发起活动
开放我的可用时间
```

这三个动作不需要身份切换。

其中：

```text
开放我的可用时间
```

会使符合资格的 USER 进入 SERVICE Supply Candidate Set。

---

# 97. 两身份权限模型

USER：

```text
browse service
browse order
browse activity
publish order
respond order if eligible
publish availability / service capability
create activity
join activity
post content
```

BUSINESS：

```text
USER market capabilities
+
business-owned order
business activity
business storefront
business members / permissions
billing
business outcome
business operating agent
```

Business 不是“更高级 User”，而是代表一个 Business Principal 执行业务动作。

---

# 98. Market + Map

三种 Market Object 继续支持：

```text
LIST
MAP
```

SERVICE：

```text
Map = service area / coarse availability area
```

ORDER：

```text
Map = task area / allowed venue precision
```

ACTIVITY：

```text
Map = public activity area / venue
```

继续冻结：

```text
SERVICE Map ≠ 真人实时 GPS
```

列表 / 地图只用图标 Switch，不用文字占空间。

---

# 99. R15.7 Home Acceptance Gates

## HOME-1
USER / BUSINESS Home 第一屏必须存在 Universal Intent Composer。

## HOME-2
Home 不允许要求用户先判断自己是“需求方还是执行者”。

## HOME-3
USER Home 快捷动作最多 3 个。

## HOME-4
BUSINESS Home 首屏 Priority Queue 最多 3 项。

## HOME-5
普通 Home 首屏不得出现大段系统架构解释。

## HOME-6
用户从 Home 到以下目标：

```text
找服务
看订单
找活动
发布订单
```

必须在 1 次 Intent Submit 或 1 次 Shortcut 后进入正确 Surface。

---

# 100. R15.7 Market Acceptance Gates

## MARKET-1 — One Market
任何 USER / BUSINESS 进入同一个 Market Root。

## MARKET-2 — Three Inventories
必须存在：

```text
SERVICE
ORDER
ACTIVITY
```

## MARKET-3 — No Agent Identity Requirement
USER 开放 Capability / Availability 后即可成为 SERVICE Supply，不要求创建第二人格。

## MARKET-4 — Inventory First
第一张有效库存卡应在 Search + 一排 Filter 后立即出现。

## MARKET-5 — Attractive but Dense
视觉增强不能降低核心信息可扫性。

## MARKET-6 — No Permanent Service Price
SERVICE 默认不挂永久固定价格。

## MARKET-7 — Order Reward Visible
ORDER 报酬 / 预算必须成为强视觉字段。

## MARKET-8 — Public Activity
USER / BUSINESS / PLATFORM 均可发起 Activity。

## MARKET-9 — Map Parity
SERVICE / ORDER / ACTIVITY 均支持 LIST / MAP，并与列表共享 Eligibility / Privacy。

---

# 101. R15.7 最终产品结构

```text
IDENTITY
├─ USER
└─ BUSINESS

ROOT
├─ HOME
├─ MARKET
├─ FEED
└─ ME

MARKET
├─ SERVICE
├─ ORDER
└─ ACTIVITY

CORE OBJECTS
├─ User
├─ BusinessPrincipal
├─ Capability
├─ Availability
├─ ServiceSupplyProjection
├─ Demand / Order
├─ Response / Quote
├─ Activity
├─ Conversation
├─ Payment / Settlement
└─ Outcome
```

最终原则：

> **弱身份，强场景。用户不用告诉 Proxy “我是什么角色”，只需要告诉 Proxy “我现在想做什么”。**

> **Home 负责把意图送到正确地方；Market 负责让真实的人、订单和活动足够有吸引力地被发现；Domain Runtime 负责把发现变成可靠的现实行动。**

---

# 102. R15.7.2 Home 三个按钮的语义正式修正

此前 Home 的：

```text
找服务
看订单
找活动
```

如果直接作为 Market Tab 跳转，会与 Root `市场` 产生重复导航语义。

R15.7.2 正式冻结：

> **Home 三个按钮不是导航按钮，而是 Semantic Intent Primers。**

它们只提供：

```text
SERVICE
ORDER
ACTIVITY
```

三个一级语义方向。

点击后：

```text
不切 Route
不直接进入 Market
不直接创建 Domain Object
```

而是更新本次 Home Composer 的：

```text
semantic_hint
```

例如：

```text
[找服务]
→ semantic_hint = SERVICE
→ Composer placeholder / suggestion 改变
→ 用户继续自然语言表达
```

---

# 103. Home Submit → Intent Runtime

真正 Submit 时：

```text
HomeIntentEnvelope
+
semantic_hint optional
+
free_text
+
Active Context
+
attachments
+
location context
        ↓
Intent Runtime
```

Semantic Hint 不是 Hard Route。

模型 / Intent Runtime 可以：

```text
采纳
修正
忽略
```

例如用户点了：

```text
找服务
```

但输入：

```text
“其实我想看看今天有什么摄影活动”
```

最终可以解析：

```text
ACTIVITY
```

而不能因为按钮被点击就强行进入 SERVICE Market。

---

# 104. Stable Intent Workspace

Home 提交后允许进入统一：

```text
INTENT_WORKSPACE
```

该 Surface 是稳定容器。

内部根据 Runtime Result 动态组织：

```text
conversation
clarification
search result
generated view
candidate compare
activity discovery
order discovery
domain draft
```

禁止为：

```text
SERVICE_HOME_RESULT_ROUTE
ORDER_HOME_RESULT_ROUTE
ACTIVITY_HOME_RESULT_ROUTE
```

各自复制三套 Page。

原则：

> **三个按钮定义模型对话主题，不定义页面。**

---

# 105. Home 与 Market 的职责继续分离

Home：

```text
Goal expression
Semantic priming
Runtime conversation
Resume
Attention
```

Market：

```text
主动 Browse
Search inventory
Filter
List / Map exploration
```

因此：

```text
Home “找服务”
≠ Market / Service Tab
```

前者表示：

```text
“我现在的对话主题偏向找服务”
```

后者表示：

```text
“我要直接浏览服务库存”
```

这可以避免重复入口和过度导航。

---

# 106. 订单列表价格展示修正

R15.7 曾将 ORDER Reward 设为列表强视觉字段。

R15.7.2 调整为：

> **价格 / 报酬仍然是 Order Domain Truth，但不要求在 Market List Card 上强曝光。**

默认列表优先扫描：

```text
任务主题
日期 / 时间
区域
关键要求
Owner Trust
发布时间
应答数
Match Context
```

价格：

```text
Order Detail
```

必须明确展示。

当产品实验发现价格对 Agent / User 决策效率有明显提升时，可由 Server-driven Variant 重新在 List 展示：

```text
SHOW_REWARD_IN_LIST
```

因此这是 Presentation Policy，不改变 Domain Truth。

---

# 107. Verification UI 简化

对于已验证商家 / 用户：

禁止反复出现：

```text
商家已验证
已验证商家
平台商家
企业已完成验证
```

默认 Market Card 只显示一个紧凑 Trust Badge：

```text
[shield/logo] 已验证
```

位置可占用此前价格视觉锚点。

详细 Verification：

```text
主体
验证类型
验证时间
认证范围
```

进入：

```text
Order Detail
Business Profile
Trust Detail
```

后再展示。

---

# 108. R15.7.2 Acceptance Gates

## HOME-S1 — Semantic, Not Navigation

Home 的三个主按钮不得直接调用：

```text
go("market")
setMarketTab(...)
```

## HOME-S2 — Hint Can Be Overridden

free text 与 semantic hint 冲突时，Runtime 必须允许重新分类。

## HOME-S3 — One Intent Surface

三个一级语义方向默认复用一个 Stable Intent Workspace。

## HOME-S4 — Market Independence

用户必须仍可从 Root Market 直接 Browse：

```text
Service
Order
Activity
```

不需要经过 Home Runtime。

## ORDER-P1 — Price Detail Truth

若 List 隐藏价格，Order Detail 必须展示真实 Reward / Budget。

## TRUST-V1 — Compact Verification

列表页已验证主体默认：

```text
icon + 已验证
```

不重复长文案。

---

# 109. R15.7.2 最终交互关系

```text
HOME
  ↓
Natural Language
+
Semantic Primer optional
  ↓
Intent Runtime
  ↓
INTENT_WORKSPACE
  ↓
Search / Conversation / Generated View / Domain Draft
```

与：

```text
MARKET
  ↓
Service | Order | Activity
  ↓
Direct Browse / Search / Filter / Map
```

并行存在。

最终原则：

> **Home 是“告诉 Proxy 我想做什么”；Market 是“我自己直接逛现实库存”。两者不能因为有相同主题词就做成重复跳转入口。**
---

# 110. R15.8 本次修订：为什么 Market 必须重新变厚

R15.7 已经把前台身份收敛为：

```text
USER
BUSINESS
```

但旧 Market 仍然保留明显的功能货架感：

```text
服务 | 订单 | 活动
```

这会产生三个问题：

1. `服务` 很容易退化成黄页 / 家政 / 58 同城式目录；
2. `订单` 如果和人物一样拆成大量榜单，会制造大量无法履约的跨地区噪音；
3. `活动` 本质是多人共同发生的公共对象，与“谁能做什么 / 什么需要被做”并不是同一种消费逻辑。

R15.8 正式冻结：

> **人物负责发现，机会负责履约，活动负责聚合。**

三个对象仍然同时存在于 Domain / Search / Graph 中，但前台 Market 不再把三者强行做成同一种货架。

---

# 111. Market 一级信息架构冻结

Root Navigation 继续保持：

```text
首页
市场
动态
我的
```

进入 `市场` 后只保留两个一级内容入口：

```text
[ 市场 ] [ 活动 ]
```

其中左侧 `市场` 是一个 **Mixed Discovery Dashboard**，同时承载：

```text
People Discovery
+
Fulfillment-Constrained Opportunity Inventory
```

右侧 `活动` 是：

```text
Public Activity Network
```

明确禁止恢复为：

```text
服务 | 订单 | 活动
```

三个平级 Tab。

---

# 112. Market Home：不是目录，而是“正在变化的真人市场”

Market Home 的目标不是解释平台，也不是先让用户选对象类型。

目标：

> **一打开就感觉市场是活的。**

R15.8 默认 Section 顺序：

```text
Search
↓
趋势人物          6 人横向
↓
现在有机会        3 个高相关本地机会
↓
新人              6 人横向
↓
现在有空          6 人横向
↓
热门主题
↓
人物市场 / 机会市场 深入入口
```

其中：

- 人物 Rail 可以跨区域产生发现价值；
- Opportunity Rail 必须先通过可履约约束；
- Opportunity 不允许为了“市场看起来很多”而塞入无现实执行价值的远距离现场需求。

Home Section 数量可以由 Server Composition 调整，但不得改变两条底层原则：

```text
People = Discovery-first
Opportunity = Fulfillment-first
```

---

# 113. 人物市场：不再使用“服务 / Agent”作为前台核心语言

前台正式对象名：

```text
人物
```

禁止把核心入口写成：

```text
Agent
执行者市场
服务目录
服务商
```

因为 USER 本身可以同时：

```text
找人
找机会
开放自己的可用时间
接单
发需求
参加活动
```

`Agent` 仅保留为内部兼容角色 / Capability Runtime 概念。

人物市场允许 6 个主要发现 Lens：

```text
趋势
新人
有空
附近
复购
主题
```

这 6 个 Lens 是 **发现上下文**，不是永久身份分类。

---

# 114. 人物榜单不是资格榜

人物市场可以借鉴“行情市场”的持续变化感，但不得退化成纯流量排行榜。

`Trend` 可以组合：

```text
Profile Open
Qualified Chat
Save / Follow
Real Demand Invite
Availability
Order Conversion
Outcome
Repeat
Freshness
Exploration
```

但必须继续遵守：

> **Popularity ≠ Qualification**

例如：

```text
Linh
河内趋势 #4
商务主题 #7
今天可用 #2
复购 #12
```

这些都是 Contextual Rank。

一旦进入具体任务：

```text
明天下午
商务谈判
中文
河内
```

必须重新经过：

```text
Eligibility
Safety
Availability
Time Feasibility
Capability
Outcome
Distance
Context Ranking
```

不能把“趋势人物”直接视为“最适合任务的人”。

---

# 115. 人物发现半径与机会履约半径必须非对称

正式冻结：

```text
Person Discovery Radius
= LARGE

Opportunity Fulfillment Radius
= SMALL
```

原因：

人物具有：

```text
猎奇
审美
关系
关注
收藏
未来合作
跨城认知
```

价值。

而现场机会如果无法履约：

```text
Exposure Value ≈ 0
```

例如：

```text
用户人在河内
岘港今晚 18:00 现场助理
```

默认不应该进入主 Opportunity Feed。

但：

```text
远程翻译
下周跨城任务
包含明确交通条件
未来预约
```

可以重新进入 Eligibility。

---

# 116. 机会市场：只保留四个一级 Lens

机会市场不做：

```text
热门榜
高价榜
急需榜
最新榜
爆单榜
```

作为一级栏目。

R15.8 只冻结四个主 Lens：

```text
现在
附近
预约
远程
```

## 116.1 现在

适合：

```text
即将开始
当天即时
临时补位
今日可执行
```

排序优先考虑：

```text
Time Feasibility
Arrival Feasibility
Capability
Reliability
Task Value
Freshness
```

## 116.2 附近

优先使用：

```text
Travel Time
```

而不是只按行政区。

可展示：

```text
15min
30min
45min
1h
```

## 116.3 预约

承载：

```text
明天
本周
周末
下周
未来明确时间
```

核心是让用户提前安排真实日程。

## 116.4 远程

不受现场通勤半径限制：

```text
翻译
会议助理
设计
资料整理
咨询
内容
线上支持
```

---

# 117. 高价 / 急需 / 热门 / 新发布：Signal，不是一级频道

这些信息仍然有价值，但应该作为：

```text
Badge
Ranking Signal
Sort Signal
Explanation Signal
```

例如：

```text
[急需]
[热门]
[新发布]
[高响应]
```

而不是继续增加 Market IA。

这样可以避免 Opportunity Market 变成 6–10 个重复列表。

---

# 118. Opportunity 前台语言与 Domain Truth

Market 前台：

```text
机会
```

底层 Truth 继续保持：

```text
Demand
Response
Quote
Order
Execution
Outcome
Settlement
```

原则：

```text
Demand 在 Market 中被发现
→ Opportunity
```

在满足具体市场机制后：

```text
Accept / Award / Commit
→ Order / Assignment
```

因此：

> **“机会”是发现语言，“订单”是成交后的履约语言。**

`我的订单`、`订单执行`、`结算` 等成交后页面继续保留“订单”。

---

# 119. Opportunity Card 信息密度冻结

机会卡不得恢复长句标题：

```text
商务谈判陪同 · 中英越沟通
品牌活动摄影 / 短视频
```

默认用短类别词：

```text
谈判
摄影
陪同
口译
助理
接待
执行
同行
巡店
```

卡片高密度信息通过：

```text
line icon
+
short keyword
+
time
+
location
+
travel time
+
trust badge
+
signal badge
```

完成语义压缩。

原则：

> **保留信息，不保留冗长文字。**

Category Icon 不使用笨重的圆角方块大 Logo 外框；图标应作为轻量 Semantic Mark 存在。

---

# 120. 接单：不再询问“你能不能履约”

R15.8 正式删除以下交互：

```text
我能履约
我不能履约

你是否确认能准时完成？
我承诺按时到达
```

原因：

> 守时不是口头声明，是 Market 默认行为规范。

系统负责在机会曝光 / 排序之前判断：

```text
Current Time
Start Time
Travel Time
Availability
Existing Commitments
Buffer
Location / Remote
Capability / Eligibility
```

人只负责决定：

```text
接
不接
```

---

# 121. 接单动作冻结：一个按钮

对于可以直接 Claim / Accept 的机会：

```text
[ 接单 ]
```

不得写：

```text
接下这个机会
我要接
确认接单并承诺履约
我可以履约
```

也不得再弹一层：

```text
Are you sure?
```

正式定义：

> **Accept = Time Commitment**

即：

```text
接单
↓
创建 Order / Assignment
↓
冻结 Time Commitment
↓
进入倒计时
```

如某个 Market Mechanism 是：

```text
Response / Quote Competition
```

则在 Award / Accepted Response 形成 Order 后，同样进入本 Time Commitment Runtime。

---

# 122. 时间是 Proxy 撮合信用的一级真相

Proxy 撮合长期优先级：

```text
1. Safety
2. Time
3. Match / Capability
4. Price / Other Optimization
```

不是因为 Match 不重要，而是：

```text
匹配 95% + 放鸽子
<
匹配 88% + 准时稳定完成
```

对于真人现实撮合，用户是否持续使用平台高度依赖：

```text
敢不敢用
+
会不会按时出现
```

因此 Profile / Ranking 必须正式拥有 Time Reliability。

---

# 123. Time Commitment Runtime

接单后自动进入：

```text
Accepted
↓
Countdown
↓
Near Appointment
↓
At Time
↓
Late / On Time
↓
Execution
↓
Outcome
```

正常路径不要求用户持续点击：

```text
我出发了
我正在路上
我保证准时
```

如果用户授权位置 / 日程能力，Runtime 可以自动推断：

```text
On the Way
ETA
Arrival
```

但这些自动状态必须受：

```text
Permission
Privacy
Geo Precision Policy
```

控制。

---

# 124. Countdown UX

接单成功以后，主状态直接展示：

```text
18:00 开始

00:42:18
距预约时间
```

临近：

```text
00:09:41
距预约时间
```

到点：

```text
00:00
```

超出：

```text
已超时
00:04:18
```

提醒时间由 Server Policy 配置，例如：

```text
T-30m
T-10m
T-0
```

不同 Category 可以有不同策略。

客户端不得把具体阈值写死为长期 Domain Rule。

---

# 125. 接单方超时：允许直接影响金额与 Reliability

用户已经点击：

```text
接单
```

即接受本单 Time Commitment。

如果接单方超时，可根据事先公布的本单规则触发：

```text
Late Warning
Settlement Deduction
Reliability Event
Ranking Decay
Eligibility Restriction
```

例如 Presentation 可显示：

```text
履约扣减
-80,000₫
```

但具体：

```text
Grace Period
Deduction %
Maximum Deduction
No-show Threshold
Eligibility Freeze
```

必须由：

```text
Market Policy
Category
Jurisdiction
Order Terms
```

配置。

模型不得自行生成处罚金额。

---

# 126. 为什么处罚主要单向约束接单方

R15.8 P0 不建立“完全对称”的客户迟到罚款体系。

主原因：

> **主动点击接单的一方承担主要履约时间责任。**

因此默认强约束：

```text
Provider / Executor
```

而客户侧先只提供：

```text
Protective Exit
Abuse Detection
```

不建立等价的罚款系统。

---

# 127. 客户迟到：30 分钟后解锁无责退出

如果接单方已经正常到达，但客户没有出现：

```text
预约 18:00
```

状态：

```text
18:00
客户尚未到达

18:15
继续等待

18:30
解锁：
[取消订单]
```

必须注意：

> **18:30 不是自动取消。**

它只是：

```text
NO-FAULT EXIT RIGHT
```

接单方可以：

```text
继续等
或
取消订单
```

取消后：

```text
Provider Cancellation = false
Reliability Penalty = none
On-time Penalty = none
Availability = restored
```

前台只需要告诉接单方：

```text
不影响履约记录
```

---

# 128. CUSTOMER_NO_SHOW 仍然必须记录事实

虽然 P0 不对客户做对称罚款，但后台必须保存：

```text
CUSTOMER_LATE
CUSTOMER_NO_SHOW
CUSTOMER_EXTREME_CANCEL
```

原因不是立即惩罚，而是防止：

```text
Repeated Abuse
Fake Demand
Harassment
System Gaming
```

如果某主体重复极端行为，可触发：

```text
Risk Review
Pre-authorization
Posting Restriction
Invitation Restriction
Visibility Warning
```

这是 Safety / Abuse Control，不是“客户迟到积分榜”。

---

# 129. 时间事件模型

建议最小事件：

```text
OPPORTUNITY_ACCEPTED
TIME_COMMITMENT_CREATED
REMINDER_SENT
ARRIVAL_PREDICTED
ARRIVED
START_TIME_REACHED
PROVIDER_LATE
PROVIDER_NO_SHOW
CUSTOMER_LATE
CUSTOMER_NO_SHOW
NO_FAULT_EXIT_UNLOCKED
NO_FAULT_EXIT_USED
EXECUTION_STARTED
EXECUTION_COMPLETED
SETTLEMENT_DEDUCTION_APPLIED
```

每个 Event 至少包含：

```text
event_id
order_id
principal_id
actor_id
occurred_at
source
policy_version
geo_evidence_ref?
calendar_evidence_ref?
server_receipt
```

禁止只依赖客户端本地时间形成处罚 Truth。

---

# 130. Time Reliability Read Model

人物 Profile 可逐步暴露：

```text
已验证
准时 98%
履约 42
复购 7
```

不建议优先展示：

```text
92.47 综合分
```

Time Reliability 可包含：

```text
on_time_rate
minor_late_rate
late_rate
no_show_count
median_arrival_delta
recent_time_reliability
```

具体任务 Ranking 不应只读一个永久总分，而应结合：

```text
Category
Time Horizon
Distance
Availability
Recent Outcomes
```

---

# 131. Safety + Time 双核心

R15.8 正式冻结：

> **安全决定敢不敢用，时间决定会不会再用。**

Safety 继续保持现有：

```text
Verification
Permission
Geo Precision
Contact Privacy
Payment Protection
Incident
Block / Report
Abuse Detection
```

Time 增加：

```text
Feasibility
Commitment
Countdown
Reminder
Arrival / ETA
Late Truth
No-show
Settlement Deduction
Reliability
Protective Exit
```

两者均不得由模型自由改写。

---

# 132. Server Policy Ownership

以下全部必须是 Server / Domain Policy：

```text
Opportunity eligibility radius
Travel-time threshold
Reminder timing
Late threshold
Deduction schedule
No-show threshold
30m customer no-show exit
Reliability update
Ranking consequences
Geo evidence requirements
```

客户端只负责：

```text
render
interaction
local countdown presentation
```

模型可以：

```text
解释
摘要
选择已注册组件
组织信息优先级
```

模型不得：

```text
决定谁被罚多少钱
绕过 eligibility
伪造 arrival
把客户 no-show 改成 provider fault
```

---

# 133. R15.8 Market Presentation Freeze

Market Home：

```text
趋势人物      → 6
现在有机会    → 3
新人          → 6
现在有空      → 6
热门主题
```

People Market：

```text
趋势 | 新人 | 有空 | 附近 | 复购 | 主题
```

Opportunity Market：

```text
现在 | 附近 | 预约 | 远程
```

Activity：

```text
热门 | 附近 | 本周 | 新活动
```

这三个层次不再使用统一 Tab 数量强行对齐。

---

# 134. R15.8 Acceptance Gates

## MARKET-IA1 — Two Primary Domains

Market Root 只显示：

```text
市场
活动
```

不得恢复：

```text
服务
订单
活动
```

## MARKET-P1 — People, Not Agent

前台人物发现页禁止要求用户理解：

```text
Agent
Provider
Executor Identity
```

## MARKET-P2 — Six People Lenses

人物市场允许：

```text
趋势
新人
有空
附近
复购
主题
```

## MARKET-O1 — Four Opportunity Lenses

机会市场一级只允许：

```text
现在
附近
预约
远程
```

## MARKET-O2 — Fulfillment First

现场机会进入主列表前必须完成：

```text
time + location + availability + eligibility
```

约束。

## MARKET-O3 — Badges Are Not Tabs

```text
高价
热门
急需
新发布
```

不得升级成默认一级频道。

## TIME-1 — One Accept Action

直接接单场景只有：

```text
接单
```

不得追加履约宣誓。

## TIME-2 — Accept Equals Commitment

`Accept` 必须创建 Server-side Time Commitment。

## TIME-3 — Countdown

接单后必须进入可见倒计时。

## TIME-4 — Late Is Domain Truth

超时判断不得只依赖需求方主观评价。

## TIME-5 — Provider Penalty Allowed

接单方迟到 / no-show 可影响：

```text
Settlement
Reliability
Ranking
Eligibility
```

## TIME-6 — Customer No-show Exit

客户未到达到 Policy Threshold（P0 默认 30m）后必须给接单方：

```text
无责取消
```

## TIME-7 — No Automatic Customer Cancellation

到 30m 只解锁权利，不自动取消。

## TIME-8 — No Symmetric Customer Fine in P0

客户迟到默认不进入对称罚款系统；极端重复行为走 Abuse / Risk Control。

---

# 135. R15.8 最终产品关系

```text
HOME
  ↓
Natural Language
+
Semantic Primer
  ↓
Intent Runtime
```

同时：

```text
MARKET
  ├─ MARKET
  │   ├─ People Discovery
  │   │   ├─ Trend
  │   │   ├─ New
  │   │   ├─ Available
  │   │   ├─ Nearby
  │   │   ├─ Repeat
  │   │   └─ Topic
  │   │
  │   └─ Opportunity
  │       ├─ Now
  │       ├─ Nearby
  │       ├─ Booked
  │       └─ Remote
  │
  └─ ACTIVITY
```

Opportunity 成交：

```text
Opportunity
↓
System Feasibility
↓
接单
↓
Time Commitment
↓
Countdown
↓
Execution
↓
Outcome
↓
Reliability
↓
Settlement
```

客户严重迟到：

```text
Provider Arrived
↓
Customer Missing
↓
30m
↓
No-fault Exit Unlocked
↓
Provider chooses Continue / Cancel
```

最终原则：

> **Proxy 不靠用户口头保证时间，而是把守时写进市场机制。**

> **人物可以跨地区被发现；现场机会必须围绕真实履约能力分发。**

> **安全是能不能开始交易的底线，时间是市场能不能长期建立信用的第二底线。**

---

# 136. 对应原型

本版本对应 P0 Prototype：

```text
Proxy_P0_Prototype_R15_8_0_Market_Depth_Time_Commitment.html
```

重点验证 Route / State：

```text
market
marketpeople
marketopportunities
marketsupplyprofile
marketorder
opportunityexecution
```

`opportunityexecution` 中允许使用 Prototype-only state controls 演示：

```text
正常
临近
接单方超时
客户迟到
客户 30m 未到
```

这些演示控制不是正式产品 UI；正式产品状态由 Server Event / Policy 驱动。

---

# 137. R15.9 修订目标 — 「我的」从身份切换页升级为 Personal Social OS

R15.8 已经把前台身份弱化为：

```text
USER
BUSINESS
```

并明确：

```text
找人
接机会
发需求
发活动
开放能力
```

都是行为或能力，而不是新的身份。

因此 USER 的 `Me / 我的` 顶部卡不再承担：

```text
切换身份
```

职责。

R15.9 将其重新定义为：

> **个人状态 + Proxy 个人主页 + 社媒身份 + 联系方式 + 个人二维码 + 市场信誉 + 渠道归因的统一中枢。**

目标不是做传统“账号设置页”，也不是把 TikTok / Zalo / Instagram 做成一排外链。

目标是建立：

```text
External Social Identity
        ↓
Proxy Personal Profile
        ↓
Discovery / QR / Share
        ↓
Proxy Chat
        ↓
Opportunity
        ↓
Order
        ↓
Outcome / Repeat
```

让用户能管理自己的数字人物资产，同时让平台掌握真实性、安全边界和有效市场归因。

---

# 138. Me 顶部卡冻结 — Personal Status Card

USER `Me` 顶部第一张卡固定优先展示：

```text
Avatar
Name
City
Verification
Time Reliability
Current Personal Status
Connected Social Summary
```

示例：

```text
Huyen
河内 · 已验证 · 准时 98%

● 可接单

TikTok  Zalo  IG  LinkedIn
```

禁止再出现：

```text
个人用户 · 同一个账号可……
切换身份
当前身份 · 用户
```

这种低信息密度文案。

顶部卡点击进入：

```text
PERSONAL_HUB
```

状态按钮独立点击进入：

```text
PERSONAL_STATUS_SHEET
```

---

# 139. Personal Status — 状态是市场状态，不是口头履约承诺

P0 允许四个用户可控状态：

```text
AVAILABLE   可接单
BUSY        忙碌
PAUSED      暂不接单
HIDDEN      隐身
```

定义：

### AVAILABLE

```text
允许进入人物发现
允许进入合适机会分发
仍需通过 Availability / Time / Location / Safety / Eligibility Gate
```

### BUSY

```text
个人主页继续存在
降低 / 停止即时机会分发
不影响已有订单
```

### PAUSED

```text
停止新机会分发
保留个人主页与历史信誉
已有订单继续履约
```

### HIDDEN

```text
退出公开人物发现
已有关系 / 已成交订单继续存在
```

重要边界：

> **Personal Status 是用户对市场曝光与接单意愿的粗粒度控制，不替代真实 Availability，也不替代 R15.8 的 System Feasibility Check。**

因此：

```text
AVAILABLE ≠ 一定能接某个具体机会
```

具体机会仍必须检查：

```text
Time
Travel / Remote
Availability
Existing Commitment
Capability
Safety
Eligibility
```

平台风控状态不得伪装成用户状态。

例如平台限制必须单独记录：

```text
POLICY_RESTRICTED
SUSPENDED
RISK_REVIEW
```

不得显示成用户主动选择了“暂不接单”。

---

# 140. USER Me Information Architecture

R15.9 USER `Me` 冻结为：

```text
我的
│
├─ Personal Status Card
│   ├─ Name / City / Verified
│   ├─ Time Reliability
│   ├─ Current Status
│   └─ Social Summary
│
├─ 个人主页
│   ├─ 主页与二维码
│   ├─ 社媒与联系
│   └─ 访问与转化
│
├─ 我的市场
│   ├─ 我的订单
│   ├─ 能力与可用时间
│   ├─ 我的活动
│   └─ 关注与收藏
│
└─ 账户
    ├─ 钱包与结算
    ├─ 设置与隐私
    └─ 我的企业 / 店铺
```

Business Workspace 仍然存在，但不再占据 USER 个人卡右侧的“切换身份”按钮。

具有企业权限的用户从：

```text
我的企业 / 店铺
```

进入 Business Principal / Workspace。

---

# 141. Personal Social OS — 用户掌控什么，平台掌控什么

这是 R15.9 的核心边界。

## 141.1 用户专属控制

用户必须拥有最终控制权：

```text
关联哪个外部账号
解除哪个外部账号
是否公开
在什么关系阶段公开
主页展示顺序
Proxy QR 上展示哪些入口
是否允许外部联系方式
是否关闭临时联系权限
```

平台不得静默改变这些设置。

## 141.2 平台控制

平台负责：

```text
账号归属验证
连接器 / Token 安全
链接风险检查
冒用 / 欺诈 / 批量账号风控
Visibility Policy 执行
来源归因
市场安全资格
外部身份状态 freshness
```

平台掌控的是：

> **真实性、规则和证据。**

不是：

> **替用户经营外部账号。**

## 141.3 明确禁止

未经明确授权，Proxy 不得：

```text
读取外部私信
抓取联系人
自动公开 Zalo / 电话
静默跨平台发帖
自动关注 / 点赞 / 私信
把外部粉丝数写成 Proxy Reliability
```

---

# 142. External Identity Link Domain Model

新增 Domain Object：

```text
ExternalIdentityLink
```

建议核心字段：

```text
link_id
user_id
provider
handle
canonical_url
ownership_state
visibility_policy
display_order
qr_asset_ref
connection_method
connected_at
last_verified_at
status
risk_state
```

`provider` 可包括：

```text
TIKTOK
ZALO
INSTAGRAM
LINKEDIN
OTHER
```

但 UI 不应要求所有 Provider 都支持相同 API 能力。

连接器能力必须声明：

```text
can_verify_ownership
can_fetch_public_profile
can_supply_qr
can_deep_link
can_publish_with_user_action
can_revoke
```

若某平台无官方 API / OAuth 能力，P0 可以退化为：

```text
Handle / URL
+
User-supplied QR
+
Ownership Confirmation
```

不得用非授权 scraping 补齐能力。

---

# 143. Ownership Verification

外部账号关联必须区分：

```text
CONNECTED
```

和：

```text
OWNERSHIP_VERIFIED
```

验证状态建议：

```text
PENDING
VERIFIED
STALE
REVOKED
RISK_REVIEW
```

可用验证方式取决于 Connector：

```text
OAuth
Deep Link Confirmation
One-time Code
QR Confirmation
Manual Evidence Review
```

原则：

> **用户填了一个 TikTok URL，不代表平台已经证明该账号属于此用户。**

对外只能在 `VERIFIED` 时展示：

```text
✓ 已关联 / 已验证
```

否则只能展示：

```text
已添加
待确认
```

---

# 144. Visibility Policy — 社交账号与联系方式逐级开放

外部账号统一使用：

```text
PUBLIC
CHAT
ORDER
PRIVATE
```

### PUBLIC

任何符合 Profile 可见性的用户可以看到。

### CHAT

发生有效 Proxy Chat 后才可见。

### ORDER

订单成立后才可见。

### PRIVATE

仅用户本人可见。

默认建议：

```text
TikTok / Instagram → PUBLIC or User Choice
Zalo               → ORDER
Phone               → ORDER
```

但默认值不是永久规则，用户可主动调整。

关系阶段：

```text
陌生浏览
↓
Proxy Chat
↓
Order Established
↓
Execution
↓
Order Closed
```

联系方式权限可以随关系阶段动态开启。

订单结束后，临时联系权限可：

```text
AUTO_CLOSE
KEEP_BY_USER
KEEP_BY_RELATIONSHIP
```

不得因为用户有公开 Profile 就自动暴露私人手机号 / Zalo。

---

# 145. Proxy Personal QR

R15.9 引入：

```text
Proxy Personal QR
```

它不是简单复制 TikTok / Zalo QR。

它指向：

```text
Proxy Personal Profile
```

然后由 Visibility Policy 决定：

```text
TikTok 是否展示
Zalo 是否展示
Instagram 是否展示
Phone 是否展示
```

优势：

```text
一个稳定入口
外部账号可变更
隐私规则可动态调整
扫码来源可归因
链接可撤销 / 风控
```

外部平台二维码仍可以作为：

```text
ExternalIdentityLink.qr_asset_ref
```

保存和展示，但必须遵循对应渠道 Visibility Policy。

Proxy QR 扫描不得自动：

```text
加好友
建立订单
合并身份
开放联系方式
```

只产生：

```text
Profile Visit / Attribution Event
```

---

# 146. Personal Profile — 外部人气和 Proxy 信誉必须分离

R15.9 冻结：

> **External Popularity ≠ Proxy Qualification ≠ Proxy Reliability**

例如：

```text
TikTok 500k Followers
```

最多可以进入：

```text
Discovery Signal
Content Relevance Signal
Exploration Signal
```

不得直接提高：

```text
Safety Eligibility
Time Reliability
Fulfillment Reliability
Order Match Qualification
Settlement Trust
```

Proxy 长期人物信誉继续优先来自：

```text
Identity Verification
Safety Record
On-time
Fulfillment
Outcome
Repeat
Qualified Relationship
```

个人主页推荐展示的核心事实仍是：

```text
已验证
准时率
真实履约次数
复购
当前 Availability / Status
相关能力
```

粉丝 / 播放量若展示，只能放在次级 Social Context 中。

---

# 147. Channel Attribution — 平台真正获得的价值

R15.9 不把 Social OS 做成“外链收纳页”。

平台必须能够形成：

```text
Source
↓
Proxy Profile
↓
Qualified Chat
↓
Opportunity
↓
Order
↓
Outcome
↓
Repeat
```

建议事件：

```text
PersonalQRScanned
ExternalChannelOpened
ProfileViewed
QualifiedChatStarted
OpportunityCreated
OpportunityAccepted
OrderCreated
OrderCompleted
OutcomeRecorded
RepeatOrderCreated
```

归因字段示例：

```text
source_channel
source_ref
campaign_ref
profile_id
user_id
session_id
order_id
outcome_id
occurred_at
```

关键指标：

```text
Profile Visit
Qualified Chat Rate
Opportunity Conversion
Order Conversion
Outcome Success
Repeat Conversion
```

用户端优先展示“真实下一步”，不鼓励只追：

```text
粉丝
点赞
播放量
```

平台也不允许用单一 CTR / Follow Count 劫持人物市场排序。

---

# 148. Personal Social Analytics — 用户控制与平台学习使用同一事实链

USER 端 `访问与转化` 可以展示：

```text
过去 30 天

来源              主页访问    合格聊天    订单
Proxy Market      612         26          5
TikTok            338         11          2
Zalo QR           214         8           2
Instagram         120         2           0
```

这不是 Creator Vanity Dashboard。

主 Funnel：

```text
Profile
↓
Qualified Chat
↓
Opportunity
↓
Order
↓
Repeat
```

平台内部使用相同事件做：

```text
Ranking Learning
Channel Quality
Abuse Detection
Acquisition Attribution
```

但不得把原始私人联系人数据变成推荐特征。

---

# 149. Platform Social Identity Control Plane

平台需要一个内部 Control Plane，至少覆盖：

```text
Ownership Verification
Link Integrity
Provider Connector State
Risk / Abuse
Visibility Enforcement
Attribution
Revocation
Audit Trail
```

内部不得只有一个：

```text
connected = true / false
```

必须区分：

```text
用户声明关联
账号归属验证
当前连接健康
当前可展示
当前风险状态
```

推荐状态：

```text
DECLARED
VERIFIED
ACTIVE
STALE
REVOKED
RISK_REVIEW
BLOCKED
```

每一次 Visibility / Link / Verification 变更必须留下：

```text
actor
reason
old_state
new_state
occurred_at
source
```

---

# 150. Security / Privacy Boundary

Social Identity 是真人市场的高敏入口之一。

P0 必须遵守：

```text
Least Scope
Explicit User Action
Revocable Link
No Credential Storage Beyond Required Token Material
Encrypted Token Storage
Auditability
Visibility Gate
Safe External Navigation
```

外部跳转前，若检测到：

```text
domain mismatch
suspicious redirect
revoked ownership
risk review
```

则平台可以：

```text
阻止跳转
隐藏渠道
提示重新验证
进入 Risk Review
```

但平台风险处置不得偷偷把用户的 `PUBLIC` 改成 `PRIVATE` 后伪装成用户选择。

应记录：

```text
Policy Hidden
```

与：

```text
User Private
```

两个不同状态。

---

# 151. P0 / P1 / P2 Scope

## P0 — 必须落地

```text
Personal Status
Proxy Personal Profile
External Account Link Record
Ownership Verification State
TikTok / Zalo / Instagram / LinkedIn 连接槽位
User-supplied / Connector-supplied QR reference
Visibility: PUBLIC / CHAT / ORDER / PRIVATE
Proxy Personal QR
Profile → Chat → Opportunity → Order Attribution
Basic Channel Analytics
Unlink / Revoke
```

P0 不要求每个社媒都有完整 OAuth / API 集成。

## P1 — 高级个人主页

```text
展示顺序
主页模块排序
关系级联系方式策略
更多 Social Provider
统一名片分享
渠道质量建议
Profile Preview
```

## P2 — Social Assistant

```text
生成 Availability Share Card
生成 Activity Share Card
生成 Personal Profile Share Card
跨平台发布辅助
内容建议
```

但 P2 必须保持：

> **AI 可以生成草稿和分享素材，用户确认后发布；默认不得自动跨平台发帖。**

---

# 152. Interaction Freeze

## SOCIAL-1 — No Identity Switch on USER Profile Card

USER `Me` 顶部卡禁止放：

```text
切换身份
```

## SOCIAL-2 — Status Is One Tap

用户状态最多一层 Sheet 完成切换。

## SOCIAL-3 — Social Visibility Is User Controlled

每个外部渠道必须可独立设置：

```text
PUBLIC / CHAT / ORDER / PRIVATE
```

## SOCIAL-4 — Proxy QR First

主二维码优先使用：

```text
Proxy Personal QR
```

外部渠道 QR 是次级入口。

## SOCIAL-5 — No Social Popularity as Reliability

外部粉丝 / 播放 / Like 不得写入 Reliability Truth。

## SOCIAL-6 — No Raw Contact Exposure

公开 Profile 不得自动暴露：

```text
Phone
Zalo private contact
External DM identifier
```

除非满足用户 Visibility Policy。

## SOCIAL-7 — Attribution Must Reach Outcome

渠道分析不能只停在：

```text
Click
View
```

必须尽可能继续到：

```text
Chat
Opportunity
Order
Outcome
Repeat
```

---

# 153. R15.9 最终产品关系

```text
ME
│
├─ Personal Status
├─ Personal Profile
├─ Social Identity Links
├─ Proxy Personal QR
├─ Contact Visibility
└─ Channel Analytics
```

对用户：

```text
我决定：
连接谁
展示谁
什么时候开放联系
二维码怎么分享
```

对平台：

```text
Proxy 决定：
是否验证成功
是否安全
是否允许展示
来源如何归因
市场资格如何执行
```

两者交集：

```text
Verified Personal Graph
        ↓
Real-world Discovery
        ↓
Real Opportunity
        ↓
Real Order
        ↓
Real Outcome
```

最终原则：

> **外部社媒负责扩展“我如何被发现”，Proxy 负责证明“我在现实合作里是否靠谱”。**

> **用户掌控自己的外部身份和联系方式；平台掌控真实性、安全边界和市场归因。**

> **Personal Social OS 是真人市场的身份与流量基础设施，不是另一个社交 Feed。**

---

# 154. 对应原型

本版本对应：

```text
Proxy_P0_Prototype_R15_9_0_Personal_Social_OS.html
```

重点验证 Route / State：

```text
me
personalhub
socialidentity
personalqr
socialprivacy
socialanalytics
socialops
```

重点交互：

```text
Me 顶部状态切换
External Channel Visibility Sheet
Proxy Personal QR
Social Channel → Order Funnel
Platform Social Identity Control Plane
```

R15.8 的：

```text
market
marketpeople
marketopportunities
marketorder
opportunityexecution
```

继续保留且不得被本次 Social OS 修改破坏。

---

# 155. R15.10 修订目标：补齐真人网络的基础通信层

R15.8 已经冻结：

```text
人物负责发现
机会负责履约
活动负责聚合
安全第一
时间第二
```

R15.9 已经补齐：

```text
Personal Status
Social Identity Hub
Proxy Personal QR
Contact Visibility
Channel Attribution
```

R15.10 继续补齐剩余基础设施：

```text
Messaging
Friends
Relationship Graph
Friend Discovery
Notification Center
Inline Post Video
```

目标不是把 Proxy 做成另一个微信 / TikTok，而是让：

```text
发现一个真人
    ↓
关注 / 聊天 / 好友
    ↓
机会 / 活动
    ↓
订单
    ↓
现实履约
    ↓
长期关系 / 复购
```

形成连续链路。

---

# 156. Root Navigation Freeze：消息成为正式一级入口

R15.10 Root Stable Surface 冻结为：

```text
首页
市场
动态
消息
我的
```

`消息` 进入 Root，不再藏在 `我的`、人物主页或订单详情里。

原因：

- 别人主动找我时，必须存在稳定收件箱；
- 人物、机会、订单、活动都会产生沟通；
- Chat 是基础设施，不是某一个业务对象的附属功能。

前台原则：

```text
主动找别人 → 从 Person / Opportunity / Activity / Business 对象进入
别人找我   → 统一进入 Messages
```

---

# 157. Unified Inbox：聊天与好友共用入口，但不混业务真相

`消息` 第一层只保留两个轻量 Tab：

```text
聊天 | 好友
```

右上角：

```text
🔔 通知
＋ 添加好友
```

聊天列表可承载：

```text
Person Conversation
Opportunity Conversation
Order Conversation
Activity Conversation
Business Conversation
```

每个 Thread 只显示一个轻量 Context Tag，例如：

```text
人物
机会
订单
活动
好友
```

Conversation 可以引用现实对象，但不能直接修改 Domain Truth。

例如聊天里说：

> “地点改到西湖。”

不能自动把 Order Location 改掉。

重大时间、地点、价格、范围变化仍必须走 Domain Action / Confirmation Gate。

---

# 158. Context Conversation：普通 IM 体验 + 现实上下文

聊天体验必须保持普通：

```text
姓名
上下文
消息气泡
输入框
```

不要把聊天页做成项目管理软件。

但顶部可以保留一个极轻 Context Anchor：

```text
Bonsaidon
谈判 · 今天 18:00
已接单 · 距开始 01:21
```

或者：

```text
西湖摄影散步
周六 15:30
8 / 12 已参加
```

原则：

> **Conversation carries context, but context truth comes from the domain object.**

---

# 159. Notification Center 与真人聊天严格分开

真人 Inbox 不能被系统通知淹没。

所以：

```text
Messages = 人找我
Notifications = Proxy 告诉我发生了什么
```

通知类型包括：

```text
ORDER_TIME_REMINDER
ORDER_LATE_STATE
OPPORTUNITY_INVITE
FRIEND_REQUEST
ACTIVITY_UPDATE
PAYMENT_UPDATE
IDENTITY_VERIFICATION
SAFETY_ALERT
```

消息未读数与通知未读数必须是两个独立 Counter。

时间履约提醒继续继承 R15.8：

```text
接单
↓
倒计时
↓
临近预约时间提醒
↓
开始时间
↓
超时 / 履约扣减
```

这些属于 Notification，不属于 Chat Message。

---

# 160. Relationship Graph：Follow 与 Friend 不合并

R15.10 正式冻结两个关系：

```text
FOLLOW
- 单向
- 用于内容 / 人物发现
- 不需要对方确认

FRIEND
- 双向
- 必须确认
- 可成为新的 Privacy Scope
```

另外继续保留事实关系：

```text
WORKED_TOGETHER
JOINED_ACTIVITY_TOGETHER
REPEAT_RELATIONSHIP
BUSINESS_RELATIONSHIP
```

这些不是“好友”等价物。

最终关系图：

```text
Person
├─ Follow
├─ Friend
├─ Worked Together
├─ Activity Co-participant
├─ Repeat
└─ External Relationship Signal
```

`Popularity ≠ Qualification` 继续有效：

> 共同好友、粉丝数量或社媒关系可以增强 Discovery / Trust Context，但不能越过 Safety、Availability、Time Reliability、Capability Match。

---

# 161. 添加好友：五种入口统一进入 Friend Request

R15.10 支持：

```text
1. Proxy QR
2. Invite Link / Invite QR
3. Contacts
4. External Social
5. Proxy Search
```

统一流程：

```text
Source
↓
Possible Person
↓
Profile Preview
↓
Friend Request
↓
Accept / Ignore / Block
↓
Confirmed Friend
```

任何来源都不能跳过双方确认。

---

# 162. QR / Invite

## 162.1 Proxy QR

扫描个人 Proxy QR：

```text
QR
↓
Proxy Profile
↓
Add Friend / Chat / Follow
```

QR 只是 Provenance，不自动建立好友。

## 162.2 Invite

邀请链接与邀请二维码可以用于：

```text
Existing User → Profile / Friend Request
New User      → Signup → Profile → Friend Request
```

平台可以保留邀请归因，但邀请人不能自动获得对方联系人或好友权限。

---

# 163. 通讯录：匹配，不公开整本通讯录

通讯录必须显式授权。

产品语义：

```text
授权通讯录匹配
```

而不是：

```text
上传通讯录到 Proxy 社交网络
```

允许：

```text
Phone Contact
↓
Privacy-preserving Match
↓
“通讯录中的 3 位已在 Proxy”
```

禁止：

- 把联系人原始号码公开给其他用户；
- 未经确认自动建立 Friend；
- 因为用户授权过一次就永久扩大权限；
- 将整本通讯录变成广告定向素材。

用户撤销权限后，停止继续读取新的通讯录变化；已经明确建立的 Proxy Friend 不自动删除。

---

# 164. 外部社媒好友发现：能力自适应，不伪造 API 能力

支持连接器方向：

```text
Facebook
TikTok
Instagram
Zalo
其他未来渠道
```

但 Product Contract 必须写成 capability-based：

```text
IF provider allows relationship scope
    → use authorized relationship data
ELSE
    → use account ownership + invite + mutual verified signals only
```

禁止：

> 第三方没有开放好友 / 关注读取能力，但 Proxy UI 仍假装“已同步 238 位好友”。

所有外部关系最多先进入：

```text
External Relationship Signal
        ↓
Possible Connection
```

不能直接成为：

```text
Proxy Friend
Proxy Reliability
Proxy Qualification
```

---

# 165. 好友 Privacy Scope

R15.9 已经有：

```text
PUBLIC
CHAT
ORDER
PRIVATE
```

R15.10 增加 Relationship Context，但不强制自动扩大权限。

推荐策略：

```text
陌生人
→ 公开 Profile

好友
→ 用户可选择更多动态 / 联系方式

订单成立
→ 可按履约需要开放 Zalo / 电话 / 临时精确联系

订单结束
→ 临时权限可恢复
```

好友本身不能绕过用户对单个社媒 / 联系方式设置的 Visibility Policy。

---

# 166. Relationship Provenance

每条可能关系 / 好友关系必须知道来源：

```text
PROXY_QR
INVITE_LINK
CONTACT_MATCH
FACEBOOK
TIKTOK
INSTAGRAM
ZALO
PROXY_SEARCH
ACTIVITY
ORDER
MUTUAL_FRIEND
```

用途：

- 给用户解释“为什么可能认识”；
- 反垃圾 / 防诈骗；
- 关系推荐；
- 渠道归因；
- 审计。

Provenance 不改变关系级别。

---

# 167. Safety & Anti-Spam

真人关系网络必须沿用 Proxy 的 Safety First 原则。

平台可以限制：

```text
单位时间好友请求数量
重复陌生私信
批量二维码 / 邀请滥用
被多人拉黑 / 举报
异常设备与账号关系图
诈骗链接
骚扰内容
```

允许 Action：

```text
rate limit
friend-request cooldown
DM restriction
relationship recommendation suppression
account review
block / report enforcement
```

平台控制的是网络秩序，不是替用户决定谁是好友。

---

# 168. 用户掌控 vs 平台掌控

用户掌控：

```text
是否允许手机号找到我
是否同步通讯录
关联哪些社媒
谁可以加好友
是否显示共同好友
好友可看到什么
删除好友
拉黑
解除社媒
```

平台掌控：

```text
Identity Verification
Relationship Provenance
Spam / Abuse
Safety
Connector Capability
Rate Limit
Recommendation Eligibility
Audit
```

共同目标：

> **让真人网络可用、可信、可控，而不是把所有关系数据尽可能吸进平台。**

---

# 169. Feed Video Boundary：能发、能看，但不做“刷视频”产品

R15.10 正式冻结：

```text
Video = Post Media Asset
```

不是：

```text
Video = 独立 Root Surface
Video = 全屏上下无限刷 Feed
```

允许：

- 帖文里发布普通视频；
- 图文 + 视频混合帖；
- 点击 / 内联播放；
- 暂停、进度、声音等正常媒体控制；
- 分享视频帖；
- 视频作为 Person / Activity / Business / Outcome 的内容表达。

不做：

- TikTok 式视频专属 Root Tab；
- 自动全屏进入下一条视频；
- 上滑无限切换视频；
- 以 Watch Time 最大化为主目标；
- 为了视频消费破坏人物、关系、机会和现实活动结构。

核心原则：

> **Proxy 可以有视频内容，但不是“刷视频 App”。**

Feed 的目标继续是：

```text
Discovery
→ Profile / Relationship
→ Chat / Activity / Opportunity
→ Real Outcome
```

而不是：

```text
Watch
→ Watch
→ Watch
→ Watch
```

---

# 170. 视频发布 P0 Contract

Post Composer P0：

```text
Text
Photos
Normal Video
Location Context
Capability Context
Activity Context
```

Prototype 支持：

```text
最多 9 个媒体资产
其中普通视频 P0 可先限制 1 个
```

这里是 Prototype / P0 UX 限制，不是永恒 Domain 限制。

Video 默认：

```text
no autoplay
playsinline
explicit controls
no auto-next
```

媒体 Truth 仍属于 Post，而不是 Opportunity / Order Truth。

---

# 171. R15.10 数据对象建议

```text
ConversationThread
- thread_id
- participant_refs
- context_ref?
- context_type?
- unread_count
- last_message_at

Message
- message_id
- thread_id
- sender_ref
- body / media_ref
- created_at
- safety_state

FriendEdge
- person_a
- person_b
- state: PENDING | ACCEPTED | REMOVED | BLOCKED
- provenance
- created_at

FollowEdge
- follower_ref
- followed_ref
- state

PossibleConnection
- target_person_ref
- signal_type
- provenance
- confidence_band
- user_visible_reason

Notification
- notification_id
- type
- object_ref
- read_state
- created_at
```

关键边界：

```text
Message ≠ Domain Action
Friend ≠ Follow
External Friend Signal ≠ Proxy Friend
Popularity ≠ Reliability
Conversation Context ≠ Domain Truth
```

---

# 172. R15.10 原型验证范围

本版本对应：

```text
Proxy_P0_Prototype_R15_10_0_Messaging_Relationship_Graph.html
```

新增 Route：

```text
messages
conversation
notifications
addfriend
qrscan
friendaddpreview
invitefriend
contacts
socialfriends
proxysearch
friendrequests
```

继续保留：

```text
market
marketpeople
marketopportunities
marketorder
opportunityexecution
personalhub
socialidentity
personalqr
socialprivacy
socialanalytics
postfeed
postcreate
```

重点 Prototype Gate：

```text
5-root navigation works
Unread badge works
Chat / Friend tabs switch
Context Conversation renders
Notification Center is separate
Friend Request Accept / Ignore works
QR / Invite / Contacts / Social / Search entry exists
Contacts permission is explicit
External social discovery is capability-aware
Video uploads into Post
Video remains inline / controlled
No video-only swipe surface exists
R15.8 Time Commitment remains intact
R15.9 Personal Social OS remains intact
```

---

# 173. R15.10 最终产品关系

```text
                    Proxy Person Graph
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      Discovery         Relationship      Reality
          │                │                │
      Person Market     Follow / Friend   Activity
      Feed / Search     Chat / Contacts   Opportunity
      Social Links      QR / Invite       Order
                                           │
                                        Outcome
                                           │
                                      Repeat / Trust
```

R15.10 冻结原则：

> **发现可以很开放，好友必须确认，沟通必须有稳定入口，现实交易继续由 Domain Truth 驱动。**

> **视频可以帮助一个真人表达自己，但不能把 Proxy 的主循环变成无尽内容消费。**

> **平台掌控真实性、安全、反滥用与关系来源；用户掌控谁能进入自己的关系网络。**



# 174. R15.11 修订目标：基础社交能力收口，进入 Launch Candidate

R15.11 不再扩张产品边界。

目标只有两个：

1. 补齐“常规社交产品应该有”的最后一层基础件；
2. 把当前产品从持续设计状态切换到 **实现 → 测试 → Android 上线候选**。

本版本继承 R15.10、R15.9、R15.8 全部冻结规则。

优先级：

```text
Safety
→ Time
→ Domain Truth
→ Messaging / Relationship Integrity
→ Core UX Stability
→ Growth / Optimization
```

R15.11 以后，除非测试发现阻断问题，不再因为“还可以再加一个功能”继续推迟上线。

---

# 175. Group Conversation Freeze：P0 群聊上限 50 人

Proxy 支持常规群聊，但产品定位不是 X / Facebook / Discord 式互联网超级群。

首发冻结：

```text
GROUP_MEMBER_LIMIT_DEFAULT = 50
```

该值属于 **Server Policy / Config**，不得写死成为客户端架构限制。

未来只有当真实数据持续出现以下信号时才考虑扩容：

```text
群成员长期接近 40–50
高频创建第二个群来绕过上限
活动 / 商家协作出现明确 >50 的真实需求
用户持续提交扩容需求
```

扩容路径可以是：

```text
50 → 100 → 200
```

但不在 P0 预先建设大型群基础设施。

核心原则：

> **Proxy 的群服务现实关系、活动和协作，不服务互联网大规模广播。**

---

# 176. 群聊 P0 功能边界

P0 支持：

```text
创建群
群名
群头像
群主
管理员
添加成员
移除成员
邀请好友
群二维码
邀请链接
@成员
回复消息
表情回应
文字
图片
普通视频
文件
位置
分享 Post
分享 Person
分享 Activity
分享 Opportunity
静音
搜索聊天记录
退出群
举报
```

普通群默认以关系 / 邀请制为主。

不做：

```text
万人公开群
超级群频道
公开群 SEO
群广告广播系统
付费群
直播群
群内复杂 Bot 平台
```

广告或商业推广若未来启用，进入 **Platform-managed Promotion / Ads**，由 Proxy 控制投放、频率、归因和收费；不把群聊变成商家批量骚扰渠道。

---

# 177. Group ≠ Activity ≠ Order

群聊是 Communication Object。

```text
GroupConversation
- member_refs
- owner_ref
- admin_refs
- context_ref?
- member_limit_policy
- message_policy
```

Activity 是现实事件：

```text
time
location
capacity
join state
host
outcome
```

Order 是交易与履约真相：

```text
price
schedule
commitment
settlement
execution state
outcome
```

允许：

```text
Activity → linked Group
Order / Business Collaboration → linked Group
```

禁止：

```text
群里一句“改到 19:00” → 自动修改 Order Time
群里说“加 200k” → 自动修改 Settlement
群主踢人 → 自动取消 Domain Order
```

重大业务变更仍必须走 Domain Action。

---

# 178. Message Request：陌生人可以联系，但不能直接闯入主 Inbox

非好友 / 非已有关系的人发来的第一条消息进入：

```text
REQUESTED
```

用户可以：

```text
Accept
Ignore
Block
Report
```

只有接受后才进入正常 Conversation Inbox。

目的不是阻止陌生人联系，而是避免真人市场最后演变成垃圾私信系统。

好友、共同活动、已成交订单等关系可以影响 Request Risk / Presentation，但不能绕过 Block / Safety Policy。

---

# 179. Feed 常规动作冻结

普通 Post 支持常见社交动作：

```text
Like
Reply
Repost
Quote
Bookmark
Share
@Mention
```

Share 可以进入：

```text
好友私聊
群聊
复制链接
系统分享
```

Bookmark 默认私有。

`@Mention` 可用于：

```text
Post
Reply
DM
Group
```

Mention 只建立内容 / 通信引用，不赋予额外隐私权限。

---

# 180. Video Boundary 再冻结：有视频，不做刷视频

R15.10 规则保持不变：

> **Video is a media type, not a navigation model.**

支持：

```text
Post 中发视频
Post 中播放视频
Reply / Share 视频帖
群聊发送普通视频
Profile 展示视频帖
```

不支持：

```text
Video Root Tab
全屏自动下一条
上下无限 Swipe 视频流
自动播放链
观看时长驱动的短视频主循环
```

Proxy Feed 目标是：

```text
发现人
了解人
产生关系
发现现实事情
```

而不是最大化连续视频消费时长。

---

# 181. Root 与基础社交架构 Final Freeze

```text
ROOT
首页
市场
动态
消息
我的
```

消息：

```text
私聊
群聊 ≤50
消息请求
好友
通知中心（独立系统事件）
```

关系：

```text
FOLLOW          单向发现
FRIEND          双向确认
GROUP           多人通信
WORKED_TOGETHER 真实合作关系
```

外部关系来源：

```text
Proxy QR
Invite Link
Contacts
TikTok
Facebook
Instagram
Zalo
```

外部关系永远只产生 Signal / Possible Connection，不能自动升级 Proxy Friend。

---

# 182. P0 明确不做

为了结束 Feature Creep，本版本正式记录不做项：

```text
短视频刷流
直播平台
大型公开群
万人群
Spaces / 大型语音房
完整创作者广告分成
用户自助群广告广播
复杂频道 / Server 社区
独立 Dating 模式
为 DAU 设计的无限消费机制
```

未来只有真实使用数据证明需要时再解冻。

---

# 183. Android Launch Candidate Gate

下一阶段不是继续画 PRD，而是验证真实产品链路。

建议执行顺序：

```text
1. Codex implementation pass
2. Static / type / lint / build gates
3. Core route smoke test
4. Android device test
5. Closed pilot
6. Fix P0/P1 blocking issues
7. Android production release
8. Observe real usage
9. iOS adaptation / review hardening
10. iOS release
11. BD expansion
```

Android 首发前最低 Vertical Slice：

```text
Signup / Login
→ Home Intent
→ Market Person / Opportunity
→ Profile
→ Follow / Friend / Chat
→ Group Chat
→ Activity
→ Opportunity / 接单
→ Time Commitment
→ Execution
→ Outcome
→ Me / Social OS
```

必须同时覆盖：

```text
Notification
Block / Report
Privacy
Location permission
Contact permission
Media upload
Offline / retry
Payment / settlement path（若首发启用）
```

---

# 184. Launch Stop Rule

测试期间问题分级：

```text
P0 — 安全 / 数据损坏 / 支付 / 身份 / 权限 / 无法履约闭环
     → 必须修复后上线

P1 — 核心路径明显失败 / 消息丢失 / 市场无法使用 / 时间状态错误
     → 原则上修复后上线

P2 — UI polish / 排序小问题 / 非阻断体验
     → 可进入上线后迭代

P3 — 新功能想法
     → 不阻塞上线
```

核心原则：

> **上线 Gate 由真实风险决定，不由 PRD 是否还能继续变厚决定。**

---

# 185. R15.11 Prototype Verification

对应原型：

```text
Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html
```

新增验证：

```text
Message root exists
DM exists
Group list exists
Create Group exists
Group member limit shows 50
Group Info exists
Mention / Reply / Reaction concept visible
Group QR / Invite concept visible
Message Requests separated from main chat
Activity / Order context remains read-only anchor
Video stays inline in Post
No video-only swipe surface
R15.8 Time Commitment still reachable
R15.9 Personal Social OS still reachable
```

---

# 186. R15.11 Product Freeze Statement

截至 R15.11，Proxy P0 的明显基础产品缺口视为已补齐。

当前主循环：

```text
发现真人
→ 关注 / 好友
→ 私聊 / 群聊
→ Activity / Opportunity
→ Order
→ Time Commitment
→ Real-world Execution
→ Outcome
→ Repeat / Relationship
```

产品接下来进入：

> **Build → Test → Android → Learn → iOS → BD**

而不是继续无限增加基础功能。

---

# 183. R15.12.7 最终冻结：体验 / 机会 / 活动

本章是当前 Market IA 与 Home Semantic Entry 的**最高优先级覆盖章**。

本次不再扩大产品边界，也不继续做多版本 UI 实验。目标只有一个：

```text
保留原 R15.11 整体产品与视觉骨架
只修正 Market 的一级对象与人物交易边界
```

最终产品表达：

```text
HOME QUICK ENTRY
├─ 体验
├─ 机会
└─ 活动

MARKET
├─ EXPERIENCE / 体验
├─ OPPORTUNITY / 机会
└─ ACTIVITY / 活动
```

冻结一句话：

> **体验负责消费，机会负责需求，活动负责聚人。**

---

# 184. 身份模型不变：只有 USER / BUSINESS

前台身份继续冻结：

```text
IDENTITY
├─ USER
└─ BUSINESS
```

以下均不是新身份：

```text
Creator
Host
Photographer
Guide
Opportunity Responder
Activity Host
Activity Participant
```

它们属于：

```text
Capability / Role / Participation / Availability
```

因此：

```text
一个 USER
→ 可以消费体验
→ 可以发布机会
→ 可以接机会
→ 可以参加 / 发起活动
→ 可以开放能力和可用时间
→ 可以成为某个 Experience 的 Host
```

Business 继续代表 Business Principal，原有 Storefront / Billing / Members / Activity / Outcome 等能力保持不变。

---

# 185. EXPERIENCE：体验成为消费侧一级对象

## 185.1 定义

Experience 必须有明确业务内容，不允许只靠人物本身构成商品。

最小字段：

```text
experience_id
category
title
scope
duration
location / venue
deliverable / included_content
price / price_rule
eligible_host_set
available_slots
safety_policy
cancellation_policy
```

示例：

```text
西湖人像摄影散步
- 90 分钟
- 西湖公开路线
- 路线组织 + 人像拍摄
- 交付 20 张精选照片
- 680,000₫ 起 / 本体验
- Linh / Mai 为当前 Eligible Host
```

错误表达：

```text
Linh
今晚有空
680,000₫
购买 / 预约她
```

正确表达：

```text
西湖人像摄影散步
→ 查看 Experience Scope
→ 选择 Host
→ 选择该 Host 在本 Experience 下的可预约档期
→ Booking
```

## 185.2 Host 可以被选，但不是商品本身

Proxy 不废除“选人”。

用户可以：

```text
Experience Detail
→ Eligible Hosts
→ 查看 Profile / Portfolio / Reliability
→ 选择具体 Host
```

但是：

```text
Price belongs to Experience / Quote
Availability belongs to Experience + Host slot
Person itself ≠ Market Inventory
```

这条边界必须同时满足“具体的人仍然重要”和“市场不把真人直接做成价格货架”。

---

# 186. OPPORTUNITY：客户发布的需求必须保留

Opportunity 是客户 / 商家主动发布的现实 Demand，不因 Experience 上线而删除。

继续保留：

```text
NOW
NEARBY
BOOKED
REMOTE
```

Opportunity 继续显示 / 管理：

```text
time
location
travel feasibility
required capability
requester / business verification
reward / budget truth
response state
acceptance
Time Commitment
Execution
Outcome
```

Opportunity 的基本路径继续是：

```text
Customer / Business publishes Demand
→ Eligibility / Feasibility
→ Opportunity Distribution
→ Eligible USER responds / accepts
→ Order
→ Time Commitment
→ Execution
→ Outcome
```

因此：

> **Experience 是平台包装好的消费对象；Opportunity 是客户自己发布的需求。两者不能互相替代。**

---

# 187. ACTIVITY：聚人、内容和商业场景

Activity 继续沿用原 R15.11 Activity Runtime，不重构。

Activity 可以由：

```text
USER
BUSINESS
PLATFORM
```

发起。

Activity 负责：

```text
多人参与
兴趣聚合
本地社交
公开场景
品牌 / 商家活动
内容产生
关系形成
```

Creator / Host 可以：

```text
参加 Activity
主理 Activity
申请 Host / Creator collaboration slot
在 Activity 中产生 Post / UGC
由真实 Activity / Campaign 产生收益
```

但 Activity Candidate 不能脱离具体 Activity 重新变成“人物价目表”。

---

# 188. People / Creator 的最终前台位置

人物没有被移除。

People Discovery 继续存在：

```text
Feed
Search
Profile
Follow / Friend
Message
Activity participants / Hosts
Experience eligible Hosts
Opportunity history / outcomes where appropriate
```

但是以下结构停止作为 Launch Candidate 的主 Market IA：

```text
人物市场
趋势人物货架
现在有空的人货架
颜值榜
真人 + 空闲 + 价格
```

Creator 经济继续是运营重点，但通过以下真实对象实现：

```text
Content
Profile
Experience
Activity
Opportunity
Brand / Business Collaboration
Repeat / Relationship
```

---

# 189. Home 与 Market UI Freeze

## 189.1 USER Home

第一屏继续保持原 R15.11 极简 Semantic Entry。

快捷入口固定为：

```text
体验 | 机会 | 活动
```

不再新增第四个 Shortcut。

## 189.2 BUSINESS Home

同样显示：

```text
体验 | 机会 | 活动
```

Business 发布需求 / 发活动 / 经营 Storefront 继续通过原有语义入口、`+` 和 Business OS 承接。

## 189.3 Market Root

Market 顶部固定三 Tab：

```text
体验 | 机会 | 活动
```

体验首屏：

```text
Search
一排轻量 Filter
趋势体验
Experience Cards
```

机会首屏：

```text
Search
现在 / 附近 / 预约 / 远程
Opportunity Cards
```

活动首屏：

```text
Search
趋势 / 附近 / 本周 / 新活动
Activity Cards
```

不新增 Store 一级 Tab。

---

# 190. Market Admission / Product Boundary

R15.12.7 不是通过“换名字”实现边界，而是要求业务对象真实成立。

Experience 必须：

```text
有明确 Scope
有合理 Duration
有 Location / Venue 规则
有明确包含内容 / Deliverable
有可解释 Price / Quote 规则
有符合资格的 Host Set
```

不得创建：

```text
无 Scope 的按人付费
人物本身作为 SKU
“今晚有空 + 人物价格”货架
颜值排序决定交易资格
违法 / 高风险交易
未成年人商业供给
```

普通生活内容继续属于 Social / UGC；是否能发 Post 与是否能进入 Market Transaction 是两套不同判断。

---

# 191. R15.12.7 Acceptance Gates

## MARKET-126-1 — Three Primary Objects

Market Root 只能出现：

```text
体验
机会
活动
```

## MARKET-126-2 — Opportunity Preserved

原 Opportunity / Order 主链不得因为 Experience 改版被删除、降级或绕过。

## MARKET-126-3 — No Person Inventory

不得出现独立 Person Market 作为 Launch Candidate 的交易货架。

## MARKET-126-4 — Host Selection Preserved

Experience Detail 必须允许在 Eligible Host Set 中选择具体 Host。

## MARKET-126-5 — Experience Owns Scope / Price

价格、Scope、Duration、Deliverable 必须属于 Experience / Quote，不直接属于 Person Card。

## MARKET-126-6 — Activity Preserved

原 Activity Runtime、Activity Detail、Venue / Merchant scene 与参加逻辑继续有效。

## MARKET-126-7 — Two Identities Only

前台身份切换仍只允许：

```text
USER
BUSINESS
```

## MARKET-126-8 — No Store Root Tab

Storefront 保留为 Business Asset / Landing Surface，不进入普通 Market 一级 Tab。

## MARKET-126-9 — Home Freeze

Home Shortcut 固定为：

```text
体验 | 机会 | 活动
```

## MARKET-127-10 — LIST / MAP Preserved

Market 必须保留 `LIST / MAP` 双模式，体验 / 机会 / 活动三类对象均可通过右上角地图图标切换。

Map Pin 只代表业务对象地点 / 区域，不代表真人实时位置。

## MARKET-127-11 — Stop Designing, Start Operating

完成以上 Gate 后，不再因为主观审美继续重做 Market IA。

下一轮改版必须来自真实运营信号，例如：

```text
Experience CTR / Detail Open
Host Selection Rate
Booking Conversion
Opportunity Response / Completion
Activity Join / Return
Creator Earnings
Repeat Revenue
Safety / Cancellation / No-show
```

---

# 192. R15.12.7 Market Map Parity Freeze

R15.12.7 只恢复 / 保留 Market 的地图模式，不改变 R15.12.6 已冻结的三对象 IA。

Market 右上角固定一个图标切换：

```text
LIST  → [Map Icon] → MAP
MAP   → [List Icon] → LIST
```

不新增文字 Tab，不新增第四个 Market Object。

三类对象均支持：

```text
EXPERIENCE
├─ LIST
└─ MAP

OPPORTUNITY
├─ LIST
└─ MAP

ACTIVITY
├─ LIST
└─ MAP
```

地图 Truth：

```text
EXPERIENCE MAP
= Experience public location / Venue / coarse area

OPPORTUNITY MAP
= task area / allowed public precision / travel feasibility

ACTIVITY MAP
= public Activity Venue / public activity area
```

严格禁止：

```text
Creator realtime GPS
Host realtime GPS
Participant realtime GPS
private meeting point before authorization
precise personal address as a public map pin
```

远程 Opportunity：

```text
REMOTE Opportunity
→ 继续存在于 LIST
→ MAP 不强行生成地理 Pin
→ 地图模式提示切回列表查看完整远程结果
```

地图与列表共享：

```text
Eligibility
Privacy
Safety
Scope
Object Truth
```

## MAP-127-1 — Icon Switch

Market Header 必须有一个简洁地图图标；点击在 `LIST / MAP` 间切换。

## MAP-127-2 — Three-object Parity

体验 / 机会 / 活动三类一级对象都必须支持 MAP，不允许只给 Activity 地图。

## MAP-127-3 — Object Map, Not Person Map

地图上的 Pin 必须属于：

```text
Experience
Opportunity
Activity
```

不得把 Creator / Host 本人作为独立可交易地图 Pin。

## MAP-127-4 — Privacy Precision

公开地图默认只使用公开 Venue 或粗粒度区域；高精度位置只在具体业务需要且获得授权后提升。

---

# 193. R15.12.7 最终产品关系

```text
                         Proxy
                           │
             ┌─────────────┼─────────────┐
             │             │             │
        EXPERIENCE     OPPORTUNITY     ACTIVITY
           体验             机会           活动
             │             │             │
       Defined Scope   Customer Demand   People / Scene
       Price / Quote   Reward / Budget   Interest / Brand
       Eligible Hosts  Accept / Execute  Join / Host
             │             │             │
             └─────────────┼─────────────┘
                           │
                    Order / Payment
                           │
                    Time Commitment
                           │
                       Outcome
                           │
                 Repeat / Relationship
```

People / Creator 横向存在于整个网络中：

```text
Feed / Search / Profile
        ↓
Experience Host
Activity Host / Participant
Opportunity Responder
        ↓
Outcome / Repeat / Personal Brand
```

最终冻结：

> **体验负责消费，机会负责需求，活动负责聚人。**
>
> **人仍然重要、仍然可以被发现和选择，但不把人本身做成 Market SKU。**
>
> **R15.12.7 之后优先上线运营，后续优化由真实数据驱动。**

