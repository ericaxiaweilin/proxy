# Proxy PRD v1.1
## Chapter 21H — Local Life Social Demand Network R2

**状态**：CURRENT SOCIAL / LOCAL NETWORK PRODUCT CONTRACT · R2  
**依赖**：Canonical Registry R2.4 / Chapter 21G R2 / Chapter 21C R3 / Chapter 21A R5 / Chapter 21E R3 / Engineering Acceptance R8  
**目标**：把 Proxy 从“用户有需求才打开的真人服务 App”扩展为一个可持续产生 **Discovery → Relationship → Conversation → Intent → Demand → Order** 的本地生活网络。

---

# 1. 产品定义

Proxy 的 Social 层不是为了复制通用社交媒体，也不是为了最大化 DAU、点赞或观看时长。

它承担三个任务：

```text
1. 让本地的人、商家、活动、路线被发现
2. 让真实关系和对话自然形成
3. 让其中一部分关系自然长成 Need / Activity / Order
```

内部定义：

> **Social Demand Network = 本地发现网络 + 关系网络 + 需求生成网络。**

Post 是订单之前的数据对象，不是订单本身。

---

# 2. 一级信息架构

P0 Consumer Bottom Navigation 固定为：

```text
首页 / 任务 / 动态 / 我的
```

## 首页
回答：**我现在最该处理什么？**

- 进行中任务
- 等待确认
- 即将发生
- 少量高相关 Local Network teaser
- 明确需求入口

首页不是无限 Feed。

## 任务
回答：**我已经明确需要某个人的时间、能力或结果。**

- Paid Need
- Matching
- Execution
- Outcome

Activity 与 Paid Task 继续并列。

## 动态
回答：**这座城市现在有什么值得我知道、关注、聊或参与？**

P0 三个读取视图：

```text
RECOMMENDED
FOLLOWING
NEARBY
```

## 我的
统一承载：

```text
钱包与结算
关注 / 收藏
偏好记忆
身份 / 主体
Agent 内容与带单数据
通知 / 隐私 / 设置
```

`Wallet` 不再占用一级 Bottom Navigation。

## 2.1 Global Local Context

R13.2 新增全局 **Local Context**，回答：

> **用户现在正在看哪一个城市 / 区域的本地网络？**

它是浏览与发现上下文，不等于用户真实精确 GPS，也不等于某个订单的 Task Location。

Canonical 结构：

```text
LocalContext {
  market_id
  market_label
  area_id?
  area_label?
  source: DEVICE | MANUAL | DEEP_LINK | TASK_INHERITED
  precision: CITY | COARSE_AREA
  updated_at
}
```

P0 Root surfaces 必须可读：

```text
首页
任务
动态
我的
Agent 生意首页
```

最少展示：

```text
河内 · 还剑湖附近
北宁 · 市中心
胡志明市 · 中心城区
```

以上仅为原型演示标签，不冻结正式市场。

硬规则：

1. `LocalContext` 决定 Feed / Nearby / Activity / Merchant / local supply 的读取范围；
2. 用户可以手动浏览另一个城市，因此 `LocalContext` 不可等同于 `device_location`；
3. `ExactLocation` 不得作为全局 Social / Feed 上下文长期暴露；
4. 酒店、家庭地址、集合点、代驾上车点等精确地址只在具体 Task / Order 目的下单独授权；
5. 某个已创建 Task 的地点是真源事实，不因用户后来切换全局浏览城市而静默变化；
6. Root Tab 不显示返回箭头；二级详情页才使用 Back。

---

# 3. Local Life Graph

R13 后本地网络的核心图：

```text
User / Agent / Merchant
        ↕
 LocalContext / Place
        ↕
       Post
        ↕
 Follow / Reply / Repost / Bookmark
        ↕
   Conversation
        ↕
       Intent
        ↓
 Need / Activity / Venue Visit
        ↓
 Task / Offer / Order
        ↓
     Outcome
        ↓
 Repeat Relationship
```

其中：

- Post 可以引用 Agent、Service、Route、Venue、Activity；
- Conversation 可以来自 Post；
- Need 可以来自 Conversation；
- Order 必须仍经过既有 Eligibility / Matching / Confirmation 主链；
- Post、点赞、关注本身永远不能绕过资格与安全规则。

---

# 4. Post Canonical Contract

```text
Post {
  post_id
  author_principal_id
  author_type: USER | AGENT | MERCHANT | PLATFORM_SPECIAL
  body
  media_refs[]
  visibility
  reply_policy
  market_scope?
  area_scope?
  created_at
  status: DRAFT | PUBLISHED | HIDDEN | REMOVED
  context_refs[]
}
```

