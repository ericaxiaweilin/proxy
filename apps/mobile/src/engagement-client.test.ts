import { describe, expect, it } from "vitest";
import { EngagementClient } from "./engagement-client";
import { InMemorySecureStorageDriver, OfflineFallbackSessionError, SecureSessionStore } from "./secure-session";

describe("EngagementClient moderation actions", () => {
  it("sends feed preference and report facts to the server", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 }
    });
    const envelopes: Array<Record<string, unknown>> = [];
    const client = new EngagementClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
      const envelope = init.body as Record<string, unknown>;
      envelopes.push(envelope);
      return { status: 200, json: async () => ({ commandId: envelope.commandId, outcome: "ACCEPTED", eventRefs: [], correlationId: envelope.correlationId }) };
    } } });
    await client.recordFeedPreference("post_1", "REDUCE_AUTHOR", "author_1");
    await client.reportPost("post_1", "SPAM");
    expect(envelopes.map((item) => item.commandType)).toEqual(["RecordFeedPreference", "ReportPost"]);
    expect(envelopes[0]?.payload).toEqual({ postId: "post_1", action: "REDUCE_AUTHOR", authorId: "author_1" });
    expect(envelopes[1]?.payload).toEqual({ postId: "post_1", reason: "SPAM" });
  });

  // R15.38.1: guest (keychain 完全空) 点赞, requireSession 现在抛
  //   OfflineFallbackSessionError, feed 表面 mapEngagementError 能识别
  //   "请登录" 而不是误报 "请检查连接"。主路径之前的 "an authenticated
  //   principal is required" 文案不直接进 UI (但 mapEngagementError 也
  //   补了一个 fallback 匹配)。
  it("throws OfflineFallbackSessionError when session is empty (guest)", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const client = new EngagementClient({ secureSessionStore: store, authClient: { request: async () => { throw new Error("should not reach"); } } });
    await expect(client.recordFeedPreference("post_1", "REDUCE_AUTHOR", "author_1")).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });

  // R15.38.5: 软登出后 (signedOut=true, accessToken="revoked", refreshToken 保留),
  //   点 like 应该拋 OfflineFallbackSessionError, 不调 transport.
  //   配合 mapEngagementError, UI 应该看到 "请登录重试", 不是 "检查连接"。
  it("throws OfflineFallbackSessionError after soft signOut (signedOut=true)", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({
      userAccountId: "user_001",
      auth: {
        sessionId: "session_001",
        userAccountId: "user_001",
        principal: { type: "INDIVIDUAL", id: "user_001" },
        accessToken: "revoked",
        refreshToken: "refresh_keep_for_silent_reauth",
        accessExpiresAt: "2026-08-14T01:00:00.000Z",
        refreshExpiresAt: "2026-09-13T00:00:00.000Z",
        rotation: 1
      },
      principal: { type: "INDIVIDUAL", id: "user_001" },
      signedOut: true,
      signedOutAt: "2026-08-14T00:00:00.000Z"
    });
    let transportCalled = false;
    const client = new EngagementClient({ secureSessionStore: store, authClient: { request: async () => { transportCalled = true; throw new Error("should not be called"); } } });
    await expect(client.reactToPost("post_1")).rejects.toBeInstanceOf(OfflineFallbackSessionError);
    expect(transportCalled).toBe(false);
  });
});

// ---------- R15.45: MuteAuthor ----------

describe("EngagementClient.muteAuthor", () => {
  async function makeAuthenticatedStore() {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 }
    });
    return store;
  }

  it("POSTs MuteAuthor command with { authorId } body", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    let capturedBody: unknown = null;
    const store = await makeAuthenticatedStore();
    const client = new EngagementClient({
      secureSessionStore: store,
      authClient: {
        request: async (path, init) => {
          capturedPath = path;
          capturedMethod = String(init.method);
          capturedBody = init.body;
          const envelope = init.body as Record<string, unknown>;
          return { status: 200, json: async () => ({ commandId: envelope.commandId, outcome: "ACCEPTED", aggregate: { id: "mute_1", state: "MUTED" }, eventRefs: [], correlationId: envelope.correlationId }) };
        }
      }
    });
    await client.muteAuthor("author_xyz");
    expect(capturedPath).toBe("/v1/commands/MuteAuthor");
    expect(capturedMethod).toBe("POST");
    const body = capturedBody as { payload?: { authorId?: string } };
    expect(body?.payload?.authorId).toBe("author_xyz");
  });

  it("throws on server rejection (e.g. cannot mute self)", async () => {
    const store = await makeAuthenticatedStore();
    const client = new EngagementClient({
      secureSessionStore: store,
      authClient: {
        request: async () => ({
          status: 200,
          json: async () => ({ outcome: "REJECTED", error: { errorCode: "CANNOT_MUTE_SELF", messageKey: "engagement.cannot_mute_self" }, eventRefs: [] })
        })
      }
    });
    await expect(client.muteAuthor("user_001")).rejects.toThrow();
  });

  it("throws on offline fallback session", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 },
      serverSession: false
    });
    const client = new EngagementClient({
      secureSessionStore: store,
      authClient: { request: async () => { throw new Error("should not be called"); } }
    });
    await expect(client.muteAuthor("author_xyz")).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});

