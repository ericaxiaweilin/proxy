import type { FeedMediaItem } from "@proxy/contracts";

export type MediaDimensions = Pick<FeedMediaItem, "aspectRatio" | "width" | "height">;
export type MediaCollectionMode = "SINGLE" | "RAIL" | "WALL";

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
  return sourceAspect < frameAspect * 0.9 || sourceAspect > frameAspect * 1.15;
}
