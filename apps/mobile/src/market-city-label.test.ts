import { describe, expect, it } from "vitest";
import { KNOWN_CITY_BOXES, nearestCityLabel } from "./market-city-label";

describe("nearestCityLabel", () => {
  it("returns the city whose bbox contains the fix", () => {
    expect(nearestCityLabel(21.0285, 105.8542, "河内")).toBe("河内");
    expect(nearestCityLabel(10.776, 106.700, "河内")).toBe("胡志明市");
    expect(nearestCityLabel(16.054, 108.202, "河内")).toBe("岘港");
    expect(nearestCityLabel(20.844, 106.688, "河内")).toBe("海防");
    expect(nearestCityLabel(21.150, 105.970, "河内")).toBe("北宁");
  });

  it("falls back to the editor-supplied label when the fix is outside any bbox", () => {
    // Mid-Pacific sentinel: (0,0) is the Atlantic, far from any
    // Vietnamese city. The MarketSurface passes "河内" as the
    // fallback so the header never goes blank.
    expect(nearestCityLabel(0, 0, "河内")).toBe("河内");
    // Mid-Australia: same situation, different fallback exercises
    // the parameter.
    expect(nearestCityLabel(-25, 134, "未知")).toBe("未知");
  });

  it("rejects non-numeric or NaN inputs by returning the fallback", () => {
    expect(nearestCityLabel(Number.NaN, 105.85, "河内")).toBe("河内");
    expect(nearestCityLabel(21.0, Number.NaN, "河内")).toBe("河内");
    // TypeScript would normally prevent this; the runtime guard
    // exists so a hot-reloaded bundle that lost type info still
    // falls back instead of crashing the header.
    expect(nearestCityLabel(undefined as unknown as number, 105.85, "河内")).toBe("河内");
  });

  it("bbox corners are inclusive (so a fix on the city edge is still labelled)", () => {
    const hn = KNOWN_CITY_BOXES.find((b) => b.name === "河内");
    expect(hn).toBeDefined();
    expect(nearestCityLabel(hn!.minLat, hn!.minLng, "fallback")).toBe("河内");
    expect(nearestCityLabel(hn!.maxLat, hn!.maxLng, "fallback")).toBe("河内");
  });

  it("bbox has 5 launch cities and the boxes do not overlap (no double-mapping)", () => {
    expect(KNOWN_CITY_BOXES.length).toBe(5);
    for (let i = 0; i < KNOWN_CITY_BOXES.length; i++) {
      const a = KNOWN_CITY_BOXES[i];
      if (!a) continue;
      for (let j = i + 1; j < KNOWN_CITY_BOXES.length; j++) {
        const b = KNOWN_CITY_BOXES[j];
        if (!b) continue;
        const overlaps =
          a.minLat <= b.maxLat && a.maxLat >= b.minLat &&
          a.minLng <= b.maxLng && a.maxLng >= b.minLng;
        expect(overlaps).toBe(false);
      }
    }
  });
});
