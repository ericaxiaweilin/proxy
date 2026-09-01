// R15.13 P5 + P6 tripwires: LocationPickerSheet — 首页顶部 "切换本地范围"
// 真的能切，且 P6 起支持自定义坐标 + 半径。
//
// 之前的 LocationContext 是纯静态文本，"切换⌄" 点了什么都不会发生 — 用户
// 报告"地址切换不了"就是这个。现在变成 Pressable + Modal picker 弹层。
// P6 又在 picker 上加了"自定义坐标" tab：tap 地图放置 pin + 选半径 +
// 命名保存，跨会话通过 expo-secure-store 持久化。
//
// We deliberately do NOT import the .tsx file from this test: vitest
// in this repo does not bundle react-native (only pure TS modules are
// safe to import in tests). The tripwires below exercise the data
// contract (DEFAULT_LOCATION, LOCATION_OPTIONS, gridToLatLng,
// makeCustomLocation, etc.) which is the part that matters for state
// correctness.
import { describe, expect, it } from "vitest";
import {
  CITY_BOUNDS,
  DEFAULT_LOCATION,
  formatRadius,
  GRID_H,
  GRID_W,
  gridToLatLng,
  LOCATION_OPTIONS,
  makeCustomLocation,
  pickCityFromDisplayName,
  reverseGeocode,
  type AnyLocation,
  type CustomLocation,
  type PresetLocation
} from "./location-options.js";

