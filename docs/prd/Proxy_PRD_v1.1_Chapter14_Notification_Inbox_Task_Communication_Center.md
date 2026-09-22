# Proxy PRD v1.1
## Chapter 14 — Notification / Inbox / Task Communication Center

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 06 — Fast Match / Invite / Offer Engine
- Chapter 08 — Availability / Supply Capacity
- Chapter 10 — Payment / Settlement
- Chapter 11 — Execution / Chat / Evidence
- Chapter 13 — Safety / Incident Center

**本章范围**：
- Notification Event
- Inbox
- Push
- In-app Notification
- Task Communication Center
- Chat / System / Safety Separation
- Offer Notification
- Arrival / Execution Notification
- Payment Notification
- Cancellation / Replacement Notification
- Business Multi-slot Aggregation
- Notification Priority
- Frequency Cap
- Quiet Hours
- Read / Unread
- Deep Link
- Preference
- Delivery Audit
- Deduplication
- Retry
- Metrics

---

# 1. 本章目标

Notification 系统要回答：

> **什么时候必须打扰用户，什么时候只需要留下记录，什么时候应该汇总，以及怎样让每一条消息都推动真实任务继续前进。**

Proxy 不追求：

```text
更多 Push
更多打开 App
更多红点
```

而是：

```text
更少遗漏
更快响应
更少噪音
更高 Task Completion
```

---

# 2. 三类消息必须分离

正式锁定：

```text
1. CHAT
2. SYSTEM_NOTIFICATION
3. SAFETY_ALERT
```

---

# 3. CHAT

Chat 是：

> 真人之间围绕某一个 Order / Task 的沟通。

例如：

```text
“我已经到入口 B。”
“请去前台找 Helen。”
```

Chat：

```text
human-authored
contextual
order-bound
```

---

# 4. SYSTEM_NOTIFICATION

系统消息是：

> 平台对状态变化、交易动作、时间节点的通知。

例如：

```text
Offer received
Agent accepted
Payment secured
Agent arrived
Task completed
Refund processed
```

---

# 5. SAFETY_ALERT

安全提醒是：

> 需要用户立即注意的风险 / 安全事件。

例如：

```text
Safety incident opened
Temporary contact revoked
Task stopped for safety
Operator requests action
```

---

# 6. 为什么必须分开

如果所有消息都进入一个流：

```text
Chat
Offer
Refund
Safety
Marketing
```

用户会错过真正关键事件。

因此：

> **Communication Type 必须是 Domain-level 分类，不只是 UI 标签。**

---

# 7. NotificationEvent

推荐对象：

```text
NotificationEvent
```

Schema：

```text
notification_event_id

recipient_type
recipient_id

event_type
category
priority

task_id optional
slot_id optional
order_id optional
incident_id optional
payment_id optional

title_key
body_key
template_data

deep_link

delivery_policy
dedupe_key

created_at
expires_at optional
```

---

# 8. Notification Category

推荐：

```text
OFFER
TASK
ORDER
EXECUTION
PAYMENT
REPLACEMENT
REVIEW
TRUST
BUSINESS
SAFETY
SYSTEM
CONTENT
```

Content 通知保持低优先级。

---

# 9. Priority

正式定义：

```text
P0_CRITICAL
P1_HIGH
P2_NORMAL
P3_LOW
```

---

# 10. P0_CRITICAL

只用于：

```text
Safety
Account takeover
Critical payment/security event
Execution emergency
```

特点：

```text
Push immediately
Inbox
Persistent until seen where appropriate
```

---

# 11. P1_HIGH

用于：

```text
Offer expiring soon
Agent cancellation
Replacement needed
Payment failed
Agent arrived
Task starts soon
```

通常：

```text
Push + Inbox
```

---

# 12. P2_NORMAL

用于：

```text
Order confirmed
Task filled
Completion ready
Refund completed
Review request
```

通常：

```text
Inbox
+
Push according to user preference / context
```

---

# 13. P3_LOW

用于：

```text
Content
Demand Pulse
Capability reminder
Merchant update
```

默认：

```text
Inbox / digest
```

而不是即时 Push。

---

# 14. Notification Delivery Channel

支持：

```text
IN_APP
PUSH
EMAIL
SMS
```

P0：

```text
IN_APP
PUSH
```

P1：

```text
EMAIL
SMS
```

只用于适合场景。

---

# 15. Delivery Policy

每个 Event 需要：

```text
delivery_policy
```

例如：

```text
PUSH_AND_INBOX
INBOX_ONLY
PUSH_IF_APP_BACKGROUND
CRITICAL_MULTI_CHANNEL
DIGEST
```

