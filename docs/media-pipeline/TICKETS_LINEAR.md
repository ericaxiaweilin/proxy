# Media Pipeline v2 · 18 工单

> Linear / Jira / GitHub Projects 可直接 import。
> Markdown 格式，含 title / description / labels / estimate / dependencies / acceptance。
> 配套脚本导入：`docs/media-pipeline/import_tickets.sh`（附件）

## 字段说明

- **ID** — 工单号
- **Title** — 标题
- **Sprint** — A / B / C / D / E
- **Gate** — 对应 Plan §12 Gate 0~6
- **Owner Role** — 角色
- **Estimate** — 人天（1d = 1 engineer-day）
- **Priority** — P0 / P1 / P2
- **Depends** — 前置 ID
- **Status** — 状态

---

## Sprint A · Gate 0 + 1（基础合同 + 上传可靠性）

### T-01 · 验收 MediaCompositionHint 合同
- **Sprint**: A | **Gate**: 0 | **Owner**: contracts | **Estimate**: 0.5d | **P**: P0
- **Depends**: —
- **Description**: 验收 `packages/contracts/src/media-composition.ts` 已写。`pnpm --filter @proxy/contracts build` 通过；zod schema 覆盖 §5.2.2（subjectType / faceBoxes / bodyBoxes / textSafeArea / focalPoint / safeCropRect / confidence / recipeVersion）。
- **Acceptance**: contracts build 0 error；schema 字段与 plan §5.2.2 1:1；`resolveFillStrategy` 覆盖回落矩阵 5 类别。

### T-02 · FeedMediaItem 增 compositionHint 字段
- **Sprint**: A | **Gate**: 0 | **Owner**: contracts + mobile | **Estimate**: 1d | **P**: P0
- **Depends**: T-01
- **Description**: 在 `packages/contracts/src/index.ts` 的 `FeedMediaItemSchema` 加 `compositionHint?: MediaCompositionHintSchema`。客户端 zod 解析保持向后兼容（缺字段 → undefined）。
- **Acceptance**: typecheck 通过；旧 payload（无 hint）解析不报错；新 payload 自动填充。

### T-13 · 客户端 preflight：超大 / 动画伪装提前拒绝
- **Sprint**: A | **Gate**: 1 | **Owner**: mobile | **Estimate**: 1d | **P**: P0
- **Depends**: —
- **Description**: `apps/mobile/src/media-client.ts` 的 `uploadImage` 前置校验：>25MB / >20000px 边长 / >80MP / .gif / .apng → 抛明确错误，不进入上传。
- **Acceptance**: 真机选择超大文件立即看到错误；不占用上传带宽；契约测试覆盖 4 种 case。

### T-14 · 后台 URL session + App 暂停续传
- **Sprint**: A | **Gate**: 1 | **Owner**: mobile | **Estimate**: 2d | **P**: P1
- **Depends**: T-13
- **Description**: 切后台 / 杀进程后，OS 接管上传，iOS 返回时收到 progress 回调。Android 暂用 foreground service。
- **Acceptance**: iOS 真机：杀 App → 打开相册 → 30s 内上传继续；重开 App 拿到正确 progress。

---

## Sprint B · Gate 2（派生 + 审核）

### T-03 · Media Composition Worker（服务端推理）
- **Sprint**: B | **Gate**: 2 | **Owner**: media platform + ML | **Estimate**: 5d | **P**: P0
- **Depends**: T-02
- **Description**: 见 `docs/media-pipeline/COMPOSITION_WORKER_SPEC.md`。ONNX + YOLOv8n-face + PicoDet + DBNet；落 JSONB；P95 ≤ 1.5s。
- **Acceptance**: 50 张样本集 85% 分类正确率；safeCropRect IoU ≥ 0.7；超时/失败有 fallback。

