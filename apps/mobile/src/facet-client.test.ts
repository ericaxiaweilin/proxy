import { describe, it, expect } from "vitest";
import { FacetClient, FacetProtocolError } from "./facet-client";
import type { PublicRequester } from "./facet-client";
import type { TransportResponse } from "./auth-client";

// 模拟最小化 public requester — 不依赖 SessionAuthClient / network。
function makeRequester(handler: (path: string) => TransportResponse): PublicRequester {
  return {
    requestPublic: async (path, init) => {
      if (init.method !== "GET") throw new Error("test: expected GET");
      return handler(path);
    }
  };
}

function ok(body: unknown): TransportResponse {
  return { status: 200, json: async () => body };
}

function errStatus(status: number): TransportResponse {
  return { status, json: async () => ({}) };
}

const KEN = {
  id: "ken",
  displayName: "小帅 Ken",
  relation: "BUILDING_TRUST",
  goal: "加强熟悉感与信任",
  currentState: "已展示 16 条",
  pillLabel: "重点关系",
  gap: { summary: "真人互动", nextShowAt: "今晚 20:00" },
  avatarUrl: "",
  recommendedKind: "personal/real-life",
  reasoningConfidence: 70,
  sideSpaceGap: "",
  sideSpaceKind: ""
};

const VALID_PAYLOAD = {
  objects: [KEN],
  totalObjects: 1,
  freshAssets: 5,
  shownAssets: 16
};

describe("FacetClient.listObjects", () => {
  it("parses valid payload from /v1/facet/objects", async () => {
    const client = new FacetClient({
      requester: makeRequester((path) => {
        expect(path).toBe("/v1/facet/objects");
        return ok(VALID_PAYLOAD);
      }),
      baseUrl: "http://localhost:3000"
    });
    const out = await client.listObjects();
    expect(out.objects).toHaveLength(1);
    expect(out.objects[0]!.id).toBe("ken");
    expect(out.totalObjects).toBe(1);
    expect(out.freshAssets).toBe(5);
    expect(out.shownAssets).toBe(16);
  });

  it("rejects non-2xx status with FacetProtocolError", async () => {
    const client = new FacetClient({
      requester: makeRequester(() => errStatus(503)),
      baseUrl: "http://localhost:3000"
    });
    await expect(client.listObjects()).rejects.toBeInstanceOf(FacetProtocolError);
  });

  it("rejects malformed payload (missing required field) with zod error", async () => {
    const client = new FacetClient({
      requester: makeRequester(() => ok({ objects: [], totalObjects: 0 })),
      baseUrl: "http://localhost:3000"
    });
    // 缺 freshAssets + shownAssets — zod 抛 ZodError (不是 FacetProtocolError)
    await expect(client.listObjects()).rejects.toThrow();
  });

  it("rejects bad relation enum (fail-closed schema)", async () => {
    const client = new FacetClient({
      requester: makeRequester(() => ok({
        ...VALID_PAYLOAD,
        objects: [{ ...KEN, relation: "BAD_RELATION" }]
      })),
      baseUrl: "http://localhost:3000"
    });
    await expect(client.listObjects()).rejects.toThrow();
  });
});
