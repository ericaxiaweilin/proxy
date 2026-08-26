# 调研：开源成熟方案 — 减少灰框 / 黑框 / 人像有限度处理

> 配套：`docs/media-pipeline/image_recipe_v2_spec.md` §5.4（灰边 / 显示不全专项）
> 配套：`architecture/Social_Media_Pipeline_Plan_Gates_R1.md` §5.2.1（人像混合）+ §5.2.2（首版回落矩阵）
> 现状截止：v2 派生已接，但 `compositionHint` 推理 worker 还没建、smart crop / saliency crop 缺位。
> 目的：列清楚"我们没造轮子的部分"应该接谁，给每个症状一个可落地的工程方案，不重复发明。

---

## 0. 一句话总结（对症下药）

| 症状 | 根因 | 推荐的成熟开源方案 | 接入位置 | 复杂度 |
|---|---|---|---|---|
| 灰框（白/灰边） | 后端 v1 强行 1:1 / 横条裁切 + 前端 `contain` 背景 offWhite | **bimg (libvips Go binding)** 做 force_aspect / embed；前端 `expo-image` contentFit 已够 | 后端 `image_variants_v2.go` 替换 ffmpeg 字符串 | 1-2 周 |
| 黑框（中心裁切把头/脚切掉） | ffmpeg `force_original_aspect_ratio=increase + crop=center` 盲切 | **smartcrop.js / smartcrop-go (libsaliency)** + **bimg smartcrop** | 后端 composition worker | 2-3 周 |
| 人像有限度处理（单人/多人/商品） | 没有 face anchor / body anchor | **MediaPipe Face Detector (TFLite)** + **ultralytics YOLOv8n-pose** (Go: `yalue/onnxruntime_go`) | composition worker | 3-4 周 |
| 缩略图/原图全栈管线 | 自己用 Image + blurRadius 叠背同图 + BlurHash | **Thumbor (Python) / Imagor (Go)** 整条；或裸 **libvips (gocv/bimg)** | 后端 image service | 2-4 周 |
| CDN 端 on-the-fly 变换 | 自己派生五档 + CDN cache | **imagor (Go)** 或 **thumbor** | API gateway / BFF | 1 周起 |
| 视频装帧慢 (Gate J) | 自造 Modal 走 RN reconciliation | 已接 **expo-video** (AVPlayerViewController) ✅ — 不用动 | — | 0 |

---

## 1. 后端图像处理：放弃 ffmpeg 拼字符串

### 1.1 现状痛点（已读 `image_variants_v2.go`）

```go
// 当前写法
filter: "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease," +
    "setsar=1,format=yuvj420p,colorspace=srgb",
extraArgs: []string{"-map_metadata", "-1"},
```

- 7 个 recipe × N 个变体 = 7 段 ffmpeg filter 字符串
- 调一次锐化 / 调一次白平衡 / 改一次 metadata strip 策略 → 重写字符串 + 重部署
- 没有 EXIF 自动 orient（`setsar=1` 不解决 orientation flag）
- 没有智能裁切；想做 anchor crop 必须自己再 fork 一次 ffmpeg 滤镜

### 1.2 推荐：**bimg** (Caddy 出品 / libvips Go binding)

仓库：`github.com/h2non/bimg` （⭐ 2.8k+，活跃维护，libvips ≥ 8.12 绑定）

为什么是 bimg 不是直接 libvips：

| 维度 | ffmpeg 字符串拼接 | bimg (libvips) | imagor |
|---|---|---|---|
| 性能 | 中 (CPU, 串行) | **高** (libvips 内置 SIMD + 并行 pipeline) | 高 (基于 libvips) |
| 智能裁切 | 无 | **`.SmartCrop(width, height)`** 内置 saliency | 同 bimg |
| 色彩管理 | `colorspace=srgb` 容易拼错 | `bimg.Options.WithImageColourSpace(ColourSpaceSRGB)` | 同 |
| 自动 EXIF orient | 要手动 `-autorotate` | `bimg.Options.WithAutoRotate(true)` | 同 |
| Go 原生 | 调 `os/exec` | **直接 struct API** | HTTP 客户端 |
| 启动复杂度 | 仅 ffmpeg 二进制 | `brew install vips` / apt libvips-dev + 1 个 cgo 文件 | 独立服务 |

**对症点 — 减少灰框/黑框**：

