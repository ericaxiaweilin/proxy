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