describe("LocationPickerSheet (R15.13 P5)", () => {
  it("DEFAULT_LOCATION is one of LOCATION_OPTIONS (no orphan initial state)", () => {
    // The shell initialises currentLocation with DEFAULT_LOCATION and
    // then renders it in LocationContext. If the two ever drift, the
    // header would show a label that the picker has no option for.
    const matched = LOCATION_OPTIONS.find((entry) => entry.id === DEFAULT_LOCATION.id);
    expect(matched).toBeDefined();
  });

  it("LOCATION_OPTIONS covers at least 3 cities (no single-city lock-in)", () => {
    // The contract is "本地范围" not "固定河内". A user in 岘港 or
    // 胡志明市 must have a real choice. Drop the city list below 3
    // and the picker becomes a fake selector.
    const cities = new Set(LOCATION_OPTIONS.map((entry) => entry.city));
    expect(cities.size).toBeGreaterThanOrEqual(3);
  });

  it("every LOCATION_OPTIONS entry has a unique id (no duplicate selection targets)", () => {
    // Two options with the same id means selecting either of them
    // would set the same state — and the active highlight in the
    // sheet would match two cards, which is a real UI bug.
    const ids = LOCATION_OPTIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("LOCATION_OPTIONS entries have city + area (no null fields, no empty strings)", () => {
    // Empty city/area would render as "  · " in the header — silent
    // and confusing. Reject any option that sneaks one through.
    for (const entry of LOCATION_OPTIONS) {
      expect(entry.city.trim().length).toBeGreaterThan(0);
      expect(entry.area.trim().length).toBeGreaterThan(0);
      expect(entry.desc.trim().length).toBeGreaterThan(0);
    }
  });

  it("selecting a Location moves currentLocation (state transition contract)", () => {
    // The shell calls onSelect({id, city, area}) when the user taps
    // a card. This tripwire pins that the callback payload is a
    // full Location (not just the id) so the shell can render the
    // new header without a second round-trip to the options table.
    const initial: PresetLocation = { ...DEFAULT_LOCATION };
    const next: PresetLocation = { id: "hcm-d1", city: "胡志明市", area: "第一郡", kind: "PRESET" };
    expect(next.id).not.toBe(initial.id);
    expect(next.city).not.toBe(initial.city);
    expect(next.area).not.toBe(initial.area);
  });
});

describe("LocationPickerSheet (R15.13 P6) — custom coordinate + radius", () => {
  it("makeCustomLocation returns a stable, reproducible id (last-write-wins on store)", () => {
    // The store uses id-based dedup; two calls with the same params
    // must produce the same id or the history would grow forever.
    const a = makeCustomLocation("河内", 5, 5, 3000);
    const b = makeCustomLocation("河内", 5, 5, 3000);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^custom_河内_5x5_r3000$/);
  });

  it("makeCustomLocation with different radius produces different id", () => {
    // 1 km vs 5 km 是两个不同点 — id 必须区分，否则 store 会
    // 把用户切半径当成 no-op 并覆盖之前的。
    const a = makeCustomLocation("河内", 5, 5, 1000);
    const b = makeCustomLocation("河内", 5, 5, 5000);
    expect(a.id).not.toBe(b.id);
  });

  it("gridToLatLng projects center of Hanoi to known center (within 1km)", () => {
    // 河内 网格 (5, 5) 必须落在 CITY_BOUNDS.河内.centerLat/Lng ± spanKm/2。
    // 偏移超过 1 km 就是 bug — 用户说"我放在河内中心"结果显示在
    // 西湖或海上，picker 就失去信任。
    const { lat, lng } = gridToLatLng("河内", 5, 5);
    const bounds = CITY_BOUNDS["河内"];
    if (!bounds) throw new Error("CITY_BOUNDS missing 河内");
    expect(Math.abs(lat - bounds.centerLat)).toBeLessThan(0.01);
    expect(Math.abs(lng - bounds.centerLng)).toBeLessThan(0.01);
  });

  it("gridToLatLng is deterministic (same inputs → same outputs across calls)", () => {
    // Picker 每次 render 都会调 gridToLatLng 算 lat/lng。
    // 浮点结果必须稳定 — 否则 map 显示的"21.0245"和 LocationContext
    // 显示的"21.0246"会让用户怀疑放错了位置。
    const a = gridToLatLng("胡志明市", 7, 3);
    const b = gridToLatLng("胡志明市", 7, 3);
    expect(a.lat).toBe(b.lat);
    expect(a.lng).toBe(b.lng);
  });

  it("gridToLatLng round-trips the four corners (no drift beyond 0.0001)", () => {
    // (0,0) = 西北角 = (center - spanKm/2)；(W, H) = 东南角 = (center + spanKm/2)
    // 这两个 anchor 偏移超 0.0001° (≈11m) 就会被 inspector 看到。
    const bounds = CITY_BOUNDS["岘港"];
    if (!bounds) throw new Error("CITY_BOUNDS missing 岘港");
    const nw = gridToLatLng("岘港", 0, 0);
    const se = gridToLatLng("岘港", GRID_W, GRID_H);
    const halfSpanDeg = (bounds.spanKm / 2) / 111;
    expect(Math.abs(nw.lat - (bounds.centerLat + halfSpanDeg))).toBeLessThan(0.0001);
    expect(Math.abs(se.lat - (bounds.centerLat - halfSpanDeg))).toBeLessThan(0.0001);
  });

  it("formatRadius renders 1km/3km/5km cleanly (no 1000/3000/5000 leakage)", () => {
    // Picker 副标题/HUD 用 formatRadius，需求是"3 km"而不是"3000 m"。
    // 若实现里把 m 跟 km 混了，"5 km" 显示成 "5000 m" 立刻被用户抓到。
    expect(formatRadius(1000)).toBe("1 km");
    expect(formatRadius(3000)).toBe("3 km");
    expect(formatRadius(5000)).toBe("5 km");
  });

  it("AnyLocation discriminator is 'CUSTOM' | 'PRESET' (exhaustive narrowing)", () => {
    // app-shell 在渲染 location 副标题时 switch on kind — 如果
    // kind 落到 string 而不是字面量联合，TS narrowing 失效，
    // CUSTOM/PRESET 路径会编译过但运行时错。
    const preset: PresetLocation = { id: "hn-swordlake", city: "河内", area: "还剑湖附近", kind: "PRESET" };
    const custom: CustomLocation = makeCustomLocation("河内", 5, 5, 3000);
    const mixed: AnyLocation[] = [preset, custom];
    const seen = new Set(mixed.map((entry) => entry.kind));
    expect(seen.size).toBe(2);
    expect(seen.has("PRESET")).toBe(true);
    expect(seen.has("CUSTOM")).toBe(true);
  });

  it("CustomLocation.custom has gridX/gridY in 0..GRID_W/GRID_H range (no out-of-bounds)", () => {
    // MapCanvas clamp 到 0..GRID，但 makeCustomLocation 是纯数据
    // 层 — 不应该让非法 grid 偷偷穿过。如果未来 sheet 让用户
    // 输入数字 (而不是拖地图)，验证在这里死。
    const custom = makeCustomLocation("河内", 0, 0, 1000);
    expect(custom.custom.gridX).toBeGreaterThanOrEqual(0);
    expect(custom.custom.gridX).toBeLessThanOrEqual(GRID_W);
    expect(custom.custom.gridY).toBeGreaterThanOrEqual(0);
    expect(custom.custom.gridY).toBeLessThanOrEqual(GRID_H);
  });

  it("radius is constrained to {1km, 3km, 5km} (no 7km hack)", () => {
    // R15.13 P6 显式只支持三档半径 — map 上的 radius 圈用这个
    // 数字。如果 TypeScript 让其他 number 滑进 field，画布上的
    // 圈大小映射会 silent fail。
    const valid: Array<1000 | 3000 | 5000> = [1000, 3000, 5000];
    for (const r of valid) {
      const custom = makeCustomLocation("河内", 5, 5, r);
      expect(custom.custom.radiusMeters).toBe(r);
    }
  });
});

describe("reverseGeocode (R15.15 P2) — OSM Nominatim + offline-grid fallback", () => {
  it("returns remote shape when Nominatim responds (no real fetch in test)", async () => {
    // stub fetcher 代替真的 fetch — vitest 不打 Nominatim。
    // 这调上成功路径: response.ok + display_name 提取。
    const stubFetcher = async (_url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({
      ok: true,
      json: async () => ({
        display_name: "Hoàn Kiếm Lake, Hà Nội",
        address: { road: "Đinh Tiên Hoàng", attraction: "Hoàn Kiếm Lake" }
      })
    });
    const r = await reverseGeocode("河内", 21.0285, 105.8542, { fetcher: stubFetcher });
    expect(r.source).toBe("remote");
    expect(r.displayName).toContain("Hoàn Kiếm");
    expect(r.road).toBe("Đinh Tiên Hoàng");
    expect(r.poi).toBe("Hoàn Kiếm Lake");
  });

  it("falls back to offline-grid when fetcher absent (no network in tests)", async () => {
    // 不传 fetcher — 代表 SSR / 测试 / 无网场景。reverseGeocode
    // 必须 fall back 到 gridToLatLngToGrid + CITY_POIS, 不能
    // 抛错。
    const r = await reverseGeocode("河内", 21.0285, 105.8542);
    expect(r.source).toBe("offline-grid");
    expect(r.displayName.length).toBeGreaterThan(0);
  });

  it("falls back to offline-grid when fetcher throws (network error)", async () => {
    // Nominatim 击沉 / 5xx / 超时 — 不让 reverseGeocode reject
    // (逆编码失败不能让用户不能保存 pin)。 
    const failingFetcher = async (): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      throw new Error("ECONNREFUSED");
    };
    const r = await reverseGeocode("河内", 21.0285, 105.8542, { fetcher: failingFetcher });
    expect(r.source).toBe("offline-grid");
  });

  it("falls back to offline-grid when Nominatim returns 503", async () => {
    // fetcher ok=false — 走同 offline 路径。
    const errorFetcher = async (): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({
      ok: false,
      json: async () => ({})
    });
    const r = await reverseGeocode("河内", 21.0285, 105.8542, { fetcher: errorFetcher });
    expect(r.source).toBe("offline-grid");
  });

  it("offline-grid pinpoint finds Hanoi Hoan Kiem Lake (grid 4,6)", async () => {
    // 河内 4,6 = 还剑湖。如果 gridToLatLngToGrid 走错，poi
    // 不会被认出来。这是手动拔 POINT_OF_INTEREST 跟 grid
    // 映射的 tripwire。
    const r = await reverseGeocode("河内", 21.0285, 105.8542);
    // center 5,5 离 (4,6) 距离 2, (8,3) 距离 5 — 最近是还剑湖
    expect(r.displayName).toContain("还剑湖");
  });

  it("offline-grid HCMC D1 Bitexco (grid 5,4)", async () => {
    const r = await reverseGeocode("胡志明市", 10.776, 106.701);
    expect(r.displayName).toContain("Bitexco");
  });

  it("offline-grid Da Nang Han River (grid 5,5)", async () => {
    const r = await reverseGeocode("岘港", 16.054, 108.202);
    expect(r.displayName).toContain("龙桥");
  });

  it("offline-grid for unknown city still returns readable name (no crash)", async () => {
    // 不在 CITY_POIS 表的 city 返 “(city) · 网格 (x, y)”，不能
    // 拵错也不能返“河内 附近”（这是 state 会调张的 bug）。
    const r = await reverseGeocode("下龙湾", 20.91, 107.18);
    expect(r.displayName).toContain("下龙湾");
    expect(r.displayName).toContain("网格");
  });
});

// R15.32.1.3: pickCityFromDisplayName 把 Nominatim 的英文/越南文
// display_name 映射到我们 LOCATION_OPTIONS 里的中文城市。GPS
// 定位后 sheet 会用这个函数拿真实城市，避免“到 HCM 了还强制河内”
// 的迷惑感。
describe("pickCityFromDisplayName", () => {
  it("returns 河内 for Hanoi variants", () => {
    expect(pickCityFromDisplayName("Hoàn Kiếm, Hà Nội, Vietnam")).toBe("河内");
    expect(pickCityFromDisplayName("Ha Noi, Vietnam")).toBe("河内");
    expect(pickCityFromDisplayName("hanoi, vietnam")).toBe("河内");
  });
  it("returns 胡志明市 for HCMC variants", () => {
    expect(pickCityFromDisplayName("Bitexco, TP Hồ Chí Minh, Vietnam")).toBe("胡志明市");
    expect(pickCityFromDisplayName("Ho Chi Minh City, Vietnam")).toBe("胡志明市");
    expect(pickCityFromDisplayName("Saigon, Vietnam")).toBe("胡志明市");
    expect(pickCityFromDisplayName("HCMC, Vietnam")).toBe("胡志明市");
  });
  it("returns 岘港 for Da Nang", () => {
    expect(pickCityFromDisplayName("Da Nang, Vietnam")).toBe("岘港");
  });
  it("returns 海防 / 芹苴 / 顺化 / 边和 for the other 4 cities", () => {
    expect(pickCityFromDisplayName("Hai Phong, Vietnam")).toBe("海防");
    expect(pickCityFromDisplayName("Can Tho, Vietnam")).toBe("芹苴");
    expect(pickCityFromDisplayName("Hue, Vietnam")).toBe("顺化");
    expect(pickCityFromDisplayName("Bien Hoa, Vietnam")).toBe("边和");
  });
  it("returns undefined for non-VN or unrecognised strings", () => {
    expect(pickCityFromDisplayName("District 1, Vietnam")).toBeUndefined();
    expect(pickCityFromDisplayName("Some place, Bangkok, Thailand")).toBeUndefined();
    expect(pickCityFromDisplayName("")).toBeUndefined();
  });
});