---

# 16. Push 不是默认答案

正式原则：

> **不是所有状态变化都 Push。**

Push 应服务：

```text
需要用户近期行动
错过会影响 Task
安全 / 钱
```

---

# 17. Inbox

Proxy 应有统一：

```text
Inbox
```

但内部分区。

建议：

```text
Action Required
Tasks
Payments
Safety
Updates
```

---

# 18. Action Required

优先显示：

```text
Offer to respond
Payment action
Completion confirmation
Replacement decision
Safety action
```

---

# 19. Inbox Item

推荐：

```text
InboxItem
```

字段：

```text
inbox_item_id
recipient_id
notification_event_id

status
priority

action_required
action_deadline optional

read_at optional
acted_at optional
dismissed_at optional

created_at
```

---

# 20. Inbox Status

```text
UNREAD
READ
ACTED
DISMISSED
EXPIRED
```

---

# 21. Read ≠ Acted

非常重要。

用户打开：

```text
Offer
```

并不代表：

```text
已处理
```

因此：

```text
read_at
```

与：

```text
acted_at
```

分开。

---

# 22. Action Deadline

需要动作的事件必须明确：

```text
Offer expires in 3 min
Confirm completion by tomorrow
Payment action required
```

---

# 23. Deep Link

所有可操作通知必须进入正确上下文：

```text
Offer
→ Offer Detail

Agent arrived
→ Order Execution

Refund
→ Payment Detail

Safety
→ Incident Center
```

不能只打开首页。

---

# 24. Task Communication Center

对一个 Task：

建议存在：

```text
Task Communication Center
```

聚合：

```text
Task Status
Slot Updates
Order Events
System Messages
Business Summary
```

不是替代 Chat。

---

# 25. Order Chat 独立

Task Communication Center：

```text
system / status
```

Order Chat：

```text
human conversation
```

二者 UI 可以相邻，但 Domain 分离。

---

# 26. Agent Inbox

建议：

```text
Matched for You
Upcoming
Execution
Earnings
Safety
```

---

# 27. Requester Inbox

建议：

```text
Matches
Task Status
Execution
Payment
Safety
```

---

# 28. Business Inbox

重点：

```text
Action Required
Task Summary
Slot Exceptions
Payment
Safety
Team Updates
```

---

# 29. Offer Notification

Agent 收到 Offer：

如果：

```text
Available Now
```

通常：

```text
P1_HIGH
Push + Inbox
```

---

# 30. Offer Notification 内容

至少：

```text
Role
Time
Approx Area
Pay
Expiry
```

不泄露：

```text
private exact address
private requester details
```

---

# 31. Offer Reminder

避免轰炸。

默认：

```text
initial push
+
max one reminder
```

如果 TTL 太短：

```text
only initial push
```

---

# 32. Offer Frequency Cap

必须和 Chapter 06 联动。

例如：

```text
max realtime offer pushes / hour
```

超出：

```text
inbox only
or
wait for next wave
```

---

# 33. Available Now 特例

Agent 主动开启：

```text
Available Now
```

表示允许更高实时通知密度。

但仍：

```text
not unlimited
```

---

# 34. Quiet Hours

用户可以设置：

```text
Quiet Hours
```

例如：

```text
22:30–07:00
```

---

# 35. Quiet Hours Override

只有：

```text
P0_CRITICAL
```

可以默认穿透 Quiet Hours。

---

# 36. Scheduled Task Exception

如果用户有：

```text
tomorrow 06:00 confirmed task
```

关键执行提醒可以按照订单上下文在 Quiet Hours 附近发送。

需要：

```text
user consent / expected execution
```

---

# 37. Task Reminder

Agent：

```text
Task tomorrow
Task in 2h
Arrival target in 30 min
```

频率应配置化。

---

# 38. Requester Reminder

Requester 不需要和 Agent 一样多的执行提醒。

可：

```text
Agent confirmed
Agent en route
Agent arrived
```

---

# 39. EN_ROUTE Notification

Requester：

```text
Your Proxy is on the way
ETA ~18 min
```

如果 ETA 不可靠：

不要展示虚假精确分钟数。

---

# 40. ARRIVED Notification

Requester / Business：

```text
Agent arrived
```

通常：

```text
P1_HIGH
```

特别适合：

```text
pickup
home visit
event role
```

---

# 41. IN_PROGRESS

不一定需要 Push。

可以只：

```text
Inbox / Order status update
```

除非 Requester 需要确认 Start。

---

# 42. Completion Notification

Agent 提交：

```text
Completion ready for review
```

Requester：

