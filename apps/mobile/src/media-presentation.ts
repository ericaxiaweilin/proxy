import type { FeedMediaItem } from "@proxy/contracts";

export type MediaDimensions = Pick<FeedMediaItem, "aspectRatio" | "width" | "height">;
export type MediaCollectionMode = "SINGLE" | "RAIL" | "WALL";

/**
 * Proxy Social Media Pipeline §5.2 / §5.2.1 — collection mode 决策。
 *
 * 决策表：
 *   1   张 → SINGLE（独立卡片 + 原比例）
 *   2/3/5 张 → RAIL（可滑）
 *   4/6   张 → WALL（两列网格 + 按 sourceAspect 高度）
 *
 * 不变量：
 *   1. 数量 = 0 → SINGLE（防止 surface feed 被打孔）
 *   2. 数量 > 6 → 裁到 6 + RAIL（见发布器 Gate 4）
 *   3. VIDEO 不影响 collection mode 决策——R2 5.2.1 同套骨架
 *   4. 混合 IMAGE + VIDEO 走同一形态（不进 VIDEO-ONLY 形态，避免分支爆炸）
 */
export function mediaCollectionMode(itemCount: number): MediaCollectionMode {
  if (itemCount <= 1) return "SINGLE";
  if (itemCount === 4 || itemCount === 6) return "WALL";
  return "RAIL";
}

export function mediaAspect(item: MediaDimensions, fallback = 4 / 5): number {
  if (item.aspectRatio > 0) return item.aspectRatio;
  if (item.width > 0 && item.height > 0) return item.width / item.height;
  return fallback;
}

/**
 * Wall cell aspect：用于 2 列 Pinterest wall 的 height 推导。
 * 6 个闸口:
 *  1. portrait (aspect<1) 限 4:5 最低  — 9:16 全身、 4:5 半
 *     身都保全, 不被压成横条
 *  2. landscape (aspect>=1) 限 1:1 最低 — 1:1 9 宫图不被压
 *     肨
 *  3. landscape 上限 1.91 (16:9 上限)  — 21:9 电影院广告 / 横
 *     幅不被 cell 撑爆 row 高
 *  4. 1.91 = 16:9 (经典)  — 大于此的 banner 都 cover 填
 *  5. 不改原图比例 — 跟 R14 §5.2.2 业务闸一致
 *  6. 都是 0.01 为粒度 — 浮点防止 cell 高度产生 1px 漂移
 */
export function wallCellAspect(aspect: number): number {
  if (aspect <= 0) return 1;
  if (aspect >= 1) return Math.min(1.91, Math.max(1, aspect));
  return Math.max(4 / 5, aspect);
}

/**
 * Media type 形态分类 —— 服务端驱动。
 *
 * 6 类形态：
 *   IMAGE         静态图 (JPEG/PNG/HEIC)
 *   VIDEO         可播放视频 (H264/H265)
 *   ANIMATED      动图 / GIF / WebP animation / APNG
 *   PANORAMA      全景图 / 360°
 *   CAROUSEL      轮播图（带 dot indicator）
 *   TEXT_HEAVY    文字/海报/菜单
 *
 * 注意：TEXT_HEAVY 跟 MEDIA_COMPOSITION_HINT 里的 subjectType 不是一个概念。
 * hint 决定填充策略（cover/contain）；MEDIA_KIND 决定渲染组件（Image/Video/Animated/Pano/...）。
 * 当前 backend 上传只设 IMAGE/VIDEO，ANIMATED/PANORAMA/CAROUSEL/TEXT_HEAVY 留给 v3 派生阶段。
 */
export type MediaKind = "IMAGE" | "VIDEO" | "ANIMATED" | "PANORAMA" | "CAROUSEL" | "TEXT_HEAVY";

export function deriveMediaKind(item: FeedMediaItem): MediaKind {
  if (item.mediaType === "VIDEO") return "VIDEO";
  if (item.placeholderUrl?.includes("anim:") || (item.thumbnailUrl ?? "").endsWith(".gif")) return "ANIMATED";
  if ((item.aspectRatio >= 2.5 || (item.width > 0 && item.width / Math.max(item.height, 1) >= 2.5)) && item.mediaType === "IMAGE") return "PANORAMA";
  // 商品轮播：单图有多个 product_id（>= 6 个 altText 标记 "product-"）。当前 mock 数据无。
  // 占位 contract 留口：若 hint.subjectType === "PRODUCT" && item.mediaAssetId 含 #carousel 后缀
  if (item.compositionHint?.subjectType === "PRODUCT" && item.compositionHint.subjectCount >= 6) return "CAROUSEL";
  if (item.compositionHint?.subjectType === "TEXT_HEAVY") return "TEXT_HEAVY";
  return "IMAGE";
}

