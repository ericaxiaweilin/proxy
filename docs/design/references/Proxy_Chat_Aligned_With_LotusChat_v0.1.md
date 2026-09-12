# Proxy Chat — 对齐 Lotus Chat 的设计 RFC v0.1

> ## ⚠️ 合规声明（2026-09-12 追加，先读这段）
>
> 本文原始版本通篇以性交易中介及其从业者作为用户画像来描述功能
> （"目标用户与其有大量行为重叠"、"他们看到'加密'就信了"），并把
> 销毁身份清空全部会话写成验收场景。
>
> **这段措辞是本仓库最危险的合规物证** —— 在越南法域下，它会被读成
> 一份经营意图说明，而不是口误。相关术语已于 2026-09-12 全局替换为中性词
> （服务者 / 从业者），并在门禁中永久禁词（COMP-CHAT-001）。
>
> **功能层面的硬性约束（不得回退）**：
> 1. 付费会话（OriginType TASK/SERVICE/ACTIVITY/NEED/OFFER/ORDER）
>    禁用阅后即焚、查看上限、防截屏 —— 服务端强制，客户端不可覆盖。
> 2. 自毁身份（BURNER）**不得**对盈利账号开放，且与电商法 122/2025
>    「禁止匿名销售」冲突（COMP-ID-001，实现待补）。
> 3. 销毁身份不得清空任何已产生交易的会话 / 消息 / 媒体。
>
> 对齐 Lotus 的隐私能力本身保留，但**只适用于社交会话**，不是交易链路。

> **状态**：DRAFT（待 review）
> **作者**：Proxy 设计/工程协作
> **日期**：2026-08-29
> **目标读者**：Proxy 移动端 / 后端 / 设计

## 0. 背景与定位

### 0.1 我们要解决的真问题

Proxy 当前的 Chat 模块（`apps/api-go/internal/conversation/` + `apps/mobile/src/surfaces/{conversation,messages}.tsx`）是**带 origin 语境的业务对话** —— 绑 HOME / TASK / POST / PROFILE / ORDER / SCENE 等。设计目的是"让对话有商业结果"。

但产品现实是：**Proxy 是一个撮合社交**（市场撮合 + 社交 + 轻任务），不是严肃的"工作 IM"。我们的目标用户（Requester / Agent / Business）和东南亚社交型 messenger 用户（特别是越南本地撮合类 messenger 的使用习惯）有大量行为重叠：

- 用 chat 议价、约时间、传图
- 多个独立圈子（工作 / 私人 / 副业）之间**不想被打通**
- 群发"今晚有空"给一组熟客
- 极端敏感场景：内容外传、对方截图、事后清痕迹

### 0.2 为什么对齐 Lotus Chat

**Lotus Chat**（VCCorp，越南，2024-10 至今）已用真实数据验证了一套"东南亚社交 messenger"打法：

- 1 年内冲到 App Store VN Social **#3**，2025-12 用户接近 **2M**
- App Store 评分 3-4 但下载量爆发 —— 说明"装来用"和"愿意评高分"是两件事
- 它的核心不是加密技术，是 **4 个让越南用户愿意装、愿意留的体验策略**

我们的 Chat 模块**不需要做成 messenger**，但**应该吸收 Lotus 验证过的模式**，理由：

1. **别人验证过的模式** —— 越南市场已为 Lotus 投票
2. **东南亚 messenger 用户的"心理预期"已被 Lotus 塑造** —— 我们的用户装上 Proxy 后会**自动拿 Proxy 和 Lotus / Zalo / Telegram 对比**
3. 我们**不需要做全 messenger** —— 只做 Lotus 的 4 件事 + 反向的 4 件事

### 0.3 这份 RFC 的边界

**做**：

- 身份层：多身份切换（基于现有 `LoginIdentity` 扩展）
- 消息层：每条消息独立的防外传策略（防转发 / 防截图 / 截图告警 / 阅后即焚）
- 加密层：传输 + 静态 + 营销包装（"让人觉得安全"，不是"密码学家认可"）
- 清理策略：30 天默认 TTL，可调
- 设备策略：最多 2 设备，新登录踢旧

