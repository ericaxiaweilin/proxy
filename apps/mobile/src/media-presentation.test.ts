import { describe, expect, it } from "vitest";
import { mediaCollectionMode, mediaRailMetrics, nearestRailIndex, portraitRailLayout, shouldPreserveWholeSubject } from "./media-presentation.js";

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