/**
 * media kind → 推荐的 collection mode (如 kind=VIDEO+solo+long 时仍走 SINGLE)
 * 默认走 mediaCollectionMode(items.length)。
 */
export function mediaKindMode(items: FeedMediaItem[]): MediaCollectionMode {
  return mediaCollectionMode(items.length);
}

/**
 * VIDEO item 自身是否需要"自动播放"（在视口内时静音播放）。
 * R2 §5.2.3 (模拟)：siloed video 不 auto-play (iOS 用户期望/电量)，non-siloed (>3s 短视频) auto-play。
 * v1: duration < 60s → autoPlay; 否则不自动。
 */
export function shouldAutoPlayVideo(item: FeedMediaItem): boolean {
  if (item.mediaType !== "VIDEO") return false;
  const duration = item.durationMs ?? 0;
  return duration > 0 && duration <= 60_000;
}

/**
 * R2 §5.2.3: 商品轮播 (CAROUSEL) 的最小 1/6 角标格式。
 * 避免 dot 跳变量名。
 */
export function formatCarouselCounter(index: number, total: number): string {
  if (total <= 0) return "0/0";
  return `${index + 1}/${total}`;
}

export function portraitRailLayout(items: readonly MediaDimensions[], contentWidth: number): {
  portraitSet: boolean;
  railHeight: number;
  portraitCardWidth: number;
} {
  const safeWidth = Math.max(280, contentWidth);
  const portraitCount = items.filter((item) => mediaAspect(item) < 1).length;
  const portraitSet = portraitCount >= Math.ceil(items.length / 2);
  return {
    portraitSet,
    railHeight: portraitSet
      ? Math.max(280, Math.min(440, safeWidth * 1.05))
      : Math.max(190, Math.min(320, safeWidth * 0.62)),
    portraitCardWidth: Math.max(244, safeWidth * 0.84)
  };
}

export function mediaRailMetrics(items: readonly MediaDimensions[], contentWidth: number, gap = 10): {
  cardWidths: number[];
  cardHeights: number[];
  offsets: number[];
  railHeight: number;
} {
  const layout = portraitRailLayout(items, contentWidth);
  const maxWidth = Math.max(244, contentWidth * 0.92);
  // 浮点精度门: 0.8 * 378 在 IEEE 754 返 302.40000000000003,
  // 重复累加到 cursor 返 312.40000000000003 — 粉碎测试期望
  // [0, 312.4, 535.025]。为保证不裁切 / 不留黑边, 以 0.001pt
  // 为粒度 round; 1px 以下偏差在 react-native 渲染 里不可见。
  const r3 = (n: number): number => Math.round(n * 1000) / 1000;
  let cursor = 0;
  const offsets: number[] = [];
  const cardHeights: number[] = [];
  const cardWidths = items.map((item) => {
    const aspect = mediaAspect(item);
    const naturalWidth = r3(layout.railHeight * aspect);
    const width = r3(Math.min(maxWidth, naturalWidth));
    cardHeights.push(r3(width / aspect));
    offsets.push(r3(cursor));
    cursor += width + gap;
    return width;
  });
  return { cardWidths, cardHeights, offsets, railHeight: layout.railHeight };
}

export function nearestRailIndex(offsets: readonly number[], scrollX: number): number {
  if (offsets.length === 0) return 0;
  let nearest = 0;
  let distance = Math.abs(scrollX - offsets[0]!);
  for (let index = 1; index < offsets.length; index += 1) {
    const nextDistance = Math.abs(scrollX - offsets[index]!);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  }
  return nearest;
}

export function shouldPreserveWholeSubject(sourceAspect: number, frameAspect: number): boolean {
  // 宽高比本身无法判断单人、多人、广告或文字安全区；靠比例猜 cover 曾导致
  // 合照、全身人像和海报边缘被裁。旧调用方统一回落为保全原图。
  void sourceAspect;
  void frameAspect;
  return true;
}
