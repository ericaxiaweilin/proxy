# Proxy R14 — API & State Contract R2 — Media Rail Amendment

**基础**：API & State Contract R1  
**目标**：让 Post 真实 API 能稳定支持 0–6 个自适应 MediaAsset。

---

# 1. Post Create / Read

建议：

```text
POST /posts
GET  /posts/:id
GET  /feed
```

`POST /posts`：

```json
{
  "body": "...",
  "mediaRefs": [
    {"mediaAssetId":"media_1","sortOrder":0},
    {"mediaAssetId":"media_2","sortOrder":1}
  ]
}
```

P0：`mediaRefs.length <= 6`。

---

# 2. Feed Read Model

```json
{
  "postId": "post_...",
  "media": [
    {
      "mediaAssetId": "media_1",
      "mediaType": "IMAGE",
      "thumbnailUrl": "...",
      "playbackUrl": null,
      "width": 1440,
      "height": 1920,
      "aspectRatio": 0.75,
      "durationMs": null,
      "processingStatus": "READY",
      "sortOrder": 0
    }
  ]
}
```

客户端以 Read Model 渲染，不从原始 storage key 自己拼 URL。

---

# 3. Media Asset API Reserve

普通媒体基础能力建议保留：

```text
POST /media/uploads
POST /media/:id/complete
GET  /media/:id
```

未来 VIDEO P0 可以在同一 MediaAsset 上增加 processing / playback，而不用修改 Post 契约。

---

# 4. Client State

客户端只缓存：

```text
current rail index
viewer index
image cache
feed scroll position
```

服务端真源：

```text
media order
media READY state
public visibility
width / height / aspect ratio
playback reference
```
