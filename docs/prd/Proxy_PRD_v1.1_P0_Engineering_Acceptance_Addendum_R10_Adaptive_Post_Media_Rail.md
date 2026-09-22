# Proxy PRD v1.1
## P0 Engineering Acceptance Addendum R10 — Adaptive Post Media Rail

**状态**：P0 ENGINEERING GATE  
**依赖**：Canonical Registry R2.6 / Chapter 21I R2 / Acceptance R9

---

# Gate A — Media Count

Post 必须支持：

```text
0–6 MediaAsset
```

`7+` 不允许客户端静默截断后发布成功。

---

# Gate B — Single Media Is Adaptive

`media_count = 1` 时：

- 按 `width / height / aspect_ratio` 自适应；
- 不得统一强制固定 16:9 或固定高度；
- 不得为了模板整齐大面积裁切主体；
- 极端长图允许限制 Feed 最大高度，但必须能进入完整 Viewer。

---

# Gate C — Multi Media Uses Horizontal Rail

`media_count = 2..6`：

```text
rounded cards
horizontal scroll
inertia
partial next-card reveal
soft snap optional
```

不得退化为固定九宫格。

---

# Gate D — Stable Ordering

服务端必须返回稳定的媒体展示顺序：

```text
media_asset_id
sort_order
```

同一 Post 多次读取不得随机换序。

---

# Gate E — Ready Media Only

公开 Feed 只能呈现满足公开策略且：

```text
processing_status = READY
```

的媒体。

PROCESSING / FAILED / REMOVED 不得伪装成可正常查看的正式媒体。

---

# Gate F — Feed Media Read Model

至少包含：

```text
media_asset_id
media_type
thumbnail_url?
playback_url?
width
height
aspect_ratio
duration_ms?
processing_status
sort_order
```

前端不得从文件名猜比例，也不得用作者 Post 文本字段伪造媒体状态。

---

# Gate G — Gallery Viewer

点击第 N 张 Media：

- Viewer 必须从第 N 张开始；
- 支持左右滑到其它媒体；
- 关闭后回原 Post；
- 不应因为打开 Gallery 丢掉 Post / Conversation / Attribution context。

---

# Gate H — Mixed Aspect Ratios

至少用以下 fixture 通过 UI Gate：

```text
landscape
portrait
square
mixed 3-item post
mixed 6-item post
```

不得出现明显拉伸、变形或固定死框。

---

# Gate I — IMAGE / VIDEO Compatible Container

Post Media 容器必须允许：

```text
IMAGE
VIDEO
```

R10 不要求 Native Live，不要求 TikTok-style immersive video feed。

普通 VIDEO 未上线前，IMAGE rail 不能因为预留视频而阻塞。

---

# Gate J — Media Events Are Analytics, Not Truth

可记录：

```text
MEDIA_IMPRESSION
MEDIA_OPEN
MEDIA_SWIPE
GALLERY_OPEN
GALLERY_INDEX_VIEW
```

但这些事件不能替代 Post / MediaAsset 真源，也不能直接成为 Agent Reliability。
