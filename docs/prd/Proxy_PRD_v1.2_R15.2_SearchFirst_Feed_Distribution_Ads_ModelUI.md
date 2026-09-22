# Proxy PRD v1.2 — R15.2 Optimization Amendment
## Search-First Feed / Human Distribution / Agent Opportunity / Business OS / Server-Driven + Model-Driven UI

**状态**：PRODUCT OPTIMIZATION / ALGORITHM FREEZE / ARCHITECTURE ALIGNMENT  
**基线**：Proxy Brand Final Handoff v1.0 + PRD v1.1 Canonical Registry + R15 Product Freeze / Model-Driven UI  
**本文件性质**：增量修订，不重写 Canonical Registry 中已经冻结的 Identity / Task / Order / Payment / Permission / Outcome Truth。

---

# 0. 本次修订解决什么

本次修订集中解决五件事：

1. **把 Feed 从“轻量内容附属模块”升级为正式核心 Surface**；
2. **把 Search / Explicit Intent 提升为推荐、Agent 发现和广告画像的最高优先级信号**；
3. **明确 Feed 的传播、用户显式调教、Agent 曝光、内容混合与机会分发机制**，避免被单一高 CTR 内容劫持；
4. **把“我的企业”8 个入口从菜单补成完整 Business OS**；
5. **把 R15 的 Server-Driven + Model-Driven UI 写成可工程落地的运行时架构**，做到：
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