```go
// bimg 替换 ffmpeg 字符串（伪代码）
buf, _ := bimg.NewImage(originalBytes).Process(bimg.Options{
    Width:         1080,
    Height:        1080,
    Type:          bimg.JPEG,
    Quality:       88,
    Embed:         true,                    // 等价 contain，pad 用 background color
    Background:    bimg.RGBA{14, 10, 20, 255}, // #0E0A14 深紫黑，与前端 SocialMediaFrame 一致
    AutoRotate:    true,                    // EXIF orientation
    StripMetadata: true,                    // EXIF + GPS
    SmartCrop:     true,                    // ← 关键：libsaliency 智能裁切，不要再拼 ffmpeg crop
    CropGravity:   bimg.GravitySmart,       // 焦点：人脸/显著区
    ColourSpace:   bimg.ColourSpace(3),     // 3 = sRGB
})
```

#### 1.2.1 SmartCrop 的 fallback 矩阵

`bimg.SmartCrop` 用 libvips 的 saliency 检测（能量函数 + 皮肤色 + 边缘），不调 ML 模型。适用：风景 / 静物 / 无明确人脸的场景。
**对人脸/商品不够准**（仍可能裁掉半张脸），需要接 1.3 的 MediaPipe/ONNX 给出 face anchor 后**关闭** SmartCrop。

```
if hasFaceAnchor(faceBoxes)  → 用 faceBoxes 计算 cover crop（人脸优先）
else if hasProductAnchor    → 用 product bbox center crop
else if hasTextSafeArea     → textSafeArea 完整 cover
else                        → bimg.SmartCrop (libsaliency 兜底)
```

#### 1.2.2 落地步骤

1. `apps/api-go/go.mod` 加 `github.com/h2non/bimg v1.1.0`
2. `apps/api-go/Dockerfile` 装 `libvips-dev`（macOS: `brew install vips`）
3. `image_variants_v2.go` 重写 7 个 recipes → 7 个 bimg.Options 结构体
4. 保留 ffmpeg 做 VIDEO 派生（expo-video 装帧，image_recipe v2 不动视频）
5. 灰度切流：v2 路由 5% → 对比 bimg vs ffmpeg 视觉/字节

### 1.3 备选：**imagor** (HTTP 微服务)

仓库：`github.com/cshum/imagor` （⭐ 1.2k，Imaginary 的 Go 重写，CDN-on-the-fly）

适用场景：
- 不想在 Go 里 cgo 编译 libvips
- 需要 URL 形式的图像 CDN（`https://img.example.com/unsafe/1080x1080/smart/<path>`）
- 多服务复用

**对 Proxy 的现实评估**：kake 已有 7 档固定派生（v1+v2），不需要"任意尺寸任意裁切"，**imagor 暂时过度**。建议 bimg 内嵌，等 P1 出现"运营想自定义派生尺寸"时再迁 imagor。

### 1.4 不推荐：mozjpeg / cjpeg 直接调

`mozjpeg` 质量好（比 libjpeg-turbo SSIM 高 5% 同字节），但：
- 已经是 libvips 内部 JPEG 编码器之一（`vips_jpegload` 走的就是 mozjpeg / libjpeg-turbo 二选一）
- 单独调 `cjpeg` 又回到 ffmpeg 那种拼字符串问题

→ 用 bimg 内部默认即可，质量档 `Quality: 88-92` 已经在 §4.2 验证。

---

## 2. Composition 推理：补 ONNX Worker

### 2.1 现状痛点

- `apps/api-go/internal/media/composition.go`：schema ✅
- `apps/api-go/migrations/025_media_composition_hint.sql`：落库 ✅
- `apps/api-go/internal/platform/postgres/media.go`：UpdateCompositionHint ✅
- `apps/api-go/internal/media/worker.go` line 136：派生 v2 时**读** `asset.CompositionHint` ✅
- **缺失**：`apps/api-go/internal/media/composition_worker.go`（COMPOSITION_WORKER_SPEC.md §6 列了 todo）
- 后果：`hint` 永远为 nil → `FEED_1X_HINT` 永久跳过 → 全部走 `FEED_1X_NATURAL` 兜底 → 半身 4:5 强行 contain 露出上下深紫黑

### 2.2 推荐：**ONNX Runtime Go + MediaPipe Face Detector (TFLite→ONNX)**

#### 2.2.1 推理栈对比

