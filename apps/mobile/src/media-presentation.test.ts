import { describe, expect, it } from "vitest";
import { portraitRailLayout, shouldPreserveWholeSubject } from "./media-presentation.js";

describe("portrait social media presentation", () => {
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
});

