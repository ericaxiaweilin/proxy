# Proxy 信息系统工程规范 v1

> UI 母版：`Proxy_Lotus_Messaging_COMPLETE_v8.html`
> 原则：Lotus 负责成熟 IM 交互骨架；Proxy 只叠加真实业务对象，不让业务对象撕裂聊天 IA。

## 0. v8 静态验收

- Screen：**22**
- Bottom sheet：**22**
- Button：**254**
- iframe：**0**
- 重复 ID：**0**
- `getElementById()` 缺失目标：**0**
- `data-go` 缺失页面：**0**
- `data-back` 缺失页面：**0**

静态结构验收通过。下一步工程实现不能继续靠页面内部临时状态，必须统一到 Domain + Event + Read Model。

---

# 1. 核心领域对象

```text
Messaging
├─ Dialog
│  ├─ DM
│  ├─ Group
│  └─ Official
├─ Message
├─ Convo
├─ Folder
├─ MessageRequest / Mặc Kệ
├─ Pin
├─ Reaction
├─ Poll
├─ CallSession
├─ CallRecording
├─ NotificationEvent
├─ AliasIdentity
└─ SecureSession
```

## Dialog

```ts
type Dialog = {
  id: string
  type: 'dm' | 'group' | 'official'
  title: string
  avatarRef?: string
  memberIds: string[]

  folderIds: string[]
  isPinned: boolean
  isMuted: boolean
  isMacKe: boolean

  lastMessageId?: string
  latestSeq: number
  createdAt: string
  updatedAt: string
}
```

**关键：**
- 邀约不是 Dialog 类型。
- 活动不是 Dialog 类型。
- 订单不是 Dialog 类型。
- 这些东西进入聊天时统一成为 `Message.proxy_object`。
- 一个邀约接受后可以**关联**某条 Dialog，但不能创造一套“邀约聊天系统”。

---

# 2. Message Object v1

完整 JSON Schema：`Proxy_Message_Object_Schema_v1.json`

统一消息类别：

```text
text
image
video
file
location
contact
proxy_object
poll
call_recording
system_event
```

Proxy 业务卡片统一：

```ts
type ProxyObjectRef = {
  objectType:
    | 'invitation'
    | 'activity'
    | 'opportunity'
    | 'voucher'
    | 'post'
    | 'order'

  objectId: string

  // 历史消息永远可显示
  snapshot: Record<string, unknown>

  // 允许显示今天的实时状态
  liveState?: Record<string, unknown>
}
```

### 为什么 Snapshot + Live State 两层

例如用户 8 月 1 日发了一张活动卡：

```text
当时：
24 / 30 已参加
今天：
活动已结束
```

聊天历史不能因为活动数据库变化而变成空卡。

所以：

```text
snapshot = 发送当时的事实
liveState = 当前最新状态
```

Renderer 可以显示：

```text
Sunday Coffee Walk
今天 16:00
发送时 24 / 30
────────
当前：已结束
```

---

# 3. Convo

Convo 是 **Message Branch**，不是第二套 Group。

```ts
type Convo = {
  id: string
  parentDialogId: string
  seedMessageId: string
  title: string
  participantIds: string[]
  externalParticipantIds: string[]
  latestSeq: number
  createdAt: string
}
```

硬规则：

```text
Convo → 必须能找到 seedMessageId
seedMessage → 必须能反查 Convo
Convo 外部成员 ≠ 自动加入 Parent Group
```

---

# 4. Alias Identity

```ts
type AliasIdentity = {
  id: string
  ownerUserId: string
  displayName: string
  avatarRef?: string

  allowDmFrom: 'anyone' | 'shared_context' | 'contacts' | 'nobody'
  allowCallFrom: 'anyone' | 'contacts' | 'nobody'
  allowMention: boolean
  discoverableByUsername: boolean
}
```

消息发送时必须保存 **identity snapshot**。

不能只保存 `alias_id`，否则用户修改 Alias 后，历史聊天的人名会全部变化。

---

# 5. Mặc Kệ / Message Request

不是普通 Folder。