## PostContextRef

```text
PostContextRef {
  post_id
  context_type:
    AGENT_PROFILE |
    SERVICE_SKU |
    ROUTE |
    VENUE |
    ACTIVITY |
    TASK_TEMPLATE
  context_id
  relation_type
}
```

硬规则：

> **Post 存 durable content；实时交易事实由读取时 Hydration 获得。**

因此以下信息不得把 Post 当 Source of Truth：

```text
current availability
current service eligibility
current quote / current offer
merchant open status
activity capacity
real-time distance
```

Feed 展示这些信息时必须读取对应业务真源。

---

# 5. Post ≠ People Directory

R13 允许：

- 用户通过 Post 进入作者 Profile；
- 关注公开作者；
- 查看作者自己发布的公开内容；
- Agent Profile 展示当前可用 Service SKU；
- 在具体服务上下文中发起聊天或需求。

R13 仍禁止：

```text
全站按“人”无限浏览
按颜值 / 身材做人员目录排序
永久价格标签绑定到一个人
绕开 Need / Service Context 直接把人当商品
```

City Companion 可以在任务候选集中提高照片权重，但 Social Feed 不得退化为“美女照片墙”。

---

# 6. Social Interaction Contract

Post P0 支持：

```text
Like
Reply
Repost
Bookmark
Share
Follow Author
Open Profile
Open Context Ref
Start DM
Create / Continue Intent
```

Activity 仍不使用普通 Social Comments。

```text
Post → Reply
Activity → Activity Q&A
Confirmed Activity → Participant Chat
```

两个对象不可合并。

---

# 7. Conversation / DM

IM 是 Local Network 的一等边。

```text
Post
→ Conversation
→ free-form discussion
→ optional structured suggestion
→ explicit Need / Activity creation
```

硬规则：

1. 发起 DM 不自动创建 Need；
2. 普通聊天不自动修改订单；
3. 只有用户明确动作或已确认的 Material Change 才写入正式需求版本；
4. `conversation_origin` 必须保留 Post / Profile / Activity / Task 来源；
5. 城市同行等 relationship-heavy Service 可直接进入场景化 IM；
6. 普通用户 Post / Merchant Post 可以进入通用 Network DM。

---

# 8. Feed Read Pipeline

R13 Feed 采用 Product-Mixer-like 读取架构，但 Proxy 不以纯 Engagement 为目标。

```text
Candidate Sources
→ Eligibility / Safety
→ Feature Hydration
→ Utility Ranking
→ Diversity / Mixing
→ Serving
→ Event Stream
```

## 8.1 Candidate Sources

P0/P0.5 可包含：

```text
FOLLOWING
RELATIONSHIP
LOCAL / NEARBY
INTEREST
RECENT_DEMAND_CONTEXT
AGENT_AVAILABILITY
MERCHANT / ACTIVITY
EXPLORATION
LOCAL_TREND
```

不得只有一个“全站热门”池。

### Local Context Scope

`RECOMMENDED` 与 `NEARBY` 必须读取当前 `LocalContext`：

```text
RECOMMENDED → current market first / P0 可限定 current market
NEARBY      → current market + current coarse area / distance
FOLLOWING   → 可跨城，但当前 market 可优先混排
```

如果只有城市级上下文而没有可用区域 / 距离信息，不得伪造“距你 800m”；应降级为城市级相关性。

## 8.2 Eligibility / Safety

在 Ranking 前处理：

- visibility
- block / mute
- content safety
- merchant active state
- geographic policy
- service / agent eligibility where a transactional decoration is shown

## 8.3 Feature Hydration

读取时补充：

```text
relationship strength
current market / area / distance scope
recent intent
current service availability
current service summary
venue / activity state
creator freshness
source / sponsor state
```

## 8.4 Utility Ranking

Engagement 只是 feature，不是最终目标。

主要下游信号：

```text
Qualified Chat Started
Useful Profile Open
Service Intent
Need Created
Activity Join
Venue Visit / Reservation Intent
Order Origin
Successful Outcome
Repeat Relationship
```

禁止把以下单独设成 North Star：

```text
Like rate
Watch time
Photo click rate
Raw comments
Raw DAU
```

尤其不得因高照片点击率把 Feed 训练成低质量人物橱窗。

## 8.5 Diversity / Mixing

必须限制：

- 同一作者连续占屏；
- 同一内容类型占比；
- 同一商业来源占比；
- Sponsored flooding；
- 成熟头部 Agent 完全挤死新人。

新人可以获得受控 Exploration，但不能购买 Eligibility。

