# Gate 3 — Feed & Gallery 媒体渲染管线验收

> 配套实现：`packages/contracts/src/media-composition.ts` + `apps/mobile/src/media/`
> 测试：`packages/contracts/src/media-composition-gates.test.ts` (34 cases)
> 规范：`architecture/Social_Media_Pipeline_Plan_Gates_R1.md §5.2.1 / §5.2.2 / Gate 3`

## 之前的问题

旧管线 (v1) 存在 3 类失败：
1. **"照片灰边"** — AdaptiveMediaRail 用了 `Image resizeMode="contain"` 嵌入 `View backgroundColor={color.offWhite}`，夜景/深色照 contain 时出现强白边
2. **"显示不全"** — 1 张图固定 156pt 高度 + 4:5 强行压成 156pt 横条，全身 9:16 被裁
3. **"毛玻璃模糊"** — `placeholderUrl` 32-64px BlurHash 优先显示，要点击才换原图

修法不是单点 UI 调整，而是 **5 个 Gate**（不变量 + 自动验收 case + 唯一函数入口）。

## 5 个 Gate

### Gate A — 档位选择 (Variant Selection)

**不变量**：屏宽 < 410pt 用 `FEED_1X` (1080px)；>= 410pt 用 `FEED_2X` (1600px)；缺档降级链 `feed2xUrl → feedUrl → galleryUrl → thumbnailUrl → playbackUrl`。

**对应规范**：
- `Social_Media_Pipeline_Plan_Gates_R1.md` §5.2 "Wi-Fi 下 FEED_1X P75 可见 < 1.2s"
- §5.2 "滚动过程中不得因图片解码持续掉到 45fps 以下"

**实现**：`packages/contracts/src/media-composition.ts` `selectVariantForViewport(item, viewportWidth)`

**调用点**（单一入口，禁止其他代码路径选 URL）：
- `apps/mobile/src/media/SocialMediaFrame.tsx` line 73
- `apps/mobile/src/media/AdaptiveMediaCollection.tsx` line 142

**验收 case** (12 个) — `Gate A · selectVariantForViewport`:
- A1: iPhone 393pt → FEED_1X
- A2: iPhone Pro Max 430pt → FEED_2X
- A3: iPad 768pt → FEED_2X
- A4: iPad Pro 1024pt → FEED_2X
- A5: 边界 410pt (inclusive) → FEED_2X
- A6: 边界 409pt → FEED_1X
- A7: 小屏 320pt → FEED_1X
- A8: 2x 缺失时降级 1x
- A9: 1x/2x 全缺时降级 galleryUrl
- A10: 完全空 item 393pt → undefined（不抛错）
- A11: 完全空 item 430pt → undefined（不抛错）
- A12: 断点常量 = 410pt（iPhone Pro Max 起点）

### Gate B — 填充策略 (Fill Strategy)

**不变量**：低置信度 (<0.4) 必须 contain；TEXT_HEAVY + textSafeArea → cover；SCENE + focalPoint + aspect 接近（< 20%）→ cover；人物/商品 + safeCropRect → cover；其他 contain。

**对应规范**：
- §5.2.2 "低置信度（<0.4）必须回落 contain"
- §5.2.2 "客户端不得自作主张"

**实现**：`packages/contracts/src/media-composition.ts` `resolveFillStrategy({ hint, sourceAspect, frameAspect })`

**调用点**：`SocialMediaFrame.tsx` line 60

**验收 case** (11 个) — `Gate B · resolveFillStrategy`:
- B1: 无 hint → contain
- B2: 置信度 0.39 → contain
- B3: 置信度 0.40 → 走真实逻辑
- B4: PERSON + safeCropRect → cover
- B5: PRODUCT + safeCropRect → cover
- B6: TEXT_HEAVY + textSafeArea → cover
- B7: TEXT_HEAVY 但缺 textSafeArea → contain
- B8: SCENE + focalPoint + aspect 接近 → cover
- B9: SCENE + aspect 偏差 > 20% → contain
- B10: UNKNOWN + 高置信度 → contain
- B11: custom threshold 0.7 生效

