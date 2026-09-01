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
