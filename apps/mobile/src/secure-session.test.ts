import { describe, expect, it } from "vitest";
import { restoreAppShell, signOutApp } from "./app-shell";
import {
  InMemorySecureStorageDriver,
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
});
