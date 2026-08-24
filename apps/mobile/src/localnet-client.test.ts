import { describe, expect, it } from "vitest";
import { LocalNetClient } from "./localnet-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

describe("LocalNetClient post publishing", () => {
  it("reuses the caller's stable idempotency key for a publish retry", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-08-24T00:00:00.000Z"));
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: {
        sessionId: "session_001",
        userAccountId: "user_001",
        principal: { type: "INDIVIDUAL", id: "user_001" },
        accessToken: "access",
        refreshToken: "refresh",
        accessExpiresAt: "2026-08-24T01:00:00.000Z",
        refreshExpiresAt: "2026-09-24T00:00:00.000Z",
        rotation: 1
      }
    });
    const envelopes: Array<Record<string, unknown>> = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          envelopes.push(init.body as Record<string, unknown>);
          return {
            status: 200,
            json: async () => ({
              commandId: "command_001",
              outcome: "ACCEPTED",
              aggregate: { type: "Post", id: "post_001", version: 1, state: "PUBLISHED" },
              eventRefs: [],
              correlationId: "correlation_001"
            })
          };
        }
      }
    });
    const payload = { body: "同一草稿", mediaRefs: [{ mediaAssetId: "media_001", sortOrder: 0, altText: "全身照" }] };
    await client.createPost(payload, "publish_draft_001");
    await client.createPost(payload, "publish_draft_001");
    expect(envelopes.map((envelope) => envelope.idempotencyKey)).toEqual(["publish_draft_001", "publish_draft_001"]);
  });
});
