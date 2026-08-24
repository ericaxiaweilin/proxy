import type { FeedMediaItem } from "@proxy/contracts";

export type MediaDimensions = Pick<FeedMediaItem, "aspectRatio" | "width" | "height">;

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

export function shouldPreserveWholeSubject(sourceAspect: number, frameAspect: number): boolean {
  return sourceAspect < frameAspect * 0.9 || sourceAspect > frameAspect * 1.15;
}