---

# 9. Unified Network Interaction Event

所有网络行为进入统一事件流：

```text
NetworkInteractionEvent {
  event_id
  actor_principal_id
  event_type
  object_type
  object_id
  source_surface
  source_id?
  local_context_ref?
  timestamp
  session_id
  downstream_context?
}
```

P0 event_type 至少包括：

```text
POST_IMPRESSION
POST_DWELL
MEDIA_OPEN
PROFILE_OPEN
FOLLOW
LIKE
REPLY
REPOST
BOOKMARK
SHARE
CONVERSATION_STARTED
SERVICE_OPEN
ACTIVITY_OPEN
VENUE_OPEN
NEED_CREATED
AGENT_SHORTLISTED
COOPERATION_CONFIRMED
ORDER_CONFIRMED
OUTCOME_FINALIZED
REPEAT_CREATED
```

---

# 10. Demand Attribution Lineage

订单来源不再只记录一个渠道枚举。

必须能保留完整 lineage：

```text
DemandAttributionLineage {
  demand_origin
  source_type
  source_id
  creator_principal_id?
  conversation_id?
  need_id?
  order_id?
}
```

示例：

```text
TikTok → Agent Profile Link → Proxy Post → DM → Need → Order
```

应同时保留：

```text
external_origin = AGENT_OWNED
proxy_source_type = POST_TO_DM
creator = Linh
```

Proxy 不得为了“抢归因”覆盖 Agent 自带客户来源。

---

# 11. Agent Creator Mode

Agent 不只是 Supply，也可以同时是：

```text
Supply Node
Creator Node
Distribution Node
Relationship Node
```

Agent 可发布：

- 路线经验
- 本地店铺发现
- 服务过程中的可公开内容
- 可用时间
- 专业建议
- 作品 / 拍摄成果（需有授权）
- 活动 / 场景推荐

Proxy 提供：

```text
AI copy assistance
translation
route card generation
context linking
content analytics
lead attribution
CRM linkage
```

Agent Creator Analytics 首先显示：

```text
Qualified Chats
Needs Created
Confirmed Cooperation
Repeat Demand
Demand Source Mix
```

Raw views / likes 只能作为辅助指标。

---

# 12. Merchant Content

Merchant 可以发布本地动态，并引用：

```text
Venue
Merchant Activity
Promotion / Benefit
Reservation Context
```

Sponsored content 必须：

1. 明确标记；
2. 先满足 relevance / safety / active state；
3. 不能因为付费绕过真实商家状态；
4. 不能静默改变用户 AI Route；
5. attribution 必须可解释。

---

# 13. 本地生活“一网打尽”的正确含义

不是把几十个分类塞到首页。

而是让同一个网络支持：

```text
人
需求
活动
商家
地点
路线
服务
对话
订单
结果
```

用户可以从任何一个真实对象进入，最后自然转换到另一个对象。

示例：

```text
Agent Post
→ DM
→ City Companion Need
→ Route
→ Cafe Venue
→ Merchant Spend
→ Outcome
→ Follow / Repeat
```

---

# 14. P0 Scope

R13 P0 必须实现：

- Bottom Nav：Home / Tasks / Feed / Me；
- Wallet 移入 Me；
- Root Header / Shell 显示可切换 Local Context；
- Home / Recommended / Nearby / Agent Home 对当前 Market / Area 有明确读取语义；
- 用户切换河内 / 北宁 / 胡志明市后，本地内容集合必须真实变化；
- Root Tab 不显示 Back；
- Feed：Recommended / Following / Nearby；
- mixed Post：Agent / User / Merchant；
- Post Detail；
- Like / Reply / Repost / Bookmark / Share；
- Follow；
- Social Profile；
- Post → Agent Service Chat；
- Post → Generic Network DM；
- Post → Activity / Venue；
- Post / DM → Need 的显式路径；
- Agent Content Analytics；
- Demand Attribution lineage；
- Ops Feed Pipeline read model。

---

# 15. Not P0

以下不应为 R13 首发阻塞项：

- 全量短视频编辑器；
- 直播；
- Creator 广告分成；
- 全局热门榜；
- 复杂 Topic / Hashtag 生态；
- 公开群聊广场；
- 无上下文人物搜索；
- Dating discovery；
- 自动从聊天直接下单。

---

# 16. North Star

Social 层最终衡量：

> **有多少高质量本地关系，最终产生了有用行动。**

核心 Funnel：

```text
Discovery
→ Relationship
→ Conversation
→ Intent
→ Demand / Activity / Venue Action
→ Order / Visit
→ Outcome
→ Repeat
```