**不做**（明确边界，避免 scope creep）：

- ❌ 真 E2EE（Signal 协议）—— 服务端无审计能力 + 3-4 周工程 + 法律风险
- ❌ 通话录音 —— 吓跑普通用户
- ❌ Convo 群内子话题 —— 服务者群是广播式
- ❌ Két sắt 加密文件柜 —— 用户证据不放 App 内
- ❌ Lota AI / 阴阳历助理 —— 服务者不信 AI 推荐
- ❌ 桌面客户端 / 4 平台矩阵 —— 服务者只玩手机
- ❌ 永久云存 / 1GB 文件 —— 服务者巴不得消息消失
- ❌ 默认防骚扰 / 默认群邀请拦截 —— 反着做

---

## 1. 改动总览

| # | 改动 | 工作量 | 优先级 |
|---|---|---|---|
| 1 | `LoginIdentity → DisplayIdentity`（多身份） | 3 天 | P0 |
| 2 | `Message.Protection` 字段（防外传四件套） | 2 天 | P0 |
| 3 | RN 防截屏 overlay + 截屏检测 | 2 天 | P0 |
| 4 | 服务端 KMS 静态加密 + 端到端 badge | 1.5 天 | P0 |
| 5 | `Message.default_ttl` 30 天清理 | 1 天 | P1 |
| 6 | `Session.max_devices = 2` + 旧设备自动踢 | 0.5 天 | P1 |
| 7 | RN UI：身份切换器 + 会话内"防外传"开关 | 3 天 | P0 |
| 8 | 营销文案 + 设置页"安全"区块 | 0.5 天 | P2 |

**总工作量：~ 13.5 工日 / 1 个工程师**（含联调、测试、写测试用例）。

---

## 2. 改动 #1：多身份切换（`DisplayIdentity`）

### 2.1 现状

`apps/api-go/internal/identity/` 已经有：

- `UserAccount` —— 一个手机号背后的人
- `LoginIdentity` —— UserAccount 可以绑多个（手机、邮箱、不同设备）
- `Session` —— 一个设备一个 session

**问题**：所有 LoginIdentity 共享同一个"对外形象"（`Profile` 模块），没有"工作身份"和"私人身份"的概念。

### 2.2 设计

**核心抽象**：`DisplayIdentity`（显示身份）—— 一个 UserAccount 可以创建 N 个"显示身份"。

```
UserAccount (真实的人)
  ├─ LoginIdentity "real" (手机号, 真实)  // 用于登录
  └─ DisplayIdentity[] (对外形象)
       ├─ "工作号"  - 默认对陌生客户显示
       ├─ "私人号"  - 仅熟人可见
       └─ "备用号"  - 短期活动用 —— ⚠️ 合规风险项，见 COMP-ID-001：
                      盈利账号禁用，且与电商法 122/2025 实名要求冲突
```

**`DisplayIdentity` 字段**：

```go
type DisplayIdentity struct {
    ID          string    // did_<random>
    OwnerID     string    // UserAccount.ID
    Alias       string    // "工作号" / "私人号" / 用户自定义
    DisplayName string    // 服务者在客户面前显示的名字（"Linh"、"Mai"）
    AvatarRef   string    // 头像（可每个身份独立）
    Visibility  string    // "PUBLIC" | "PRIVATE" | "BURNER"
    CreatedAt   time.Time
    BurnedAt    *time.Time // 销毁时间（仅 BURNER 类型）
    // PUBLIC：对所有人都可见
    // PRIVATE：仅在"已知联系人"白名单内可见
    // BURNER：默认对所有人可见，X 天后自动销毁 + 不可恢复
}
```

**`Conversation` 改造**：

