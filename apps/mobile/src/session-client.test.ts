import { describe, it, expect } from "vitest";
import { SessionClient } from "./session-client";
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

function envelope(commandType: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    commandId: "cmd_test",
    commandType,
    commandVersion: 1,
    actor: { type: "USER", id: "user_alice" },
    principal: { type: "INDIVIDUAL", id: "principal_alice" },
    target: { type: "Session", id: "mine" },
    idempotencyKey: "idem_test",
    authContext: { sessionId: "sess_alice" },
    purpose: "session",
    correlationId: "corr_test",
    requestedAt: "2026-09-05T00:00:00Z",
    outcome: "ACCEPTED",
    operationRef: JSON.stringify(payload),
    eventRefs: [],
  };
}

describe("SessionClient", () => {
  // DEVICE-LIST-001 mobile half. The Settings device card used to end with
  // "设备列表尚未接入". This test confirms the wire now goes through the
  // standard command envelope and the list payload surfaces from
  // operationRef (NOT body — parseCommandResult drops body).
  it("listMySessions round-trips through ListMySessions envelope", async () => {
    const store = makeStore();
    await writeSession(store);
    const seen: Array<{ path: string; body: unknown }> = [];
    const client = new SessionClient({
      secureSessionStore: store,
      authClient: { request: async (path, init) => {
        seen.push({ path, body: init.body });
        return { status: 200, json: async () => envelope("ListMySessions", {
          sessions: [
            { id: "sess_alice", platform: "IOS", status: "ACTIVE", issuedAt: "2026-09-14T00:00:00Z", expiresAt: "2026-10-14T00:00:00Z", current: true },
            { id: "sess_old", platform: "ANDROID", status: "REVOKED", issuedAt: "2026-08-01T00:00:00Z", expiresAt: "2026-09-01T00:00:00Z", current: false },
          ],
          count: 2,
        }) };
      } },
    });
    const sessions = await client.listMySessions();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe("/v1/commands/ListMySessions");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.current).toBe(true);
    expect(sessions[1]?.platform).toBe("ANDROID");
  });

  it("listMySessions treats a missing array as malformed, not as empty", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new SessionClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => envelope("ListMySessions", { count: 0 }) }) },
    });
    // An empty list must arrive as [] — a missing array means the server
    // spoke a shape the client cannot read, and swallowing it as "no
    // devices" would hide a broken wire behind a plausible screen.
    await expect(client.listMySessions()).rejects.toThrow("session list response malformed");
  });

  it("revokeSession posts RevokeSession against the session id", async () => {
    const store = makeStore();
    await writeSession(store);
    const seen: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = new SessionClient({
      secureSessionStore: store,
      authClient: { request: async (path, init) => {
        seen.push({ path, body: init.body as Record<string, unknown> });
        return { status: 200, json: async () => envelope("RevokeSession", {}) };
      } },
    });
    await client.revokeSession("sess_old");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe("/v1/commands/RevokeSession");
    const body = seen[0]?.body as { target: { type: string; id: string }; payload: { reason: string } };
    expect(body.target).toEqual({ type: "Session", id: "sess_old" });
    expect(body.payload.reason).toBe("USER_REVOKED_DEVICE");
  });

  it("revokeSession surfaces a server refusal instead of pretending", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new SessionClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({
        ...envelope("RevokeSession", {}),
        outcome: "REJECTED",
        error: { errorCode: "SESSION_NOT_REVOCABLE", category: "ACCOUNT_STATE", retryability: "AFTER_USER_ACTION", messageKey: "identity.session_not_revocable", correlationId: "corr_test" },
      }) }) },
    });
    // Someone else's session id (or an already-dead one) must fail closed
    // here — the server owns that check, the client just refuses to lie.
    await expect(client.revokeSession("sess_stranger")).rejects.toThrow("identity.session_not_revocable");
  });

  it("rejects signed-out session with OfflineFallbackSessionError", async () => {
    const store = makeStore();
    await writeSession(store, { signedOut: true });
    const client = new SessionClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({}) }) },
    });
    await expect(client.listMySessions()).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});
