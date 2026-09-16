export interface ClusterInput {
  id: string;
  lat: number;
  lng: number;
}

export interface MapCluster<T extends ClusterInput = ClusterInput> {
  key: string;
  latitude: number;
  longitude: number;
  count: number;
  members: T[];
}

// MAP-CLUSTER-001: 网格聚合（纯函数，无原生依赖）：按当前可视跨度切分固定格数，
// 同一格 ≥2 点即合成一簇（质心）。放大时格子变小自动散开，缩小自动收拢。
// minPoints 固定 2；空输入返空数组。
const CELLS = 8;
const MIN_POINTS = 2;

export function clusterPins<T extends ClusterInput>(
  pins: ReadonlyArray<T>,
  latitudeDelta: number,
  longitudeDelta: number
): MapCluster<T>[] {
  if (pins.length === 0) return [];
  const cellH = latitudeDelta > 0 ? latitudeDelta / CELLS : 1;
  const cellW = longitudeDelta > 0 ? longitudeDelta / CELLS : 1;
  const cells = new Map<string, T[]>();
  for (const pin of pins) {
    if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) continue;
    const key = `${Math.floor(pin.lat / cellH)}:${Math.floor(pin.lng / cellW)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(pin);
    else cells.set(key, [pin]);
  }
  const out: MapCluster<T>[] = [];
  for (const [key, members] of cells) {
    if (members.length < MIN_POINTS) {
      const single = members[0]!;
      out.push({ key: `pin:${single.id}`, latitude: single.lat, longitude: single.lng, count: 1, members });
      continue;
    }
    const latitude = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const longitude = members.reduce((s, m) => s + m.lng, 0) / members.length;
    out.push({ key: `cluster:${key}`, latitude, longitude, count: members.length, members });
  }
  // 输出顺序稳定：按 key 排，渲染不抖。
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}