```text
P2_NORMAL
```

若存在结算时限：

可升级。

---

# 43. Auto-confirm Reminder

在 Auto-confirm 前：

最多：

```text
one reminder
```

避免多次催促。

---

# 44. Payment Notification

必须覆盖：

```text
Payment secured
Payment failed
Refund started
Refund completed
Agent earnings available
Payout completed
Payout failed
```

---

# 45. Payment Failed

需要用户行动：

```text
P1_HIGH
Push + Inbox
```

---

# 46. Payment Secured

一般：

```text
P2_NORMAL
```

Agent 可以看到：

```text
Payment Protected
```

但不一定需要单独 Push。

---

# 47. Agent Earnings Available

这是供给侧强价值信号：

```text
Your earnings are available
```

建议：

```text
P2_NORMAL
```

---

# 48. Payout Completed

Agent：

```text
P2_NORMAL
```

可只 Push 一次。

---

# 49. Payout Failed

需要处理：

```text
P1_HIGH
```

---

# 50. Cancellation Notification

Agent / Requester：

必须明确：

```text
Who cancelled
What happens next
Money impact
Replacement status
```

---

# 51. Agent Cancellation

Requester：

```text
Your Agent cancelled.
Proxy is finding a replacement.
```

如果 Replacement 已自动启动：

不要让用户先看到：

```text
任务失败
```

---

# 52. Replacement Notification

推荐分阶段：

```text
Replacement started
Replacement found
Replacement failed
```

但不要每个 Wave 都通知 Requester。

---

# 53. Replacement Wave 内部化

Requester 不需要看到：

```text
Wave 1 failed
Wave 2 sent
Wave 3...
```

只看：

```text
Finding replacement
```

避免制造焦虑。

---

# 54. Failed Replacement

如果：

```text
no viable replacement
```

必须：

```text
P1_HIGH
```

并给下一步：

```text
Adjust
Refund
Operator Help
```

---

# 55. Safety Alert

所有 Safety 事件使用专门样式 / 通道。

不要和普通：

```text
Task Update
```

混在一起。

---

# 56. Safety Alert 内容

原则：

```text
minimum necessary
action-oriented
```

例如：

```text
Safety review opened for this order.
Temporary contact access has been disabled.
```

---

# 57. 锁屏安全

Push Preview 不应显示：

```text
exact incident detail
private location
sensitive allegation
```

---

# 58. Critical Safety

P0_CRITICAL：

例如：

```text
SOS acknowledged
Account security issue
Critical incident action
```

可以：

```text
push immediately
```

P1 可增加：

```text
SMS
```

---

# 59. Business Multi-slot Notification

多人 Task 最大风险：

> 每个 Slot 发一条通知，Business 被淹没。

因此必须：

```text
aggregate
```

---

# 60. Slot Aggregation

例如：

```text
5-slot Grand Opening
```

不要：

```text
An accepted
Minh accepted
Linh accepted
...
```

可以：

```text
Grand Opening
4 / 5 positions filled
1 Greeter still needed
```

---

# 61. Exception Breakout

正常 Slot 更新聚合。

异常：

```text
No-show
Replacement needed
Safety
Payment failed
```

单独通知。

---

# 62. Business Digest

P0 可做 Task-level：

```text
5 / 5 filled
All agents confirmed
Next milestone: Saturday 17:30
```

---

# 63. Notification Aggregation Window

对短时间同类事件：

例如：

```text
3 Agents accept within 30 sec
```

合并成一条：

```text
3 positions filled
```

---

# 64. Deduplication

每个通知必须有：

```text
dedupe_key
```

例如：

```text
ORDER_123_AGENT_ARRIVED
```

重复事件不得发送多次。

---

# 65. Provider Retry

Push Provider 失败：

可以重试。

但：

```text
same event
```

不得因 Retry 产生重复 Inbox Item。

---

# 66. Delivery Record

推荐：

```text
NotificationDelivery
```

字段：

```text
delivery_id
notification_event_id
channel

status

attempt_count
provider_reference

sent_at
delivered_at optional
failed_at optional
```

---

# 67. Delivery Status

```text
PENDING
SENT
DELIVERED
FAILED
SUPPRESSED
EXPIRED
```

---

# 68. Suppressed

例如：

```text
quiet hours
frequency cap
preference disabled
duplicate
```

仍然记录：

```text
SUPPRESSED
```

方便调试。

---

# 69. User Notification Preference

设置：

```text
Offers
Task Updates
Payments
Content
Merchant Updates
```

---

# 70. 不允许关闭的类别

部分：

```text
Critical Safety
Account Security
Required Legal / Payment notice
```

