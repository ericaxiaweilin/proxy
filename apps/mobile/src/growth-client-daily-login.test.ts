import { describe, expect, it } from "vitest";
import { GrowthClient } from "./growth-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

// DAILY-LOGIN-001（用户：「每日登录都默认加积分 比如 5 积分」）：App 登录态下静默记一次「每日登录」。
async function signedInStore(): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  await store.write({
    userAccountId: "user_1",
    principal: { type: "INDIVIDUAL", id: "user_1" },
    auth: {
      sessionId: "session_1", userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" },
      accessToken: "access", refreshToken: "refresh",
      accessExpiresAt: "2026-09-04T00:00:00.000Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1
    }
  });
  return store;
}

function transport(body: Record<string, unknown>, calls: Array<{ path: string; body: Record<string, unknown> }>) {
  return {
    request: async (path: string, init: { method: "POST"; body: unknown }) => {
      calls.push({ path, body: init.body as Record<string, unknown> });
      return {
        status: 200,
        json: async () => ({
          commandId: "c1", outcome: "ACCEPTED", aggregate: { type: "DailyLogin", id: "user_1", version: 1, state: "RECORDED" },
          eventRefs: [], correlationId: "corr", body
        })
      };
    }
  };
}

describe("GrowthClient.recordDailyLogin", () => {
  it("sends RecordDailyLogin as the signed-in user and returns what the server granted", async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = new GrowthClient({
      authClient: transport({ granted: true, points: 5, date: "2026-10-11" }, calls),
      secureSessionStore: await signedInStore()
    });
    const res = await client.recordDailyLogin();
    expect(res).toEqual({ granted: true, points: 5, date: "2026-10-11" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/commands/RecordDailyLogin");
    expect(calls[0]?.body.commandType).toBe("RecordDailyLogin");
    expect((calls[0]?.body.actor as { id: string }).id).toBe("user_1");
    expect(calls[0]?.body.purpose).toBe("daily_login");
    // 身份只来自会话；payload 里没有任何 userId 可被改。
    expect(calls[0]?.body.payload).toEqual({});
  });

  it("a repeat on the same day is granted=false, not an error", async () => {
    const client = new GrowthClient({
      authClient: transport({ granted: false, points: 5, date: "2026-10-11" }, []),
      secureSessionStore: await signedInStore()
    });
    await expect(client.recordDailyLogin()).resolves.toMatchObject({ granted: false });
  });

  it("without a session it throws instead of pretending", async () => {
    const client = new GrowthClient({
      authClient: transport({}, []),
      secureSessionStore: new SecureSessionStore(new InMemorySecureStorageDriver())
    });
    await expect(client.recordDailyLogin()).rejects.toThrow();
  });
});
