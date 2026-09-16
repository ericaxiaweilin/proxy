import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngagementClient, EngagementCommandRejectedError } from "./engagement-client";
import { InMemorySecureStorageDriver, OfflineFallbackSessionError, SecureSessionStore } from "./secure-session";

describe("EngagementClient moderation actions", () => {
  it("sends feed preference and report facts to the server", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
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
        refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
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
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
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
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 },
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
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
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
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
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

describe("EngagementClient R15.61/R15.62 list user replies/bookmarks", () => {
  function newAuthedClient(responder: (env: Record<string, unknown>) => Record<string, unknown>) {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    void store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
    });
    return new EngagementClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
      const envelope = init.body as Record<string, unknown>;
      const body = responder(envelope);
      return { status: 200, json: async () => body };
    } } });
  }

  it("listUserReplies: parses { userId, replies[], count }", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "Reply", id: "user_001", version: 1, state: "LISTED" },
      operationRef: JSON.stringify({
        userId: "user_001",
        replies: [
          { replyId: "r_1", postId: "post_1", parentPostId: "post_1", body: "comment A", createdAt: "2026-09-01T00:00:00Z" }
        ],
        count: 1
      }),
      correlationId: env.correlationId
    }));
    const out = await client.listUserReplies("user_001");
    expect(out.count).toBe(1);
    expect(out.replies[0]?.body).toBe("comment A");
  });

  it("listUserBookmarks: parses { userId, bookmarks[], count }", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "Bookmark", id: "user_001", version: 1, state: "LISTED" },
      operationRef: JSON.stringify({
        userId: "user_001",
        bookmarks: ["post_1", "post_2"],
        count: 2
      }),
      correlationId: env.correlationId
    }));
    const out = await client.listUserBookmarks("user_001");
    expect(out.count).toBe(2);
    expect(out.bookmarks).toEqual(["post_1", "post_2"]);
  });

  it("listUserBookmarks: limit optional", async () => {
    let capturedLimit: number | undefined = undefined;
    const client = newAuthedClient((env) => {
      const payload = env.payload as Record<string, unknown>;
      capturedLimit = payload.limit as number | undefined;
      return {
        commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
        aggregate: { type: "Bookmark", id: "user_001", version: 1, state: "LISTED" },
        operationRef: JSON.stringify({ userId: "user_001", bookmarks: [], count: 0 }),
        correlationId: env.correlationId
      };
    });
    await client.listUserBookmarks("user_001", 30);
    expect(capturedLimit).toBe(30);
  });
});

describe("POST-REACTION-TRUTH-001 / POST-COMMENT-VISIBILITY-001 wire", () => {
  function clientWith(operationRef: Record<string, unknown>) {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    void store.write({ userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 } });
    return new EngagementClient({ secureSessionStore: store, authClient: { request: async (_path, init) => ({ status: 200, json: async () => ({ commandId: (init.body as any).commandId, outcome: "ACCEPTED", eventRefs: [], aggregate: { type: "Post", id: "post_1", version: 1, state: "OK" }, operationRef: JSON.stringify(operationRef), correlationId: (init.body as any).correlationId }) }) } });
  }

  it("hydrates server reaction counts and viewer state", async () => {
    const engagement = { postId: "post_1", followed: false, reactions: 8, replies: 2, reposts: 0, bookmarked: false, reacted: true };
    await expect(clientWith({ engagement }).getPostEngagement("post_1")).resolves.toEqual(engagement);
  });

  it("returns the post comment list used after reply refresh", async () => {
    const replies = [{ replyId: "rep_1", postId: "post_1", actorId: "user_001", body: "hello", createdAt: "2026-09-05T00:00:00Z" }];
    await expect(clientWith({ postId: "post_1", replies, count: 1 }).listPostReplies("post_1")).resolves.toEqual({ postId: "post_1", replies, count: 1 });
  });
});