不能完全关闭。

---

# 71. Content Notification

当前基础内容层：

```text
likes
comments
business post
```

P3_LOW。

默认不应挤占任务消息。

---

# 72. Content vs Marketplace Priority

如果用户同时：

```text
收到一个 Like
+
Offer expires in 2 min
```

UI 必须优先：

```text
Offer
```

---

# 73. Red Badge

不要只有一个无限增长：

```text
99+
```

建议优先显示：

```text
Action Required count
```

比所有未读更重要。

---

# 74. Unread Badge

可以：

```text
Inbox unread
```

但 Task critical action 应单独：

```text
Action badge
```

---

# 75. Notification State Source

Notification 不能自己成为交易真相。

例如：

```text
“Agent arrived”
```

只是：

```text
Order ARRIVED
```

产生的消息。

如果 Notification 丢了：

Order 状态仍然正确。

---

# 76. Event-driven Architecture

推荐：

```text
Domain Event
↓
Notification Policy
↓
Notification Event
↓
Delivery
```

---

# 77. 不允许业务服务直接拼 Push 文案

例如 Order Service 不应该：

```text
send_push("Your agent arrived")
```

而是发：

```text
ORDER_ARRIVED
```

由 Notification Domain 处理。

---

# 78. Template

通知使用：

```text
template_key
+
locale
+
template_data
```

支持：

```text
vi
en
zh
```

---

# 79. Localization

Task / Role 名称来自 Graph：

```text
localized display name
```

而不是硬编码英文。

---

# 80. User Language

Notification 优先：

```text
recipient preferred language
```

Business Workspace 可按成员个人语言。

---

# 81. Timezone

所有：

```text
deadline
task time
offer expiry
```

通知必须按：

```text
recipient local / task timezone
```

正确显示。

---

# 82. Stale Notification

如果：

```text
Offer already filled
```

用户点击旧 Push：

页面应该：

```text
This position has been filled.
```

而不是报错。

---

# 83. Notification Expiry

例如 Offer Notification：

```text
expires with offer
```

Inbox 可变：

```text
EXPIRED
```

---

# 84. Actionable Notification

如果 Item 已经处理：

```text
ACTED
```

CTA 要更新。

不能继续：

```text
Accept
```

---

# 85. Chat Notification

Chat 新消息可以 Push，

但受：

```text
order activity
mute
quiet hours
```

控制。

---

# 86. Chat Mention

Business 多成员：

P1 支持：

```text
@mention
```

只通知相关成员。

---

# 87. Business Role Routing

例如：

```text
Payment Failed
```

通知：

```text
Business Billing Admin
```

不一定通知所有 Staff。

---

# 88. Safety Role Routing

Incident：

通知：

```text
authorized Business Owner / Safety role
```

不能广播全公司。

---

# 89. Notification Security

Deep Link 打开后仍要：

```text
authorization check
```

不能因为有 Push Token 就直接访问敏感 Order。

---

# 90. Push Token

Device Push Token 属于：

```text
private technical data
```

不能用于 Candidate / Profile。

---

# 91. Multi-device

同一用户多个设备：

可以全部接收关键 Push。

已在某设备处理：

其他设备 Inbox 同步：

```text
ACTED
```

---

# 92. Notification Audit

记录：

```text
event created
policy decision
suppression
delivery
read
acted
```

---

# 93. Notification Analytics

核心：

```text
Delivery Rate
Open Rate
Action Rate
Time to Action
```

但真正重要：

```text
Offer → Accept
Reminder → Arrival
Payment Alert → Recovery
```

---

# 94. Noise Metrics

必须监控：

```text
Push per active user
Notification mute rate
Offer push decline rate
Notification disable rate
Duplicate rate
```

---

# 95. Agent Habit Metrics

```text
Available Now
→ Offer Push
→ View
→ Accept
```

---

# 96. Requester Metrics

```text
Replacement Alert
→ Action
Completion Alert
→ Confirm
Payment Failure
→ Recovery
```

---

# 97. Business Metrics

```text
Task Summary Notification
→ Open
Exception Alert
→ Resolution
```

---

# 98. Safety Metrics

```text
Critical Alert Delivery
Time to Open
Time to Protective Action
```

---

# 99. Guardrail Metrics

必须监控：

```text
Critical alert suppressed
Payment failure not delivered
Offer spam
Duplicate push
Stale actionable CTA
Sensitive info in lockscreen notification
```

---

# 100. P0 必须实现

