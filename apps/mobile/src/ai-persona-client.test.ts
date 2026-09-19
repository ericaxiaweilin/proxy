import { describe, expect, it } from "vitest";
import { AiPersonaClient, TwinMinorForbiddenError, TwinNoAgeEvidenceError, TwinNoLiveConsentError } from "./ai-persona-client";
import type { TransportResponse } from "./auth-client";

// TWIN-CENTER-003: 分身 client 的线形约定 —— 空列表是 []（不是失败），
// 204 是「未授权」（不是失败），404 no_live_consent 是类型化错误
// （不是「收回成功」），未成年人门禁翻译成人话。
function stubTransport(handler: (path: string, body: unknown) => { status: number; payload: unknown }): {
  request: (path: string, init: { method: "GET" | "POST"; body?: unknown }) => Promise<TransportResponse>;
} {
  return {
    request: async (path: string, init: { method: "GET" | "POST"; body?: unknown }) => {
      const { status, payload } = handler(path, init.body);
      return { status, json: async () => payload };
    },
  };
}

describe("AiPersonaClient", () => {
  it("空列表解成 []，缺数组才抛错", async () => {
    const client = new AiPersonaClient({ authClient: stubTransport(() => ({ status: 200, payload: { personas: [] } })) });
    await expect(client.listMine("acct_1")).resolves.toEqual([]);
    const broken = new AiPersonaClient({ authClient: stubTransport(() => ({ status: 200, payload: {} })) });
    await expect(broken.listMine("acct_1")).rejects.toThrow("缺少 personas 数组");
  });

  it("只收 USER_TWIN，别的类型过滤掉", async () => {
    const twin = { id: "aip_1", ownerId: "acct_1", displayName: "我的分身", personaType: "USER_TWIN", createdAt: "2026-09-18T00:00:00Z" };
    const creative = { ...twin, id: "aip_2", personaType: "CREATIVE" };
    const client = new AiPersonaClient({ authClient: stubTransport(() => ({ status: 200, payload: { personas: [twin, creative] } })) });
    await expect(client.listMine("acct_1")).resolves.toEqual([twin]);
  });

  it("204 解成未授权 undefined", async () => {
    const client = new AiPersonaClient({ authClient: stubTransport(() => ({ status: 204, payload: null })) });
    await expect(client.getLiveConsent("aip_1", "acct_1")).resolves.toBeUndefined();
  });

  it("收回无授权抛类型化错误", async () => {
    const client = new AiPersonaClient({
      authClient: stubTransport(() => ({ status: 404, payload: { error: "no_live_consent" } })),
    });
    await expect(client.revokeConsent("aip_1", "acct_1")).rejects.toBeInstanceOf(TwinNoLiveConsentError);
  });

  it("未成年人门禁翻译成人话", async () => {
    const client = new AiPersonaClient({
      authClient: stubTransport(() => ({
        status: 400,
        payload: { error: "create_failed", reason: "AI companions are not available to minors" },
      })),
    });
    await expect(client.createTwin({ ownerId: "acct_1", displayName: "分身" })).rejects.toBeInstanceOf(TwinMinorForbiddenError);
  });

  it("老账号无年龄断言指到补救办法，不抛英文原文", async () => {
    const client = new AiPersonaClient({
      authClient: stubTransport(() => ({
        status: 400,
        payload: { error: "create_failed", reason: "no age evidence on file for this account" },
      })),
    });
    const err = await client.createTwin({ ownerId: "acct_1", displayName: "分身" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwinNoAgeEvidenceError);
    expect((err as Error).message).not.toContain("no age evidence");
  });

  it("空名字本地拦，不发请求", async () => {
    let calls = 0;
    const client = new AiPersonaClient({
      authClient: stubTransport(() => {
        calls += 1;
        return { status: 201, payload: {} };
      }),
    });
    await expect(client.createTwin({ ownerId: "acct_1", displayName: "  " })).rejects.toThrow("起个名字");
    expect(calls).toBe(0);
  });

  it("补年龄断言发对路径，格式不对本地拦", async () => {
    const seen: Array<{ path: string; body: unknown }> = [];
    const client = new AiPersonaClient({
      authClient: stubTransport((path: string, body: unknown) => {
        seen.push({ path, body });
        return { status: 201, payload: { recorded: true } };
      }),
    });
    await client.recordAgeAssertion("1990-05-06");
    expect(seen).toEqual([{ path: "/v1/identity/age-assertion", body: { dateOfBirth: "1990-05-06" } }]);
    await expect(client.recordAgeAssertion("1990/05/06")).rejects.toThrow("YYYY-MM-DD");
    expect(seen).toHaveLength(1);
  });
});
