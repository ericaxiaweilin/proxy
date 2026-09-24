# Proxy PRD v1.8 — R17.x 对话→订单/活动 物化路径

**Date:** 2026-09-05
**Status:** WIRE CONTRACT FREEZE / MATERIALISATION CHAIN FREEZE / AI PERSONA ASSET FREEZE
**Inherits:** `Proxy_PRD_v1.7_R16_AI_Three_Actors_MoneyFlow_Direction.md` (2026-09-04)
**Commits (this freeze):**
- `501864a fix(activity): add ListMyActivities server + repo + wire (R17.x)`
- `a7d2e24 fix(mobile): wire MyActivitiesSurface to ListMyActivities (R17.x)`
- `7d0a265 fix(activity): 5 platform AI personas carry photo asset (R17.x)`
- `b008e8b fix(chat): activity proxy picks a real activity via sheet picker (R17.x)`
- `3e0c88e fix(market): chat→order materialisation (ConfirmApplication creates real Order)`

R17.x 关闭 R16.x 后暴露的两条物化路径 + 一项资产缺口：

1. **"我的活动" 页 (me.tsx > myactivities) 走 hardcoded mock。** 即使 actor 在 server 端有 owner / 参加了的活动，UI 也只能看到 `本周暂无开放活动`。
2. **"聊天说下单/发起活动" 但 proxyObject 引用 hardcoded / 不存在的 ID。** `act_westlake` 这种 fragment 从未在 server 真实存在；`"order_"+applicationID` 这种 fragment 不会出现在 `listMyOrders` 里 — 两路径不一致。
3. **平台 AI 5 角色只有 emoji avatar。** PRD 要求"至少 5 个带照片、明确 AI 状态"用于冷启动和对话引导。

---

# 1. 物化路径图 (R17.x 关闭后)

```
              ┌─────────────────────────────────────────────────────────┐
              │ Conversation (chat)                                    │
              │   composer: "活动" / (未来) "提单" 按钮                 │
              └─────────────────┬───────────────────────────────────────┘
                                │ proxyObject.{activity, opportunity, order}
                                ▼
              ┌─────────────────────────────────────────────────────────┐
              │ server.conversation.SendMessage (proxy_object kind)     │
              │   字段: objectType / objectId / snapshot / liveState    │
              └─────────────────┬───────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   activity                opportunity                order
   ListActivities          ListMarketOpen.        listMyOrders
   (server.activities)     (server.marketplace)    (server.fulfillment)
        ▲                       ▲                       ▲
        │                       │                       │
        │ 我的活动 (mobile)      │ 我的机会 (mobile)      │ 我的订单 (mobile)
        │   MyActivitiesSurface │   FavoritesSurface     │   MyOrdersSurface
        │   (R17.x wire)        │   (R16.x wire)         │   (R17.x materialised)
        │                       │                       │
        └───────── ListMyActivities ─────── ConfirmMarketApplication ─┘
                  (server.activity)              (server.marketplace
                                                  → fulfillment.CreateOrder)
```

**关键不变式**：
- proxyObject 携带的 objectId **必须**对应 server 真实存在的业务对象。
- mobile 端**没有**平行映射表（既不维护 priceLabelForFlow，也不维护 activityIdToCard）。
- 所有 client 端 UI（"我的活动"、"我的订单"、chat 发的卡片）都从同一份 server 仓储读取。

---

# 2. AI 角色资产 (R17.x Photo Asset Freeze)

平台 AI 5 角色（ai_001-ai_005）的 SVG 头像资产位于：

```
apps/mobile/assets/ai-personas/
├── ai_001.svg   平台 AI 周末企划      紫 (☕)
├── ai_002.svg   平台 AI 拍照季        粉 (📸)
├── ai_003.svg   平台 AI 拍照搭子      绿 (🤝)
├── ai_004.svg   平台 AI 餐厅尝鲜      橙 (🍽️)
├── ai_005.svg   平台 AI 饭局推荐      金 (🍜)
└── INDEX.md
```

每张 SVG：
- 1024x1024 viewBox，圆形脸，单色渐变背景
- 右上角 "AI 虚拟" 白色 pill badge（明确 AI 标识）
- 底部 caption 显示 personaId + 角色名
- `<title>` + `<desc>` 标明 "AI-generated avatar, not a real person, PLATFORM_AI persona"（LC-07 对齐）

**Wire contract**：Activity.aiPersonaPhoto (string, optional)，最小长度 1（拒绝空 string 充数）。路径以 `ai-personas/` 开头（防错接真人 URL）。

**约束**：
- 这是 PLATFORM_AI 角色资产，**不是**真人候选（AI-ACTOR-002 tripwire 维护）。
- AI 不能接单 / 收款 / 替用户确认（aiboundary policy）。
- USER_TWIN 角色 photo 必须先有 LikenessConsent LIVE 才下发（PRD LC-07）。

