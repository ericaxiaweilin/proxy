# Proxy R14 — Adaptive Media Rail UI / Backend Alignment

## 产品形态

```text
0 张 → 纯文字
1 张 → 自适应比例大图
2–6 张 → 圆角横向滑动 Rail
```

不是：

```text
固定尺寸 Banner
固定九宫格
所有图强制同宽同高
```

## 后端责任

```text
media_refs / relation
stable ordering
READY filtering
width / height / aspect_ratio
thumbnail / playback read model
```

## 客户端责任

```text
adaptive geometry
horizontal scrolling
partial next item reveal
viewer
restore index / scroll context
```

## P0 上限

```text
6 Media / Post
```

VIDEO 保留同一容器兼容性；普通视频处理链可稍后实现。
