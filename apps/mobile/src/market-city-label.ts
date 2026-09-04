// R15.x (P1 market 附近): map a (lat, lng) foreground fix to a
// human-readable Vietnamese city / district name. The MarketSurface
// header uses this when the user has shared GPS, so the "河内" label
// becomes the actual city the viewer is in (Hanoi / Ho Chi Minh City
// / Đà Nẵng / Hải Phòng / Bắc Ninh). Pure — no I/O, no React, no
// network — so it's easy to unit-test in vitest without pulling in
// the whole react-native runtime.
//
// We deliberately do NOT add finer-grained labels (Hai Bà Trưng,
// Cầu Giấy, Bình Thạnh, etc.). The platform's PRD v1.4 §4 lists the
// 5 cities above as the launch set; sub-city granularity would be a
// privacy regression (the marker on a map becomes exact rather than
// approximate) and is out of scope for this fix.

export type CityBox = { readonly name: string; readonly minLat: number; readonly maxLat: number; readonly minLng: number; readonly maxLng: number };

export const KNOWN_CITY_BOXES: ReadonlyArray<CityBox> = [
  { name: "河内", minLat: 20.95, maxLat: 21.10, minLng: 105.75, maxLng: 105.95 },
  { name: "胡志明市", minLat: 10.70, maxLat: 10.85, minLng: 106.60, maxLng: 106.85 },
  { name: "岘港", minLat: 15.95, maxLat: 16.15, minLng: 107.95, maxLng: 108.30 },
  { name: "海防", minLat: 20.78, maxLat: 20.92, minLng: 106.60, maxLng: 106.78 },
  // Bắc Ninh starts *above* Hanoi's northernmost edge so the
  // two boxes never overlap (a fix near Yên Phong should not
  // also be tagged "河内"). The cities are ~30 km apart in
  // reality; 21.15 is well below Yên Phong's real bbox.
  { name: "北宁", minLat: 21.15, maxLat: 21.30, minLng: 105.85, maxLng: 106.10 }
];

export function nearestCityLabel(lat: number, lng: number, fallback: string): string {
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return fallback;
  }
  for (const box of KNOWN_CITY_BOXES) {
    if (lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng) {
      return box.name;
    }
  }
  return fallback;
}