```go
type Conversation struct {
    // ... existing fields
    DisplayIdentityID string  // 这个会话用哪个 DisplayIdentity 发起/接收
    // 切换 DisplayIdentity = 整个 App 上下文切：会话列表、未读、好友列表
}
```

**命令包新增**：

- `identity.create_display_identity`
- `identity.switch_display_identity`
- `identity.burn_display_identity`（销毁 + 清空相关 Conversation）

### 2.3 数据隔离规则

切换 DisplayIdentity 后，**以下上下文整体切换**：

- 会话列表（只看到该 DisplayIdentity 参与的 Conversation）
- 未读数（按 DisplayIdentity 维度）
- 好友 / 联系人列表
- 媒体素材库（`internal/media/` 现有结构需加 `OwnerDisplayIdentityID` 字段）
- 设置页（每个身份独立配置"防外传默认值"）

**实现方式**：客户端本地状态切换 + 服务端 `command.Principal` 加 `DisplayIdentityID`，所有命令带此字段做权限隔离。

### 2.4 比 Lotus 强的地方

Lotus 的 Bí Danh 只能"进群时换名"——**不能跨会话切换**。
Proxy 应该做成**整个 App 切身份**——这是我们的差异化。

---

## 3. 改动 #2：消息级防外传（`Message.Protection`）

### 3.1 现状

`apps/api-go/internal/conversation/service.go` 的 `Message`：

```go
type Message struct {
    ID             string
    ConversationID string
    SenderID       string
    MessageType    string  // TEXT | IMAGE | SYSTEM_CONTEXT | STRUCTURED_SUGGESTION
    Body           string
    MediaRef       string
    CreatedAt      time.Time
    EditedAt       *time.Time
    DeletedAt      *time.Time
}
```

**没有防外传字段**。

### 3.2 设计

```go
type MessageProtection struct {
    // 防转发
    Forwardable bool `json:"forwardable"`       // 能否被转发（默认 false）
    Copyable    bool `json:"copyable"`          // 能否被复制文本（默认 false）

    // 防截图
    ScreenshotProtected bool `json:"screenshotProtected"` // RN overlay 防截屏
    ScreenshotWarn      bool `json:"screenshotWarn"`      // 检测到截屏 → push 通知发送方

    // 阅后即焚
    ViewLimit   int  `json:"viewLimit,omitempty"`   // 最多看 N 次（0 = 无限）
    ViewCount   int  `json:"viewCount"`              // 已看次数
    TTLDuration time.Duration `json:"ttlDuration,omitempty"` // X 秒后从对方设备消失
    ExpiresAt   *time.Time `json:"expiresAt,omitempty"`     // 服务端硬过期时间

    // 加密标记（营销用）
    EndToEndEncrypted bool `json:"endToEndEncrypted"` // 永远 true（前端展示 🔒）
}
```

添加到 `Message`：

```go
type Message struct {
    // ... existing
    Protection MessageProtection `json:"protection"`
}
```

### 3.3 默认值（系统级策略）

| MessageType | Forwardable | ScreenshotWarn | ViewLimit | TTLDuration |
|---|---|---|---|---|
| TEXT (DM) | `false` | `true` | 0 | 30 天 |
| IMAGE (DM) | `false` | `true` | 3 | 30 天 |
| VIDEO (DM) | `false` | `true` | 1 | 30 天 |
| LOCATION (DM) | `false` | `true` | 1 | 1 小时 |
| TEXT (GROUP) | `true` | `false` | 0 | 30 天 |
| IMAGE (GROUP) | `true` | `true` | 0 | 30 天 |

> **关键决策**：群消息默认可转发（避免破坏群协作），私聊默认不可转发（保护隐私）。
> 用户可在会话设置里覆盖默认。

### 3.4 服务端行为

