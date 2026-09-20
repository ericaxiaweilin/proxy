import type { FeedMediaItem } from "@proxy/contracts";

export type MediaDimensions = Pick<FeedMediaItem, "aspectRatio" | "width" | "height">;
export type MediaCollectionMode = "SINGLE" | "RAIL";

/**
 * MEDIA-ROW-HARDEN-001 (2026-09-20)：collection mode 决策。
 *
 * 决策表：
 *   1     张 → SINGLE（独立卡片 + 原比例）
 *   2+    张 → RAIL（横滑，默认一屏露 2 张整图，见 mediaRowMetrics）
 *
 * 之前 4/6 张单独走 WALL（两列 Pinterest 网格，格高按每张自己的
 * sourceAspect 算）——真机上传的真实照片宽高比跟模拟器种子图差很多，
 * WALL 和旧 RAIL 都会按 source aspect 撑出偏大的格子/卡片（"每张都很大"，
 * 模拟器种子图凑巧比例温和才没露出来）。现在数量只决定"单图还是多图"，
 * 2 张以上一律走同一条固定尺寸的横滑规则，不再有两套并行的多图形态。
 *
 * 不变量：
 *   1. 数量 = 0 → SINGLE（防止 surface feed 被打孔）
 *   2. 数量 > 6 → 裁到 6 + RAIL（见发布器 Gate 4）
 *   3. VIDEO 不影响 collection mode 决策——R2 5.2.1 同套骨架
 */
export function mediaCollectionMode(itemCount: number): MediaCollectionMode {
  return itemCount <= 1 ? "SINGLE" : "RAIL";
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

// MEDIA-ROW-HARDEN-001: 黄金比例，瘦高卡片（宽:高 = 1:1.618）。2 张横排时
// 每张卡片宽度定死为半屏，不再看每张照片自己的 sourceAspect——旧算法
// (railHeight 固定、宽度 = railHeight × sourceAspect) 对一张真实横幅照片能
// 算出接近整屏宽的卡片，这正是"每张都很大"的病根。真实照片裁到这个比例走
// SocialMediaFrame 已有的 cover/contain 策略，不会拉伸变形。
export const MEDIA_ROW_GOLDEN_RATIO = 1.618;

/**
 * 2+ 张图统一的横滑行尺寸：卡片宽度固定 = (屏宽 - 间距) / 2，一屏正好露出
 * 完整 2 张，第 3 张起横滑翻出。高度按黄金比例算，所有卡片同宽同高——
 * 不再有"这张图比那张图宽"的变量。
 *
 * MEDIA-EDGE-BLEED-002（2026-09-20）：leadingInset 是调用方（feed.tsx）为了
 * "默认态跟文字缩进对齐，但横滑之后能滑到屏幕真正左边缘" 这条要求，把外层
 * 容器往左破出屏幕缩进（marginLeft: -leadingInset）之后，需要在内容区第一
 * 张卡片前补回的等量留白——不然卡片会贴着破出去的容器边缘，比文字还靠左。
 * 这段留白只在 offsets[0]（静止态）生效；offsets[1] 及以后不再叠加它，
 * 所以横滑到第 2/3... 张时，那张卡片能贴到（已经破出去的）容器左边缘，
 * 也就是屏幕真正的左边缘——静止态有缩进、滑动后能到边缘，两条要求都满足。
 * leadingInset 默认 0，其余调用方（目前没有）行为不变。
 */
export function mediaRowMetrics(itemCount: number, contentWidth: number, gap = 10, leadingInset = 0): {
  cardWidth: number;
  cardHeight: number;
  offsets: number[];
} {
  // contentWidth 是（已经破出屏幕缩进的）容器测量宽度，卡片可用宽度要先
  // 扣掉 leadingInset，否则会算出比默认态视觉尺寸更宽的卡片。
  const safeWidth = Math.max(280, contentWidth - leadingInset);
  // 浮点精度门（同旧 mediaRailMetrics）：0.001pt 粒度 round，
  // 1px 以下偏差在 RN 渲染里不可见，但能防止 offsets 累加漂移。
  const r3 = (n: number): number => Math.round(n * 1000) / 1000;
  const cardWidth = r3((safeWidth - gap) / 2);
  const cardHeight = r3(cardWidth * MEDIA_ROW_GOLDEN_RATIO);
  const count = Math.max(0, itemCount);
  const offsets = Array.from({ length: count }, (_, index) =>
    r3(index === 0 ? 0 : leadingInset + index * (cardWidth + gap)));
  return { cardWidth, cardHeight, offsets };
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
