// Location data + types for the home / feed location picker.
// Kept as a pure .ts file (no JSX, no react-native imports) so
// vitest can import it directly without bundling react-native.
// The .tsx sheet file in this directory renders these options
// inside a Modal but never recomputes them — adding a city here
// is the only edit needed to grow the picker.

export interface LocationOption {
  id: string;
  city: string;
  area: string;
  desc: string;
  // icon id is rendered by the sheet via ProxyIcon; the data
  // layer intentionally stays free of the icon component so this
  // file can be imported by pure tests.
  icon: string;
}

export interface Location {
  id: string;
  city: string;
  area: string;
}

// R15.13 P6：自定义坐标 + 半径。比 P5 多两个字段 — lat/lng (用户
// 在地图上自己放的点) 和 radiusMeters (1/3/5 km 三档)。P5 的预设
// 选项不用这两个字段，UI 层会用"无坐标"来 fallback 渲染。
export interface CustomLocationFields {
  gridX: number; // 0..GRID_W (城市网格坐标)
  gridY: number; // 0..GRID_H
  radiusMeters: 1000 | 3000 | 5000;
}

// LocationKind 区分"预设地点"和"自定义坐标"。新字段 — 旧的
// LocationPickerSheet 不传 custom 就走 preset 路径 (向后兼容)。
export type LocationKind = "PRESET" | "CUSTOM";

export interface CustomLocation extends Location {
  kind: "CUSTOM";
  custom: CustomLocationFields;
}

export interface PresetLocation extends Location {
  kind: "PRESET";
}

export type AnyLocation = PresetLocation | CustomLocation;

export const LOCATION_OPTIONS: ReadonlyArray<LocationOption> = [
  { id: "hn-swordlake", city: "河内", area: "还剑湖附近", desc: "老城、咖啡馆、湖边人像", icon: "route" },
  { id: "hn-westlake", city: "河内", area: "西湖周边", desc: "日落、咖啡、慢门", icon: "camera" },
  { id: "hcm-d1", city: "胡志明市", area: "第一郡", desc: "咖啡街、范五老、滨城市集", icon: "diamond" },
  { id: "dn-hanriver", city: "岘港", area: "韩江附近", desc: "龙桥、咖啡、伴手礼", icon: "circle" }
];

export const DEFAULT_LOCATION: PresetLocation = {
  id: "hn-swordlake",
  city: "河内",
  area: "还剑湖附近",
  kind: "PRESET"
};

// GRID_W / GRID_H: 与 MapCanvas 保持一致 — 数据层只描述"这是
// 城市网格的 10x10"的事实，让 sheet / canvas 各自实现。
export const GRID_W = 10;
export const GRID_H = 10;

// GridCoord: 城市网格里的一个 cell。MapCanvas 内部用 (lat, lng)
// 操作，但 sheet / store / picker 都用这个 grid coord 存储 + 显示
// ("(3, 4) · 河内" 比 "21.0285, 105.8512" 对用户友好)。
export interface GridCoord {
  x: number; // 0..GRID_W
  y: number; // 0..GRID_H
}

// cityBounds 描述"自定义坐标"怎么从 grid coord 映射到现实 (lat, lng)。
// 这是粗略的城市中心 + 半径估算 — P6 阶段不接 OSM/Geocoding，
// 但要保证"我放在还剑湖附近" 显示的坐标看起来在河内，不能是
// 胡志明市或海上。
export interface CityBounds {
  city: string;
  centerLat: number;
  centerLng: number;
  // 城市网格覆盖的范围 (km) — 决定了 1 个 cell 等于多少米
  spanKm: number;
}

export const CITY_BOUNDS: Record<string, CityBounds> = {
  河内: { city: "河内", centerLat: 21.0285, centerLng: 105.8542, spanKm: 12 },
  胡志明市: { city: "胡志明市", centerLat: 10.776, centerLng: 106.701, spanKm: 12 },
  岘港: { city: "岘港", centerLat: 16.054, centerLng: 108.202, spanKm: 12 }
};

// gridToLatLng 把 (gridX, gridY) 投影到具体城市的近似坐标。返回
// 字符串格式 "21.0245, 105.8512" — picker / location context 都
// 会用这个字符串显示"我放在 (21.02, 105.85)" 给用户反馈。
// 这是 P6 唯一一处把"网格"和"真实坐标"绑定的代码。如果以后接
// OSM 逆编码，把这个函数换成 onGeocode 完成即可。
export function gridToLatLng(city: string, gridX: number, gridY: number): { lat: number; lng: number } {
  const fallback: CityBounds = { city: "河内", centerLat: 21.0285, centerLng: 105.8542, spanKm: 12 };
  const bounds: CityBounds = (city in CITY_BOUNDS ? CITY_BOUNDS[city] : fallback) as CityBounds;
  // x=0..GRID_W, y=0..GRID_H → 经度从西到东，纬度从北到南
  // spanKm 在两个方向都覆盖，~111km/° 是赤道附近的换算 (误差
  // 在河内 21°N 只有 4%，足够 P6 演示)
  const halfSpanDeg = (bounds.spanKm / 2) / 111;
  const lng = bounds.centerLng + (gridX - GRID_W / 2) * (2 * halfSpanDeg) / GRID_W;
  const lat = bounds.centerLat - (gridY - GRID_H / 2) * (2 * halfSpanDeg) / GRID_H;
  return { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4 };
}

