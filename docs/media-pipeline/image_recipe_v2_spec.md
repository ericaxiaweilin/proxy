# image_recipe_v2 冻结 spec

> 对应 `architecture/Social_Media_Pipeline_Plan_Gates_R1.md` §4.2 + §5.2.2
> 目标：消除灰边、色偏、中心裁切。冻结后 v1 旧对象保留，CDN cache key 区分。

## 1. 升级原则

1. **v1 不删**：所有 v1 variant 对象保留 6 个月，新请求走 v2
2. **recipe version 入 object key**：`mv_{asset}_{purpose}_v{recipe}.jpg`
3. **CDN cache key 必须含 recipe**：`image_recipe_v2` 变更即失效
4. **失败隔离**：v2 单档失败 → 该档 FAILED，其他档照常；v2 整体失败 → 客户端回落 v1

## 2. 五档 + 二档派生（v2 = 7 档）

| Purpose | 长边 | 格式 | sRGB | setsar | metadata | 触发条件 |
|---|---:|---|:-:|:-:|:-:|---|
| FEED_1X | 1080 | jpeg q=2 | ✅ | ✅ | strip | 全场景 |
| FEED_2X | 1600 | jpeg q=2 | ✅ | ✅ | strip | 全场景 |
| GALLERY | 2560 | jpeg q=2 | ✅ | ✅ | strip | 全场景 |
| SHARE_OG | 1200×630 | jpeg q=2 | ✅ | ✅ | strip | 全场景（cover + crop，不硬补） |
| PLACEHOLDER | 64 | jpeg | ✅ | ✅ | strip | 全场景 |
| FEED_1X_HINT | 1080 | jpeg q=2 | ✅ | ✅ | strip | compositionHint 存在且 confidence ≥ 0.4 + safeCropRect |
| FEED_1X_NATURAL | 1080 | jpeg q=2 | ✅ | ✅ | strip | 全身 / 横图；contain 补深紫黑 `#0E0A14` |

## 3. ffmpeg 滤镜（精确字符串）

```text
FEED_1X
  scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,
  setsar=1,format=yuvj420p,colorspace=srgb

FEED_1X_NATURAL
  scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,
  pad='max(iw,1080)':'max(ih,1080)':(ow-iw)/2:(oh-ih)/2:color=0x0E0A14,
  setsar=1,format=yuvj420p,colorspace=srgb

SHARE_OG
  scale=1200:630:force_original_aspect_ratio=increase,
  crop=1200:630,setsar=1,format=yuvj420p,colorspace=srgb
```

- `colorspace=srgb` 强制 sRGB 编码（消除宽色域发灰）
- `setsar=1` 归一化像素比（消除 Android 偶发变形）
- `format=yuvj420p` JPEG 友好像素布局
- `-map_metadata -1` 派生图无 EXIF / ICC / GPS
- `-q:v 2` ffmpeg JPEG 质量档（≈ mozjpeg q=88-92）

## 4. compositionHint 落库 schema

```go
type MediaCompositionHint struct {
  SubjectType   string  // PERSON | PRODUCT | TEXT_HEAVY | SCENE | MIXED_* | UNKNOWN
  SubjectCount  int
  FaceBoxes     []MediaBox  // 归一化 [0,1]
  BodyBoxes     []MediaBox
  TextSafeArea  *MediaBox
  FocalPoint    *MediaBox
  SafeCropRect  *MediaBox
  Confidence    float64
  RecipeVersion string  // 永远 = "composition_recipe_v1"
}
```

计算由独立 Worker 跑（轻量 ONNX / OpenCV），与派生 worker 解耦。

## 5. 验收 Gate 2 证据要求

### 5.1 SSIM 矩阵（v1 vs v2）

| 输入 | 评估 |
|---|---|
| iPhone HEIC（4:5 半身） | SSIM v1 vs v2 ≥ 0.99，色差 ΔE ≤ 2 |
| iPhone HEIC（9:16 全身） | 同上 |
| Android JPEG（1.91:1 风景） | 同上 |
| 宽色域 HEIC | v2 视觉上 sRGB 正确，v1 偏色 |

### 5.2 视觉回归（iPhone 15 + 小屏 iPhone + Android 三档真机）

- 1/2/3/4/5/6 各数量
- 单人近照 / 半身 / 全身 / 多人 / 靠边人物 / 风景 / 文字截图
- 低照度 / 高噪点 / 透明 / 宽色域
- 弱网 / 断网 / 后台恢复 / 上传重复提交

### 5.3 端到端指标

- Feed 首张 P75 可见 < 1.2s（Wi-Fi）
- Gallery 首张 P75 < 1.5s
- 滚动 45fps+ 持续
- 上传 25MB 不掉
- 内存压力不崩

### 5.4 灰边 / 显示不全专项

- 全身 9:16 contain：背景色 = `#0E0A14`，不能出现白/灰边
- 横图 1.91:1 letterbox：上下深紫黑，无强对比
- 4 图混合横竖：WALL 格子按 sourceAspect 比例，不再 1:1 裁切
- 文字海报：textSafeArea cover，文字可读

## 6. 客户端接线（步骤）

1. `packages/contracts/src/index.ts` 增 `FeedMediaItem.compositionHint?: MediaCompositionHint`
2. `apps/mobile/src/media/AdaptiveMediaCollection.tsx` 替换 `surfaces/feed.tsx` 旧实现
3. `apps/mobile/src/media/SocialMediaFrame.tsx` 替换 `surfaces/feed.tsx` 旧实现
4. `apps/api-go/internal/media/image_variants.go` 增 `image_recipe_v2` 派生，保留 v1
5. `apps/api-go/internal/media/postmedia_lookup.go` 增 `feedUrlHint / feedUrlNatural` 字段
6. CDN cache key 规则同步刷新

## 7. 风险与回滚

- v2 视觉回归不通过 → 单档 FAILED，客户端自动回落 v1
- 性能退化 > 20% → 全量关 v2 路由，回 v1
- 颜色空间错误（过饱和 / 失真）→ 立刻关 v2，回 v1
- 监控：v2 SSIM Δ、v2 vs v1 字节增量、客户端 fallback rate

## 8. 冻结签字

- [ ] 后端 platform lead
- [ ] iOS tech lead
- [ ] Android tech lead
- [ ] Design R3 owner
- [ ] Pipeline R1 owner
