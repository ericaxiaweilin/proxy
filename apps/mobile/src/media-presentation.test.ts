import { describe, expect, it } from "vitest";
import {
  mediaCollectionMode,
  mediaRailMetrics,
  nearestRailIndex,
  portraitRailLayout,
  shouldPreserveWholeSubject,
  deriveMediaKind,
  shouldAutoPlayVideo,
  formatCarouselCounter
} from "./media-presentation.js";
import type { FeedMediaItem } from "@proxy/contracts";

describe("portrait social media presentation", () => {
  it("uses a large single, rails for 2/3/5, and walls for 4/6", () => {
    expect([1, 2, 3, 4, 5, 6].map(mediaCollectionMode)).toEqual([
      "SINGLE", "RAIL", "RAIL", "WALL", "RAIL", "WALL"
    ]);
  });
  it("gives half-body and full-body photos one stable 4:5-like rail", () => {
    const layout = portraitRailLayout([
      { aspectRatio: 4 / 5, width: 2400, height: 3000 },
      { aspectRatio: 9 / 16, width: 2160, height: 3840 }
    ], 360);
    expect(layout.portraitSet).toBe(true);
    expect(layout.railHeight).toBe(378);
    expect(layout.portraitCardWidth).toBeCloseTo(302.4);
    expect(layout.portraitCardWidth / layout.railHeight).toBeCloseTo(0.8);
  });

  it("fills a 4:5 half-body image but preserves an entire 9:16 body", () => {
    expect(shouldPreserveWholeSubject(4 / 5, 4 / 5)).toBe(false);
    expect(shouldPreserveWholeSubject(9 / 16, 4 / 5)).toBe(true);
  });

  it("keeps the rail responsive without becoming unbounded", () => {
    const small = portraitRailLayout([{ aspectRatio: 0.75, width: 3, height: 4 }], 240);
    const large = portraitRailLayout([{ aspectRatio: 0.75, width: 3, height: 4 }], 1024);
    expect(small.railHeight).toBe(294);
    expect(large.railHeight).toBe(440);
  });

  it("produces stable snap offsets and restores the closest media index", () => {
    const metrics = mediaRailMetrics([
      { aspectRatio: 4 / 5, width: 2400, height: 3000 },
      { aspectRatio: 9 / 16, width: 2160, height: 3840 },
      { aspectRatio: 3 / 4, width: 2250, height: 3000 }
    ], 360);
    expect(metrics.offsets).toEqual([0, 312.4, 624.8]);
    expect(nearestRailIndex(metrics.offsets, 330)).toBe(1);
    expect(nearestRailIndex(metrics.offsets, 610)).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// Gate F — Media Kind Classification (形态识别)
//
// §5.2.3 扩展：6 类媒体形态决策
//  IMAGE / VIDEO / ANIMATED / PANORAMA / CAROUSEL / TEXT_HEAVY
// -----------------------------------------------------------------------------

function makeItem(overrides: Partial<FeedMediaItem>): FeedMediaItem {
  return {
    mediaAssetId: "a1",
    mediaType: "IMAGE",
    width: 1080,
    height: 1080,
    aspectRatio: 1,
    processingStatus: "READY",
    moderationStatus: "APPROVED",
    sortOrder: 0,
    ...overrides
  };
}

describe("Gate F · deriveMediaKind", () => {
  it("F1 · VIDEO mediaType → VIDEO", () => {
    expect(deriveMediaKind(makeItem({ mediaType: "VIDEO" }))).toBe("VIDEO");
  });

  it("F2 · IMAGE 默认 → IMAGE", () => {
    expect(deriveMediaKind(makeItem({}))).toBe("IMAGE");
  });

  it("F3 · thumbnailUrl .gif → ANIMATED", () => {
    expect(deriveMediaKind(makeItem({ thumbnailUrl: "/u/x.gif" }))).toBe("ANIMATED");
  });

  it("F4 · placeholderUrl 含 anim: 前缀 → ANIMATED", () => {
    expect(deriveMediaKind(makeItem({ placeholderUrl: "anim:abc123" }))).toBe("ANIMATED");
  });

  it("F5 · aspectRatio ≥ 2.5 → PANORAMA", () => {
    expect(deriveMediaKind(makeItem({ aspectRatio: 3.0, width: 3000, height: 1000 }))).toBe("PANORAMA");
  });

  it("F6 · width/height 比例 ≥ 2.5 → PANORAMA（aspectRatio=0 退路）", () => {
    expect(deriveMediaKind(makeItem({ aspectRatio: 0, width: 5000, height: 1500 }))).toBe("PANORAMA");
  });

  it("F7 · PRODUCT + subjectCount ≥ 6 → CAROUSEL", () => {
    expect(deriveMediaKind(makeItem({
      compositionHint: {
        subjectType: "PRODUCT",
        subjectCount: 6,
        faceBoxes: [],
        bodyBoxes: [],
        confidence: 0.9,
        recipeVersion: "v1"
      }
    }))).toBe("CAROUSEL");
  });

  it("F8 · PRODUCT + subjectCount < 6 → IMAGE（不是 CAROUSEL）", () => {
    expect(deriveMediaKind(makeItem({
      compositionHint: {
        subjectType: "PRODUCT",
        subjectCount: 1,
        faceBoxes: [],
        bodyBoxes: [],
        confidence: 0.9,
        recipeVersion: "v1"
      }
    }))).toBe("IMAGE");
  });

  it("F9 · TEXT_HEAVY hint → TEXT_HEAVY", () => {
    expect(deriveMediaKind(makeItem({
      compositionHint: {
        subjectType: "TEXT_HEAVY",
        subjectCount: 0,
        faceBoxes: [],
        bodyBoxes: [],
        confidence: 0.95,
        recipeVersion: "v1"
      }
    }))).toBe("TEXT_HEAVY");
  });

  it("F10 · VIDEO 不被 TEXT_HEAVY 覆盖（mediaType 优先）", () => {
    expect(deriveMediaKind(makeItem({
      mediaType: "VIDEO",
      compositionHint: {
        subjectType: "TEXT_HEAVY",
        subjectCount: 0,
        faceBoxes: [],
        bodyBoxes: [],
        confidence: 0.95,
        recipeVersion: "v1"
      }
    }))).toBe("VIDEO");
  });
});

// -----------------------------------------------------------------------------
// Gate G — Video Auto-Play Policy
//
// §5.2.3：≤ 60s 短视频可以静音自动播放；> 60s 必须用户点。
// -----------------------------------------------------------------------------

describe("Gate G · shouldAutoPlayVideo", () => {
  it("G1 · IMAGE → false（不自动播放）", () => {
    expect(shouldAutoPlayVideo(makeItem({ mediaType: "IMAGE" }))).toBe(false);
  });

  it("G2 · VIDEO + 30s → true（短）", () => {
    expect(shouldAutoPlayVideo(makeItem({ mediaType: "VIDEO", durationMs: 30_000 }))).toBe(true);
  });

  it("G3 · VIDEO + 60s → true（边界 ≤）", () => {
    expect(shouldAutoPlayVideo(makeItem({ mediaType: "VIDEO", durationMs: 60_000 }))).toBe(true);
  });

  it("G4 · VIDEO + 61s → false（长视频）", () => {
    expect(shouldAutoPlayVideo(makeItem({ mediaType: "VIDEO", durationMs: 61_000 }))).toBe(false);
  });

  it("G5 · VIDEO + durationMs=0 → false（无元数据）", () => {
    expect(shouldAutoPlayVideo(makeItem({ mediaType: "VIDEO", durationMs: 0 }))).toBe(false);
  });

  it("G6 · VIDEO + durationMs=undefined → false", () => {
    const item = makeItem({ mediaType: "VIDEO" });
    delete (item as { durationMs?: number }).durationMs;
    expect(shouldAutoPlayVideo(item)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Gate H — Carousel Counter Format
//
// §5.2.3：商品轮播右下角 1/6 角标。边界 0/0。
// -----------------------------------------------------------------------------

describe("Gate H · formatCarouselCounter", () => {
  it("H1 · 第 1 张 / 6 → '1/6'", () => {
    expect(formatCarouselCounter(0, 6)).toBe("1/6");
  });

  it("H2 · 第 6 张 / 6 → '6/6'", () => {
    expect(formatCarouselCounter(5, 6)).toBe("6/6");
  });

  it("H3 · 0 张 → '0/0'（防崩）", () => {
    expect(formatCarouselCounter(0, 0)).toBe("0/0");
  });

  it("H4 · index 越界（= total）→ 仍显示 'total/total'", () => {
    expect(formatCarouselCounter(6, 6)).toBe("7/6");
  });

  it("H5 · 单张轮播 → '1/1'", () => {
    expect(formatCarouselCounter(0, 1)).toBe("1/1");
  });
});
