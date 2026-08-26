# Video P0 — 范围冻结 & 未来扩展路径

> 配套实现：`apps/api-go/internal/media/service.go` (P0 视频管线)
> PRD：`Proxy_PRD_v1.1_Chapter06A_Content_Sharing_Video_Live.md` §9-12
> 状态：P0 冻结（2026-08-16 commit `3d1fe99`）

## 1. P0 当前范围（已交付 ✅）

普通视频：upload → thumbnail → play / pause / seek / fullscreen / caption / share。

**FFmpeg 标准化链**（本机 ffmpeg 8.0.1）：
```
ffprobe 读时长/分辨率/codec
  → ffmpeg 转 H.264+AAC MP4+faststart
  → 第 1 秒缩略图
  → media_store（模拟对象存储）
  → playback_url
```

**状态机**：`UPLOADING → PROCESSING → READY | FAILED`，**只有 `READY` 可播**。

**铁证**：HEVC .mov（手机不兼容）→ 处理 → READY → H.264+AAC MP4 41KB + thumbnail + `playable=True`（fresh-db 30 表 PASS）。

---

## 2. P0 显式不做 — 按"永远不做 / 未来要做"分类

| 能力 | P0 状态 | 触发条件 | 目标版本 |
|---|---|---|---|
| **HLS 多码率切片** | ❌ 不做 | **单视频 > 5 分钟** 或 用户群有"边下边播"诉求 | **P1 必做** |
| **ABR 自适应码率** | ❌ 不做 | HLS 落地后随之上（无 HLS 不可能 ABR） | P1（与 HLS 一起） |
| **转码集群** | ❌ 不做 | 单机 worker 处理不过来（日上传 > ~1000 视频） | P2 |
| **直播（推流 + ingest）** | ❌ **永远不做** | — | — |
| **WebRTC（P2P 双向）** | ❌ **永远不做** | — | — |

### 2.1 "永远不做"的原因

- **直播**：不是 Proxy 产品方向。Proxy 是"Agent 接单 + 内容分享"，不是"主播平台"。**对接此条前需产品方向变更**。
- **WebRTC**：1v1 双向实时音视频（视频会议/客服形态），同样不在产品方向内。**对接此条前需产品方向变更**。

### 2.2 "P1 必做" — HLS 路径

**触发场景**（任一即启动）：
1. PM 决定支持"Agent 上传讲解视频 / 商家上传店铺介绍视频"等**单视频 > 5 分钟**的形态
2. 客服/调研显示用户对"打开视频要等很久"或"看到一半卡住"的不满
3. iOS App Store 审核对 > 50MB 视频要求渐进式播放

**P1 设计要点**（先记一下，避免重新设计）：
- **入流**：现有上传路径不变，**worker 端 FFmpeg 多走一步**出 HLS 切片
- **出流**：现有 `playback_url` 改成 master `.m3u8`（引用 3 档子 playlist），客户端用 `expo-video` 播 HLS（**已经原生支持**，无需新 SDK）
- **降级**：HLS 失败回退到单 MP4（保留 P0 兜底）
- **与 image pipeline 隔离**：HLS 不影响 `MediaAsset.ProcessingStatus` 语义
- **不做**：ABR 客户端带宽预测（先固定 3 档：360p/720p/1080p，按 `viewport` 选最高不超过屏宽的档）

**HLS 落地工单清单**（P1 启动时拆）：
- [ ] T-HLS-01 FFmpeg 切片脚本 + 档位配置
- [ ] T-HLS-02 `MediaAsset.HLSMasterPlaylist` / `HLSVariant[]` 字段 + migration
- [ ] T-HLS-03 客户端 `expo-video` source 切换到 m3u8
- [ ] T-HLS-04 HLS 失败 → MP4 降级（`processingStatus` 语义）
- [ ] T-HLS-05 e2e：5min 视频 → HLS → iOS 渐进式播放（断网重连验证）

---

## 3. 与 image pipeline 的边界

| 维度 | Image Pipeline | Video Pipeline (P0) |
|---|---|---|
| 主体 | 上传图 → 多档派生 → composition hint → Feed | 上传视频 → 标准化 → 单一 MP4 |
| Composition 推理 | ✅ 有（PERSON/SCENE 几何） | ❌ VIDEO 跳过 `ComposeAssetNow`（worker 里显式 return） |
| Adaptive Media Rail | ✅ WALL/RAIL/SINGLE 三模式 | ✅ R14 §16 VIDEO 进 Feed（`durationMs` 角标） |
| FFmpeg 9 兼容 | ✅ 已加 `-autorotate` + `setsar=1,format=yuvj420p` | ✅ 同样适用（同一 worker 调用） |

**关键不变量**：VIDEO 不进 composition pipeline（worker.go 显式 `if asset.MediaType != "IMAGE" return nil`），避免给视频算 face box 这种语义错误。

---

## 4. 决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-08-16 | P0 视频范围冻结 | PRD 06A：MVP 只要求"普通视频正常播放" |
| 2026-08-16 | 显式不做 HLS/ABR/集群/直播/WebRTC | P0 launch scope 不含；防 scope creep |
| 2026-08-26 | **HLS 升格为"P1 必做"，标注触发条件** | 业务侧出现"Agent 讲解视频 / 商家店铺介绍"等 > 5min 视频场景诉求 |
| 2026-08-26 | 直播 / WebRTC 维持"永远不做" | 不在 Proxy 产品方向内 |

---

## 5. 未来 Sprint 启动时检查清单

启动 P1 HLS 工作时，确认：
- [ ] 触发条件已满足（产品 / 客服 / 审核 至少一项）
- [ ] 拍板是否同步上 ABR（默认：是）
- [ ] 转码集群是否也需要（看日上传量）
- [ ] 客户端 `expo-video` 版本是否支持 HLS（当前应该已支持，需验证）
- [ ] EVIDENCE_LOG.md 增加 HLS 真机播放证据
