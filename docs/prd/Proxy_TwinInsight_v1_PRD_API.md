# TwinInsight v1 — AI 分身 · 好友洞察 PRD + API 契约

- 状态：Draft（FUNCTIONAL_REFERENCE_ONLY，由用户原型转写，未进 CURRENT_BASELINE）
- 原型：`docs/design/references/proxy_ai_twin_insight_v1.html`（2026-09-21 deepseek 原型）
- 实现分支：`feat/ai-twin-insight-v1`（worktree `ai-twin-insight-v1`，基线 `ae9db44`）
- 契约：`packages/contracts/src/twin-insight.ts`（single source of truth）
- 客户端：`apps/mobile/src/twin-insight-client.ts`
- 组件：`apps/mobile/src/components/twin-insight-card.tsx`

## 1. 走查结论（原型 → Proxy 基线）

原型信息架构（保留）：好友横滑 rail → 折叠洞察卡（摘要行 + 迷你信号）→
展开详情（信号格 / 评分条 / AI 建议 / 对话摘要 / 最近互动 / 双按钮）→ toast 反馈。

必须改的 7 处（否则不合闸）：

1. emoji 信号图标（👁💬⏱❤️）→ `proxy-icon`（search/chat/clock/heart）。R3 禁止页面内
   Unicode 回退，图标只能走 `proxy-icon.tsx` 稳定 token。
2. 渐变头像 + 硬编码 hex（`#e07b39/#0a0a0a` 等）→ `theme.tsx`（`foundation` + `color`）
   + `ProxyAvatar/ProxyButton`。原型渐变仅用于区分 demo 数据，生产头像走
   server 真图 + 首字回退。
3. 评分阈值 60/40 硬编码 → 服务端 thresholds 快照
  （`operateAt/observeAt/configVersion`，复用 `FacetConfig.priorityHigh/MidBoundary`
   语义）。客户端只做 `twinScoreBand` 判定，不自定 verdict。
4. `<strong>` HTML 富文本 → wire 纯文本 + RN `Text` 嵌套。服务端不得下发 HTML，
   避免注入与双端渲染漂移。
5. 静态 `friends` mock → REST wire（`GET insights` 匿名读 / `POST operate` 认证写）。
   读沿用 Facet 匿名策略（公开浏览无需登录），写沿用 FACET-AUTH-001
  （无 token 拒 401，客户端翻译成人话）。
6. “开启单独运营”无门禁 → 必须经过未成年人门禁（`AiPersonaClient` 同规则，
   COMP-AI-MINOR-001 fail-closed）+ 审计（谁/何时/对谁/什么动作）。
7. 缺隐私与成本说明 → 7 天行为信号（访问/停留/点赞）属于行为数据，需 consent +
   数据生命周期（不硬删，走状态机 + 审计，见 AGENTS.md 数据不变式）；
   “重新总结”是 LLM 调用，需服务端限流 + 成本计数。

## 2. 范围

IN（v1）：rail + 折叠卡 + 详情 + 双按钮 + 重新总结，均接真 wire（先 mock server，
后接 reasoner）。

OUT（明确不做）：自动群发/代聊执行（只给建议，不代发）；关系规则引擎复用 Facet
（TwinInsight 不复制 FacetObject，仅引用 `targetId`）；图片上传/写真（沿用
twin-photo-sim 通道，不在此面）；LIBRARY/副空间 CRUD（仍走 Facet）。

## 3. 数据模型（wire，见 zod）

- `TwinInsightSignal = hot|warm|cold|new`（rail 右上点 + 卡片点）
- `TwinInsightVerdict = worth|watch|skip|new`（服务端判定，客户端只展示）
- `signals = { views7d, messages7d, avgStaySec, likes7d }`
 （停留统一秒传输，`formatTwinStay` 格式化为 `x分/x秒`）
- `advices[] ≤ 5`：`{ type: good|info|warn, text: 纯文本 }`
- `timeline[] ≤ 10`：`{ text, time: 展示串, gray }`
- `score 0..100`（与 Facet `reasoningConfidence` 同量纲，便于后期融合）
- `thresholds = { operateAt, observeAt, configVersion }`

