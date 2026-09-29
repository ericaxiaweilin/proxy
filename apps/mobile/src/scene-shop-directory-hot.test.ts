import { describe, expect, it } from "vitest";
import { availableHotSorts, hotTopRank, sceneTypeBucket, sortHotScenes, type SceneShopBrief } from "./scene-shop-directory";

// HOT-SCENES-PAGE-001：热门场景整页背后的纯函数，之前完全没有测试覆盖。

function scene(over: Partial<SceneShopBrief> & { id: string }): SceneShopBrief {
  return {
    name: over.id,
    area: "Cầu Giấy",
    type: "咖啡 · 动态场景",
    category: "商家",
    imageUrl: "",
    latitude: 21.03,
    longitude: 105.85,
    visitedCount: 0,
    ...over,
  };
}

describe("SCENE-TYPE-BUCKET-001", () => {
  it("takes the part before ' · ' as the bucket", () => {
    expect(sceneTypeBucket("咖啡 · 动态场景")).toBe("咖啡");
    expect(sceneTypeBucket("公共景点 · 湖边")).toBe("公共景点");
    expect(sceneTypeBucket("艺术 · 展览")).toBe("艺术");
  });
  it("falls back to the whole trimmed string when there's no separator", () => {
    expect(sceneTypeBucket("咖啡店")).toBe("咖啡店");
    expect(sceneTypeBucket("  咖啡店  ")).toBe("咖啡店");
  });
  it("returns empty for empty/blank type — callers must not fold that into a fake bucket", () => {
    expect(sceneTypeBucket("")).toBe("");
    expect(sceneTypeBucket("   ")).toBe("");
  });
});

describe("HOT-SCENES-PAGE-001 availableHotSorts", () => {
  it("drops 距离最近 when there is no origin — a dead sort is worse than no sort", () => {
    expect(availableHotSorts(false).map((s) => s.id)).toEqual(["visited", "rating"]);
    expect(availableHotSorts(true).map((s) => s.id)).toEqual(["visited", "rating", "nearest"]);
  });
});

describe("HOT-SCENES-PAGE-001 hotTopRank", () => {
  it("only ranks the top 3 by real visitedCount, and only when visitedCount > 0", () => {
    const scenes = [
      { id: "a", visitedCount: 50 },
      { id: "b", visitedCount: 0 },
      { id: "c", visitedCount: 30 },
      { id: "d", visitedCount: 10 },
      { id: "e", visitedCount: 5 },
    ];
    expect(hotTopRank(scenes, "a")).toBe(0);
    expect(hotTopRank(scenes, "c")).toBe(1);
    expect(hotTopRank(scenes, "d")).toBe(2);
    // e 有真去过人数但排第 4——挂不上 TOP3。
    expect(hotTopRank(scenes, "e")).toBeUndefined();
    // b 是 0 去过，绝不能冒充热榜前三。
    expect(hotTopRank(scenes, "b")).toBeUndefined();
  });
});

describe("HOT-SCENES-PAGE-001 sortHotScenes", () => {
  const withOrigin = { latitude: 21.03, longitude: 105.85 };
  it("visited: descending by real visitedCount", () => {
    const scenes = [scene({ id: "a", visitedCount: 5 }), scene({ id: "b", visitedCount: 50 })];
    expect(sortHotScenes(scenes, "visited").map((s) => s.id)).toEqual(["b", "a"]);
  });
  it("rating: rated scenes first (descending), unrated scenes pushed to the end sorted by visitedCount — never a fake 0 score", () => {
    const scenes = [
      scene({ id: "no-rating", visitedCount: 40 }),
      scene({ id: "low", rating: 3.5, ratingCount: 2, visitedCount: 1 }),
      scene({ id: "high", rating: 4.9, ratingCount: 10, visitedCount: 1 }),
      scene({ id: "zero-count", rating: 5, ratingCount: 0, visitedCount: 20 }),
    ];
    // zero-count 的 ratingCount=0，即便 rating 字段有值也不算"有评分"——跟 no-rating 一起
    // 落到未评分组，按 visitedCount 排（no-rating 的 40 排在 zero-count 的 20 前面）。
    expect(sortHotScenes(scenes, "rating").map((s) => s.id)).toEqual(["high", "low", "no-rating", "zero-count"]);
  });
  it("nearest: reuses the real haversine distance sort", () => {
    const near = scene({ id: "near", latitude: 21.031, longitude: 105.851 });
    const far = scene({ id: "far", latitude: 21.2, longitude: 106.2 });
    expect(sortHotScenes([far, near], "nearest", withOrigin).map((s) => s.id)).toEqual(["near", "far"]);
  });
});