- **ServerGuardedForwards**：转发消息前 check `Protection.Forwardable` → 否则返回 `PROTECTION_VIOLATION` 错误
- **ScreenshotDetectHandler**：客户端发 `EVENT_SCREENSHOT_DETECTED` 事件 → 服务端 push `SECURITY_ALERT` 给发送方
- **TTLCleanupWorker**：定时任务，每天扫 `expires_at < now()` 的消息，标记为 `ExpiredAt`，前端不再展示 + 对象存储中的 media 删除
- **ViewCountIncrement**：每次 GET message 时 `view_count++`，达到 `view_limit` 时返回 `VIEW_LIMIT_EXCEEDED` 给客户端

### 3.5 比 Lotus 强的地方

Lotus 的防外传是"会话级开关"——"整段对话都禁"或"都开"。
Proxy 应该做成**每条消息独立策略**——"这条图能转、那张图不能转、看完就毁"。

---

## 4. 改动 #3：RN 防截屏 + 截屏检测

### 4.1 iOS

```typescript
// apps/mobile/src/lib/screenshot-protection.ts
import { NativeModules, Platform } from "react-native";
import { useEffect } from "react";

// iOS: 监听 UIApplication.userDidTakeScreenshotNotification
// Android: 监听 Window.OnFrameMetricsAvailableListener
// 检测到截屏 → 上报 + 在 UI 上加短暂"截图提示"气泡
```

- **iOS 防截屏**：iOS 13+ 有 `UIScreen.isCaptured` 监听（用户在录屏时触发），但**没有 API 直接阻止截屏**——只能用"检测后告警"+"overlay 隐私模式"
- **Android 防截屏**：`WindowManager.LayoutParams.FLAG_SECURE` 可以**直接阻止**截屏和录屏

### 4.2 Android FLAG_SECURE

```typescript
// 进入"防截屏"消息时设置
if (Platform.OS === 'android' && message.protection.screenshotProtected) {
  NativeModules.ScreenProtection.enable();
}
// 离开时关闭
NativeModules.ScreenProtection.disable();
```

**这是 Android 的"硬"防截屏** —— 用户按截屏键 = 出黑屏。**iOS 没有这个 API**，只能软告警。

### 4.3 截屏告警流程

```
[对方] 截屏
   ↓
[iOS: NSNotification / Android: FrameMetrics]
   ↓
[RN] 检测到 → 调用 POST /v1/events/screenshot-detected
   ↓
[Server] push notification 给消息发送方
   ↓
[发送方 App] 看到 "对方在 14:23 截了您发的图片"
```

---

## 5. 改动 #4：营销级加密（不是真 E2EE）

### 5.1 真实加密现状

- **传输**：所有 API 已走 TLS（HTTPS）—— 默认安全
- **静态**：PostgreSQL 是明文，对象存储是明文
- **Session Token**：JWT 已经在用

### 5.2 改动

**PostgreSQL**：

```go
// apps/api-go/internal/platform/postgres/conversation_messages.go
// 新增：conversation_messages.body_ciphertext (BYTEA, nullable)
// 新增：conversation_messages.body_iv (BYTEA, nullable)
// body_ciphertext 为空 = 旧数据 / 未加密
// 写入时用 AES-256-GCM，key 来自 KMS
```

**对象存储**（`internal/media/`）：

```typescript
// 上传时：
// 1. 客户端 → 服务端（TLS）
// 2. 服务端用 SSE-KMS 加密
// 3. 写到 S3-compatible storage
// 4. 返回的 URL 是预签名 + 短期（默认 1 小时）
```

**密钥管理**：

- 用 AWS KMS / GCP KMS / 自建 HSM（生产环境）
- 开发环境用本地 `crypto/aes` + 启动时随机 key（够用，不进生产）
- 切换不复杂，1 天搞定

### 5.3 营销包装

**设置页 → "安全" 区块**：

```
┌─────────────────────────────────────┐
│  🔒 端到端加密                       │
│                                     │
│  所有消息、照片、语音均使用军用级    │
│  AES-256 加密。                     │
│                                     │
│  [查看安全白皮书]                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  🛡️ 防截图提醒                       │
│                                     │
│  您发送的图片和位置，对方截图时您将  │
│  立即收到通知。                     │
│                                     │
│  [开] ✓                             │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  👤 多身份模式                       │
│                                     │
│  当前身份：工作号 (Linh)            │
│  [切换] [管理身份]                  │
└─────────────────────────────────────┘
```

