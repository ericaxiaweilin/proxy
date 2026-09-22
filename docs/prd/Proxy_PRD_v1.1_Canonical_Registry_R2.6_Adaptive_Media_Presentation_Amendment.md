# Proxy PRD v1.1 — Canonical Registry R2.6 Adaptive Media Presentation Amendment

**状态**：CANONICAL AMENDMENT  
**基础**：R2.5 Real Network Amendment

---

# 最新优先级

发生冲突时：

```text
R2.6 Adaptive Media Presentation Amendment
→ Chapter 21I R2
→ Engineering Acceptance R10
→ R2.5 Real Network Amendment
→ Engineering Acceptance R9
→ R2.4 Location Context Amendment
→ Chapter 21H R2
→ Engineering Acceptance R8
→ older canonical sources
```

---

# Canonical Decisions

1. Post P0 支持 `0–6` 个 MediaAsset。
2. 单图必须按媒体比例自适应显示，不使用统一固定死尺寸。
3. `2–6` 个媒体使用圆角横向滑动 Adaptive Media Rail，不采用固定九宫格。
4. Media Rail 的媒体顺序由稳定的 `media_refs / sort_order` 决定。
5. Feed Read Model 必须 Hydrate `width / height / aspect_ratio / processing_status`。
6. 只有允许公开且 `READY` 的媒体可进入正式 Feed 展示。
7. 点击任意 Media 应从对应 index 进入全屏 Viewer，并可左右滑动。
8. Post Media 容器必须兼容 `IMAGE | VIDEO`，但不因此把 Proxy 变成 TikTok-style 视频 Feed。
9. Media engagement 只能作为辅助信号，不得成为 Feed North Star 或 Agent Reliability。
10. Post / Media 数据结构支持多资产后，横滑主要属于 Client Presentation，但其 Read Model 与 READY / ordering 属于服务端契约。
