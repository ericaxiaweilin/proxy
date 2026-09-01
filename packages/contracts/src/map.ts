import { z } from "zod";

// R15.32 — MapExploreSurface wire contracts.
//
// The mobile app calls GET /v1/map/items?sw_lat=...&sw_lng=...&ne_lat=...&ne_lng=...
// on every pan / zoom. The response shape is deliberately flat (one
// array per item kind) so the client can drop pins without first
// reshaping a unified list.
//
// All coordinates are WGS-84 (MapKit / Google Maps native). 5 decimal
// places = ~1m precision which is more than enough for a city-scale
// pin (and small enough to keep the wire payload under a few KB).

export const MapItemKindSchema = z.enum(["post", "agent", "order"]);
export type MapItemKind = z.infer<typeof MapItemKindSchema>;

// BBoxSchema — the four corners. Validated by ParseBBox on the server
// but we mirror the check here so the client can fail-fast before the
// round-trip.
export const BBoxSchema = z.object({
  swLat: z.number().min(-90).max(90),
  swLng: z.number().min(-180).max(180),
  neLat: z.number().min(-90).max(90),
  neLng: z.number().min(-180).max(180),
});
export type BBox = z.infer<typeof BBoxSchema>;

// MapQuerySchema — what the client sends in the query string.
// types is comma-separated for HTTP-friendliness. limit is clamped by
// the server to 1..500.
export const MapQuerySchema = z.object({
  swLat: z.number(),
  swLng: z.number(),
  neLat: z.number(),
  neLng: z.number(),
  types: z.array(MapItemKindSchema).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type MapQuery = z.infer<typeof MapQuerySchema>;

// Pin schemas. Each is a self-contained projection — when the user
// taps a pin the bottom sheet can render immediately, no follow-up
// fetch required for the preview.

export const PostPinSchema = z.object({
  kind: z.literal("post"),
  id: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  authorId: z.string(),
  authorName: z.string(),
  cityScope: z.string(),
  sceneType: z.string(),
  body: z.string(),
  createdAt: z.string(),
  mediaCount: z.number().int().nonnegative(),
  // R15.32.2: optional cover image. Server returns the storage key
  // reshaped to /v1/media/thumb/{key}. Empty when the post has no
  // media. The mobile client falls back to a colored placeholder.
  mediaType: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});
export type PostPin = z.infer<typeof PostPinSchema>;

export const AgentPinSchema = z.object({
  kind: z.literal("agent"),
  id: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  name: z.string(),
  bio: z.string(),
  serviceAreas: z.array(z.string()),
  languages: z.array(z.string()),
  photoCount: z.number().int().nonnegative(),
  availability: z.enum(["AVAILABLE", "BUSY", "OFFLINE", "UNKNOWN"]),
});
export type AgentPin = z.infer<typeof AgentPinSchema>;

export const OrderPinSchema = z.object({
  kind: z.literal("order"),
  id: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  title: z.string(),
  status: z.string(),
  budget: z.number().int().nonnegative(),
  city: z.string(),
  area: z.string(),
  startAt: z.string(),
});
export type OrderPin = z.infer<typeof OrderPinSchema>;

// PayloadSchema — the response. Fields are optional so a `types=posts`
// filter returns only { posts, bbox, count }.
export const MapItemsPayloadSchema = z.object({
  posts: z.array(PostPinSchema).optional(),
  agents: z.array(AgentPinSchema).optional(),
  orders: z.array(OrderPinSchema).optional(),
  bbox: BBoxSchema,
  count: z.number().int().nonnegative(),
});
export type MapItemsPayload = z.infer<typeof MapItemsPayloadSchema>;

// buildQueryString — turn a MapQuery into ?sw_lat=...&sw_lng=... form.
export function buildMapItemsQuery(q: MapQuery): string {
  const parts: string[] = [
    `sw_lat=${q.swLat}`,
    `sw_lng=${q.swLng}`,
    `ne_lat=${q.neLat}`,
    `ne_lng=${q.neLng}`,
  ];
  if (q.types && q.types.length > 0) {
    parts.push(`types=${q.types.join(",")}`);
  }
  if (q.limit) {
    parts.push(`limit=${q.limit}`);
  }
  return parts.join("&");
}