## 4. API（REST，不走 command 信封；与 FacetClient 同 transport 分层）

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/v1/ai/twins/:twinId/insights?window=7d` | 匿名 | 列表（含 thresholds 快照）。空 = `insights: []`；缺数组 = 协议异常 |
| GET | `/v1/ai/twins/:twinId/insights/:targetId` | 匿名 | 详情（列表已全量时可跳过） |
| POST | `/v1/ai/twins/:twinId/targets/:targetId/operate` | 必须 | body `{ action: observe\|operate }` → `{ targetId, action, actedAt }`；401 未登录 / 429 限流 |
| POST | `/v1/ai/twins/:twinId/insights/:targetId/summary:refresh` | 必须 | 重新总结；服务端限流（建议 1 次/分钟/目标）；返完整 `TwinInsight` |

错误语义：非 2xx → `TwinInsightProtocolError`；schema 漂移 → ZodError
（fail-closed，UI 展示重试，不静默降级）。

## 5. 移动端状态机

`rail selectedId`（默认首个）→ `card expanded`（默认折叠，切换好友自动折叠，
与原型一致）→ `acting`（写操作进行中，双按钮 disabled）→ toast
（已标记为观察 / 已开启对 X 的单独运营 / 已重新总结 / 请登录后重试）。

无障碍：rail 为 `tablist`，卡片摘要为 `button + expanded`，图标按钮带 label；
正文 ≥ 11pt（R3 gate）。

## 6. 与现有模块关系

- 落位（owner 定向 2026-09-21）：好友洞察段挂在 AI 分身中心 Twin 段之后
  （`TwinInsightSection`）。AI-CLUSTER-BOUNDARY-001 说这屏只管数字资产、
  访问战绩归好友页——那条针对的是同一份 MEDIA-DWELL 明细两屏各画一遍；
  本段走独立的 TwinInsight wire（服务端算好的洞察），好友页明细不动，
  不违反「同一份数据只画一次」。
- Facet：关系运营的“对象”概念仍归 Facet；TwinInsight 的 `targetId` 建议与
  `FacetObject.id` 对齐（或映射表），`score` 与 `reasoningConfidence` 同量纲，
  阈值复用 `FacetConfig`，不另起一套阈值体系。
- AI 分身中心（`AiPersonaClient`）：分身 CRUD + consent 仍走该 client；
  TwinInsight 只做“分身视角的好友洞察”，创建/授权/收回不重复实现。
  未成年人门禁与年龄补录沿用 `TwinMinorForbiddenError/TwinNoAgeEvidenceError`。
- 小美推荐（`AIAssistantsRow`）：平台 AI 目录，与“我的分身的好友洞察”是两个面，
  不混用组件。

## 6.1 过渡期演示数据（后端未落地前）

- `twin-insight-demo.ts`：原型 6 好友的纯文本演示数据，`TwinInsightSection`
  在未登录 / 无分身 / 服务端失败时兜底渲染，badge「本机演示」明示
  （先例：好友页 CONTACT_MATCHES「本机演示」）。
- `twin-insight-section.test.ts` 钉住：demo 符合 wire 契约、无 HTML、
  verdict 与分数字段一致。
- TODO TWIN-INSIGHT-002：Go 端实现 §4 四个 endpoint 后删除 demo 模块 + badge，
  补 regression ID + `check-regression-contracts.sh` 条目。

## 7. 验证

- `pnpm --filter @proxy/contracts test --run src/twin-insight.test.ts`
- `pnpm --filter @proxy/mobile test --run src/twin-insight-client.test.ts`
- `pnpm --filter @proxy/mobile typecheck`
- 后续服务端接线后：`go -C apps/api-go test ./internal/api -run TestTwinInsight -count=1 -v`
 （本分支未含 Go 实现，联调时补 regression ID + `check-regression-contracts.sh` 条目）

## 8. 回到基线的门

本原型当前不得写入 `CURRENT_BASELINE.json` / `docs/design/README.md` 的
ACTIVE 位。转正需 commander 审批：R3 视觉走查 + 真机安全区/动态字号/横竖屏 +
design gate 全绿 + 服务端 wire 联调。
