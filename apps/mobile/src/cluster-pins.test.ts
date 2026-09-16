import { describe, expect, it } from "vitest";
import { clusterPins } from "./cluster-pins";

// MAP-CLUSTER-001: 网格聚合按可视跨度收拢/散开，质心正确，非有限点跳过。
describe("clusterPins", () => {
  it("returns singles when pins are far apart", () => {
    const out = clusterPins(
      [
        { id: "hanoi", lat: 21.0285, lng: 105.8542 },
        { id: "hcmc", lat: 10.776, lng: 106.701 },
        { id: "danang", lat: 16.054, lng: 108.202 }
      ],
      12,
      12
    );
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.count === 1)).toBe(true);
  });

  it("merges nearby pins into one centroid cluster", () => {
    const out = clusterPins(
      [
        { id: "a", lat: 21.0285, lng: 105.8542 },
        { id: "b", lat: 21.0295, lng: 105.8552 }
      ],
      0.08,
      0.08
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(2);
    expect(out[0]!.latitude).toBeCloseTo(21.029, 4);
    expect(out[0]!.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("splits the same pins when zoomed in", () => {
    const pins = [
      { id: "a", lat: 21.0285, lng: 105.8542 },
      { id: "b", lat: 21.0385, lng: 105.8642 }
    ];
    // 街区视角：0.01 格子约 140m，两点（差约 1.5km）分开。
    expect(clusterPins(pins, 0.01, 0.01).every((c) => c.count === 1)).toBe(true);
    // 全国视角：合成一簇。
    expect(clusterPins(pins, 12, 12)).toHaveLength(1);
  });

  it("returns empty for empty input and skips non-finite pins", () => {
    expect(clusterPins([], 1, 1)).toEqual([]);
    const out = clusterPins(
      [{ id: "bad", lat: NaN, lng: 105 },
       { id: "ok", lat: 21.0285, lng: 105.8542 }],
      12,
      12
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.members[0]!.id).toBe("ok");
  });
});