### T-04 · image_recipe_v2 派生（5+2 档）
- **Sprint**: B | **Gate**: 2 | **Owner**: media platform | **Estimate**: 3d | **P**: P0
- **Depends**: —
- **Description**: 见 `docs/media-pipeline/image_recipe_v2_spec.md`。v1 不删；新增 FEED_1X_HINT / FEED_1X_NATURAL；五档全部 sRGB + setsar + strip metadata。
- **Acceptance**: ffmpeg 命令复现；SSIM v1 vs v2 ≥ 0.99；色差 ΔE ≤ 2；§11 样本集全过。

### T-05 · v2 Worker 集成到 ProcessAssetNow
- **Sprint**: B | **Gate**: 2 | **Owner**: media platform | **Estimate**: 2d | **P**: P0
- **Depends**: T-03, T-04
- **Description**: 流程改为 Upload → Original READY → CompositionJob → DerivativeJob（消费 hint 出 FEED_1X_HINT）→ READY。
- **Acceptance**: 端到端跑通；DB 有 v2 variant；hint 低置信度时不出 FEED_1X_HINT。

### T-06 · CDN cache key 含 recipe + v1 回落
- **Sprint**: B | **Gate**: 2 | **Owner**: infra | **Estimate**: 1d | **P**: P0
- **Depends**: T-04
- **Description**: CDN cache key 改为 `image_recipe_v2 + variant_id`；客户端 v2 找不到 → 自动 v1。
- **Acceptance**: 手动切 recipe v1，客户端无感；切 v2 立即命中；监控看 v2 hit rate 上升。

### T-10 · PLACEHOLDER variant 全链路接通
- **Sprint**: B | **Gate**: 2 | **Owner**: media + mobile | **Estimate**: 1d | **P**: P1
- **Depends**: T-04
- **Description**: worker 出 PLACEHOLDER；客户端 `SocialMediaFrame` 拿 `placeholderUrl` 先渲染 BlurHash 占位，主图加载完切换。
- **Acceptance**: Feed 首屏 P75 < 300ms（占位先出）；主图加载无闪烁。

---

## Sprint C · Gate 3 + 4（Feed / Gallery / 发布器）

### T-07 · 替换 feed.tsx 媒体组件
- **Sprint**: C | **Gate**: 3 | **Owner**: mobile | **Estimate**: 2d | **P**: P0
- **Depends**: T-02
- **Description**: `surfaces/feed.tsx` 旧 `AdaptiveMediaCollection / AdaptiveMediaRail / SocialMediaFrame / SinglePostImage` 全部迁出，改为 `import from "../media/..."`。
- **Acceptance**: 真机视觉回归（4:5 + 9:16 混合）无灰边；既有测试不退步。

### T-08 · 单图深紫黑底
- **Sprint**: C | **Gate**: 3 | **Owner**: mobile | **Estimate**: 0.5d | **P**: P0
- **Depends**: T-07
- **Description**: `SinglePostImage` 容器背景色 → `#0E0A14`；夜景 / 深色照片 contain 无白边。
- **Acceptance**: iPhone 真机夜景横图 4:3、1:1、1.91:1 三档，无白边。

### T-09 · WALL 取消 1:1 强制 cover
- **Sprint**: C | **Gate**: 3 | **Owner**: mobile | **Estimate**: 0.5d | **P**: P0
- **Depends**: T-07
- **Description**: `MediaWall` 格子高度按 sourceAspect，contain 优先。
- **Acceptance**: 4 / 6 图混合横竖 → 无主体裁切；点进 Gallery 仍按原 sortOrder。

### T-11 · 三档真机视觉矩阵
- **Sprint**: C | **Gate**: 3 | **Owner**: mobile QA | **Estimate**: 3d | **P**: P0
- **Depends**: T-07, T-08, T-09, T-10
- **Description**: iPhone 15 + 小屏 iPhone + Android（Pixel / 三星 / 小米 各 1）真机；§11 样本集简化到 30 张。
- **Acceptance**: 截图矩阵归档到 `architecture/evidence/Media_V2_Visual_R3_2026-XX-XX.md`；Gate 3 可勾选 `[x]`。

