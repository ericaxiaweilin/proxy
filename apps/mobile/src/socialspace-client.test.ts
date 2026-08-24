import { describe, expect, it } from "vitest";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";
import { SocialSpaceClient } from "./socialspace-client";

async function sessionStore(): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  await store.write({
    userAccountId: "user_001",
    principal: { type: "INDIVIDUAL", id: "user_001" },
    auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 }
  });
  return store;
}

describe("SocialSpaceClient", () => {
  it("reads server status facts and sends membership commands", async () => {
    const envelopes: Array<Record<string, unknown>> = [];
    const client = new SocialSpaceClient({
      secureSessionStore: await sessionStore(),
      authClient: { request: async (_path, init) => {
        const envelope = init.body as Record<string, unknown>;
        envelopes.push(envelope);
        const operationRef = envelope.commandType === "ListStatuses"
          ? JSON.stringify({ statuses: [{ id: "s1", authorId: "u1", author: "小美", body: "下午有空", createdAt: "2026-08-24T00:00:00Z", expiresAt: "2026-08-25T00:00:00Z" }] })
          : JSON.stringify({ communityId: "photo", joined: true });
        return { status: 200, json: async () => ({ commandId: envelope.commandId, outcome: "ACCEPTED", eventRefs: [], correlationId: envelope.correlationId, operationRef }) };
      } }
    });
    expect((await client.listStatuses())[0]?.body).toBe("下午有空");
    await client.setCommunityMembership("photo", true);
    expect(envelopes.map((item) => item.commandType)).toEqual(["ListStatuses", "SetCommunityMembership"]);
    expect(envelopes[1]?.payload).toEqual({ communityId: "photo", joined: true });
  });
});
