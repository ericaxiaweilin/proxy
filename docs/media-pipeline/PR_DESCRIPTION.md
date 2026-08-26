# PR · Media Pipeline v2 (composition hint + 深紫黑底 + WALL 反 1:1 裁切)

> 内部 PR description。推到自家服务器前 review 一次。

## 标题

`feat(media): pipeline v2 — composition hint + image_recipe_v2 + 反 1:1 裁切`

## 背景

`Social_Media_Pipeline_Plan_Gates_R1.md` §5.2.1 / §5.2.2 多数 Gate 仍 BLOCKED。
当前 `surfaces/feed.tsx` 的媒体组件有 3 个**用户能直接看到**的问题：

1. **灰边**：`socialMediaFrame` 父容器背景透明，夜景 / 深色照片 contain 出现白 / 灰边
2. **WALL 1:1 强制 cover**：4 / 6 图混合横竖 → 主体被吃
3. **中心裁切**：纯宽高比启发式，没人脸 / 身体 / safeCropRect 概念

## 改动

### 新增（不动现有文件）

- `packages/contracts/src/media-composition.ts` — `MediaCompositionHint` zod schema + `resolveFillStrategy()`
- `packages/contracts/src/index.ts` — re-export（已加 `.js` 后缀兼容 NodeNext）
- `apps/mobile/src/media/SocialMediaFrame.tsx` — 深紫黑 `#0E0A14` 底 + 服务端 hint 驱动 fill
- `apps/mobile/src/media/AdaptiveMediaCollection.tsx` — WALL 取消 1:1，按 sourceAspect 比例
- `apps/mobile/src/media/README.md` — 替换指南
- `apps/api-go/internal/media/image_variants_v2.go` — recipe v2 stub（7 档 / sRGB / setsar / strip）
- `docs/media-pipeline/image_recipe_v2_spec.md` — 冻结 spec

### 关键设计选择

- **深紫黑 `#0E0A14`** = 与品牌 violet 一致，避免夜景照 contain 出现强白边
- **`FEED_1X_NATURAL`** = v2 新增：原比例 + 补深紫黑，服务端兜底客户端 contain 时的"灰边"
- **WALL 高度按 sourceAspect** = 横竖混合不强行 1:1
- **compositionHint 低置信度 (< 0.4) 回落 contain** = 宁可不裁，不中心裁
- **v1 不删** = 旧 variant 保留 6 个月，CDN cache key 区分

## 验收

- ✅ `pnpm --filter @proxy/contracts build` 通过
- ✅ `pnpm --filter @proxy/mobile typecheck` 通过（0 errors）
- ⏳ §11 样本集视觉回归（iPhone 15 + 小屏 iPhone + Android 三档真机）
- ⏳ SSIM v1 vs v2 ≥ 0.99，色差 ΔE ≤ 2
- ⏳ 全身 9:16 contain 无白边
- ⏳ 4 图混合横竖无主体裁切

## 风险与回滚

- 新组件在 `apps/mobile/src/media/`，**未替换 feed.tsx** → 当前生产行为零变化
- 替换后若视觉回归：单档 FAILED → 客户端 fallback v1
- v2 worker 全失败：v1 仍在 → 服务无中断

## 关联

- Plan：`architecture/Social_Media_Pipeline_Plan_Gates_R1.md`
- 工单矩阵：`docs/media-pipeline/TICKETS_LINEAR.md`
- 后续 PR：
  - composition worker（工单 #3）
  - `surfaces/feed.tsx` 实际替换（工单 #7）
  - CDN cache key 切换（工单 #6）

## Reviewer checklist

- [ ] 后端 platform lead：image_variants_v2.go stub 是否对齐你们 ffmpeg 链
- [ ] iOS tech lead：MediaCompositionHint 字段是否覆盖真机场景
- [ ] Android tech lead：setsar 修复是否对你们的低密度屏有副作用
- [ ] Design R3 owner：深紫黑 `#0E0A14` 是否在主题 token 体系内
- [ ] Pipeline R1 owner：v1 / v2 并行窗口是否需要 SLA
