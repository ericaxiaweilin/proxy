# Proxy PRD v1.1
## Chapter 21A — Requester Experience Loop R5 · Local Network

**状态**：CURRENT REQUESTER UX CONTRACT · R5  
**替代**：Chapter 21A R4 中与一级导航、首页与 Network 入口冲突的部分。  
**依赖**：Chapter 21H R1 / Chapter 21G R2

---

# 1. 一级导航

```text
首页 / 任务 / 动态 / 我的
```

Wallet 从 Bottom Nav 移除，进入“我的 → 钱包与结算”。

原因：

- Personal Human Service 大量允许 Direct Settlement；
- Wallet 不是高频 Discover / Execute 入口；
- Feed / Network 对订单生成和日常本地生活频率更重要。

---

# 2. Home ≠ Feed

首页只给：

```text
Primary Need CTA
Things needing action
Upcoming
Repeat
2–3 个高相关 Local Network teaser
```

禁止首页变成第二个无限 Feed。

---

# 3. Dynamic / Feed

P0：

```text
推荐 / 关注 / 附近
```

Post 支持：

```text
关注
喜欢
回复
转发
收藏
分享
主页
私信
上下文跳转
```

---

# 4. Post → Conversation → Need

典型路径：

```text
看到 Linh 路线 Post
→ 聊一下
→ City Companion IM
→ 讨论节奏 / 时间 /价格
→ Cooperation Confirmation
```

或：

```text
看到普通用户咖啡 Post
→ 私信
→ 决定参加 Activity
```

聊天本身不创建订单。

---

# 5. “整理成需求”是显式动作

当用户在聊天中已经形成明确需求，Proxy 可以提示：

```text
要不要把这个想法整理成一次需求？
```

用户确认后才创建 / 更新 Need Draft。

不得：

- 自动把普通聊天变成订单；
- 自动改变价格；
- 自动把社交关系变成 Task。

---

# 6. Profile UX

用户可以从 Post 进入 Profile。

Profile 可以展示：

- 作者内容；
- 公开 Bio；
- Follow；
- 当前相关 Service SKU；
- Service CTA。

不得提供全站 People Directory 或裸的人物价格墙。

---

# 7. Wallet Secondary IA

“我的 → 钱包与结算”展示：

```text
Platform wallet balance
Platform-paid earnings
Refunds
Direct-settlement record / confirmation
```

Direct Settlement 人工费不得伪装成平台托管余额。
