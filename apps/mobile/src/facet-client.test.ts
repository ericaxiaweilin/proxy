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
