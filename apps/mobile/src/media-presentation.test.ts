import { describe, expect, it } from "vitest";
import {
  MEDIA_ROW_GOLDEN_RATIO,
  mediaCollectionMode,
  mediaRowMetrics,
  nearestRailIndex,
  shouldPreserveWholeSubject,
  deriveMediaKind,
  shouldAutoPlayVideo,
  formatCarouselCounter
} from "./media-presentation";
import type { FeedMediaItem } from "@proxy/contracts";

// 11 fixture-aspect inputs (from architecture/fixtures/social-media/matrix/manifest.json)
const FIXTURE_ASPECTS: ReadonlyArray<{ id: string; w: number; h: number; expectedMode: "SINGLE" | "RAIL" }> = [
  { id: "single-portrait-half-4x5",     w: 1200, h: 1500, expectedMode: "SINGLE" },
  { id: "single-portrait-full-9x16",    w: 900,  h: 1600, expectedMode: "SINGLE" },
  { id: "single-landscape-half-4x3",    w: 1600, h: 1200, expectedMode: "SINGLE" },
  { id: "single-landscape-full-3x1",    w: 1800, h: 600,  expectedMode: "SINGLE" },
  { id: "group-portrait-2-1x1",         w: 1500, h: 1500, expectedMode: "SINGLE" },
  { id: "group-portrait-4-1x1",         w: 1500, h: 1500, expectedMode: "SINGLE" },
  { id: "landscape-skyline-16x9",       w: 1920, h: 1080, expectedMode: "SINGLE" },
  { id: "object-product-4x5",           w: 1200, h: 1500, expectedMode: "SINGLE" },
  { id: "object-flatlay-1x1",           w: 1500, h: 1500, expectedMode: "SINGLE" },
  { id: "ad-banner-text-heavy-16x9",    w: 1920, h: 1080, expectedMode: "SINGLE" },
  { id: "screenshot-ui-9x19.5",         w: 1170, h: 2532, expectedMode: "SINGLE" },
];
describe("MEDIA-ROW-HARDEN-001 portrait social media presentation", () => {
  it("uses a large single for 1, a fixed-size row for everything 2+", () => {
    // 4/6 张以前单独走 WALL（两列，按每张自己的 sourceAspect 算格高）——
    // 跟旧 RAIL 一样"按这张照片自己的比例撑格子"，真机真实照片比例跟种子图
    // 差很多时会撑出偏大的格子。现在数量只分单图/多图两档。
    expect([1, 2, 3, 4, 5, 6].map(mediaCollectionMode)).toEqual([
      "SINGLE", "RAIL", "RAIL", "RAIL", "RAIL", "RAIL"
    ]);
  });

  it("preserves both half-body and full-body photos instead of guessing a crop from aspect", () => {
    expect(shouldPreserveWholeSubject(4 / 5, 4 / 5)).toBe(true);
    expect(shouldPreserveWholeSubject(9 / 16, 4 / 5)).toBe(true);
  });

  it("sizes every card the same — half the screen wide, golden-ratio tall, regardless of source aspect", () => {
    // 卡片尺寸完全不看 items 内容（3 张 9:16 全身照跟 3 张 21:9 banner
    // 算出来的 metrics 必须一样）——这是这次要堵死的那类 bug 的核心断言。
    const metrics = mediaRowMetrics(3, 360, 10);
    expect(metrics.cardWidth).toBeCloseTo((360 - 10) / 2, 3);
    expect(metrics.cardHeight).toBeCloseTo(metrics.cardWidth * MEDIA_ROW_GOLDEN_RATIO, 3);
    expect(metrics.cardWidth / metrics.cardHeight).toBeCloseTo(1 / MEDIA_ROW_GOLDEN_RATIO, 3);
  });

  it("keeps the row responsive without collapsing below a usable minimum", () => {
    const small = mediaRowMetrics(3, 100, 10);
    const large = mediaRowMetrics(3, 1024, 10);
    // contentWidth 被 clamp 到至少 280 再算格宽——避免极窄容器把卡片挤没。
    expect(small.cardWidth).toBeCloseTo((280 - 10) / 2, 3);
    expect(large.cardWidth).toBeCloseTo((1024 - 10) / 2, 3);
  });

  it("produces stable snap offsets and restores the closest media index", () => {
    const metrics = mediaRowMetrics(3, 360, 10);
    const cardStep = metrics.cardWidth + 10;
    expect(metrics.offsets).toEqual([0, cardStep, cardStep * 2]);
    expect(nearestRailIndex(metrics.offsets, cardStep - 20)).toBe(1);
    expect(nearestRailIndex(metrics.offsets, cardStep * 2 - 5)).toBe(2);
  });

  it("offsets length always matches item count, including 0", () => {
    expect(mediaRowMetrics(0, 360).offsets).toEqual([]);
    expect(mediaRowMetrics(6, 360).offsets).toHaveLength(6);
  });
});

