import { describe, expect, it } from "vitest";
import { restoreAppShell, signOutApp } from "./app-shell";
import {
  InMemorySecureStorageDriver,
  OfflineFallbackSessionError,
  requireAuthenticatedServerSession,
  SECURE_SESSION_STORAGE_KEY,
  SecureSessionStore,
  type StoredSession
} from "./secure-session";

const session: StoredSession = {
	userAccountId: "user_001",
	auth: {
    sessionId: "session_001",
    userAccountId: "user_001",
    principal: { type: "BUSINESS", id: "business_001" },
    accessToken: "access_secret",
    refreshToken: "refresh_secret",
    accessExpiresAt: "2026-08-14T00:15:00.000Z",
    refreshExpiresAt: "2026-09-13T00:00:00.000Z",
    rotation: 1
  },
  principal: { type: "BUSINESS", id: "business_001" }
};

describe("secure mobile session boundary", () => {
  it("restores only from the injected secure driver and signs out by deletion", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write(session);
    const restored = await restoreAppShell({ secureSessionStore: store, isRestricted: false, isOffline: false });
    expect(restored.state).toEqual({ status: "AUTHENTICATED", initialRoute: "home" });
    expect(restored.session?.auth.refreshToken).toBe("refresh_secret");
    expect(await signOutApp(store)).toEqual({ status: "SIGNED_OUT", initialRoute: "auth" });
    expect(await driver.getItem(SECURE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("deletes malformed or expired credentials and fails closed", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-10-01T00:00:00.000Z"));
    await driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify({ auth: { refreshToken: "not-enough" } }));
    expect(await store.read()).toBeUndefined();
    expect(await driver.getItem(SECURE_SESSION_STORAGE_KEY)).toBeNull();

    await driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify(session));
    expect(await store.read()).toBeUndefined();
    expect(await driver.getItem(SECURE_SESSION_STORAGE_KEY)).toBeNull();
  });

  // R15.34.1 P0: 离线 fallback session (createNativeGuestSession 在 API
  //   不可达时降级造的 fake session) 不能发写命令。serverSession 标志是
  //   false 的 session 调 requireAuthenticatedServerSession 必须抛。
  it("rejects offline fallback sessions from write paths", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const offlineSession: StoredSession = {
      ...session,
      serverSession: false
    };
    await store.write(offlineSession);
    await expect(requireAuthenticatedServerSession({ store })).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });

  // R15.34.1 P0: 真实 server-issued session 走 requireAuthenticatedServerSession
  //   正常通过。serverSession 为 undefined / true 都走。
  it("accepts real server-issued sessions", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write(session);
    const restored = await requireAuthenticatedServerSession({ store });
    expect(restored.userAccountId).toBe("user_001");
    expect(restored.serverSession).toBeUndefined();
  });

  // R15.34.2 P0 追打: 升级前在 keychain 里的 “旧” 离线 fallback session
  //   没有 serverSession 字段 (看起来像真实 session)。读时只能凭
  //   accessToken 以 “offline_” 开头或 sessionId 以 “sess_offline_” 开头
  //   补上 serverSession: false 标记。requireAuthenticatedServerSession
  //   然后能拦下来。
  it("auto-tags legacy offline fallback sessions on read", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const legacyOffline: StoredSession = {
      userAccountId: "guest_legacy",
      auth: {
        sessionId: "sess_offline_legacy_xyz",
        userAccountId: "guest_legacy",
        principal: { type: "INDIVIDUAL", id: "guest_legacy" },
        accessToken: "offline_legacy_access_abc",
        refreshToken: "offline_legacy_refresh_def",
        accessExpiresAt: "2026-08-14T01:00:00.000Z",
        refreshExpiresAt: "2026-09-13T00:00:00.000Z",
        rotation: 1
      },
      principal: { type: "INDIVIDUAL", id: "guest_legacy" }
    };
    await store.write(legacyOffline);
    // 读出来时会被补上 serverSession: false
    const read = await store.read();
    expect(read).toBeDefined();
    expect(read?.serverSession).toBe(false);
    // requireAuthenticatedServerSession 现在能拒
    await expect(requireAuthenticatedServerSession({ store })).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});
