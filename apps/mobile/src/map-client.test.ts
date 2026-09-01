import { describe, it, expect, vi, beforeEach } from "vitest";
import { MapClient, filterByKinds, bboxFromRegion } from "./map-client";
import type { TransportResponse } from "./auth-client";
import type { MapItemsPayload } from "@proxy/contracts";

function makeResponse(status: number, body: unknown): TransportResponse {
  return {
    status,
    json: () => Promise.resolve(body),
  } as TransportResponse;
}

const samplePayload: MapItemsPayload = {
  bbox: { swLat: 0, swLng: 0, neLat: 1, neLng: 1 },
  count: 3,
  posts: [
    { kind: "post", id: "p1", lat: 0.5, lng: 0.5, authorId: "u", authorName: "X", cityScope: "hn", sceneType: "X", body: "", createdAt: "2026-01-01", mediaCount: 0 },
  ],
  agents: [
    { kind: "agent", id: "a1", lat: 0.5, lng: 0.5, name: "Linh", bio: "", serviceAreas: ["hn"], languages: ["ZH"], photoCount: 0, availability: "AVAILABLE" },
  ],
  orders: [
    { kind: "order", id: "o1", lat: 0.5, lng: 0.5, title: "x", status: "OPEN", budget: 0, city: "hn", area: "", startAt: "2026-01-01" },
  ],
};

describe("MapClient.items", () => {
  let captured = { path: "" };
  let mock: any;

  beforeEach(() => {
    captured = { path: "" };
    mock = {
      requestPublic: vi.fn(async (path: string) => {
        captured.path = path;
        return makeResponse(200, samplePayload);
      }),
    };
  });

  it("calls the correct path with query string", async () => {
    const c = new MapClient({ requester: mock, baseUrl: "" });
    const payload = await c.items({ swLat: 10, swLng: 106, neLat: 11, neLng: 107 });
    expect(captured.path).toContain("sw_lat=10");
    expect(payload.count).toBe(3);
  });

  it("throws on non-2xx", async () => {
    mock.requestPublic = vi.fn(async () => makeResponse(500, { error: "boom" }));
    const c = new MapClient({ requester: mock, baseUrl: "" });
    await expect(c.items({ swLat: 0, swLng: 0, neLat: 1, neLng: 1 })).rejects.toThrow(/unexpected status: 500/);
  });

  it("throws on schema mismatch", async () => {
    mock.requestPublic = vi.fn(async () => makeResponse(200, { oops: true }));
    const c = new MapClient({ requester: mock, baseUrl: "" });
    await expect(c.items({ swLat: 0, swLng: 0, neLat: 1, neLng: 1 })).rejects.toThrow();
  });

  it("accepts custom kinds", async () => {
    const c = new MapClient({ requester: mock, baseUrl: "" });
    await c.items({ swLat: 0, swLng: 0, neLat: 1, neLng: 1, types: ["agent"] });
    expect(captured.path).toContain("types=agent");
  });
});

describe("filterByKinds", () => {
  it("returns empty arrays for missing kinds", () => {
    const partial: MapItemsPayload = {
      bbox: { swLat: 0, swLng: 0, neLat: 1, neLng: 1 },
      count: 0,
      posts: [],
    };
    const out = filterByKinds(partial, ["post", "agent", "order"]);
    expect(out.posts).toEqual([]);
    expect(out.agents).toEqual([]);
    expect(out.orders).toEqual([]);
  });

  it("filters by kinds", () => {
    const out = filterByKinds(samplePayload, ["agent"]);
    expect(out.posts).toEqual([]);
    expect(out.agents).toHaveLength(1);
    expect(out.orders).toEqual([]);
  });
});

describe("bboxFromRegion", () => {
  it("returns corners from a center+delta region", () => {
    const b = bboxFromRegion({ latitude: 21.0, longitude: 105.8, latitudeDelta: 0.4, longitudeDelta: 0.6 });
    expect(b.swLat).toBeCloseTo(20.8);
    expect(b.neLat).toBeCloseTo(21.2);
    expect(b.swLng).toBeCloseTo(105.5);
    expect(b.neLng).toBeCloseTo(106.1);
  });
});