**会话内**：

每条消息气泡右下角小图标 `🔒`，hover 显示 "端到端加密"。

**这是"让人觉得安全"** —— 服务者 / 从业者不会真的去验证 AES-256 是真是假，他们看到"加密" + "军用级" + 🔒 就信了。

### 5.4 不做真 E2EE 的理由

| 真 E2EE 的代价 | 对 Proxy 的影响 |
|---|---|
| 服务端无审计 | 反诈 / 反未成年人 / 反人口贩运做不了 |
| 多端同步复杂 | 服务者换手机 = 历史消息全丢（用户骂街） |
| Group key 分发 | 工程量翻倍 |
| 法律风险 | 平台出事我们要担全责（因为"我们看不到内容"） |
| 服务者 / 从业者不验证 | **ROI = 0** |

---

## 6. 改动 #5：30 天默认 TTL

### 6.1 现状

Message 的 `CreatedAt` 永久保留，没有自动清理。

### 6.2 设计

- 全局配置 `Message.DefaultRetentionDays = 30`（可在 settings 调 7/30/90/365）
- 每条 Message 写入时计算 `ExpiresAt = CreatedAt + DefaultRetentionDays`
- 后台 worker 每天扫 `expires_at < now()` 的消息：
  - DB 标记 `ExpiredAt`
  - 对象存储中关联的 media 删除
  - 列表查询过滤 `WHERE expired_at IS NULL`

### 6.3 例外

- SCENE / ORDER / VOUCHER origin 的消息**不清理**（业务证据）
- 用户标记 ⭐️ 的消息**不清理**
- 用户在 `DisplayIdentity` 销毁时**所有相关消息立即清**

---

## 7. 改动 #6：设备数限制 = 2

### 7.1 现状

`Session` 没有设备数限制。

### 7.2 设计

```go
// apps/api-go/internal/identity/service.go
const MaxConcurrentSessions = 2  // 配置项

func (s *Service) createSession(...) command.Result {
    // ...
    activeSessions, _ := s.repository.ListActiveSessions(ctx, userAccount.ID)
    if len(activeSessions) >= MaxConcurrentSessions {
        // 自动踢掉最旧的
        oldest := activeSessions[0]  // 按 LastActiveAt 升序
        s.repository.RevokeSession(ctx, oldest.ID, "AUTO_EVICT_NEW_LOGIN")
    }
    // ...
}
```

**配套 UI**：

- 设置页 → "我的设备" 列出当前 2 个设备
- "登出此设备" / "登出其他设备" 按钮
- 新设备登录成功时 push 通知给其他设备（"您的新设备已登录，旧设备将在 5 秒后下线"）

---

## 8. 改动 #7：UI 改动

### 8.1 顶部：身份切换器

```
┌─────────────────────────────────────┐
│  💼 工作号 (Linh)          [切换 ▾] │
├─────────────────────────────────────┤
│  会话列表...                         │
└─────────────────────────────────────┘
```

点 [切换] → 弹出 Bottom Sheet：

```
┌─────────────────────────────────────┐
│  切换身份                            │
├─────────────────────────────────────┤
│  ⦿ 工作号 (Linh)      [当前]       │
│  ○ 私人号 (An)                      │
│  ○ 备用号 (Mai)        7天后自动销毁 │
│                                     │
│  [+ 新建身份]                       │
└─────────────────────────────────────┘
```

**整个 App 上下文随之切换**（会话列表、未读、好友、素材库、设置）。

### 8.2 会话内：每条消息的"防外传"标记

发图时，长按图片 → 弹出"发送选项"：