```text
陌生消息
   ↓
Message Request
   ↓
Mặc Kệ（默认静音，不计普通 Dialog unread）
   ↓
用户 Reply / Accept / Follow
   ↓
Normal Dialog
```

普通 Dialog 可以主动：

```text
Normal Dialog → Move to Mặc Kệ
```

但它不应该删除历史消息。

---

# 6. 未读模型

**不要遍历 Message 表计算 unread。**

使用 Cursor：

```ts
type ReadCursor = {
  userId: string
  dialogId: string
  lastReadSeq: number
}

unread =
  Dialog.latestSeq - ReadCursor.lastReadSeq
```

Convo 同样独立：

```ts
type ConvoReadCursor = {
  userId: string
  convoId: string
  lastReadSeq: number
}
```

## Root「信息」Badge

```text
Information Badge
 =
Normal Dialog unread
+ Convo unread
+ Action Required
+ Missed Call

不直接加：
- Mặc Kệ 普通陌生消息
- Muted Dialog
- Reaction notification
```

否则一个 Message 会同时产生：

```text
Message unread + Reaction unread + Notification unread
```

造成重复红点。

## Notification Bell

只显示事件：

```text
Reaction
Member approval
Pin changed
Contact joined
Policy / official system event
```

**Notification ≠ Message unread。**

---

# 7. Folder

Folder 只做 Dialog 分类。

```ts
type Folder = {
  id: string
  ownerUserId: string
  name: string
  dialogIds: string[]
  order: number
}
```

禁止：

```text
Folder 自己复制消息
Folder 自己保存 unread
Folder 自己建立消息表
```

Folder unread 必须派生：

```text
sum(dialog unread)
```

---

# 8. Pin

```ts
type Pin = {
  id: string
  dialogId: string
  messageId: string
  pinnedBy: string
  expiresAt?: string
  createdAt: string
}
```

支持：

```text
24h
7d
活动结束
永久
```

群组 Pin Permission 属于 Group Setting，不属于 Message。

---

# 9. Poll

Poll 是 Message Object。

```ts
type Poll = {
  id: string
  messageId: string
  question: string
  options: PollOption[]
  multipleChoice: boolean
  expiresAt?: string
}

type PollVote = {
  pollId: string
  userId: string
  optionIds: string[]
}
```

投票结果只通过 Poll Service 更新，不能编辑 Message body 来改百分比。

---

# 10. Call / Recording

```text
CallSession
├─ participants
├─ audio / video
├─ recordMode
├─ consent
├─ start/end
└─ recording
```

```ts
type CallSession = {
  id: string
  dialogId: string
  type: 'audio' | 'video'
  participantIds: string[]
  recordingRequested: boolean
  recordingConsentUserIds: string[]
  state: 'ringing' | 'active' | 'ended' | 'missed'
}
```

录音完成：

```text
Recording Ready
    ↓
生成 CallRecording
    ↓
生成 Message(kind=call_recording)
    ↓
参与者全部收到同一 Message Object
```

Convo 可以从 `call_recording message` 创建。

---

# 11. Secure Chat

普通 Message Service 与 Secure Message Service 共用 UI renderer，但不能共用明文 payload 存储。

Server 应只看到：

```text
message id
sender
recipient
ciphertext
encrypted attachment ref
TTL metadata
delivery state
```

Server 不应拥有：

```text
plaintext
解密密钥
安全媒体原文件明文
```

Secure Chat 必须独立：

```text
SecureSession
SecureKey
SecureReadCursor
SecureAttachment
```

不是：

```text
Message.security=true
然后明文继续进普通 messages 表
```

---

# 12. API v1