### Gate C — 无占位 (No Placeholder)

**不变量**：Feed 不渲染 `PLACEHOLDER` variant（BlurHash 32-64px 模糊图）。PLACEHOLDER 只在 `onError` fallback / Gallery 首帧使用。

**对应规范**：§5.2 性能预算 + 用户体验"看到的是清晰图，不是模糊"

**实现**：`packages/contracts/src/media-composition.ts` `isForbiddenInFeed(purpose)` + `FEED_FORBIDDEN_PURPOSES`

**调用点**：（在 reviewer / lint 中查 call site） — `SocialMediaFrame` 和 `SinglePostImage` 都不再传 `placeholderUrl` 到 `<Image source={...}>`。

**验收 case** (5 个) — `Gate C · isForbiddenInFeed`:
- C1: PLACEHOLDER 是禁止档位
- C2: FEED_1X 允许
- C3: FEED_2X 允许
- C4: GALLERY 允许
- C5: ORIGINAL 允许

### Gate D — 背景色不变量 (Frame Background)

**不变量**：Frame 背景锁定 `#0E0A14`（深紫黑）。不用 offWhite/white：夜景/深色照片 contain 时会出现强白边。

**对应规范**：§5.2.1 "背景不能使用纯白导致夜景/深色照片出现强烈边框"

**实现**：`packages/contracts/src/media-composition.ts` `FRAME_BACKGROUND_HEX` + `isFrameBackgroundSafe(hex)`

**调用点**：所有 `<View style={styles.frame}>` + `<View style={styles.backdrop}>` + `<View style={styles.singleStage}>` + `<View style={styles.wallCell}>` 都用 `FRAME_BACKGROUND_HEX` (从 contracts import)。

**验收 case** (6 个) — `Gate D · isFrameBackgroundSafe`:
- D1: FRAME_BACKGROUND_HEX = "#0E0A14"
- D2: #0E0A14 通过
- D3: 白色禁止
- D4: offWhite #F7F4F9 禁止
- D5: undefined 禁止
- D6: 浅灰 #E5E5E5 禁止

### Gate E — 懒加载边界 (Lazy Load Boundary)

**不变量**：离屏图片不渲染不下载。

**实现机制**：
- React Native `<Image>` native lazy load（自动）
- `<ScrollView>` 默认 lazy
- `<Pressable>` 包裹的 image 不进 viewport 不渲染

**测试方法**（手测 + 真机录屏）：
- iPhone 15 真机 Metro performance trace
- 弱网 (Slow 3G / Wi-Fi off) 录制：滚到底部前，顶部 3 张图之外不下载
- App 内存：进入 feed 30 秒后 < 80MB（不算 LRU cache）

**自动 case 状态**：**未实现**。RN 0.86 + Hermes native lazy 行为要靠 trace 验证，CI 难做。

## 质量门汇总

| 检查 | 命令 | 状态 |
|---|---|---|
| Contracts 编译 | `pnpm --filter @proxy/contracts build` | ✅ |
| Contracts 测试（含 34 gate） | `pnpm --filter @proxy/contracts test` | ✅ 42/42 |
| Mobile typecheck | `pnpm --filter @proxy/mobile typecheck` | ✅ |
| Mobile 测试 | `pnpm test` (mobile) | ✅ 26/84 |
| Go build | `cd apps/api-go && go build ./...` | ✅ |
| Go vet | `cd apps/api-go && go vet ./...` | ✅ |
| Go test | `cd apps/api-go && go test ./...` | ✅ 28 包 |

## 仍未做的（与 Gate 3 阻塞项对齐）

- [ ] 半身/全身/多人/靠边人物样本集截图回归（§11）
- [ ] iPhone 15 + 小屏 iPhone + Android 三档真机视觉证据
- [ ] 弱网真机录屏（Gate E lazy load 验证）
- [ ] 端到端性能 trace（FPS、内存、滚动手势）