| 选项 | 推荐度 | 理由 |
|---|---|---|
| **MediaPipe Face Detector (BlazeFace-SDF) TFLite→ONNX** | ⭐⭐⭐⭐⭐ | 6MB 模型，CPU 30ms/张，iOS 屏幕级准确率 |
| YOLOv8n-face + yalue/onnxruntime_go | ⭐⭐⭐⭐ | COMPOSITION_WORKER_SPEC.md §9 已选；6MB，CPU 50ms/张 |
| OpenCV DNN Haar / HOG | ⭐⭐ | 多人 / 暗光掉点明显 |
| 云 API (Rekognition / 腾讯云) | ⭐ | 隐私红线，COMPOSITION_WORKER_SPEC §11 已否决 |

**选 MediaPipe BlazeFace-SDF** 而非 YOLOv8n-face 的原因：
- 更快（30ms vs 50ms @ CPU 4 核）
- 更小（6MB 同）
- 关键点 6 个 vs YOLO 5 个，对"边缘人物脸"识别更稳
- Google 维护，TFLite→ONNX 转换官方支持

#### 2.2.2 Go binding 选择

```go
// go.mod
require (
    github.com/yalue/onnxruntime_go v1.18.0  // CGO, 需 libonnxruntime.so
)

// 加载
ortEnv := onnxruntime.NewEnvironment()
session, _ := ortEnv.NewSession("models/blazeface_short_range.onnx",
    []string{"input"}, []string{"boxes", "scores"})

// 推理（伪代码）
preprocessed := preprocessImage(original, 128, 128)  // MediaPipe 标准
outputs, _ := session.Run([]ort.Tensor{preprocessedTensor})
boxes, scores := postprocess(outputs)               // 归一化到 [0,1]
```

#### 2.2.3 全身 / 商品 / 文字 — 第二阶段

P0 只做**人脸 anchor**（解决 80% 的"裁头/裁脚"问题）：
- 半身 4:5 (portrait 0.8) → safeCropRect = face+body 联合 bbox（body = face.x ± 15%, face.y + face.h ~ face.y + face.h*2.5）
- 全身 9:16 (portrait 0.56) → safeCropRect 几乎全图 cover，focalPoint = face center
- 多人合照 → 所有 face boxes union + 5% padding

P1 加商品 / 文字（PP-PicoDet + DBNet）：
- 商品：PicoDet 主框 → safeCropRect
- 文字海报：DBNet 文字密度热图 → textSafeArea
- 风景：focalPoint = bimg smartcrop 结果

#### 2.2.4 验收 Gate 2 复测

- §7.1 主体分类 ≥ 85%（先只算人脸，PERSON vs UNKNOWN 二元 → 容易达标）
- §7.2 单图 ≤ 200ms（MediaPipe 30ms + postprocess 20ms + IO 50ms = 100ms）
- §7.3 视觉回归：半身 4:5 全身 9:16 真实发布，含人脸图不能裁头（已有证据 `post_45ca5b5f18da5f06659d89cc`，但用的 fixture 没人脸，证据强度不足）

#### 2.2.5 风险

- 模型加载冷启动 1-2s → 用 `sync.Once` 预加载 + worker pool warm-up（COMPOSITION_WORKER_SPEC §11 已识别）
- onnxruntime CGO 跨平台编译麻烦 → 用 build tag `//go:build onnxruntime` 隔离，CI 提供 prebuilt lib
- 隐私：人脸坐标是数学数据，不是生物特征，落库需隐私法务签字（COMPOSITION_WORKER_SPEC §11）

---

## 3. 智能裁切：libsaliency + smartcrop

### 3.1 smartcrop-go (libsaliency 移植)

仓库：`github.com/muesli/smartcrop-go` （⭐ 770，纯 Go，无 CGO）

适用：纯色风景 / 静物 / 无明显主体
对症：**横图 letterbox 黑边** 场景

```go
// 用法（与 bimg 互不冲突，可作 bimg smartcrop 的 Go 端等价）
crop, _ := smartcrop.Crop(img, 1080, 1080)  // 返回最佳 crop 框
// crop = smartcrop.CropResult{Type: "smart", X, Y, Width, Height}
```

限制：纯 Go 实现比 libvips 的 C 版慢 5-10 倍，但 100ms/张 仍可接受。

### 3.2 bimg 内置 SmartCrop

bimg 调的是 libvips `vips_smartcrop`，基于显著性 + 皮肤色 + 边缘能量函数。
**比 smartcrop-go 准且快 10x**，且不需要额外依赖。

→ 选 bimg SmartCrop 作为默认；smartcrop-go 仅作 fallback（万一 bimg 编译失败）。

