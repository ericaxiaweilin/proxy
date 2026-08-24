import { describe, expect, it } from "vitest";
import { EngagementClient } from "./engagement-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

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
});