```text
NotificationEvent
InboxItem
NotificationDelivery
Priority
Category
Push + In-app
Action Required
Deep Link
Offer notifications
Task / Order updates
Arrival / Completion
Payment alerts
Cancellation / Replacement
Safety alerts
Business slot aggregation
Deduplication
Frequency Cap
Quiet Hours
Preference
Localization
Audit
```

---

# 101. P1

```text
Email
SMS
Business digest scheduling
Chat mentions
Advanced role routing
Cross-device smart suppression
Notification preference learning
```

---

# 102. Acceptance Criteria

## AC-NOTIFY-01
Chat、System Notification、Safety Alert 必须分离。

## AC-NOTIFY-02
Notification 不得成为业务状态 Source of Truth。

## AC-NOTIFY-03
所有 Notification 必须由 Domain Event 驱动。

## AC-NOTIFY-04
P0_CRITICAL 只能用于安全 / 账户 / 严重交易事件。

## AC-NOTIFY-05
不是所有系统事件都必须 Push。

## AC-NOTIFY-06
所有需要用户行动的 Inbox Item 必须支持 action_required。

## AC-NOTIFY-07
Read 与 Acted 必须分离。

## AC-NOTIFY-08
可操作 Notification 必须 Deep Link 到正确上下文。

## AC-NOTIFY-09
Offer 必须支持 TTL / Expiry。

## AC-NOTIFY-10
Offer Reminder 必须有限制。

## AC-NOTIFY-11
必须遵守 Offer Frequency Cap。

## AC-NOTIFY-12
Available Now 可以提高实时 Offer 通知密度，但仍需上限。

## AC-NOTIFY-13
Quiet Hours 默认只允许 Critical Safety 穿透。

## AC-NOTIFY-14
Business Multi-slot 正常状态更新必须聚合。

## AC-NOTIFY-15
No-show / Replacement / Safety 等异常必须单独突出。

## AC-NOTIFY-16
Requester 不得收到内部 Match Wave 细节。

## AC-NOTIFY-17
所有 Notification 必须支持 dedupe_key。

## AC-NOTIFY-18
Provider Retry 不得创建重复 Inbox Item。

## AC-NOTIFY-19
Payment Failed 必须属于高优先级可操作通知。

## AC-NOTIFY-20
Payment Secured 不应默认制造多余 Push。

## AC-NOTIFY-21
Safety Push 不得在锁屏泄露敏感 Incident 内容。

## AC-NOTIFY-22
Content Notification 优先级不得高于交易 / Safety。

## AC-NOTIFY-23
Red Badge 应优先表达 Action Required，而非仅所有未读。

## AC-NOTIFY-24
旧 Offer Notification 点击后必须优雅处理 Stale 状态。

## AC-NOTIFY-25
通知模板必须支持多语言。

## AC-NOTIFY-26
时间必须按正确 Timezone 展示。

## AC-NOTIFY-27
Business 通知必须支持权限 / 角色路由。

## AC-NOTIFY-28
Deep Link 打开后必须重新执行授权检查。

## AC-NOTIFY-29
Notification Delivery 必须可审计。

## AC-NOTIFY-30
通知系统优化目标必须是 Time to Action / Completion，而不是 Push Open Rate 本身。

---

# 103. 本章锁定结论

1. **Chat、System Notification、Safety Alert 是三套不同通信语义。**
2. **通知系统只负责传递状态，不拥有交易真相。**
3. **真正关键的指标不是 Push 数，而是用户是否及时完成下一步动作。**
4. **Offer 要实时，但必须防 Spam。**
5. **Available Now 是允许更高实时通知密度的显式用户行为。**
6. **Business 多 Slot 必须汇总正常更新，只突出 Exception。**
7. **Payment / Cancellation / Replacement / Safety 都需要独立优先级。**
8. **Action Required 比单纯 Unread 更重要。**
9. **Quiet Hours 与 Critical Override 必须明确。**
10. **所有通知必须支持 Deep Link、去重、过期、审计、多语言。**
11. **内容消息永远不能淹没 Human Agent 真实交易消息。**
12. **Notification 最终服务 Successful Human Execution。**

---

# 104. 下一章

下一份增量 PRD：

> **Chapter 15 — Business Workspace / Multi-user / Multi-store / Human Operations**

重点解决：

```text
Business 多成员怎么协作
Owner / Admin / Task Manager / Billing / Viewer 怎么分权
一个 Business 多 Store 怎么管理
谁能发 Task
谁能确认 Agent
谁能看付款
谁能处理 Safety
多人活动怎么形成 Trusted Team
Business Dashboard 到底看什么
```

这一章会正式把 Proxy 从“个人也能发需求”推进到真正可用的 B 端 Human Operations Workspace。