### 3.3 不推荐：基于 ML 的 saliency

如 DeepGaze II、Saliency GAN — 过重、过慢、模型权重大，本场景用不到。

---

## 4. 缩略图 / 占位 / LQIP：放弃自己写 BlurHash + blurRadius

### 4.1 现状

- 后端派生 PLACEHOLDER 64×64（spec §2 第 5 行） ✅
- 前端 `expo-image` 接 `placeholder={blurhash}` 字段（SocialMediaFrame.tsx 注释已写）但**实际 Feed 不用**（Gate C 强制禁 PLACEHOLDER）
- `apps/mobile/src/media/AdaptiveMediaCollection.tsx` line 207：`<Image resizeMode="contain">` 用 RN 内置 Image，**不是 expo-image** ← 残留

### 4.2 推荐：**thumbhash** (Square 工程师 / 28B 编码) + **blurhash** (Wolt) 共存

| 格式 | 库 | 优势 | 劣势 |
|---|---|---|---|
| **thumbhash** | `github.com/evanw/thumbhash` (Go port: `github.com/galifornia/go-thumbhash`) | 28 字节编码 + 1.5x 视觉保真 + 可解码任意尺寸 placeholder | 比 blurhash 略大（28B vs 20-30B 实际相近） |
| blurhash | `github.com/bbrks/go-blurhash` | 成熟 (Wolt 2018), 4 年生态 | 暗色场景纹理丢失 |
| LQIP base64 | 手写 | 零依赖 | 30-50x 字节数 |

**对 Proxy 的选型**：
- P0：保留 `image_recipe_v2` PLACEHOLDER 64×64 JPEG（已稳定）
- P0.5：换成 **thumbhash 字符串** 喂 `expo-image.placeholder`，28 字节/张，1.5x 视觉保真
- P1：若暗色海报场景仍糊，再加 blurhash 双轨

### 4.3 expo-image placeholder 接入

```typescript
// SocialMediaFrame.tsx 已经预留：
<ExpoImage
  source={{ uri, blurhash: item.compositionHint?.thumbhash }}
  placeholder={item.compositionHint?.thumbhash}  // ← 服务端下发的 thumbhash
  placeholderContentFit="cover"
  transition={200}
/>
```

但 Gate C 写死 Feed 不渲染 placeholder：保留 `image_recipe_v2` PLACEHOLDER JPEG 给 onError fallback + Gallery 首帧用，Feed 走 image 直接 visible。

→ **不接 thumbhash 也行**，保留现有 PLACEHOLDER 64×64 JPEG。

---

## 5. 视频：现状已是最佳

### 5.1 已接

- `expo-video 57.0.2`（native AVPlayer + AVPlayerViewController）
- `useVideoPlayer` + `VideoView`
- `setup.preferredForwardBufferDuration = 3` (Gate J)
- `enterFullscreen()` 走 native fullscreen（不自造 Modal）
- 静默 / 循环 / 60s 内 autoPlay

### 5.2 不需要再做的

- 视频转码：ffmpeg 派生 H264/H265 mp4 已在 worker（`video_recipe_v1`）
- 装帧优化：native AVPlayer 已是 iOS 顶级
- PiP / AirPlay：expo-video 自动支持

### 5.3 风险

- HEVC/H265 编码费 CPU：考虑 `libx265` 改 `libsvt-av1` 或 `libopenh264`（H264 baseline 兼容性最好）

---

## 6. 端到端管线：可选升级路径

### 6.1 现状

```
upload → ORIGINAL (immutable)
       → ffmpeg v1 派生 (5 档, 永保)
       → ffmpeg v2 派生 (7 档, 含 HINT/NATURAL, 失败不阻塞)
       → FEED_1X 选 hint/cover/natural 三选一 (客户端)
```

### 6.2 推荐升级路径

```
P0 (本期): bimg 替 ffmpeg 字符串 + MediaPipe BlazeFace worker
       → 5 派生档全 bimg 化, FEED_1X_HINT 真接人脸 anchor
P0.5: imagor 独立微服务 (可选, 仅当运营要自定义派生尺寸时)
P1: smartcrop bimg 兜底 + 商品/文字 detector
P2: thumbhash 替 64×64 PLACEHOLDER
```

### 6.3 不推荐的方案

- **Serverless (Lambda + sharp)**：冷启动 200ms+，PASS
- **Thumbor (Python)**：性能差 + 运维复杂，PASS
- **Cloudinary / Imgix**：商业 + 数据出境，PASS
- **Photoshop API**：杀鸡用牛刀，PASS

