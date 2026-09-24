# Proxy PRD v1.1
## Chapter 21E — Activity Scene Commerce Contract R3 · Post Boundary

**状态**：CURRENT ACTIVITY / SOCIAL BOUNDARY CONTRACT · R3  
**替代**：R2 中未覆盖 Social Post 的部分。  
**依赖**：Chapter 21H R1

---

# 1. Activity 与 Post 是并列对象

```text
Post ≠ Activity
Activity ≠ Task
Post ≠ Task
```

Post 可以引用 Activity；Activity 不吸收 Social Feed 的评论模型。

---

# 2. 互动模型

## Post

```text
Like
Reply
Repost
Bookmark
Share
DM
```

## Activity

```text
Interested
Join
Share
Activity Q&A
Confirmed Participant Chat
Verified Participant Review
```

普通 Post Reply 不写入 Activity Q&A。

---

# 3. Post → Activity

用户或商家可以发布一条 Post 描述某个活动，并建立：

```text
PostContextRef(context_type=ACTIVITY)
```

点击活动上下文后进入 Activity Detail。

Post 被删除，不删除 Activity；Activity 取消，也不自动删除历史 Post，但 Feed 必须 hydrate 最新 Activity 状态。

---

# 4. Merchant Post

Merchant Post 可引用：

```text
Venue
Merchant Activity
Benefit
Reservation context
```

Sponsored Merchant Post 仍遵守：

```text
Relevance Before Sponsorship
```