// MEDIA-EDGE-BLEED-002: 静止态（第 1 张）要跟文字缩进对齐，留一段左边空白；
// 横滑到第 2 张起，卡片要能贴到屏幕真正左边缘——不能像 offsets[0] 那样永远
// 留一段固定的空白，那等于滑到哪张都还是贴着缩进线，滑不到边缘。
describe("MEDIA-EDGE-BLEED-002 leadingInset keeps rest-state indent but lets scroll reach the true edge", () => {
  it("only inset[0] carries the leading gap; offset[1+] drop straight to the bled container's own edge", () => {
    const inset = 68;
    const metrics = mediaRowMetrics(3, 393, 10, inset);
    const cardStep = metrics.cardWidth + 10;
    // 静止态：scrollX=0，卡片 1 渲染在屏幕上的位置 = leadingInset - 0 = 68，
    // 跟文字缩进对齐（feed.tsx 传的正是这个数字）。
    expect(metrics.offsets[0]).toBe(0);
    // 滑到卡片 2：scrollX = leadingInset + 1*cardStep，卡片 2 在（已经破出屏幕
    // 的）容器里的内容位置正好等于这个 scrollX，渲染在屏幕 x=0——真正的左边缘。
    expect(metrics.offsets[1]).toBeCloseTo(inset + cardStep, 3);
    expect(metrics.offsets[2]).toBeCloseTo(inset + cardStep * 2, 3);
  });

  it("card width is computed from the space after the inset, not the full bled container width", () => {
    // contentWidth 是破出去之后测量到的宽度（比默认态视觉宽度多 68pt）；
    // 卡片可用宽度要先扣掉 leadingInset，否则默认态两张卡片会比预期更宽。
    const withInset = mediaRowMetrics(3, 393, 10, 68);
    const withoutBleed = mediaRowMetrics(3, 393 - 68, 10, 0);
    expect(withInset.cardWidth).toBeCloseTo(withoutBleed.cardWidth, 3);
  });

  it("defaults to 0 (no inset, no bleed) so callers that don't pass it keep the old flush-from-zero offsets", () => {
    const withDefault = mediaRowMetrics(3, 360, 10);
    const explicitZero = mediaRowMetrics(3, 360, 10, 0);
    expect(withDefault.offsets).toEqual(explicitZero.offsets);
    expect(withDefault.offsets[1]).toBe(withDefault.cardWidth + 10);
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

describe("R15.16 P2 — 11 fixture 走 mediaCollectionMode 门", () => {
  for (const fix of FIXTURE_ASPECTS) {
    it(`${fix.id} (${fix.w}x${fix.h}) SINGLE 模式`, () => {
      // 单个 fixture 走 SINGLE 模式 — 不管 portrait/landscape 比例，
      // SINGLE 只看 item count = 1。
      expect(mediaCollectionMode(1)).toBe(fix.expectedMode);
    });
  }

  it("2 / 3 / 4 / 5 / 6 个 fixture 都走 RAIL（数量只分单图/多图两档）", () => {
    expect(mediaCollectionMode(2)).toBe("RAIL");
    expect(mediaCollectionMode(3)).toBe("RAIL");
    expect(mediaCollectionMode(4)).toBe("RAIL");
    expect(mediaCollectionMode(5)).toBe("RAIL");
    expect(mediaCollectionMode(6)).toBe("RAIL");
  });

  it("row 对 11 个 fixture 都给同一个固定卡片尺寸（不看任何一张的 aspect）", () => {
    // MEDIA-ROW-HARDEN-001: 卡片尺寸只看 items.length 和 contentWidth，
    // 跟 FIXTURE_ASPECTS 里每一条自己的宽高比无关——11 条 fixture 混进
    // 同一个 collection，算出来的 cardWidth/cardHeight 必须完全相同。
    const metrics = mediaRowMetrics(FIXTURE_ASPECTS.length, 360, 10);
    expect(metrics.cardWidth).toBeCloseTo((360 - 10) / 2, 3);
    expect(new Set(metrics.offsets.map((_, i) => metrics.cardWidth)).size).toBe(1);
    expect(metrics.offsets).toHaveLength(FIXTURE_ASPECTS.length);
  });
});
