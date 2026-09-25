import { describe, expect, it } from "vitest";
import type { TransportResponse } from "./auth-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";
import {
  StoreOnboardingClient,
  StoreRecommendationProtocolError,
  type RecommendStoreInput
} from "./storeonboarding-client";

// STORE-REC-ADDRESS-001：客户端这一半 —— 地址与落点怎么进 payload。
//
// 两件事必须在这里钉住，因为它们错了都不会崩：
//   ① **半个坐标不许发**。服务端会拒（INVALID_RECOMMENDATION_LOCATION），但那是
//      让用户看一句看不懂的错误码；本地先拦，给一句能懂的话，也别白跑一次网络。
//   ② **空地址不发键**。服务端把「没传」和「空串」当同一件事（列默认 ''），
//      但少发一个键，日志里就能一眼看出这条推荐到底有没有填地址。

function accepted(): TransportResponse {
  return {
    status: 200,
    json: async () => ({ commandId: "cmd_1", outcome: "ACCEPTED", correlationId: "corr_1", eventRefs: [] })
  };
}

async function seededStore(): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  await store.write({
    userAccountId: "user_1",
    principal: { type: "INDIVIDUAL", id: "user_1" },
    auth: {
      sessionId: "session_1",
      userAccountId: "user_1",
      principal: { type: "INDIVIDUAL", id: "user_1" },
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: "2026-09-04T01:00:00.000Z",
      refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
      rotation: 1
    }
  });
  return store;
}

async function capture(): Promise<{ sent: Record<string, unknown>[]; client: StoreOnboardingClient }> {
  const store = await seededStore();
  const sent: Record<string, unknown>[] = [];
  const client = new StoreOnboardingClient({
    secureSessionStore: store,
    authClient: {
      request: async (_path: string, init: { method: "POST"; body: unknown }) => {
        const envelope = init.body as { payload?: Record<string, unknown> };
        sent.push(envelope.payload ?? {});
        return accepted();
      }
    }
  });
  return { sent, client };
}

const base: RecommendStoreInput = {
  storeName: "Three Beans Cau Giay",
  city: "河内",
  category: "咖啡",
  reason: "适合 afterwork",
  origin: "USER"
};

describe("STORE-REC-ADDRESS-001 — 推荐客户端带上位置", () => {
  it("地址与落点原样进 payload", async () => {
    const { sent, client } = await capture();
    await client.recommendStore({
      ...base,
      address: "  12 Trần Duy Hưng, Cầu Giấy  ",
      latitude: 21.0113,
      longitude: 105.7985
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.address).toBe("12 Trần Duy Hưng, Cầu Giấy");
    expect(sent[0]?.latitude).toBe(21.0113);
    expect(sent[0]?.longitude).toBe(105.7985);
  });

  it("不填地址、不选点时两个键都不发", async () => {
    const { sent, client } = await capture();
    await client.recommendStore({ ...base });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty("address");
    expect(sent[0]).not.toHaveProperty("latitude");
    expect(sent[0]).not.toHaveProperty("longitude");
  });

  it("空白地址不当作填了", async () => {
    const { sent, client } = await capture();
    await client.recommendStore({ ...base, address: "   " });
    expect(sent[0]).not.toHaveProperty("address");
  });

  it("只有一半的坐标当场拒绝，并且一个请求都不发", async () => {
    const { sent, client } = await capture();
    await expect(client.recommendStore({ ...base, latitude: 21.0113 })).rejects.toBeInstanceOf(
      StoreRecommendationProtocolError
    );
    await expect(client.recommendStore({ ...base, longitude: 105.7985 })).rejects.toBeInstanceOf(
      StoreRecommendationProtocolError
    );
    expect(sent).toHaveLength(0);
  });

  it("有落点没地址也合法 —— 逆编码失败时坐标仍然是有用的", async () => {
    const { sent, client } = await capture();
    await client.recommendStore({ ...base, latitude: 21.0113, longitude: 105.7985 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty("address");
    expect(sent[0]?.latitude).toBe(21.0113);
  });

  it("0 是合法坐标，不能被当成「没填」丢掉", async () => {
    const { sent, client } = await capture();
    await client.recommendStore({ ...base, latitude: 0, longitude: 0 });
    expect(sent[0]?.latitude).toBe(0);
    expect(sent[0]?.longitude).toBe(0);
  });
});