// MUTE-REVERSIBLE-001 — 屏蔽以前是单向的：服务端只有 AddMutedAuthor / IsMuted，
// 没有 UnmuteAuthor 也没有 ListMutedAuthors，于是被屏蔽者的帖子被 feed 永久过滤
// 之后再无任何入口可撤销。这一组钉住「有回程」这件事真的接到了线上命令名上。
describe("MUTE-REVERSIBLE-001 unmute / list muted authors wire", () => {
  function newAuthedClient(responder: (env: Record<string, unknown>) => Record<string, unknown>) {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    void store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
    });
    return new EngagementClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
      const envelope = init.body as Record<string, unknown>;
      return { status: 200, json: async () => responder(envelope) };
    } } });
  }

  it("unmuteAuthor sends UnmuteAuthor carrying the author id", async () => {
    const seen: Array<{ commandType: unknown; target: unknown; payload: unknown }> = [];
    const client = newAuthedClient((env) => {
      seen.push({ commandType: env.commandType, target: env.target, payload: env.payload });
      return {
        commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
        aggregate: { type: "MutedAuthor", id: "author_1", version: 1, state: "UNMUTED" },
        correlationId: env.correlationId
      };
    });
    await expect(client.unmuteAuthor("author_1")).resolves.toBe("UNMUTED");
    expect(seen[0]?.commandType).toBe("UnmuteAuthor");
    expect(seen[0]?.payload).toEqual({ authorId: "author_1" });
    // target.id 必须非空，否则信封在 dispatch 之前就被拒成 INVALID_COMMAND_ENVELOPE。
    expect(seen[0]?.target).toEqual({ type: "Profile", id: "author_1" });
  });

  it("unmuteAuthor reports NOT_MUTED for an idempotent repeat", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "MutedAuthor", id: "author_1", version: 1, state: "NOT_MUTED" },
      correlationId: env.correlationId
    }));
    await expect(client.unmuteAuthor("author_1")).resolves.toBe("NOT_MUTED");
  });

  it("listMutedAuthors parses { actorId, mutedAuthors[], count } and keeps server-resolved names", async () => {
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "MutedAuthor", id: "user_001", version: 1, state: "LISTED" },
      operationRef: JSON.stringify({
        actorId: "user_001",
        mutedAuthors: [
          { muteId: "mute_1", authorId: "author_1", createdAt: "2026-09-13T12:00:00Z", authorDisplayName: "NguyenThanhHuyen" },
          { muteId: "mute_2", authorId: "author_2", createdAt: "2026-09-13T11:00:00Z" }
        ],
        count: 2
      }),
      correlationId: env.correlationId
    }));
    const out = await client.listMutedAuthors();
    expect(out.count).toBe(2);
    expect(out.actorId).toBe("user_001");
    expect(out.mutedAuthors.map((row) => row.authorId)).toEqual(["author_1", "author_2"]);
    expect(out.mutedAuthors[0]?.authorDisplayName).toBe("NguyenThanhHuyen");
    // 解析不到的作者名缺席，而不是被回填成 authorId。
    expect(out.mutedAuthors[1]?.authorDisplayName).toBeUndefined();
  });

  it("listMutedAuthors forwards an optional limit and targets the caller", async () => {
    let captured: { target: unknown; payload: unknown } | undefined;
    const client = newAuthedClient((env) => {
      captured = { target: env.target, payload: env.payload };
      return {
        commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
        aggregate: { type: "MutedAuthor", id: "user_001", version: 1, state: "LISTED" },
        operationRef: JSON.stringify({ actorId: "user_001", mutedAuthors: [], count: 0 }),
        correlationId: env.correlationId
      };
    });
    await client.listMutedAuthors(25);
    expect(captured?.payload).toEqual({ limit: 25 });
    expect(captured?.target).toEqual({ type: "Profile", id: "user_001" });
  });

  it("listMutedAuthors omits limit when not given", async () => {
    let payload: unknown;
    const client = newAuthedClient((env) => {
      payload = env.payload;
      return {
        commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
        aggregate: { type: "MutedAuthor", id: "user_001", version: 1, state: "LISTED" },
        operationRef: JSON.stringify({ actorId: "user_001", mutedAuthors: [], count: 0 }),
        correlationId: env.correlationId
      };
    });
    await client.listMutedAuthors();
    expect(payload).toEqual({});
  });

  it("listMutedAuthors throws instead of faking an empty list", async () => {
    // 唯一解除入口：服务端没给读模型时绝不能悄悄返 { count: 0 }，
    // 否则界面会渲染「还没有屏蔽任何人」，用户会以为屏蔽丢了。
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "MutedAuthor", id: "user_001", version: 1, state: "LISTED" },
      correlationId: env.correlationId
    }));
    await expect(client.listMutedAuthors()).rejects.toThrow(/missing operationRef/);
  });

  it("listMutedAuthors refuses to run for a guest", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const client = new EngagementClient({ secureSessionStore: store, authClient: { request: async () => { throw new Error("should not reach"); } } });
    await expect(client.listMutedAuthors()).rejects.toBeInstanceOf(OfflineFallbackSessionError);
    await expect(client.unmuteAuthor("author_1")).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});

// ---------- POLL-VOTE-001: VotePostPoll ----------

