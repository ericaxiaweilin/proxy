import { describe, expect, it } from "vitest";
import { SessionAuthClient, SessionExpiredError, SessionRefreshUnavailableError, type TransportRequest, type TransportResponse } from "./auth-client";
import { InMemorySecureStorageDriver, SecureSessionStore, type StoredSession } from "./secure-session";

const initialSession: StoredSession = {
	userAccountId: "user_001",
	auth: {
    sessionId: "session_001",
    userAccountId: "user_001",
    principal: { type: "BUSINESS", id: "business_001" },
    accessToken: "access_1",
    refreshToken: "refresh_1",
    accessExpiresAt: "2026-08-14T00:00:10.000Z",
    refreshExpiresAt: "2026-09-13T00:00:00.000Z",
    rotation: 1
  },
  principal: { type: "BUSINESS", id: "business_001" }
};

function response(status: number, body: unknown): TransportResponse {
  return { status, json: async () => body };
}

describe("mobile session auth client", () => {
  it("refreshes once for concurrent callers and stores the rotated pair", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write(initialSession);
    const requests: TransportRequest[] = [];
    const client = new SessionAuthClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      refreshSkewMs: 30_000,
      transport: async (request) => {
        requests.push(request);
        return response(200, { auth: { ...initialSession.auth, accessToken: "access_2", refreshToken: "refresh_2", rotation: 2, accessExpiresAt: "2026-08-14T00:15:00.000Z" } });
      }
    });
    const [first, second] = await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(first).toBe("access_2");
    expect(second).toBe("access_2");
    expect(requests).toHaveLength(1);
    expect((await store.read())?.auth.rotation).toBe(2);
  });

  it("retries a 401 once with the rotated access token", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write({ ...initialSession, auth: { ...initialSession.auth, accessExpiresAt: "2026-08-14T00:15:00.000Z" } });
    const seen: TransportRequest[] = [];
    const client = new SessionAuthClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      transport: async (request) => {
        seen.push(request);
        if (request.url.endsWith("RefreshSession")) return response(200, { auth: { ...initialSession.auth, accessToken: "access_2", refreshToken: "refresh_2", rotation: 2, accessExpiresAt: "2026-08-14T00:15:00.000Z" } });
        return seen.length === 1 ? response(401, {}) : response(200, { ok: true });
      }
    });
    const result = await client.request("/v1/commands/PreviewTaskDraft", { method: "POST", body: { expectedVersion: 1 } });
    expect(result.status).toBe(200);
    expect(seen[0]?.headers.Authorization).toBe("Bearer access_1");
    expect(seen.at(-1)?.headers.Authorization).toBe("Bearer access_2");
  });

  it("clears secure credentials when refresh is rejected", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write(initialSession);
    const client = new SessionAuthClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      transport: async () => response(401, { error: { errorCode: "REFRESH_TOKEN_INVALID" } })
    });
    await expect(client.refresh()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(await store.read()).toBeUndefined();
  });

  it("preserves secure credentials when refresh service is temporarily unavailable", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write(initialSession);
    const client = new SessionAuthClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      transport: async () => response(503, { error: "temporarily_unavailable" })
    });
    await expect(client.refresh()).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
    expect((await store.read())?.auth.refreshToken).toBe("refresh_1");
  });

  it("does not refresh a valid remembered session on app startup", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write({ ...initialSession, auth: { ...initialSession.auth, accessExpiresAt: "2026-08-14T00:15:00.000Z" } });
    let requests = 0;
    const client = new SessionAuthClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      transport: async () => { requests += 1; return response(500, {}); }
    });
    expect(await client.getAccessToken()).toBe("access_1");
    expect(requests).toBe(0);
  });

  it("soft sign out locks locally without revoking the refresh token needed by Continue", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write(initialSession);
    let requests = 0;
    const client = new SessionAuthClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      transport: async () => { requests += 1; throw new Error("unexpected network request"); }
    });
    await client.signOut();
    // R15.39: signOut 不再 clear keychain — 改为设 signedOut=true,
    //   保留 refreshToken 以供后续 silent re-auth (点 “继续” 按钮) 使用。
    //   写路径 (requireSession) 仍会拒 (signedOut gate), 跟 “未登录”
    //   一样表现。
    const after = await store.read();
    expect(after).toBeDefined();
    expect(after?.signedOut).toBe(true);
    expect(after?.signedOutAt).toBe("2026-08-14T00:00:00.000Z");
    // accessToken 被置为 "revoked" — 避免起动时 getAccessToken 走
    //   “老 accessToken 有效” 路径
    expect(after?.auth.accessToken).toBe("revoked");
    // refreshToken 保留 — silent re-auth 要用
    expect(after?.auth.refreshToken).toBe(initialSession.auth.refreshToken);
    expect(requests).toBe(0);
  });

  it("refresh after soft sign out restores the remembered account in one tap", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write(initialSession);
    const client = new SessionAuthClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      transport: async (request) => {
        if (!request.url.endsWith("RefreshSession")) throw new Error("unexpected request");
        return response(200, { auth: { ...initialSession.auth, accessToken: "access_2", refreshToken: "refresh_2", rotation: 2 } });
      }
    });
    await client.signOut();
    const tokens = await client.refresh();
    expect(tokens.accessToken).toBe("access_2");
    expect((await store.read())?.signedOut).toBeUndefined();
  });
});
