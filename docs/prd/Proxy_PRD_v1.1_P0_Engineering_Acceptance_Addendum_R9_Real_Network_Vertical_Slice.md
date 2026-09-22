# Proxy PRD v1.1
## P0 Engineering Acceptance Addendum R9 — Real Network Vertical Slice

**状态**：P0 ENGINEERING GATE  
**依赖**：Canonical Registry R2.5 / Chapter 21I R1 / Acceptance R8

---

# Gate A — No Prototype Truth in Production

生产系统不得把以下作为业务真源：

```text
localStorage
hard-coded candidate seed
hard-coded social post seed
front-end only order state
front-end only availability
front-end generated fake distance
```

页面可以有 loading skeleton / demo fixture，但生产路径必须从服务端真源读取。

---

# Gate B — Persistent Canonical IDs

以下对象必须使用持久化唯一 ID：

```text
principal_id
agent_profile_id
post_id
conversation_id
message_id
need_id
task_id
task_slot_id
candidate_batch_id
offer_id
order_id
outcome_id
event_id
lineage_id
```

不得使用数组 index 或 UI route name 作为业务 ID。

---

# Gate C — Post → Conversation

必须验证：

```text
published Post
→ open Profile
→ start Conversation
```

Conversation 必须保存 `origin_type / origin_id`。

同一个 Post 被不同用户发起 DM 时，Conversation 独立。

---

# Gate D — Conversation → Need Is Explicit

必须：

- 普通 Message 不创建正式 Need；
- 可创建 `Need Draft`；
- 用户明确确认后才产生正式 Need；
- Conversation origin 保留；
- 生成 Need 后 Conversation 不丢失。

---

# Gate E — Eligibility Before Ranking

所有 Candidate 必须：

```text
identity / service state
capability eligibility
availability
time feasibility
market / location feasibility
safety gate
```

先通过后才能进入 ranking。

没有真实合格人选时返回 shortage，不得展示假候选。

---

# Gate F — LocalContext Isolation

继续满足 R8：

```text
LocalContext
!= Task Location
!= Meeting Point
!= ExactLocationGrant
```

切换浏览城市不得修改已存在 Need / Task / Order 真相。

---

# Gate G — Order Confirmation Snapshot

Order 创建前冻结至少：

```text
requester
agent
service SKU
need version
route version / reference
duration
time
meeting context
agreed compensation
included / excluded scope
settlement mode
```

Order 之后 Material Change 必须产生新版本 / amendment，不得静默覆盖。

---

# Gate H — Direct Settlement Isolation

`DIRECT_SETTLEMENT`：

- 不创建 Platform Funding 假记录；
- 不创建虚假的平台已收款状态；
- 双方确认“已付 / 已收”是声明信号，不等于平台物理验证现金；
- Platform Pay Ledger 与 Direct Settlement 必须隔离。

---

# Gate I — Event Day 1

从第一个测试用户开始，关键事件必须入流。

至少覆盖：

```text
Post impression
Profile open
DM start
Need create
Candidate batch
Candidate view
Cooperation confirm
Order confirm
Execution complete
Outcome final
Repeat
```

Event 写失败不得导致已确认 Order 回滚，但必须可重试 / 进入观察队列。

---

# Gate J — Attribution Immutable Origin

首次归因来源必须可追踪。

允许补充后续 touchpoint，不允许把：

```text
AGENT_OWNED
```

偷偷改成：

```text
PROXY_OWNED
```

Original acquisition source 必须保留。

---

# Gate K — Real-Time IM Minimum

至少支持：

```text
send
receive
history
read cursor / read state
reconnect
message idempotency
```

重复发送 / 重连不得生成重复 Message。

---

# Gate L — Feed Truth

Feed Hydration 中：

```text
availability
current service
merchant state
activity capacity
distance
```

必须读取当前真源。

Post 本体不得成为这些实时事实的真源。

---

# Gate M — Ops Audit

所有运营写操作必须记录：

```text
operator
action
target
reason
before state
after state
timestamp
```

Ops 不得无审计地直接改生产事实。

---

# Gate N — Traceable Human Order Test

发布前必须有自动 + 人工联合验收：

```text
real Post
→ real DM
→ real Need
→ real Candidate
→ real Order
→ real execution
→ Outcome
```

最终输出完整 lineage，且每一跳都有 ID 可回查。