describe("EngagementClient.votePostPoll", () => {
  function newAuthedClient(responder: (env: Record<string, unknown>) => Record<string, unknown>, onPath?: (path: string) => void) {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    void store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
    });
    return new EngagementClient({ secureSessionStore: store, authClient: { request: async (path, init) => {
      onPath?.(path);
      const envelope = init.body as Record<string, unknown>;
      return { status: 200, json: async () => responder(envelope) };
    } } });
  }

  function accepted(env: Record<string, unknown>, poll: unknown) {
    return {
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "Post", id: "post_1", version: 1, state: "POLL_VOTED" },
      operationRef: JSON.stringify({ postId: "post_1", poll }),
      correlationId: env.correlationId
    };
  }

  const pollView = {
    options: [
      { optionId: "opt_a", label: "甜", sortOrder: 0, voteCount: 3 },
      { optionId: "opt_b", label: "辣", sortOrder: 1, voteCount: 1 }
    ],
    totalVotes: 4,
    votedOptionId: "opt_a",
    expiresAt: "2026-09-15T10:00:00.000Z",
    closed: false
  };

  it("POSTs VotePostPoll with { postId, optionId } targeting the post", async () => {
    let capturedPath = "";
    let captured: Record<string, unknown> | undefined;
    const client = newAuthedClient((env) => { captured = env; return accepted(env, pollView); }, (path) => { capturedPath = path; });
    await client.votePostPoll("post_1", "opt_a");
    expect(capturedPath).toBe("/v1/commands/VotePostPoll");
    expect(captured?.target).toEqual({ type: "Post", id: "post_1" });
    expect(captured?.payload).toEqual({ postId: "post_1", optionId: "opt_a" });
  });

  it("returns the server's authoritative tally rather than guessing client-side", async () => {
    // 关键：票数必须是服务端给的。客户端绝不能自己「旧数字 +1」——
    // 改票时还得给旧选项 -1，猜错一步百分比就与服务端对不上。
    const client = newAuthedClient((env) => accepted(env, pollView));
    const poll = await client.votePostPoll("post_1", "opt_a");
    expect(poll.totalVotes).toBe(4);
    expect(poll.votedOptionId).toBe("opt_a");
    expect(poll.options.map((option) => option.voteCount)).toEqual([3, 1]);
    expect(poll.closed).toBe(false);
  });

  it("surfaces the server error code when the poll is closed", async () => {
    // 截止后必须让调用方拿到 POLL_CLOSED：界面据此「显示结果 + 禁止再投」，
    // 而不是笼统报一句「请检查连接」。
    const client = newAuthedClient((env) => ({
      commandId: env.commandId,
      outcome: "REJECTED",
      // 字段必须完整：parseErrorEnvelope 要求 errorCode/category/retryability/
      // messageKey/correlationId 齐备，缺一个就整条 error 被丢掉 —— 客户端
      // 于是只能笼统报「请检查连接」，POLL_CLOSED 这个码就白设计了。
      error: {
        errorCode: "POLL_CLOSED",
        category: "BUSINESS_STATE",
        retryability: "AFTER_USER_ACTION",
        messageKey: "localnet.poll_closed",
        correlationId: env.correlationId
      },
      eventRefs: [],
      correlationId: env.correlationId
    }));
    const caught = await client.votePostPoll("post_1", "opt_a").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(EngagementCommandRejectedError);
    expect((caught as EngagementCommandRejectedError).result.error?.errorCode).toBe("POLL_CLOSED");
  });

  it("throws instead of inventing a result when operationRef is missing", async () => {
    // 跟屏蔽列表同理：没有权威票数就渲染「0 票」是在骗人，用户会以为票丢了。
    const client = newAuthedClient((env) => ({
      commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [],
      aggregate: { type: "Post", id: "post_1", version: 1, state: "POLL_VOTED" },
      correlationId: env.correlationId
    }));
    await expect(client.votePostPoll("post_1", "opt_a")).rejects.toThrow(/missing operationRef/);
  });

  it("refuses to run for a guest", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const client = new EngagementClient({ secureSessionStore: store, authClient: { request: async () => { throw new Error("should not reach"); } } });
    await expect(client.votePostPoll("post_1", "opt_a")).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});

// ENGAGEMENT-FALLBACK-EMPTY-001: 这三个读取方法以前把**所有**错误（连协议错也算）
// 吞成空列表 + 计数 0。危害不只是少显示一点：promise 永远 resolve，调用方没有机会
// 知道失败了 —— 个人主页照常渲染「还没有收藏／还没有回复」，用户以为东西丢了。
// 这也让 PROFILE-TAB-LOAD-FAILED-001 的失败标记永远翻不起来。
describe("ENGAGEMENT-FALLBACK-EMPTY-001", () => {
  function clientWithoutPayload(): EngagementClient {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    void store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 },
    });
    // 服务端 ACCEPTED 但没给 operationRef —— 正是以前会掉进 fallback 的那种响应。
    return new EngagementClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
      const env = init.body as Record<string, unknown>;
      return { status: 200, json: async () => ({ commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [], aggregate: { type: "Profile", id: "user_001", version: 1, state: "LISTED" }, correlationId: env.correlationId }) };
    } } });
  }

  it("listPinnedPosts rejects instead of faking an empty list", async () => {
    await expect(clientWithoutPayload().listPinnedPosts("user_001")).rejects.toThrow(/missing operationRef/);
  });

  it("listUserReplies rejects instead of faking an empty list", async () => {
    await expect(clientWithoutPayload().listUserReplies("user_001")).rejects.toThrow(/missing operationRef/);
  });

  it("listUserBookmarks rejects instead of faking an empty list", async () => {
    await expect(clientWithoutPayload().listUserBookmarks("user_001")).rejects.toThrow(/missing operationRef/);
  });

  it("no reader swallows into an empty list any more", () => {
    const source = readFileSync(fileURLToPath(new URL("./engagement-client.ts", import.meta.url)), "utf8");
    // 反向钉：三条静默兜底不许回来。
    expect(source).not.toContain("return { ownerId, postIds: [], count: 0 };");
    expect(source).not.toContain("return { userId, replies: [], count: 0 };");
    expect(source).not.toContain("return { userId, bookmarks: [], count: 0 };");
  });
});