---

## 7. 与已有 Gate 3 / 5.2.2 / 5.2.1 的对齐

| Gate / 条款 | 当前阻塞 | 开源方案对症 |
|---|---|---|
| Gate A 档位选择 | ✅ 已冻结 | 不动 |
| Gate B 填充策略 | ✅ 已冻结 | 不动 |
| Gate C 禁 PLACEHOLDER | ✅ 已冻结 | 不动 |
| Gate D 深紫黑背景 | ✅ 已冻结 | bimg `Background: 0x0E0A14` 与前端 SocialMediaFrame 一致 |
| Gate E 懒加载 | RN native | 不动 |
| §5.2.1 半身/全身 4:5/9:16 | ⚠️ fixture 没人脸，证据强度低 | MediaPipe BlazeFace 接入后再跑真实人脸图回归 |
| §5.2.2 compositionHint 推理 | ❌ worker 缺失 | ONNX Runtime + BlazeFace-SDF |
| §5.2.2 smart crop fallback | ❌ 无 | bimg SmartCrop (libsaliency) |
| Gate J VIDEO 装帧 < 500ms | ✅ 已冻结 | 不动 |
| §5.4 灰边 / 显示不全专项 | ⚠️ NATURAL 兜底仍可能"小头图+大紫黑" | bimg Background + 真实人脸 anchor |

---

## 8. 落地优先级

| 优先级 | 任务 | 工时 | 负责人 | 阻塞 |
|---|---|---|---|---|
| **P0-1** | bimg 替 ffmpeg 字符串（仅 IMAGE 派生） | 1-2 周 | 后端 platform | Docker 加 libvips |
| **P0-2** | MediaPipe BlazeFace composition worker | 2-3 周 | ML + 后端 | 模型下载、go binding 编译 |
| **P0-3** | 真实人脸 fixture 回归 (复用 `post_45ca5b5f18da5f06659d89cc` 流程) | 0.5 周 | QA | 真人脸测试集脱敏 |
| P1-1 | bimg SmartCrop 兜底 (无人脸时) | 0.5 周 | 后端 | 跟 P0-1 一起做 |
| P1-2 | 商品/文字 detector (PP-PicoDet + DBNet) | 2 周 | ML | 模型下载 |
| P1-3 | thumbhash 替 PLACEHOLDER JPEG | 0.5 周 | 全栈 | 端到端 |
| P2-1 | imagor 独立服务 | 2 周 | SRE | 评估运营需求 |
| P2-2 | AV1 视频编码 (减小 30%) | 1 周 | 后端 | 兼容性测试 |

---

## 9. 参考资料

- bimg 文档：https://github.com/h2non/bimg
- libvips 文档：https://www.libvips.org/API/current/
- imagor：https://github.com/cshum/imagor
- MediaPipe BlazeFace：https://github.com/google/mediapipe/tree/master/mediapipe/tasks/python/vision/face_detector
- smartcrop-go：https://github.com/muesli/smartcrop-go
- thumbhash：https://github.com/evanw/thumbhash
- yalue/onnxruntime_go：https://github.com/yalue/onnxruntime_go
- 项目相关：
  - `architecture/Social_Media_Pipeline_Plan_Gates_R1.md` §5.2.1 + §5.2.2
  - `docs/media-pipeline/image_recipe_v2_spec.md` §5.4
  - `docs/media-pipeline/COMPOSITION_WORKER_SPEC.md` §2 + §6
  - `apps/api-go/internal/media/image_variants_v2.go`
  - `apps/api-go/internal/media/composition.go`
  - `apps/mobile/src/media/SocialMediaFrame.tsx`

---

## 10. 决策记录

- **D1** 不接 imagor，P0 阶段内嵌 bimg（避免运维复杂度）
- **D2** 不接 smartcrop-go，bimg SmartCrop 是 libvips 实现，更快更准
- **D3** MediaPipe BlazeFace-SDF 优先于 YOLOv8n-face（更快更小）
- **D4** thumbhash 推迟 P1，先保留 PLACEHOLDER 64×64 JPEG
- **D5** 不接云视觉 API（隐私红线，COMPOSITION_WORKER_SPEC §11）
- **D6** video 端 expo-video 不动（已最优）
- **D7** 不重复发明：focalPoint 直接接 expo-image contentPosition，contentFit 替代手算 cover/contain
