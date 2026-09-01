// MapClient — R15.32 MapExploreSurface (Phase 1 = bbox read only).
//
// 设计原则：
//  - 后端是 anonymous GET /v1/map/items，不需要 auth。
//  - 跟 FacetClient 完全同形：PublicRequester transport + Zod parse
//    fail-closed。共用相同的 requestPublic 路径（auth-client 里实现）。
//  - 一次调用返回三组数据 (posts / agents / orders) 的子集，调用者
//    用 `kinds` 过滤；wire format 用 plural 自然语言 ("posts")，server
//    parser 同时接受单复数。
//  - Phase 1 NOT-IN-SCOPE：clustering 算法（client 用 simple grid
//    binning）、pin drag-to-reposition、check-in、heatmap。
import type { MapItemsPayload, MapQuery, MapItemKind } from "@proxy/contracts";
import { MapItemsPayloadSchema, buildMapItemsQuery } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";

export type PublicRequester = {
  requestPublic(path: string, init: { method: "GET" }): Promise<TransportResponse>;
};

export type MapClientOptions = {
  requester: PublicRequester;
  baseUrl: string;
};

export class MapProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MapProtocolError";
  }
}

export class MapClient {
  public constructor(private readonly input: MapClientOptions) {}

  /**
   * 查询当前可视区域内的 pins。Kinds 可选；缺省 = 三类全要。
   * 后端会做 limit 上限 clamp (≤500)。
   */
  public async items(q: MapQuery): Promise<MapItemsPayload> {
    const qs = buildMapItemsQuery(q);
    const path = `/v1/map/items?${qs}`;
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new MapProtocolError(`map items unexpected status: ${response.status}`);
    }
    const raw = await response.json();
    return MapItemsPayloadSchema.parse(raw);
  }
}

/**
 * FilterKinds narrows a MapItemsPayload down to the kinds the UI is
 * currently rendering. Pure helper so the surface component doesn't
 * have to remember the optional-array shape.
 */
export function filterByKinds(payload: MapItemsPayload, kinds: ReadonlyArray<MapItemKind>): {
  posts: MapItemsPayload["posts"];
  agents: MapItemsPayload["agents"];
  orders: MapItemsPayload["orders"];
} {
  const want = new Set<MapItemKind>(kinds);
  return {
    posts: want.has("post") ? payload.posts ?? [] : [],
    agents: want.has("agent") ? payload.agents ?? [] : [],
    orders: want.has("order") ? payload.orders ?? [] : [],
  };
}

/**
 * bboxFromRegion — convert an Apple Maps region (lat/lng deltas) into
 * the four corners MapQuery expects. Used by MapView's
 * onRegionChangeComplete to trigger refetch.
 */
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
export function bboxFromRegion(r: Region): { swLat: number; swLng: number; neLat: number; neLng: number } {
  return {
    swLat: r.latitude - r.latitudeDelta / 2,
    neLat: r.latitude + r.latitudeDelta / 2,
    swLng: r.longitude - r.longitudeDelta / 2,
    neLng: r.longitude + r.longitudeDelta / 2,
  };
}