// R15.15 P2: ReverseGeocodeShape — onGeocode 逆编码查询返
// 回报。不是 OSM 原生 response (那是 array + lat/lon + display_name +
// address.road / address.attraction / address.tourism) — 我们
// 只提取“用户能看到”的几个字段。
export interface ReverseGeocodeShape {
  // 总显示名: "Hoàn Kiếm, Hà Nội" / "Bitexco Financial Tower, HCMC"
  displayName: string;
  // 街道名: "Đinh Tiên Hoàng" / undefined
  road?: string;
  // POI 名: "Hoàn Kiếm Lake" / undefined
  poi?: string;
  // source: "remote" | "offline-grid" | "offline-grid-x" (cells-from-center)
  // 告诉调用方走的是 Nominatim 还是 P6 估算。
  source: "remote" | "offline-grid";
}

// 逆编码 default impl: R15.15 P2 线上走 Nominatim, 离线
// (无 fetch / Nominatim 拵错) 走 gridToLatLng 的“原点 + 偏移
// 描述” 路径。vitest 可以传 onGeocode 覆盖为 stub, 不打真 fetch。
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

export type NominatimFetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

// R15.32.1.3: 线上逆编码走 Proxy 自己的 /v1/geocode/reverse，理由：
//   1. Nominatim 公共点经常限流 / 拒服务，状状不稳定
//      (用 cloud IP 打默认会有 403)。
//   2. 走我们的 server 可以加 cache、观测、同一个 log line。
//   3. iPhone 不需要配置 ATS 例外，公共点都走 http://localhost:4100。
// Server 内部会调 Photon / Nominatim 并翻译成同一个 shape。
export async function reverseGeocodeViaProxy(
  baseUrl: string,
  lat: number,
  lng: number,
  options?: { signal?: AbortSignal }
): Promise<ReverseGeocodeShape> {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/v1/geocode/reverse?lat=${lat}&lng=${lng}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(options?.signal ? { signal: options.signal } : {})
    });
    if (!res.ok) {
      return { displayName: "", source: "offline-grid" };
    }
    const body = (await res.json()) as {
      displayName?: string;
      road?: string;
      poi?: string;
      source?: "remote" | "offline";
    };
    if (body.source === "offline" || !body.displayName) {
      return { displayName: "", source: "offline-grid" };
    }
    return {
      displayName: body.displayName,
      ...(body.road ? { road: body.road } : {}),
      ...(body.poi ? { poi: body.poi } : {}),
      source: "remote"
    };
  } catch {
    return { displayName: "", source: "offline-grid" };
  }
}

