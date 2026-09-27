# ComposerV2Screen — 新动态 v2

视觉 1:1 复刻 `Proxy · 新动态 v2.html`，作为 `feed.tsx` 内联 composer 的替代品。
全屏 Modal，自管所有 composer 状态（body / media / 引用 / 视觉装饰 / 上传 / 草稿）。

## 用法

```tsx
import { ComposerV2Screen } from "./ComposerV2Screen";

<ComposerV2Screen
  visible={composerOpen}
  onClose={() => setComposerOpen(false)}
  onPublished={async () => { await loadFeed(); }}
  localNet={localNet}
  mediaClient={mediaClient}
  activityClient={activities}
  initialQuoteId={composerQuoteId}
  posts={posts}
/>
```

## 功能与后端字段映射

| UI 控件 | v2 状态 | 实际后端字段 | 备注 |
|---|---|---|---|
| 正文 TextInput | `body` | `body` | 0/500，>460 转橘红 |
| 媒体 1/2/4 宫格 | `media[]` | `mediaRefs[]` | 上传走 `mediaClient.uploadMedia` |
| 引用帖文卡 | `quoteId` | `contextRefs[]` | `contextType: "QUOTE_POST"` |
| 拍摄场景 | `scene` | `contextRefs[]` | `contextType: "REALITY_SCENE"` + `relationType: "FEATURED_AT"`；带图发出后进该场景照片墙 |
| 关联活动 | `activity` | `contextRefs[]` | `contextType: "ACTIVITY"` + `relationType: "REFERS_TO"`，`contextId` 是 `activityId`（**不是**标题）。读端判定见 `apps/mobile/src/activity-ref.ts` |
| 地点 chip | `place` | body 前缀 `📍 {area}` | 复用 `LocationPickerSheet` |
| 话题 chip | `topic` | body 前缀（原文） | 3 个建议 |
| 谁可回复 | `replyPerm` | 仅本地（v1 无此字段）| 待 PRD |
| 谁可引用 | `quotePerm` | 仅本地 | 待 PRD |
| GIF | `gifWord` | body 前缀 `🎬 GIF: {word}` | 4 个硬编码 |
| 投票 | `poll` | `poll` + body 兼容前缀 | 最多 4 项；服务端尚未持久化新字段 |
| 24h 切换 | `isGhost24h` | `ephemeralUntil` + body 兼容前缀 | 服务端尚未持久化新字段，当前依靠正文保留语义 |
| 长文 | `longTextDraft` | 追加到 body | 模态编辑器 |
| 串帖（添加下一条）| — | toast 占位 | 等串帖 PRD |
| 语音 | `media[]` | `mediaRefs[]` | v2 风格按钮 + 30s 硬顶，复用 `useVoiceRecorder` |
| @ 提及 | — | 直接追加到 body | 未来加 `onSelectionChange` 切到光标位 |

## 数据层

- **草稿持久化**：复用 `expo-composer-draft-store`（v1 schema，向后兼容）
  - 持久化：body / media / visibility / includeCity / quoteTargetId / idempotencyKey
  - 不持久化：place / topic / gifWord / poll / isGhost24h / longTextDraft
  - **重启后丢失的视觉项会从 body 文本前缀解析回来**（待做反向解析；当前暂未做）
- **上传**：复用 `mediaClient.uploadMedia`，含断点续传（`uploadSession`）/ 暂停 / 取消
- **发布**：`localNet.createPost(payload, idempotencyKey)`，payload 与 v1 composer 一致

## 主题

走 R3 token（`color.surface / color.ink / color.lime / color.violet`），不沿用 v2 HTML 的米黄/橙系。
若后续要切回 v2 原色，加 6 个补充 token 即可。

## 已知 TODO

