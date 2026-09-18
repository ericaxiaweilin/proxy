import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchNearbySpots, clearNearbySpotsCache } from "./nearby-spots";

// NEARBY-SPOTS-001: 推荐地点必须是用户定位周围 3km 的真实热门（OSM），
// 不能再是 4 个硬编码城市预设。失败一律空列表 + offline，不拿假数据冒充。

function stubFetchOnce(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    async () =>
      ({
        ok,
        json: async () => body,
      }) as unknown as Response
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearNearbySpotsCache();
});

describe("NEARBY-SPOTS-001 nearby popular places within 3km", () => {
  it("parses server places and drops nameless or unlocated entries", async () => {
    stubFetchOnce({
      places: [
        { id: "osm:node:1", name: "还剑湖", category: "attraction", latitude: 21.0285, longitude: 105.8524, distanceMeters: 320 },
        { id: "osm:node:2", name: "  ", category: "attraction", latitude: 21.03, longitude: 105.85, distanceMeters: 100 },
        { id: "osm:node:3", name: "无坐标", category: "park", latitude: 0, longitude: 0, distanceMeters: 50 },
      ],
      source: "openstreetmap",
    });
    const result = await fetchNearbySpots("http://127.0.0.1:4100", 21.0285, 105.8524, 3000);
    expect(result.source).toBe("openstreetmap");
    expect(result.spots.map((s) => s.name)).toEqual(["还剑湖"]);
    expect(result.spots[0]?.distanceMeters).toBe(320);
  });

  it("fails closed to empty offline on bad input, HTTP errors and exceptions", async () => {
    const badInput = await fetchNearbySpots("", NaN, 200);
    expect(badInput).toEqual({ spots: [], source: "offline" });
    stubFetchOnce({}, false);
    const httpFail = await fetchNearbySpots("http://127.0.0.1:4100", 21.0, 105.8, 3000);
    expect(httpFail).toEqual({ spots: [], source: "offline" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const threw = await fetchNearbySpots("http://127.0.0.1:4100", 21.0, 105.8, 3000);
    expect(threw).toEqual({ spots: [], source: "offline" });
  });

  it("asks the server with a 3km radius around the fix", async () => {
    let seenUrl = "";
    vi.stubGlobal("fetch", async (url: unknown) => {
      seenUrl = String(url);
      return { ok: true, json: async () => ({ places: [], source: "openstreetmap" }) } as unknown as Response;
    });
    await fetchNearbySpots("http://127.0.0.1:4100/", 21.0285, 105.8524, 3000);
    expect(seenUrl).toContain("/v1/places/nearby?");
    expect(seenUrl).toContain("radius=3000");
    expect(seenUrl).toContain("lat=21.0285");
  });

  it("reuses fresh spots in the same grid cell without refetching", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          places: [{ id: "osm:node:1", name: "还剑湖", category: "attraction", latitude: 21.0285, longitude: 105.8524, distanceMeters: 320 }],
          source: "openstreetmap",
        }),
      } as unknown as Response;
    });
    const first = await fetchNearbySpots("http://127.0.0.1:4100", 21.0285, 105.8524, 3000);
    // 同格内轻微移动（约 1km）直接复用，不打上游。
    const second = await fetchNearbySpots("http://127.0.0.1:4100", 21.03, 105.85, 3000);
    expect(first.spots).toEqual(second.spots);
    expect(calls).toBe(1);
  });
});

describe("NEARBY-SPOTS-001 picker wiring", () => {
  const sheet = readFileSync(fileURLToPath(new URL("./components/location-picker-sheet.tsx", import.meta.url)), "utf8");

  it("offers nearby lookup in the recommend tab and sends picked spots with real coordinates", () => {
    // 推荐 tab 打开默认加载（不用点按钮）；无坐标预设发不出去的老坑已删。
    expect(sheet).toContain("附近地点");
    expect(sheet).toContain("fetchNearbySpots(baseUrl");
    // 选中的是带真坐标的 CUSTOM（meetupPointFromLocation 只认这条路）。
    expect(sheet).toContain('kind: "CUSTOM"');
    expect(sheet).toContain("radiusMeters: 3000");
    expect(sheet).toContain("lat: spot.lat, lng: spot.lng");
    // 定位跟地图 tab 同口径（Balanced 单次）：getCurrentFix 的 10 秒超时
    // 在室内 GPS 慢时直接判死，而地图无超时是能回来的 —— 不能再走它。
    expect(sheet).toContain("Accuracy.Balanced");
    expect(sheet).not.toContain("getCurrentFix(");
  });
});