```
┌─────────────────────────────────────┐
│  发送图片                            │
├─────────────────────────────────────┤
│  🔒 禁止转发            [开 ✓]      │
│  📸 截图时通知我        [开 ✓]      │
│  ⏱️ 阅后即焚            [1次]        │
│  ⏰ 多久后销毁          [30 天]      │
│  🔐 端到端加密          [始终开启]   │
└─────────────────────────────────────┘
```

> 注意：用户**很少真的去点这个**——所以默认值就是"防外传"的（参见 §3.3 表）。

### 8.3 会话设置页：全局防外传默认值

```
┌─────────────────────────────────────┐
│  对话安全                            │
├─────────────────────────────────────┤
│  🛡️ 防外传模式                      │
│  对 [Linh] 发送的所有消息默认：      │
│                                     │
│  [ ● 强保护 ]  禁止转发 + 截图通知  │
│  [ ○ 标准 ]    群消息可转发         │
│  [ ○ 关闭 ]                          │
│                                     │
│  ⏱️ 消息保留时间      [30 天 ▾]     │
│  📱 当前设备：iPhone 15 (此设备)    │
│  [登出其他设备]                     │
└─────────────────────────────────────┘
```

### 8.4 不做的 UI（避免 scope creep）

- ❌ 加密详情 / 密钥指纹展示页（用户不看）
- ❌ 通话录音 UI
- ❌ 加密文件柜
- ❌ AI 助理入口

---

## 9. 测试计划

### 9.1 单元测试

- `apps/api-go/internal/identity/display_identity_test.go`
  - 创建/切换/销毁 DisplayIdentity
  - 跨 DisplayIdentity 隔离
  - 越权访问（用户 A 的 DisplayIdentity 不能被用户 B 用）
- `apps/api-go/internal/conversation/message_protection_test.go`
  - 防转发拒绝
  - ViewLimit 计数
  - TTL 过期
  - 截图告警事件触发

### 9.2 集成测试

- `apps/api-go/internal/conversation/integration_test.go`
  - 多 DisplayIdentity 切换后 Conversation 列表正确
  - TTL worker 跑完后过期消息不可见

### 9.3 移动端测试

- `apps/mobile/src/lib/screenshot-protection.test.ts`
  - 截屏事件 → 上报 → server 收到
- `apps/mobile/src/surfaces/messages.test.tsx`
  - 切换 DisplayIdentity → 会话列表切

### 9.4 验收（E2E）

> ⚠️ **本节原有验收用例以性交易中介及其从业者命名目标场景。**
> 该措辞把产品定位描述成服务性交易中介，是本仓库最危险的合规物证
> （近乎一份经营意图说明），已重写。功能本身不变，但**不得**用于
> 付费见面链路 —— 见 COMP-CHAT-001（付费会话保留可审计记录）与
> COMP-ID-001（盈利账号禁用自毁身份）。

- 服务者场景：创建"工作号" → 客户发消息看到 "Linh" → 服务者切"私人号" → 客户发的消息不在"私人号"会话列表里
- 内容保护场景（**仅限社交会话**，付费会话已由服务端禁用）：发图给好友 → 设"阅后即焚 1 次" → 对方看 1 次 → 第二次 GET 返回 `VIEW_LIMIT_EXCEEDED`
- 身份停用场景：**仅限从未产生交易的账号**；已产生交易的账号，销毁身份不得清空其交易会话 / 消息 / 媒体（COMP-ID-001）

---

## 10. 风险与开放问题

### 10.1 风险

| 风险 | 缓解 |
|---|---|
| 切换 DisplayIdentity 导致消息丢失感 | 顶部有 toast 提示"已切换到 XX，此身份下 X 条新消息" |
| 防截屏在 iOS 不能硬阻断 | 告警 + 法务声明 + iOS 用 "已截图" 气泡提示 |
| KMS 集成上线延期 | 1.5 天已包含 fallback（本地 AES key），生产环境可后切 KMS |
| BURNER 身份被滥用 | ⚠️ 与电商法 122/2025「禁止匿名销售」冲突：**盈利账号不得使用**；7 天自毁仅限从未产生交易的账号，且销毁时 audit log 留底（COMP-ID-001） |