export async function reverseGeocode(
  city: string,
  lat: number,
  lng: number,
  options?: {
    fetcher?: NominatimFetcher;
    nominatimUrl?: string;
    signal?: AbortSignal;
  }
): Promise<ReverseGeocodeShape> {
  // 尝试走 Nominatim。不传 fetcher 时跳过远程 (测试 / SSR 友好)。
  const fetcher = options?.fetcher;
  if (fetcher) {
    try {
      const url = `${options?.nominatimUrl ?? DEFAULT_NOMINATIM_URL}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await fetcher(url);
      if (res.ok) {
        const body = (await res.json()) as { display_name?: string; address?: { road?: string; attraction?: string; tourism?: string; pedestrian?: string } };
        if (body.display_name) {
          return {
            displayName: body.display_name,
            ...(body.address?.road ? { road: body.address.road } : {}),
            ...(body.address?.attraction || body.address?.tourism || body.address?.pedestrian
              ? { poi: body.address?.attraction ?? body.address?.tourism ?? body.address?.pedestrian! }
              : {}),
            source: "remote"
          };
        }
      }
    } catch {
      // fall through to offline-grid
    }
  }
  // Offline-grid fallback: 拿 (lat, lng) 对回 gridX/gridY, 然后
  // 从 POI_LIST 找最近, 有就返 “<poi>附近”, 没有返 “(x, y)”。
  const { gridX, gridY } = gridToLatLngToGrid(city, lat, lng);
  const nearest = nearestPoi(city, gridX, gridY);
  if (nearest) {
    return {
      displayName: `${nearest.label}附近`,
      ...(nearest.label ? { poi: nearest.label } : {}),
      source: "offline-grid"
    };
  }
  return {
    displayName: `${city} · 网格 (${gridX}, ${gridY})`,
    source: "offline-grid"
  };
}

// R15.32.1.3: 从 Nominatim 的 display_name 里拿城市。
// Nominatim 返的是越南文 / 英文 ("Hà Nội" / "TP Hồ Chí Minh")，
// LOCATION_OPTIONS 用中文 ("河内" / "胡志明市")，需要映射。
// 不区分重音符号 — "Hà Nội" / "Ha Noi" 都能识别。匹配不到
// (例如 Nominatim 返 "District 1, Vietnam" 这种含糊形式) 返回
// undefined，调用方会保持 customCity 不变。
export function pickCityFromDisplayName(displayName: string): string | undefined {
  // 同时检查原文和脱重音后的形式：Nominatim 有时返 "Ha Noi" /
  // "Hà Nội" / "Hanoi" 三种。重音拆解后 "ha noi" 是匹配词，但
  // "hanoi" 拆重音后还是 "hanoi" — 也要直接返 "河内"。
  const raw = displayName.toLowerCase();
  const normLower = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normLower.includes("ha noi") || raw.includes("hanoi")) return "河内";
  if (normLower.includes("ho chi minh") || raw.includes("hcmc") || raw.includes("saigon")) return "胡志明市";
  if (normLower.includes("da nang")) return "岘港";
  if (normLower.includes("hai phong")) return "海防";
  if (normLower.includes("can tho")) return "芹苴";
  if (normLower.includes("hue")) return "顺化";
  if (normLower.includes("bien hoa")) return "边和";
  return undefined;
}

// 内部工具: gridToLatLng 的逆函数 (lat, lng) → gridX/gridY。
// P6 只在数据层需要走“逆编码”路径时才用。精确到 cell 即可,
// 不是 sub-cell。
function gridToLatLngToGrid(city: string, lat: number, lng: number): { gridX: number; gridY: number } {
  const bounds: CityBounds = (city in CITY_BOUNDS ? CITY_BOUNDS[city] : { city: "河内", centerLat: 21.0285, centerLng: 105.8542, spanKm: 12 }) as CityBounds;
  const halfSpanDeg = (bounds.spanKm / 2) / 111;
  const xRaw = ((lng - bounds.centerLng) / (2 * halfSpanDeg)) * GRID_W + GRID_W / 2;
  const yRaw = ((bounds.centerLat - lat) / (2 * halfSpanDeg)) * GRID_H + GRID_H / 2;
  const gridX = Math.max(0, Math.min(GRID_W, Math.round(xRaw)));
  const gridY = Math.max(0, Math.min(GRID_H, Math.round(yRaw)));
  return { gridX, gridY };
}

// P6 地图上有 2 个河内 POI (还剑湖 + 西湖) — 但 POI 位置是
// 硬编码在 MapCanvas 里的 SVG 点, 跟 grid 是独立坐标。这里手动
// 映射 POI 中心点对应到 (gridX, gridY) 上, 给逆编码 fallback
// 用。
const CITY_POIS: Record<string, ReadonlyArray<{ label: string; gridX: number; gridY: number }>> = {
  河内: [
    { label: "还剑湖", gridX: 4, gridY: 6 },
    { label: "西湖", gridX: 8, gridY: 3 }
  ],
  胡志明市: [
    { label: "Bitexco", gridX: 5, gridY: 4 },
    { label: "范五老", gridX: 3, gridY: 6 }
  ],
  岘港: [
    { label: "龙桥", gridX: 5, gridY: 5 },
    { label: "韩江", gridX: 6, gridY: 5 }
  ]
};

function nearestPoi(city: string, gridX: number, gridY: number): { label: string; gridX: number; gridY: number } | undefined {
  const pois = CITY_POIS[city] ?? [];
  let best: { label: string; gridX: number; gridY: number; d: number } | undefined;
  for (const p of pois) {
    const d = Math.abs(p.gridX - gridX) + Math.abs(p.gridY - gridY);
    if (!best || d < best.d) {
      best = { ...p, d };
    }
  }
  return best ? { label: best.label, gridX: best.gridX, gridY: best.gridY } : undefined;
}

// 半径格式化 — 给 LocationContext 用 "3 km" / "5 km" 这样的简短显示。
export function formatRadius(m: number): string {
  if (m >= 1000) return `${m / 1000} km`;
  return `${m} m`;
}

// CustomLocation 构造器 — 给 sheet 选完点 + 半径时调。id 用
// "custom_" + city + "_" + gridX + "x" + gridY 防止和 preset 重名。
export function makeCustomLocation(
  city: string,
  gridX: number,
  gridY: number,
  radiusMeters: 1000 | 3000 | 5000
): CustomLocation {
  return {
    id: `custom_${city}_${gridX}x${gridY}_r${radiusMeters}`,
    city,
    area: `自定义 · ${gridX}, ${gridY}`,
    kind: "CUSTOM",
    custom: { gridX, gridY, radiusMeters }
  };
}
