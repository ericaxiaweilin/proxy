import { describe, it, expect } from "vitest";
import { FacetClient, FacetProtocolError } from "./facet-client";
import type { PublicRequester } from "./facet-client";
import type { TransportResponse } from "./auth-client";

// 模拟最小化 public requester — 不依赖 SessionAuthClient / network。
function makeRequester(handler: (path: string, init: { method: string; body?: unknown }) => TransportResponse): PublicRequester {
  return {
    requestPublic: async (path, init) => handler(path, init)
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
  sideSpaceKind: "",
  sideSpacePosts: [],
  sideSpaceFulfilled: false
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

  // ---------- R15.43 副空间 CRUD ----------

  it("listSideSpacePosts returns parsed posts", async () => {
    const client = new FacetClient({
      requester: makeRequester((path) => {
        expect(path).toBe("/v1/facet/objects/spa/side-space/posts");
        return ok({
          posts: [
            { id: "ss-store-env", kind: "intro/services", title: "门店环境", imageUrl: "", addedAt: "2026-09-01T00:00:00Z" }
          ]
        });
      }),
      baseUrl: "http://localhost:3000"
    });
    const out = await client.listSideSpacePosts("spa");
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]!.id).toBe("ss-store-env");
  });

  it("addSideSpacePost POSTs with { postId } body and parses response", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    let capturedBody: unknown = null;
    const client = new FacetClient({
      requester: {
        requestPublic: async (path, init) => {
          capturedPath = path;
          capturedMethod = String(init.method);
          capturedBody = init.body;
          return ok({
            id: "ss-store-env", kind: "intro/services", title: "门店环境", imageUrl: "", addedAt: "2026-09-01T00:00:00Z"
          });
        }
      },
      baseUrl: "http://localhost:3000"
    });
    const out = await client.addSideSpacePost("spa", "ss-store-env");
    expect(capturedPath).toBe("/v1/facet/objects/spa/side-space/posts");
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual({ postId: "ss-store-env" });
    expect(out.id).toBe("ss-store-env");
  });

  it("removeSideSpacePost DELETEs the correct path", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    const client = new FacetClient({
      requester: {
        requestPublic: async (path, init) => {
          capturedPath = path;
          capturedMethod = String(init.method);
          return { status: 200, json: async () => ({ status: "removed" }) };
        }
      },
      baseUrl: "http://localhost:3000"
    });
    await client.removeSideSpacePost("spa", "ss-store-env");
    expect(capturedPath).toBe("/v1/facet/objects/spa/side-space/posts/ss-store-env");
    expect(capturedMethod).toBe("DELETE");
  });

  it("listSideSpaceCatalog returns 5 mock posts", async () => {
    const client = new FacetClient({
      requester: makeRequester((path) => {
        expect(path).toBe("/v1/facet/side-space/catalog");
        return ok({
          posts: [
            { id: "ss-store-env", kind: "intro/services", title: "门店", imageUrl: "" },
            { id: "ss-service-1", kind: "intro/services", title: "服务", imageUrl: "" },
            { id: "ss-client-1", kind: "portfolio/capability", title: "客户", imageUrl: "" },
            { id: "ss-capability-compare", kind: "portfolio/capability", title: "能力对比", imageUrl: "" },
            { id: "ss-collab-1", kind: "portfolio/capability", title: "合作", imageUrl: "" }
          ]
        });
      }),
      baseUrl: "http://localhost:3000"
    });
    const out = await client.listSideSpaceCatalog();
    expect(out.posts).toHaveLength(5);
  });

  it("R15.43: sideSpace post with bad kind is rejected by zod", async () => {
    const client = new FacetClient({
      requester: makeRequester(() => ok({
        posts: [{ id: "x", kind: "BOGUS_KIND", title: "t", imageUrl: "", addedAt: "2026-09-01T00:00:00Z" }]
      })),
      baseUrl: "http://localhost:3000"
    });
    await expect(client.listSideSpacePosts("spa")).rejects.toThrow();
  });
});

// ---------- R15.51 FacetConfig ----------