describe("EngagementClient R15.54 follow graph", () => {
  function newAuthedClient(responder: (envelope: Record<string, unknown>) => Record<string, unknown>) {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    void store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 }
    });
    return new EngagementClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
      const envelope = init.body as Record<string, unknown>;
      const body = responder(envelope);
      return { status: 200, json: async () => body };
    } } });
  }

  it("unfollowProfile: returns UNFOLLOWED state", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "Follow", id: "user_001|user_002", version: 1, state: "UNFOLLOWED" },
      correlationId: env.correlationId
    }));
    const state = await client.unfollowProfile("user_002");
    expect(state).toBe("UNFOLLOWED");
  });

  it("unfollowProfile: NOT_FOLLOWING (idempotent) state", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "Follow", id: "user_001|user_999", version: 1, state: "NOT_FOLLOWING" },
      correlationId: env.correlationId
    }));
    const state = await client.unfollowProfile("user_999");
    expect(state).toBe("NOT_FOLLOWING");
  });

  it("getFollowCounts: parses operationRef JSON", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "FollowCounts", id: "user_001", version: 1, state: "OK" },
      operationRef: JSON.stringify({ userId: "user_001", followers: 128, following: 56 }),
      correlationId: env.correlationId
    }));
    const counts = await client.getFollowCounts("user_001");
    expect(counts.followers).toBe(128);
    expect(counts.following).toBe(56);
  });

  it("isFollowing: returns true", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "FollowingState", id: "user_001|user_002", version: 1, state: "OK" },
      operationRef: JSON.stringify({ isFollowing: true }),
      correlationId: env.correlationId
    }));
    const is = await client.isFollowing("user_001", "user_002");
    expect(is).toBe(true);
  });

  it("isFollowing: returns false", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "FollowingState", id: "user_001|user_003", version: 1, state: "OK" },
      operationRef: JSON.stringify({ isFollowing: false }),
      correlationId: env.correlationId
    }));
    const is = await client.isFollowing("user_001", "user_003");
    expect(is).toBe(false);
  });
});

describe("EngagementClient R15.56 post pin (置顶)", () => {
  function newAuthedClient(responder: (env: Record<string, unknown>) => Record<string, unknown>) {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    void store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 }
    });
    return new EngagementClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
      const envelope = init.body as Record<string, unknown>;
      const body = responder(envelope);
      return { status: 200, json: async () => body };
    } } });
  }

  it("pinPost: returns PINNED state", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "PostPin", id: "user_001|post_1", version: 1, state: "PINNED" },
      correlationId: env.correlationId
    }));
    const state = await client.pinPost("post_1");
    expect(state).toBe("PINNED");
  });

  it("pinPost: ALREADY_PINNED idempotent", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "PostPin", id: "user_001|post_1", version: 1, state: "ALREADY_PINNED" },
      correlationId: env.correlationId
    }));
    const state = await client.pinPost("post_1");
    expect(state).toBe("ALREADY_PINNED");
  });

  it("unpinPost: returns UNPINNED", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "PostPin", id: "user_001|post_1", version: 1, state: "UNPINNED" },
      correlationId: env.correlationId
    }));
    const state = await client.unpinPost("post_1");
    expect(state).toBe("UNPINNED");
  });

  it("listPinnedPosts: parses { ownerId, postIds, count }", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "PostPin", id: "user_001", version: 1, state: "LISTED" },
      operationRef: JSON.stringify({ ownerId: "user_001", postIds: ["post_1", "post_2"], count: 2 }),
      correlationId: env.correlationId
    }));
    const out = await client.listPinnedPosts("user_001");
    expect(out.count).toBe(2);
    expect(out.postIds).toEqual(["post_1", "post_2"]);
  });
});
