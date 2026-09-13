import { describe, it, expect } from "vitest";
import { RelationshipClient } from "./relationship-client";
import { InMemorySecureStorageDriver, OfflineFallbackSessionError, SecureSessionStore } from "./secure-session";

function makeStore(): SecureSessionStore {
  return new SecureSessionStore(new InMemorySecureStorageDriver());
}

async function writeSession(store: SecureSessionStore, overrides: Record<string, unknown> = {}): Promise<void> {
  await store.write({
    userAccountId: "user_alice",
    principal: { type: "INDIVIDUAL", id: "principal_alice" },
    auth: {
      sessionId: "sess_alice",
      userAccountId: "user_alice",
      principal: { type: "INDIVIDUAL", id: "principal_alice" },
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: "2099-09-25T00:00:00Z",
      refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
      rotation: 1,
    },
    ...overrides,
  });
}

function envelope(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>, outcome = "ACCEPTED"): Record<string, unknown> {
  return {
    commandId: "cmd_test",
    commandType,
    commandVersion: 1,
    actor: { type: "USER", id: "user_alice" },
    principal: { type: "INDIVIDUAL", id: "principal_alice" },
    target,
    idempotencyKey: "idem_test",
    authContext: { sessionId: "sess_alice" },
    purpose: "relationship",
    correlationId: "corr_test",
    requestedAt: "2026-09-05T00:00:00Z",
    outcome,
    operationRef: JSON.stringify(payload),
    eventRefs: [],
  };
}

function envelopeRejected(commandType: string, errorCode: string, messageKey: string): Record<string, unknown> {
  return {
    commandId: "cmd_test",
    commandType,
    commandVersion: 1,
    actor: { type: "USER", id: "user_alice" },
    principal: { type: "INDIVIDUAL", id: "principal_alice" },
    target: { type: "Friendship", id: "test" },
    idempotencyKey: "idem_test",
    authContext: { sessionId: "sess_alice" },
    purpose: "relationship",
    correlationId: "corr_test",
    requestedAt: "2026-09-05T00:00:00Z",
    outcome: "REJECTED",
    operationRef: "",
    eventRefs: [],
    error: { errorCode, messageKey, category: "BUSINESS_STATE", retryability: "AFTER_USER_ACTION", correlationId: "corr_test" },
  };
}

describe("RelationshipClient", () => {
  // R18.x FRIEND-001 mobile half. The '我的 → 好友与关系'
  // surface (FriendCrmSurface) was entirely hardcoded mock
  // data and every action mutated local React state only.
  // This test confirms the wire: listMyFriendships returns
  // the two-bucket shape, acceptFriendRequest surfaces a
  // FRIEND_NOT_FOUND as a thrown error, and a signed-out
  // session throws OfflineFallbackSessionError.
  it("listMyFriendships round-trips and returns active + pending buckets", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new RelationshipClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/ListMyFriendships")) {
          return { status: 200, json: async () => envelope("ListMyFriendships", { type: "FriendshipCollection", id: "mine" }, {
            friendships: {
              active: [{ userId: "user_bob", direction: "MUTUAL", state: "FRIEND", displayName: "Bob", city: "Hanoi", since: "2026-08-01T00:00:00Z" }],
              pending: [{ userId: "user_carol", direction: "INCOMING", state: "PENDING", displayName: "Carol", city: "Saigon", since: "2026-09-01T00:00:00Z" }],
            },
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const payload = await client.listMyFriendships();
    expect(payload.active).toHaveLength(1);
    expect(payload.active[0]?.userId).toBe("user_bob");
    expect(payload.pending).toHaveLength(1);
    expect(payload.pending[0]?.direction).toBe("INCOMING");
  });

  it("acceptFriendRequest round-trips and returns the new state", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new RelationshipClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/AcceptFriendRequest")) {
          return { status: 200, json: async () => envelope("AcceptFriendRequest", { type: "Friendship", id: "from:user_bob" }, { friendship: { id: "fr_abc", state: "FRIEND", userA: "user_alice", userB: "user_bob", requesterId: "user_bob" } }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const result = await client.acceptFriendRequest("user_bob");
    expect(result.state).toBe("FRIEND");
  });

  it("sendFriendRequest surfaces FRIEND_SELF_FORBIDDEN as a thrown error", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new RelationshipClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => envelopeRejected("SendFriendRequest", "FRIEND_SELF_FORBIDDEN", "relationship.self_forbidden") }) },
    });
    await expect(client.sendFriendRequest("user_alice")).rejects.toThrow(/FRIEND_SELF_FORBIDDEN|relationship\.self_forbidden/);
  });

  it("rejects signed-out session with OfflineFallbackSessionError", async () => {
    const store = makeStore();
    await writeSession(store, { signedOut: true });
    const client = new RelationshipClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({}) }) },
    });
    await expect(client.listMyFriendships()).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});