```text
# Dialog
GET    /v1/dialogs
POST   /v1/dialogs/dm
GET    /v1/dialogs/:id
POST   /v1/dialogs/:id/read
POST   /v1/dialogs/:id/move-to-macke

# Message
GET    /v1/dialogs/:id/messages
POST   /v1/dialogs/:id/messages
PATCH  /v1/messages/:id
DELETE /v1/messages/:id

# Reaction
PUT    /v1/messages/:id/reactions/:emoji
DELETE /v1/messages/:id/reactions/:emoji

# Forward
POST   /v1/messages/:id/forward

# Pin
GET    /v1/dialogs/:id/pins
POST   /v1/messages/:id/pin
DELETE /v1/messages/:id/pin

# Convo
GET    /v1/convos
POST   /v1/messages/:id/convos
GET    /v1/convos/:id/messages
POST   /v1/convos/:id/messages
POST   /v1/convos/:id/read

# Group
POST   /v1/groups
GET    /v1/groups/:id/members
POST   /v1/groups/:id/member-requests/:requestId/approve
POST   /v1/groups/:id/member-requests/:requestId/reject
PATCH  /v1/groups/:id/settings

# Poll
POST   /v1/dialogs/:id/polls
PUT    /v1/polls/:id/vote

# Calls
POST   /v1/calls
POST   /v1/calls/:id/answer
POST   /v1/calls/:id/end
POST   /v1/calls/:id/recording-consent
GET    /v1/calls/history

# Folder
GET    /v1/folders
POST   /v1/folders
PATCH  /v1/folders/:id

# Requests
GET    /v1/message-requests
POST   /v1/message-requests/:id/accept
POST   /v1/message-requests/:id/ignore

# Notification
GET    /v1/notifications
POST   /v1/notifications/read

# Secure
POST   /v1/secure/sessions
POST   /v1/secure/sessions/:id/messages
POST   /v1/secure/sessions/:id/read
DELETE /v1/secure/sessions/:id
```

---

# 13. Realtime Events

建议 WebSocket / SSE 统一事件格式：

```ts
type RealtimeEvent<T> = {
  eventId: string
  type: string
  seq: number
  occurredAt: string
  payload: T
}
```

事件：

```text
message.created
message.updated
message.deleted
message.read

reaction.changed
pin.changed

convo.created
convo.message.created
convo.read

poll.updated

dialog.updated
dialog.moved_to_macke

group.member_requested
group.member_approved
group.member_removed

call.ringing
call.started
call.ended
call.recording_ready

notification.created
```

---

# 14. 最重要的数据一致性规则

### 规则 1
`Message` 是聊天事实真源。

### 规则 2
`Notification` 只是事件提醒，不复制业务事实。

### 规则 3
`Folder` 只是视图，不复制 Dialog。

### 规则 4
`Convo` 必须挂 seed Message。

### 规则 5
Proxy 业务对象在聊天里只存：

```text
object ref + historical snapshot
```

不复制业务数据库。

### 规则 6
所有 unread 都使用 seq/cursor，不做全表 count。

### 规则 7
Secure Chat 的服务端永远不持有 plaintext。

---

# 15. Proxy 五 Root 接入

```text
首页 / 市场 / 动态 / 信息 / 我的
                   │
                   └─ Messaging Domain
```

入口关系：

```text
Person Profile
 ├─ 消息 ───────────→ DM Dialog
 └─ 邀约 ───────────→ Invitation
                       ↓ accepted
                     DM Dialog

Dynamic
 └─ 分享 / 作者消息 ─→ Dialog

Market / Activity
 └─ Activity Group ──→ Group Dialog

Market / Opportunity
 └─ 联系 / 响应 ─────→ Dialog

Voucher / Order
 └─ Share ───────────→ proxy_object Message
```

**信息 Root 本身不负责创建业务状态。**
它负责把业务状态变成人能沟通和继续行动的上下文。

---

# 16. 前端 Renderer

最后前端不应该写：

```ts
if (message.invitation) ...
else if (message.activity) ...
else if ...
```

应该统一：

```ts
<MessageRenderer message={message} />
```

内部：

```text
text            → TextMessage
image/video     → MediaMessage
file            → FileMessage
proxy_object    → ProxyObjectMessage
poll            → PollMessage
call_recording  → CallRecordingMessage
system_event    → SystemEventMessage
```

`ProxyObjectMessage` 再按 `object_type` 选择业务卡 Renderer。

这样 Proxy 再新增一种市场对象，不需要改 Chat 核心。
