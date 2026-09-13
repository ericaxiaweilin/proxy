import { describe, it, expect } from "vitest";
import { ProfileClient } from "./profile-client";
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

function envelope(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    commandId: "cmd_test",
    commandType,
    commandVersion: 1,
    actor: { type: "USER", id: "user_alice" },
    principal: { type: "INDIVIDUAL", id: "principal_alice" },
    target,
    idempotencyKey: "idem_test",
    authContext: { sessionId: "sess_alice" },
    purpose: "profile",
    correlationId: "corr_test",
    requestedAt: "2026-09-05T00:00:00Z",
    outcome: "ACCEPTED",
    operationRef: JSON.stringify(payload),
    eventRefs: [],
  };
}

describe("ProfileClient", () => {
  // R18.x: PROFILE-001 mobile half.
  // The '编辑主页' modal in me.tsx used to call only
  // profileStore.write (local SecureStore). This test confirms
  // the wire now goes through the standard command envelope
  // and the wire-side response shape surfaces to the surface
  // the user sees.
  it("updateProfile round-trips through UpdateProfile envelope", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new ProfileClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/UpdateProfile")) {
          return { status: 200, json: async () => envelope("UpdateProfile", { type: "Profile", id: "user_alice" }, {
            profile: { userAccountId: "user_alice", name: "Alice Liddell", handle: "@alice", bio: "河内", city: "Hanoi", avatarPath: "assets/avatar-alice.jpg", version: 2, updatedAt: "2026-09-05T10:00:00Z" },
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const profile = await client.updateProfile({ name: "Alice Liddell", handle: "@alice", bio: "河内", city: "Hanoi", avatarPath: "assets/avatar-alice.jpg" });
    expect(profile.userAccountId).toBe("user_alice");
    expect(profile.name).toBe("Alice Liddell");
    expect(profile.version).toBe(2);
  });

  it("getProfile round-trips through GetProfile envelope", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new ProfileClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/GetProfile")) {
          return { status: 200, json: async () => envelope("GetProfile", { type: "Profile", id: "user_alice" }, {
            profile: { userAccountId: "user_alice", name: "Alice", handle: "@alice", bio: "", city: "Hanoi", avatarPath: "", version: 1, updatedAt: "2026-09-05T09:00:00Z" },
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const profile = await client.getProfile();
    expect(profile.name).toBe("Alice");
    expect(profile.city).toBe("Hanoi");
  });

  it("rejects signed-out session with OfflineFallbackSessionError", async () => {
    const store = makeStore();
    await writeSession(store, { signedOut: true });
    const client = new ProfileClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({}) }) },
    });
    await expect(client.updateProfile({ name: "X", handle: "@x", bio: "", city: "Hanoi", avatarPath: "" })).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});