### 10.2 开放问题（需要 review 决定）

1. **DisplayIdentity 数量上限** —— 建议 3 个 / UserAccount（工作 / 私人 / 备用），可调
2. **BURNER 自动销毁时间** —— 7 天 / 30 天？建议 7 天
3. **群消息是否支持 DisplayIdentity 隔离** —— 建议"群消息继承创建者 DisplayIdentity"，群内成员看到的是创建者的工作名
4. **多身份是否计入 UserAccount 唯一性** —— 一个手机号 = 一个 UserAccount，但可有多个 DisplayIdentity。建议**是**（防注册刷号）
5. **截图告警是否在所有消息类型都开** —— 建议私聊默认开、群默认关（用户可调）

---

## 11. 排期

| 阶段 | 内容 | 时间 |
|---|---|---|
| **Phase 1** | DisplayIdentity (#1) + Message.Protection (#2) + RN 防截屏 (#3) | 7 天 |
| **Phase 2** | KMS 加密 (#4) + 30 天 TTL (#5) + 设备限制 (#6) | 3 天 |
| **Phase 3** | UI 联调 + 测试 + 验收 | 3.5 天 |
| **总** | | **~ 13.5 工日** |

---

## 12. 不在 RFC 范围（明确排除）

为了避免 scope creep，以下功能**即使 Lotus 做了，我们也不做**：

| Lotus 做了 | 不做的原因 |
|---|---|
| 真 E2EE (Signal 协议) | 法律 + 审计 + ROI 低 |
| 通话录音 | 吓跑普通用户 + 法律风险 |
| Két sắt 加密文件柜 | 用户证据不放 App |
| Convo 群内子话题 | 服务者群是广播式 |
| Lota AI / 阴阳历 | 服务者不用 AI |
| 1GB 文件 / 永久云存 | 服务者巴不得消息消失 |
| 多平台（Win / Mac） | 服务者只玩手机 |
| 默认防骚扰 / 默认群邀请拦截 | 服务者希望被加 |
| 默认永久云存 | 服务者巴不得消失 |

---

## 13. 参考

- 越南媒体评测：[GenK 2025-05-28](https://genk.vn/khong-can-chieu-tro-lotus-chat-van-leo-thang-top-3-ung-dung-mxh-tai-ve-nhieu-nhat-tren-app-store-nguoi-dung-viet-dang-chon-lai-nguoi-dong-hanh-20250527214432362.chn)
- 官方：[lotuschat.vn](https://lotuschat.vn/)
- Kenh14 评测：[Review nhanh Lotus Chat](https://kenh14.vn/review-nhanh-lotus-chat-app-chat-hang-viet-nam-chat-luong-cao-co-gi-xin-xo-dang-dung-215250524104537785.chn)
- Proxy 现有：`apps/api-go/internal/conversation/service.go`、`apps/api-go/internal/identity/service.go`
- Proxy 设计基线：`docs/design/CURRENT_BASELINE.json`

---

## 14. Review Checklist

- [ ] 产品 review：3 个 DisplayIdentity 类型是否合理？
- [ ] 产品 review：BURNER 7 天自动销毁是否合适？
- [ ] 工程 review：KMS 集成方案（AWS / GCP / 自建？）
- [ ] 法务 review：防截屏 / 阅后即焚 / BURNER 在越南 / 东南亚的法律风险
- [ ] 设计 review：身份切换器 UI 是否符合 R3 design system
- [ ] 安全 review：截图告警的事件防滥用机制

---

**下一步**：如果这份 RFC 被 review 通过，进入 Phase 1 实现。Phase 1 的 PR 拆为：

1. `identity.DisplayIdentity` 后端实现（含测试）
2. `conversation.Message.Protection` 后端实现（含测试）
3. RN 端防截屏 + 截屏告警
4. UI：身份切换器 + 会话内"防外传"选项

每步独立 PR，单独 review。
