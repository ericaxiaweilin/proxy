# Proxy PRD v1.2 — R15.4 Optimization Amendment
## Universal Home Intent / Search-First Feed / Human Distribution / Agent Opportunity / Business OS / Server-Driven + Model-Driven UI / Generated View Runtime

**状态**：PRODUCT OPTIMIZATION / ALGORITHM FREEZE / UI RUNTIME FREEZE / INTERACTION FREEZE / ARCHITECTURE ALIGNMENT  
**基线**：Proxy Brand Final Handoff v1.0 + PRD v1.1 Canonical Registry + R15 Product Freeze / Model-Driven UI + R15.3 Generated UI Runtime  
**本文件性质**：增量修订，不重写 Canonical Registry 中已经冻结的 Identity / Task / Order / Payment / Permission / Outcome Truth。

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

