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
  offsets: number[];
  railHeight: number;
} {
  const layout = portraitRailLayout(items, contentWidth);
  let cursor = 0;
  const offsets: number[] = [];
  const cardWidths = items.map((item) => {
    const width = layout.portraitSet
      ? layout.portraitCardWidth
      : Math.max(contentWidth * 0.72, Math.min(contentWidth * 0.92, layout.railHeight * mediaAspect(item)));
    offsets.push(cursor);
    cursor += width + gap;
    return width;
  });
  return { cardWidths, offsets, railHeight: layout.railHeight };
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
  // 【fix 2026-08-26】只对"差异极大"才 contain：避免 4:5 portrait（0.8）在 1.91 frame 里被 contain
  // （会让 1.91 frame 上下大段空白）。差异 < 30% 信任 frame 比例 cover，> 30% 触发 contain。
  // 0.5625 portrait in 1.91 frame  ratio = 0.29 → contain (含人像全身)
  // 0.8 in 0.85 frame            ratio = 0.94 → cover (差不多)
  // 1.5 in 1.91 frame            ratio = 0.78 → cover
  // 1.0 in 0.5 frame             ratio = 2.0  → contain
  if (frameAspect <= 0) return true;
  const ratio = sourceAspect / frameAspect;
  // 阈值选 0.75 (4:5 in 3:5 frame ratio=0.75) + 1.34 (4:3 in 16:9 frame)：
  // 9/16 in 4/5 frame  → 0.703 < 0.75 → contain (保护人像)
  // 4/5 in 4/5 frame   → 1.0  → cover
  // 16/9 in 4/3 frame  → 1.33 < 1.34 → cover
  // 1.0 in 0.5 frame   → 2.0  > 1.34 → contain
  return ratio <= 0.75 || ratio >= 1.34;
}
