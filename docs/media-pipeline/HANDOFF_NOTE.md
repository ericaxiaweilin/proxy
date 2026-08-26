# Media Pipeline v2 落地包 · 网络恢复后执行

> 服务器网络中断期间，落到本地的全部产出。
> 网络恢复后，按本说明推服务器备份。

## 目录结构

```
docs/media-pipeline/
├── HANDOFF_NOTE.md            ← 本文件
├── PR_DESCRIPTION.md          ← PR description（推到代码托管）
├── image_recipe_v2_spec.md    ← recipe v2 冻结 spec（后端 + 平台 + design 评审用）
├── COMPOSITION_WORKER_SPEC.md ← 工单 T-03 实现 spec
├── TICKETS_LINEAR.md          ← 18 工单矩阵
├── import_tickets.sh          ← Linear API 导入脚本（待你提供 token 后跑）
└── EVIDENCE_LOG.md            ← （占位）typecheck / build 通过记录
```

## 已交付的代码改动

```
新增（不动现有文件）：
  packages/contracts/src/media-composition.ts        (2512B)
  packages/contracts/src/index.ts                    (修改：re-export)
  apps/mobile/src/media/SocialMediaFrame.tsx         (3414B)
  apps/mobile/src/media/AdaptiveMediaCollection.tsx  (7635B)
  apps/mobile/src/media/README.md                    (2028B)
  apps/api-go/internal/media/image_variants_v2.go   (6164B)
  docs/media-pipeline/image_recipe_v2_spec.md       (4623B)
  docs/media-pipeline/PR_DESCRIPTION.md
  docs/media-pipeline/COMPOSITION_WORKER_SPEC.md
  docs/media-pipeline/TICKETS_LINEAR.md
  docs/media-pipeline/HANDOFF_NOTE.md
```

## 质量门状态

- ✅ `pnpm --filter @proxy/contracts build` 通过
- ✅ `pnpm --filter @proxy/mobile typecheck` 通过（0 errors）
- ⏳ Go 端 `image_variants_v2.go` 仅 stub，未编译（缺 ffmpeg + 你们的 model 依赖路径，需 Sprint B 启动时接）

## 网络恢复后执行步骤

### Step 1 · 推代码

```bash
cd ~/Desktop/kake
# 验证未污染任何现有文件
git status --short

# 提交新增（建议拆 2 个 commit：contracts / mobile+docs）
git add packages/contracts/src/media-composition.ts \
        packages/contracts/src/index.ts

git add apps/mobile/src/media/ \
        apps/api-go/internal/media/image_variants_v2.go \
        docs/media-pipeline/

git commit -m "feat(media): pipeline v2 — composition hint + image_recipe_v2 + WALL 反 1:1 裁切

见 docs/media-pipeline/PR_DESCRIPTION.md
对应 architecture/Social_Media_Pipeline_Plan_Gates_R1.md §5.2.1 / §5.2.2"

git push origin <your-branch>
```

### Step 2 · 推服务器备份（rsync / scp）

```bash
rsync -avz --progress ~/Desktop/kake/docs/media-pipeline/ \
    <user>@<server>:/backup/proxy/media-pipeline-$(date +%Y%m%d)/

# 也备份新增的源文件
rsync -avz --progress \
    ~/Desktop/kake/packages/contracts/src/media-composition.ts \
    ~/Desktop/kake/apps/mobile/src/media/ \
    ~/Desktop/kake/apps/api-go/internal/media/image_variants_v2.go \
    <user>@<server>:/backup/proxy/media-pipeline-src-$(date +%Y%m%d)/
```

### Step 3 · 起 sprint planning

- 复制 `TICKETS_LINEAR.md` 到 Linear / Jira / GitHub Projects
- 18 工单按 Sprint A→E 入 board
- 关键路径：T-01 → T-02 → T-07 → T-11（约 5d 即可看到"无灰边"）
- 最长路径：T-01 → T-02 → T-03 → T-05 → T-11（约 12d 全管线）

### Step 4 · 关键评审

- 后端 platform lead 审 `image_variants_v2.go` 的 ffmpeg 滤镜字符串
- ML / 隐私法务 审 `COMPOSITION_WORKER_SPEC.md` 的人脸坐标存证周期
- Design R3 owner 审 `#0E0A14` 是否在主题 token 体系内

## 下次断网期间可继续做

如果再有网络中断，你可以在本地继续：

1. 起 1~2 个工单的 **实际编码**（比如 T-13 客户端 preflight）
2. 写 **E2E 测试脚本**（vitest + Detox）
3. 写 **监控指标定义**（PromQL / Grafana dashboard JSON）
4. 补 §11 样本集资产清单（注明哪些需要拍摄 / 哪些需法务授权）

这些都不需要网络。

## 风险与已知问题

- `image_variants_v2.go` 仅 stub：ffmpeg 命令字符串是按 spec 写的，**未在真实 ffmpeg 上跑过**。Sprint B 启动必须先在 dev box 验证。
- `resolveFillStrategy` 阈值（0.4）是我猜的，需 Sprint B 跑样本集后调
- WALL 格子 4:5 / 9:16 / 横图 实际比例是 `Math.max(4/5, aspect)`，**横图格子会变方**（这是 spec §5.2 隐含行为，**需 design 确认**）
- `AdaptiveMediaCollection` 还没写测试（vitest），Sprint C 启动前补
