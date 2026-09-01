import { describe, it, expect } from "vitest";
import {
  MapItemKindSchema,
  BBoxSchema,
  MapQuerySchema,
  PostPinSchema,
  AgentPinSchema,
  OrderPinSchema,
  MapItemsPayloadSchema,
  buildMapItemsQuery,
} from "./map";

describe("BBoxSchema", () => {
  it("accepts a valid bbox", () => {
    const ok = BBoxSchema.safeParse({
      swLat: 20.8, swLng: 105.4, neLat: 21.2, neLng: 106.0,
    });
    expect(ok.success).toBe(true);
  });
  it("rejects lat out of range", () => {
    const bad = BBoxSchema.safeParse({
      swLat: 200, swLng: 0, neLat: 21, neLng: 0,
    });
    expect(bad.success).toBe(false);
  });
});

describe("MapItemKindSchema", () => {
  it("accepts the three kinds", () => {
    for (const k of ["post", "agent", "order"]) {
      expect(MapItemKindSchema.safeParse(k).success).toBe(true);
    }
  });
  it("rejects unknown", () => {
    expect(MapItemKindSchema.safeParse("snakes").success).toBe(false);
  });
});

describe("MapQuerySchema", () => {
  it("round-trips", () => {
    const q = { swLat: 10, swLng: 106, neLat: 11, neLng: 107, types: ["post", "agent"] as const, limit: 100 };
    const r = MapQuerySchema.safeParse(q);
    expect(r.success).toBe(true);
  });
});

describe("PostPinSchema", () => {
  it("requires kind=post", () => {
    const ok = PostPinSchema.safeParse({
      kind: "post", id: "p1", lat: 1, lng: 2,
      authorId: "u1", authorName: "X", cityScope: "hn", sceneType: "X", body: "hi",
      createdAt: "2026-01-01T00:00:00Z", mediaCount: 0,
    });
    expect(ok.success).toBe(true);
  });
  it("rejects kind=agent", () => {
    const bad = PostPinSchema.safeParse({
      kind: "agent", id: "p1", lat: 1, lng: 2,
      authorId: "u1", authorName: "X", cityScope: "hn", sceneType: "X", body: "hi",
      createdAt: "2026-01-01T00:00:00Z", mediaCount: 0,
    });
    expect(bad.success).toBe(false);
  });
});

describe("AgentPinSchema", () => {
  it("requires kind=agent", () => {
    const ok = AgentPinSchema.safeParse({
      kind: "agent", id: "a1", lat: 1, lng: 2,
      name: "Linh", bio: "", serviceAreas: ["hn"], languages: ["ZH"],
      photoCount: 0, availability: "AVAILABLE",
    });
    expect(ok.success).toBe(true);
  });
});

describe("OrderPinSchema", () => {
  it("requires kind=order", () => {
    const ok = OrderPinSchema.safeParse({
      kind: "order", id: "o1", lat: 1, lng: 2,
      title: "x", status: "OPEN", budget: 100, city: "hn", area: "hbt", startAt: "2026-01-01",
    });
    expect(ok.success).toBe(true);
  });
});

describe("MapItemsPayloadSchema", () => {
  it("accepts an empty payload (e.g. empty bbox)", () => {
    const ok = MapItemsPayloadSchema.safeParse({
      bbox: { swLat: 0, swLng: 0, neLat: 1, neLng: 1 },
      count: 0,
    });
    expect(ok.success).toBe(true);
  });
  it("accepts posts only", () => {
    const ok = MapItemsPayloadSchema.safeParse({
      bbox: { swLat: 0, swLng: 0, neLat: 1, neLng: 1 },
      count: 1,
      posts: [{
        kind: "post", id: "p", lat: 0.5, lng: 0.5,
        authorId: "u", authorName: "X", cityScope: "hn", sceneType: "X", body: "",
        createdAt: "2026-01-01T00:00:00Z", mediaCount: 0,
      }],
    });
    expect(ok.success).toBe(true);
  });
});

describe("buildMapItemsQuery", () => {
  it("omits empty types and limit", () => {
    const s = buildMapItemsQuery({ swLat: 10, swLng: 106, neLat: 11, neLng: 107 });
    expect(s).toBe("sw_lat=10&sw_lng=106&ne_lat=11&ne_lng=107");
  });
  it("includes types and limit", () => {
    const s = buildMapItemsQuery({ swLat: 10, swLng: 106, neLat: 11, neLng: 107, types: ["post", "agent"], limit: 50 });
    expect(s).toContain("types=post,agent");
    expect(s).toContain("limit=50");
  });
});
