# 工单 #3 · Media Composition Worker 实现 spec

> 对应 `Social_Media_Pipeline_Plan_Gates_R1.md` §5.2.2
> 目标：服务端给每张图打 `MediaCompositionHint` 标签，前端从"按宽高比猜"升级为"按主体类型 + 安全区"布局

## 1. 职责边界

**做**：检测原图主体类型 / 安全区 / 焦点，输出 §5.2.2 schema 的 `MediaCompositionHint`
**不做**：审核、可见性、压缩、格式转换、CDN 推送

与派生 worker (`image_variants_v2.go`) 解耦：
- composition worker 先跑（轻量，仅 CPU）
- 派生 worker 看到 hint 再出 `FEED_1X_HINT`

## 2. 推理栈（首版建议）

| 选项 | 优点 | 缺点 |
|---|---|---|
| **ONNX Runtime + YOLOv8n-face + PP-PicoDet(人/商品)** | 跨平台、CPU 实时、无外部依赖 | 模型需要量化（~6MB） |
| OpenCV DNN + Haar / HOG | 零依赖、go-binding | 精度低，多人不稳 |
| 调云 API（Rekognition / 腾讯云） | 精度高 | 隐私、延迟、$ |

**首版建议 ONNX Runtime**（Go binding：`github.com/yalue/onnxruntime_go`），可后续替换。

## 3. 输出 schema（落 Postgres + 缓存到 Redis）

```go
type MediaCompositionHint struct {
  MediaAssetID  string
  SubjectType   string  // PERSON | PRODUCT | TEXT_HEAVY | SCENE | MIXED_PERSON_PRODUCT | MIXED_PERSON_TEXT | UNKNOWN
  SubjectCount  int
  FaceBoxes     []MediaBox  // 归一化 [0,1]
  BodyBoxes     []MediaBox
  TextSafeArea  *MediaBox
  FocalPoint    *MediaBox
  SafeCropRect  *MediaBox
  Confidence    float64
  RecipeVersion string  // 永远 = "composition_recipe_v1"
  ComputedAt    time.Time
  ComputeMs     int
}
```

存：
- `media_assets.composition_hint` JSONB
- `media_composition_audit` (asset_id, recipe_version, computed_at, compute_ms, model_versions) 用于回归

## 4. 主体类型决策树

```text
if face_boxes 存在 + body_boxes 存在:
  if text_safe_area 也存在: MIXED_PERSON_TEXT
  elif 商品检测 (picoDet): MIXED_PERSON_PRODUCT
  else: PERSON
elif face_boxes 存在 alone: PERSON (半身)
elif text_safe_area: TEXT_HEAVY
elif 商品检测: PRODUCT
else: SCENE
```

`SafeCropRect` 合并：
- 单人：face + body 联合 bbox
- 多人：所有人脸 + 身体 联合 + 5% padding
- 文字：textSafeArea + 5% padding
- 商品：商品框 + 5% padding
- 混合：union 全部
- SCENE：focalPoint 即可，不出 safeCropRect

## 5. 置信度（confidence）

| 类别 | 计算 |
|---|---|
| PERSON | `min(face_conf, body_conf) * 0.9` |
| TEXT | `text_detect_score * 0.95` |
| PRODUCT | `product_score * 0.9` |
| SCENE | 0.6（默认） |
| UNKNOWN | 0.3 |

前端阈值 `< 0.4` 回落 contain（已在 `resolveFillStrategy` 写死）。

## 6. 异步任务

复用现有 `ProcessingJob` 队列：

```text
Upload → Original READY
  → enqueue(CompositionJob, recipe=composition_recipe_v1)
  → Worker claim
  → 推理 + 写 media_assets.composition_hint
  → enqueue(DerivativeJob, recipe=image_recipe_v2) ← 之前是 v1
  → Worker 出 v2 variant
  → READY
```

需要新增：
- `apps/api-go/internal/media/composition_worker.go`
- `apps/api-go/internal/media/composition_recipe_v1.go`（推理实现）
- `apps/api-go/migrations/025_media_composition_hint.sql`（JSONB 字段）
- `apps/api-go/internal/media/worker.go` 增 `CompositionJob` claim 路径

## 7. 验收 Gate 2 证据

### 7.1 命中率

样本集 200 张（§11 简化为 50 张可起步）：
- 主体类型分类正确率 ≥ 85%
- safeCropRect IoU 与人工标注 ≥ 0.7

### 7.2 性能

- CPU（4 核）：单图 ≤ 200ms
- GPU（若有）：单图 ≤ 50ms
- 队列 P95：上传完成到 hint 入库 ≤ 1.5s

### 7.3 视觉回归

接入 v2 派生后：
- 全身 9:16 contain 无白边
- 4:5 + 9:16 混排无主体裁切
- 文字海报可读
- 商品不切边

## 8. 失败与回滚

- 模型加载失败 → CompositionJob FAILED → 派生 worker 跳过 `FEED_1X_HINT`，走 `FEED_1X_NATURAL` 兜底
- 推理超时（> 5s）→ 写 UNKNOWN + confidence=0.3 → 前端 contain
- Postgres JSONB 写失败 → 进死信队列 → 人工补跑

## 9. 依赖与版本

- `onnxruntime_go v1.18+`
- 模型权重：
  - YOLOv8n-face（人脸检测，6MB）
  - YOLOv8n-pose（身体关键点，13MB，可选）
  - PP-PicoDet（商品/通用，8MB）
  - DBNet（文字检测，5MB）
- 合计 ~32MB，量化后可压到 ~12MB

## 10. 落地路径

1. 拉模型 + 量化 → 放到 `apps/api-go/internal/media/models/`（git lfs 或外部 bucket）
2. 实现 `composition_recipe_v1.go` 接口（mock 先出假数据）
3. 接 `ProcessingJob` 队列
4. 跑 §11 样本集 50 张 → 调阈值
5. 接派生 worker 消费 hint
6. 客户端 `FeedMediaItem.compositionHint` zod 校验
7. Gate 2 勾选 `[x]`

## 11. 风险

- **首次冷启动**：模型加载 1-2s → 需要 warm pool 或预加载
- **iOS / Android 隐私**：本 worker **服务端跑**，不动端上模型，零端侧风险
- **合规**：人脸坐标是数学数据，不构成生物特征；中国 / 越南 / 印尼等市场先法务过一遍存证周期

## 12. 签字

- [ ] ML/平台 lead
- [ ] 隐私法务
- [ ] 后端 platform lead
- [ ] Pipeline R1 owner