---

# 3. 物化规则 Materialisation Rule (与 R16.x 一致)

R16.x 已确立：Opportunity → Invite → Order → Activity Participation 必须有唯一业务对象流向。R17.x **补完**两端：

| 起点                 | 终点       | 触发命令                              | 实现                                                                  |
|----------------------|------------|---------------------------------------|-----------------------------------------------------------------------|
| activity draft       |  Activity   | PublishActivity                        | memory + PG                                                          |
| activity joined     |  Activity   | JoinActivity                           | memory + PG (activity.participants)                                  |
| opportunity apply   |  Application | ApplyToMarketOpportunity              | memory + PG                                                          |
| application select  |  Application | SelectMarketApplication              | memory + PG                                                          |
| application confirm  |  Order       | **ConfirmMarketApplication**           | marketplace → **fulfillment.CreateOrder**（R17.x 新增 adapter）     |
| conversation send   |  Message    | SendMessage(proxyObject=...)          | memory + PG                                                          |

**关键**: application confirm 路径在 R17.x 之前使用 fragment ID 拼接 (`"order_"+applicationID`)，从未在 fulfillment 真实仓储。R17.x 后委托 `marketplaceFulfillmentAdapter` 调 `fulfillment.TransactionalRepository.CreateOrder`，让 "我的订单" 页（走 fulfillment.listMyOrders）能看见 marketplace confirm 产生的 Order。

---

# 4. Chat → 业务对象 物化完整性 (新增)

R17.x 引入的 wire 约束：

1. **chat sendProxyObject 必须带 server 真实 objectId**
   - `act_westlake` 等 hardcoded fragment 不允许（CHAT-PROXY-ACTIVITY-001 tripwire）
   - empty objectId 也不允许 silent fallback（mobile test 拒绝）
2. **chat "活动" 按钮走 sheet picker**：从 `ActivityClient.listActivities()` 选真活动，picker 显示空也诚实提示 "本周暂无开放活动"。
3. **chat → order (R17.x commit 5)**：marketplace ConfirmMarketApplication 委托 fulfillment 创建真 Order；idempotency 保证重复 confirm 不创建多份 Order。

**未做**（保留给后续 commit）：
- chat "提单" 按钮 UI 编排（commit 5 只完成 server-side 派生；UI 入口待 R18）
- NLP 文本识别 "下单了/提单了/发起活动" 自动派生（设计决定：不做 NLP 假阳性，只走显式 button）

---

# 5. 已知 Gap (R17.x 后未关闭)

| Gap                                                | 影响                                                              | 优先级 |
|----------------------------------------------------|-------------------------------------------------------------------|--------|
| chat composer 无 "提单" 按钮                         | user 仍不能在 chat 直接发出 Order proxyObject (需走需求页完成)  | 中    |
| GENERATE_MEDIA Action 未在 aiboundary               | USER_ASSISTANT 暂时不能生成 AI 媒体                                 | 低    |
| AI persona SVG → 客户端 expo-image SVG 渲染          | 当前用 View 圆形 token 替代；expo-image SVG 支持上线后无缝切换 | 低    |
| 真人 / AI 头像在 social / creator center 同步       | 当前 persona 资产只在冷启动活动列表显示                            | 低    |

---

# 6. Tripwire Registry (R17.x 增量)

| ID                              | 测试                                                                  | 防什么                                          |
|---------------------------------|-----------------------------------------------------------------------|-------------------------------------------------|
| ACT-MY-ACTIVITIES-001           | service_test.TestListMyActivitiesByActor                              | "我的活动" 页退回 hardcoded mock                |
| ACT-MY-ACTIVITIES-002           | platform/postgres.TestActivityPostgresListByOwnerAndParticipant        | 仅以内存仓储跑，生产 PG 表无 ListByOwner/Part. |
| AI-PERSONA-PHOTO-001            | service_test.TestPlatformAIPersonaPhotoRequiredOnColdStart            | photo 字段从 seed 丢失 / 出现真人 URL           |
| AI-PERSONA-PHOTO-001 (mobile)   | contracts activity.test.ts                                            | schema 拒接 photo / 漏发 photo                 |
| CHAT-PROXY-ACTIVITY-001         | conversation-client.test.ts                                           | conversation hardcoded "act_westlake" fallback |
| CHAT-ORDER-MATERIALISATION-001  | marketplace service_test.TestConfirmMarketApplicationMaterialisesRealOrder | fake "order_"+applicationID fragment 不返回     |

---

# 7. Version History

- **v1.8** (this, 2026-09-05) — R17.x 物化路径补完 + AI persona 资产 freeze
- **v1.7** (2026-09-04) — R16.x AI Three Actors + MoneyFlow Direction
- v1.6 — R15.12.15 Guest/Google Phone Auth
- (earlier versions omitted)