- [x] 引用 sheet 的搜索 / 按时间过滤 — 已完成：`QuotePickerSheetBody` 支持 推荐 / 最新 / 同城 + 关键词搜索
- [x] 长文编辑器字数限制 / 自动保存 — 已完成：`appendLongText` helper + modal 内计数器/上限提示；关闭 composer 时清理 longTextDraft
- [x] 投票时长多档切换 — 已完成：`POLL_DURATIONS` (1天/3天/7天/1小时/30分钟) + 点击底部 投票时长 打开 sheet 切换
- [x] @ 提及切到光标位置 — 已完成：`onSelectionChange` + cursor-aware insertion
- [x] ~~body 前缀的反向解析~~ — 已完成：`parseComposerBody`
- [ ] 串帖（多帖连发）的真正实现
- [x] 24h / 投票 → 共享契约字段（`ephemeralUntil` / `Post.Poll`）— 客户端已发送，服务端持久化待接
- [x] 发布逻辑提取为可单测模块 — 已抽离到 `composer-publish.ts`（21 个测试）
- [x] 工具按钮长按 tooltip — `TooltipOnLongPress` 组件提供，长按 350ms 显示，1200ms 自动隐藏
- [x] 空选项 poll 一致性 — `shouldSerializePoll` helper：`buildCreatePostPayload` 与 body 拼装统一走同一判断，避免后端拒收

## 设计决策记录

- **v2 HTML 原色（米黄/橙）未采用**：保留 R3 token 是为了不抹平其他页面的视觉基线。如果产品明确要求复刻 v2 HTML，加 `color.sand / color.amber / color.gold` 三套即可。
- **GIF picker 是文字代替 GIF**：避免引依赖（react-native-gif / giphy SDK），保持零体积。后续如需真 GIF，加 `giphy-js-sdk-core` + `react-native-fast-image` 即可。
- **TooltipOnLongPress 不替代 onPress**：组件包装在 Pressable 外层，但 onPress 在内部子节点上绑定（如 VoiceToolButton 内部）。React Native Pressable 不会默认冒泡，所以 wrapper 的 onPress 不会被意外触发。
- **composer-publish.ts 既有 helpers（buildCreatePostPayload）有 overrides 参数**：让调用方能在不影响 ephemeralUntil / poll 字段映射的前提下覆盖 body / mediaRefs / 头部字段。

## 文件清单

```
src/
├── composer-body.ts            # body 序列化 + 解析 + 相对时间格式化 + 投票时长描述 + 长文拼接
├── composer-body.test.ts       # 45 个测试
├── composer-publish.ts         # 发布逻辑（上传 + schema 字段映射 + idempotencyKey）
├── composer-publish.test.ts    # 23 个测试
├── composer-media.ts           # 媒体工具（拖动/排序/状态/alt 上限）
├── composer-media.test.ts      # 29 个测试
├── surfaces/
│   ├── ComposerV2Screen.tsx    # 主组件
│   └── ComposerV2Screen.md     # 本文档
└── components/
    ├── VoiceToolButton.tsx     # 替代老的 voice-record-panel.tsx
    └── TooltipOnLongPress.tsx  # 通用长按 tooltip 控件
```

## 后续打磨可考虑

- [ ] 文字选中的自愈（rn 端偶尔选中不到：正确性依赖 onSelectionChange 返回事件的准确度，必要时用 ref + setNativeProps）
- [ ] Tooltip 在长按滚动时的误触（当前 delayLongPress=350ms，期望避免）
- [ ] 提交中未能上传完的媒体中的重试入口（现在只能重发整个帖子）
- [ ] 串帖仅临时方案：发布后能在卡片里看到上一段 body 作为上下文提示
- [x] 拼装后的 body 有效长度计为字符计数器 — 已完成：`estimateAssembledBodyLength` 计算包含所有装饰前缀的预计长度，避免发布后超后端限额
- [x] 引用目标丢失 → 主动清空 — 已加 useEffect：帖子不在 posts 里时主动 setQuoteId(null) + toast 提示
- [x] 长文 modal 跨打开周期残留 — 关闭 composer 时 useEffect 清理 longTextDraft / longTextOpen
- [ ] i18n：所有硬编码文案均依赖后续 i18n 接入
