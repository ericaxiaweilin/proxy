// NEARBY-SPOTS-001: 用户定位周围 3km 热门地点。
//
// 走自家 /v1/places/nearby（服务端 relay Overpass：OSM 景点/博物馆/公园/
// 市集，按距离排序，最多 12 个）。失败/离线/无结果一律空列表 —— 没数据
// 就显示"附近暂时没有"，绝不拿硬编码景点冒充（GEO-HONEST 同一口径）。

export type NearbySpot = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  distanceMeters: number;
};

export type NearbySpotsResult = {
  spots: NearbySpot[];
  /** openstreetmap = 真实数据；offline = 上游失败或入参非法，调用方照实显示。 */
  source: "openstreetmap" | "offline";
};

const SPOT_CACHE_TTL_MS = 10 * 60 * 1000;
type SpotCacheEntry = { spots: NearbySpot[]; at: number };
const spotCache = new Map<string, SpotCacheEntry>();

/** 测试清缓存用。生产代码不调。 */
export function clearNearbySpotsCache(): void {
  spotCache.clear();
}

function toSpot(raw: unknown): NearbySpot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const lat = typeof r.latitude === "number" ? r.latitude : NaN;
  const lng = typeof r.longitude === "number" ? r.longitude : NaN;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !name) {
    return null;
  }
  // Null Island (0,0) 不是真实推荐 —— 服务端已过滤，这里纵深防一层。
  if (lat === 0 && lng === 0) return null;
  const distance = typeof r.distanceMeters === "number" && Number.isFinite(r.distanceMeters) && r.distanceMeters >= 0
    ? Math.round(r.distanceMeters)
    : -1;
  return {
    id: typeof r.id === "string" && r.id ? r.id : `${lat.toFixed(5)},${lng.toFixed(5)}`,
    name,
    category: typeof r.category === "string" ? r.category : "",
    lat,
    lng,
    distanceMeters: distance,
  };
}

export async function fetchNearbySpots(
  baseUrl: string,
  lat: number,
  lng: number,
  radiusMeters = 3000,
  options?: { signal?: AbortSignal }
): Promise<NearbySpotsResult> {
  if (!baseUrl || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { spots: [], source: "offline" };
  }
  // POI 是静态数据，10 分钟内同格（约 1km）直接复用 —— 省上游配额，
  // 也盖住"第一次冷启动抖一下"的毛病。搬家（跨格）自动重拉。
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}:r${radiusMeters}`;
  const hit = spotCache.get(key);
  if (hit && Date.now() - hit.at < SPOT_CACHE_TTL_MS) {
    return { spots: hit.spots, source: "openstreetmap" };
  }
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/v1/places/nearby?lat=${lat}&lng=${lng}&radius=${radiusMeters}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) return { spots: [], source: "offline" };
    const body = (await res.json()) as { places?: unknown; source?: unknown };
    const spots = Array.isArray(body.places)
      ? body.places.map(toSpot).filter((s): s is NearbySpot => s !== null)
      : [];
    if (spots.length > 0) {
      spotCache.set(key, { spots, at: Date.now() });
    }
    return { spots, source: body.source === "openstreetmap" ? "openstreetmap" : "offline" };
  } catch {
    return { spots: [], source: "offline" };
  }
}

export function formatSpotDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "";
  if (distanceMeters < 1000) return `约${Math.round(distanceMeters)}米`;
  return `约${(distanceMeters / 1000).toFixed(1)}公里`;
}
