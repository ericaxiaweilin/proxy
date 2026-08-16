# Proxy PRD v1.1
## P0 Engineering Acceptance Addendum R7 — Local Life Network

**状态**：P0 ENGINEERING GATE  
**依赖**：Chapter 21H R1 / Chapter 21A R5 / Chapter 21G R2 / Chapter 21C R3 / Chapter 21E R3

---

# Gate A — Information Architecture

必须：

```text
Bottom Nav = 首页 / 任务 / 动态 / 我的
```

不得：

```text
Wallet 继续占一级 Bottom Nav
```

Wallet 必须可从“我的”进入。

---

# Gate B — Feed Reachability

必须真实可达：

```text
Home → Feed
Bottom Nav → Feed
Feed → Post Detail
Feed → Create Post
Feed → Profile
Feed → DM
Feed → Activity / Venue
Feed → Need / City Companion
Me → Wallet
Agent Home → Content Analytics
```

---

# Gate C — Feed Views

必须实现三个独立读取状态：

```text
RECOMMENDED
FOLLOWING
NEARBY
```

切换不得只是视觉标签不改变数据集合 / 排序。

---

# Gate D — Post Interaction

P0 Post 必须支持：

```text
Like
Reply
Repost
Bookmark
Share
Follow
Profile Open
Context Ref Open
```

Activity 不得因为新增 Post 而获得普通评论区。

---

# Gate E — Post Context / Hydration

Post 可以存引用：

```text
SERVICE_SKU
ROUTE
VENUE
ACTIVITY
```

但以下不能以 Post 字段作为业务真源：

```text
current availability
current eligibility
current price / offer
venue open state
activity capacity
```

读取时必须 Hydrate。

---

# Gate F — Conversation

必须支持：

```text
Agent Service Post → contextual service IM
User / Merchant Post → generic Network DM
```

DM 不能自动创建 Need。

当用户明确选择“整理成需求 / 按这个想法找同行”后才进入 Need 主链。

---

# Gate G — Attribution

Post / Profile / DM 产生的 Need 必须至少写：

```text
demand_origin
source_type
source_id
creator_principal_id
conversation_id? 
```

Agent 自带外部客户的一级来源不得被覆盖。

---

# Gate H — Ranking Objective

Feed 服务端排序必须允许审计以下层次：

```text
candidate_source
eligibility_result
hydrated_features
ranking_score_components
diversity / mixing decisions
sponsor state
```

不能只保留最终 score。

禁止把纯：

```text
watch time
like rate
photo CTR
```

作为唯一 / 主 North Star。

---

# Gate I — People Boundary

允许：Post → Profile。

不允许：

```text
全站 People Browser
按外貌筛人的无限目录
永久“人价签”
```

任务候选仍要求 Eligibility Before Ranking。

---

# Gate J — Agent Creator Analytics

至少显示：

```text
Qualified Conversations
Needs Created
Confirmed Cooperation
Demand Source Mix
```

不得只显示 Like / Follower vanity metrics。

---

# Gate K — Language / Runtime

Consumer Chinese build 必须保持纯中文 UI。

Runtime localization 不得修改：

```text
STYLE
SCRIPT
CODE
PRE
TEXTAREA
```

新增 Social 页面不得重新引入 CSS selector localization bug。
