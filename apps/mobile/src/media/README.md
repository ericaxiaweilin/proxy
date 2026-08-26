# Media Pipeline v2 — 目标形态

> 对应 `architecture/Social_Media_Pipeline_Plan_Gates_R1.md`。
> 新增文件，**不动** `surfaces/feed.tsx` 现有实现。团队审完再决定替换。

## 新增文件

| 路径 | 作用 |
|---|---|
| `packages/contracts/src/media-composition.ts` | §5.2.2 MediaCompositionHint 合同 + `resolveFillStrategy()` |
| `apps/mobile/src/media/SocialMediaFrame.tsx` | §5.2.1 重写：深紫黑底 + 同图柔化 + 服务端 hint 驱动 fill |
| `apps/mobile/src/media/AdaptiveMediaCollection.tsx` | §5.2/§5.2.1 重写：WALL 强制 1:1 cover 取消，改为按 sourceAspect 比例 contain |

## 行为变化（相对 `surfaces/feed.tsx` 当前实现）

| 现象 | 旧实现 | 新实现 |
|---|---|---|
| 灰边（夜景 contain 上下白条） | 父容器 `offWhite` 色透明 | 固定 `#0E0A14` 深紫黑底 |
| 4 张横图被吃成 1:1 裁切 | `frameAspect={1}` + cover | WALL 格子高度按 sourceAspect，contain 优先 |
| 全身 9:16 contain 露白边 | `socialMediaFrame` 透明背 | 深紫黑底 + 同图 blurRadius 24 背景 |
| 中心裁掉头/脚 | 纯宽高比启发式 | 服务端 `compositionHint.safeCropRect` 决定；低置信度回落到 contain |
| 占位空白 | 没人用 `placeholderUrl` | 模糊占位 + 主图加载完切换 |
| 4:5 + 9:16 混排高度抖 | portrait 画布统一 OK | 同上，已对齐规范 |

## 验收 Gate（对应 Plan §12）

- Gate 3 "极端比例不默认裁主体" → 新 WALL 路径
- Gate 3 "iOS/Android 缩放图库依赖已接入" → MediaViewer 走 `playbackUrl`
- Gate 3 "半身 4:5 + 全身 9:16 使用统一人像画布" → 既有 `portraitRailLayout`，v2 强化背景

## 替换路径

1. 把 `surfaces/feed.tsx` 现有 `AdaptiveMediaCollection / AdaptiveMediaRail / SocialMediaFrame / SinglePostImage` 整体迁出
2. 在 `feed.tsx` 顶部 `import { AdaptiveMediaCollection } from "../media/AdaptiveMediaCollection"`
3. `FeedMediaItem` 增 `compositionHint?: MediaCompositionHint`
4. 跑 §11 样本集视觉回归
