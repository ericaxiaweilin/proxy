import { describe, expect, it } from "vitest";
import { restoreAppShell, signOutApp } from "./app-shell";
import {
  InMemorySecureStorageDriver,
  isSignInRequiredError,
  OfflineFallbackSessionError,
  requireAuthenticatedServerSession,
  SECURE_SESSION_STORAGE_KEY,
  SecureSessionStore,
  SignedOutSessionError,
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
    refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
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
    const expiredNow = "2026-10-01T00:00:00.000Z";
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date(expiredNow));
    await driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify({ auth: { refreshToken: "not-enough" } }));
    expect(await store.read()).toBeUndefined();
    expect(await driver.getItem(SECURE_SESSION_STORAGE_KEY)).toBeNull();

    // 「已过期」必须是显式造出来的，不能靠写死的日期自然变老：真实时间一漂，
    // 这个夹具就会在两种语义之间翻转（2026-09-13 全仓库 mobile 测试红过一次）。
    // 见门禁 TEST-ABSDATE-002。
    const expiredSession: StoredSession = {
      ...session,
      auth: { ...session.auth, refreshExpiresAt: new Date(Date.parse(expiredNow) - 86400000).toISOString() }
    };
    await driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify(expiredSession));
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
        refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
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

  // R15.39: 用户主动登出后, session 留在 keychain 里, 带 signedOut=true
  //   + signedOutAt. restore 阶段不认这个 session (变 SIGNED_OUT 状态),
  //   写路径 (requireAuthenticatedServerSession) 也要拒。
  it("treats signedOut sessions as unauthenticated on restore and write", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const softSignedOut: StoredSession = {
      ...session,
      // 模拟 R15.39 signOut 的写回: accessToken 置为 “revoked” (非空但
      //   无效), signedOut 标 true
      auth: { ...session.auth, accessToken: "revoked" },
      signedOut: true,
      signedOutAt: "2026-08-14T00:00:00.000Z"
    };
    await store.write(softSignedOut);
    const restored = await restoreAppShell({ secureSessionStore: store, isRestricted: false, isOffline: false });
    // restore 阶段识别 signedOut, 走 SIGNED_OUT 状态 (跟 “没 session” 一样)
    expect(restored.state).toEqual({ status: "SIGNED_OUT", initialRoute: "auth" });
    // 但 session 还在 keychain 里 (silent re-auth 可用)
    expect(await driver.getItem(SECURE_SESSION_STORAGE_KEY)).not.toBeNull();
    // requireAuthenticatedServerSession 拒
    await expect(requireAuthenticatedServerSession({ store })).rejects.toBeInstanceOf(SignedOutSessionError);
  });

  // R15.39: signedOut 之后读路径仍然能走 (写路径才拒)。这是设计选择
  //   — signedOut 不是 “删 session”，只是 “锁写” 。
  it("signedOut session is still readable (write-only lock)", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const softSignedOut: StoredSession = {
      ...session,
      signedOut: true,
      signedOutAt: "2026-08-14T00:00:00.000Z"
    };
    await store.write(softSignedOut);
    // store.read() 不拒 — 读路径继续能用 (浏览 feed, 看历史)
    const read = await store.read();
    expect(read?.userAccountId).toBe("user_001");
    expect(read?.signedOut).toBe(true);
  });

  // R15.39: signedOutAt 字段被严格验证 (ISO 字符串)。垃圾值会让
  //   isStoredSession 拒掉, 进而被读路径的 auto-cleanup 删掉。
  it("rejects malformed signedOutAt on read", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const malformed: StoredSession = {
      ...session,
      signedOut: true,
      signedOutAt: "not-an-iso-date"
    };
    // 直接写 raw JSON 绕过 isStoredSession 验证
    await driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify({
      userAccountId: malformed.userAccountId,
      auth: malformed.auth,
      principal: malformed.principal,
      signedOut: true,
      signedOutAt: "not-an-iso-date"
    }));
    // 读不出来 — auto-clear
    expect(await store.read()).toBeUndefined();
    expect(await driver.getItem(SECURE_SESSION_STORAGE_KEY)).toBeNull();
  });

  // MOBILE-SESSION-PRINCIPAL-001（2026-10-05，模拟器上商家面整片「加载失败：authenticated
  // principal required」+ 全 0）：升级前写进 keychain 的 session 没有**顶层** principal
  // （这个字段在类型上是可选的），而每个写入口都只看顶层 —— 于是这台设备看着是登录着的
  // （头像、昵称、礼券都读得出来），商家侧却一条命令都发不出去，且不重新登录就永久坏着。
  // auth.principal 是服务端签发时必带的同一个身份，读口必须把它补回顶层。
  it("recovers the top-level principal from the server-issued one inside auth", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const legacy: Partial<StoredSession> = { ...session };
    delete legacy.principal;
    expect(session.principal).toBeDefined(); // 夹具本身要有，否则这条测试什么都没测
    await driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify(legacy));

    const restored = await store.read();
    expect(restored?.principal).toEqual({ type: "BUSINESS", id: "business_001" });
    // 真验收：写入口不再抛。
    await expect(requireAuthenticatedServerSession({ store })).resolves.toMatchObject({
      userAccountId: "user_001"
    });

    // 顶层与 auth 里不一致时以顶层为准 —— 补的是缺失，不是悄悄换身份。
    await store.write({ ...session, principal: { type: "INDIVIDUAL", id: "user_001" } });
    const both = await store.read();
    expect(both?.principal).toEqual({ type: "INDIVIDUAL", id: "user_001" });
    expect(both?.auth.principal).toEqual({ type: "BUSINESS", id: "business_001" });
  });

  // MOBILE-SIGNIN-ERROR-TEXT-001：哪些失败该翻成「去登录」，哪些不该。
  // 两个方向都是真踩过的：一边把协议原文甩在商家面上（用户看不出是要登录），
  // 另一边曾经把所有 catch 都报成「登录后…」——登录着网络抖一下也被赶去登录。
  it("recognises sign-in-required failures without swallowing every other error", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));

    // 真的登录态问题：用**实际抛出的那条消息**来断言，改了原文这里就红。
    const legacy: Partial<StoredSession> = { ...session };
    delete legacy.principal;
    await driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify({ ...legacy, signedOut: undefined }));
    const missingPrincipal = await store.read();
    expect(missingPrincipal?.principal).toBeDefined(); // 上一条测试已证明能补回来
    await store.write({ ...session, signedOut: true });
    await expect(requireAuthenticatedServerSession({ store })).rejects.toBeInstanceOf(SignedOutSessionError);
    await store.write({ ...session, auth: { ...session.auth, accessToken: "offline_x", sessionId: "sess_offline_x" }, serverSession: false });
    await expect(requireAuthenticatedServerSession({ store })).rejects.toBeInstanceOf(OfflineFallbackSessionError);
    const signedOut = new SignedOutSessionError();
    const offline = new OfflineFallbackSessionError();
    for (const message of [
      "an authenticated principal is required",        // secure-session 自己
      "authenticated principal required",               // supply / fulfillment / benefit / payment client
      signedOut.message,
      offline.message,
    ]) {
      expect(isSignInRequiredError(message)).toBe(true);
    }

    // 不是登录问题的，一律不许报「去登录」。
    for (const message of [
      "fetch failed",
      "HTTP 500",
      "session response was not accepted",
      "activity not found",
      "",
    ]) {
      expect(isSignInRequiredError(message)).toBe(false);
    }
  });
});