describe("FacetClient.config", () => {
  it("R15.51: listFacetConfig GET /v1/facet/config returns parsed FacetConfig", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    const client = new FacetClient({
      requester: makeRequester((path, init) => {
        capturedPath = path;
        capturedMethod = init.method;
        return ok({
          sideSpaceHighThreshold: 2,
          sideSpaceMidThreshold: 2,
          priorityMidBoundary: 30,
          priorityHighBoundary: 60,
          confidenceFloor: 50,
          updatedAt: "2026-09-01T00:00:00Z",
          updatedBy: "ops_default",
          version: 1
        });
      }),
      baseUrl: "http://localhost:3000"
    });
    const cfg = await client.listFacetConfig();
    expect(capturedPath).toBe("/v1/facet/config");
    expect(capturedMethod).toBe("GET");
    expect(cfg.sideSpaceHighThreshold).toBe(2);
    expect(cfg.priorityHighBoundary).toBe(60);
    expect(cfg.version).toBe(1);
  });

  it("R15.51: updateFacetConfig POST /v1/facet/config with version+patch returns new config", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    let capturedBody: unknown = null;
    const client = new FacetClient({
      requester: makeRequester((path, init) => {
        capturedPath = path;
        capturedMethod = init.method;
        capturedBody = init.body;
        return ok({
          sideSpaceHighThreshold: 3,
          sideSpaceMidThreshold: 2,
          priorityMidBoundary: 30,
          priorityHighBoundary: 60,
          confidenceFloor: 50,
          updatedAt: "2026-09-01T00:00:00Z",
          updatedBy: "ops_alice",
          version: 2
        });
      }),
      baseUrl: "http://localhost:3000"
    });
    const out = await client.updateFacetConfig({
      expectedVersion: 1,
      patch: { sideSpaceHighThreshold: 3, updatedBy: "ops_alice" }
    });
    expect(capturedPath).toBe("/v1/facet/config");
    expect(capturedMethod).toBe("POST");
    expect((capturedBody as { expectedVersion?: number }).expectedVersion).toBe(1);
    expect((capturedBody as { patch?: { updatedBy?: string } }).patch?.updatedBy).toBe("ops_alice");
    expect(out.version).toBe(2);
    expect(out.sideSpaceHighThreshold).toBe(3);
  });

  it("R15.51: updateFacetConfig 409 throws FacetProtocolError (version mismatch)", async () => {
    const client = new FacetClient({
      requester: makeRequester(() => ({ status: 409, json: async () => ({ error: "config_version_mismatch" }) })),
      baseUrl: "http://localhost:3000"
    });
    await expect(
      client.updateFacetConfig({ expectedVersion: 1, patch: { updatedBy: "ops" } })
    ).rejects.toBeInstanceOf(FacetProtocolError);
  });

  it("R15.51: updateFacetConfig 400 throws FacetProtocolError (invalid)", async () => {
    const client = new FacetClient({
      requester: makeRequester(() => ({ status: 400, json: async () => ({ error: "config_invalid_value" }) })),
      baseUrl: "http://localhost:3000"
    });
    await expect(
      client.updateFacetConfig({ expectedVersion: 1, patch: { updatedBy: "ops" } })
    ).rejects.toBeInstanceOf(FacetProtocolError);
  });
});

describe("FacetClient.sideSpaceSuggestions (R15.52)", () => {
  it("GET /v1/facet/side-space/suggestions?limit=3 returns parsed payload", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    const client = new FacetClient({
      requester: makeRequester((path, init) => {
        capturedPath = path;
        capturedMethod = init.method;
        return ok({
          suggestions: {
            spa: {
              objectId: "spa",
              sideSpaceKind: "portfolio/capability",
              posts: [
                { post: { id: "ss-collab-1", kind: "portfolio/capability", title: "合作", imageUrl: "" }, reason: "匹配 portfolio/capability 缺口", rank: 1 }
              ]
            }
          }
        });
      }),
      baseUrl: "http://localhost:3000"
    });
    const out = await client.listSideSpaceSuggestions(3);
    expect(capturedPath).toBe("/v1/facet/side-space/suggestions?limit=3");
    expect(capturedMethod).toBe("GET");
    expect(out.suggestions.spa).toBeDefined();
    expect(out.suggestions.spa?.sideSpaceKind).toBe("portfolio/capability");
    expect(out.suggestions.spa?.posts[0]?.rank).toBe(1);
  });

  it("uses default limit=3 when arg omitted", async () => {
    let capturedPath = "";
    const client = new FacetClient({
      requester: makeRequester((path) => {
        capturedPath = path;
        return ok({ suggestions: {} });
      }),
      baseUrl: "http://localhost:3000"
    });
    await client.listSideSpaceSuggestions();
    expect(capturedPath).toBe("/v1/facet/side-space/suggestions?limit=3");
  });

  it("rejects on malformed payload (zod fail-closed)", async () => {
    const client = new FacetClient({
      requester: makeRequester(() => ok({ wrong: "shape" })),
      baseUrl: "http://localhost:3000"
    });
    await expect(client.listSideSpaceSuggestions(3)).rejects.toThrow();
  });
});