### T-12 · Gallery 不丢 index（旋转 / 后台 / 来电）
- **Sprint**: C | **Gate**: 3 | **Owner**: mobile | **Estimate**: 1.5d | **P**: P1
- **Depends**: T-07
- **Description**: `MediaViewer` 关闭后回 Feed 必须恢复 `mediaIndex`；旋转 / 切后台 / 来电不丢。
- **Acceptance**: E2E 真机录屏：3 张帖 → 点第 2 张 → 旋转 → 关闭 → 回到第 2 张。

---

## Sprint D · Gate 5（分享链接）

### T-15 · opaque public ID + Universal Link / App Link
- **Sprint**: D | **Gate**: 5 | **Owner**: api + mobile | **Estimate**: 3d | **P**: P1
- **Depends**: —
- **Description**: `Post.publicId` (uuid v7) + canonical URL `https://proxy.example/p/{publicId}`；iOS `apple-app-site-association` + Android `assetlinks.json`。
- **Acceptance**: 链接在已装 App 时直接跳到 Post；未装时回落到 web（待 T-16）；登录后回跳原 Post。

### T-16 · 公开 Web Post + OG / Twitter Card
- **Sprint**: D | **Gate**: 5 | **Owner**: web | **Estimate**: 4d | **P**: P1
- **Depends**: T-04, T-15
- **Description**: 服务端渲染 web post；OG / Twitter Card 用 SHARE_OG variant；PRIVATE / REMOVED 不可访问（404 + 不泄露存在性）。
- **Acceptance**: Twitter / Facebook / LinkedIn 分享预览正确；爬虫与用户走同一 Visibility Decision；OG 失效时品牌回落图。

---

## Sprint E · Gate 6（运营 / 隐私 / 规模）

### T-17 · 运营 Dashboard（4 板块）
- **Sprint**: E | **Gate**: 6 | **Owner**: infra + data | **Estimate**: 3d | **P**: P2
- **Depends**: T-04, T-07
- **Description**: upload / processing / Feed load / Gallery / 分享 4 板块；按 appVersion / OS / device class / network type 分段。
- **Acceptance**: dashboard 截图归档；告警阈值确定（upload success < 95% / variant fail > 1% 告警）。

### T-18 · 删除/封禁 → CDN 失效演练
- **Sprint**: E | **Gate**: 6 | **Owner**: infra + ops | **Estimate**: 2d | **P**: P2
- **Depends**: T-06
- **Description**: 演练脚本：删除 Post / 封禁 user → CDN 强制 purge；SLA < 60s；归档演练记录。
- **Acceptance**: 演练报告 `architecture/evidence/CDN_Invalidation_Drill_2026-XX-XX.md`；runbook 更新。

---

## 关键路径

```
T-01 → T-02 → T-07 → T-11（最短体验闭环）
                  ↘ T-03 → T-05 → T-11（最完整管线）
```

**最长依赖链**：T-01 → T-02 → T-03 → T-05 → T-11（约 12d calendar）

**最早体验改善点**：T-01 + T-02 + T-07 + T-08 + T-09（仅前端 + 合同，约 5d）
  → 用户即可看到"无灰边 / WALL 不被 1:1 裁切"
  → 不需要等 composition worker（hint 缺失时回落 contain 即可）

## 状态总览

- 🟢 完成：T-01（部分，contract 写好）
- 🟡 进行中：—
- 🔴 待开：17 工单

## 导入建议

- 全部 P0 必做（否则 Gate 2 / 3 不能勾选）：T-01 ~ T-11
- P1（强烈建议）：T-12, T-14, T-15, T-16
- P2（运营必需）：T-17, T-18

## Label 建议（Linear）

`area:media`, `gate:0` ~ `gate:6`, `sprint:a` ~ `sprint:e`, `priority:p0/p1/p2`, `role:contracts/mobile/api/infra/ml/qa/web/ops`
