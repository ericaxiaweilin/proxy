# Proxy R13 — Local Life Network UI / PRD Alignment

**Prototype**：`Proxy_P0_Prototype_R13_Local_Life_Network_CN.html`

---

# 1. R13 主要 UI 变化

```text
R12: 首页 / 任务 / 钱包 / 我的
R13: 首页 / 任务 / 动态 / 我的
```

Wallet：

```text
我的 → 钱包与结算
```

---

# 2. 新增 Screens

| Screen | Contract |
|---|---|
| `postfeed` | Chapter 21H §8 · Recommended / Following / Nearby |
| `postdetail` | Chapter 21H §6 · Reply / Social interactions |
| `postcreate` | Chapter 21H §4 · durable Post + context refs |
| `socialprofile` | Chapter 21H §5 · Post → Profile without People Directory |
| `networkchat` | Chapter 21H §7 · Post → generic DM |
| `agentcontentanalytics` | Chapter 21C R3 · content → demand analytics |
| `feedops` | Chapter 21H §8 / Acceptance R7 · feed pipeline |

---

# 3. 新增主链

## Agent Service Content

```text
Feed
→ Linh Post
→ Chat
→ City Companion
→ Cooperation Confirmation
```

## User Local Activity Content

```text
Feed
→ User Post
→ Network DM
→ Activity
```

## Merchant Content

```text
Feed
→ Merchant Post
→ Venue / Merchant Activity
→ attributed commerce intent
```

---

# 4. Prototype Data Flow

新增状态：

```text
appState.social
appState.demandAttribution
```

`social` 负责原型交互：

```text
feedTab
liked
bookmarked
reposted
following
replies
dmThreads
userPosts
selectedPost
selectedProfile
```

`demandAttribution` 演示：

```text
origin
sourceType
sourceId
creatorId
conversationId
```

生产实现必须按 Chapter 21H 拆成服务端对象 / 事件，不得直接复制前端 demo state 作为数据库 schema。

---

# 5. Home Alignment

R13 首页新增少量 Local Network teaser，但不变成第二个 Feed。

完整 Feed 始终进入：

```text
动态
```

---

# 6. Existing Contracts Preserved

R13 未取消：

```text
Task First for paid execution
Eligibility Before Ranking
Activity / Task separation
Direct Settlement for eligible personal services
City Companion pre-deal IM
Outcome / Satisfaction / Memory
Merchant relevance before sponsorship
```
