import { describe, expect, it } from "vitest";
import { NotificationClient } from "./notification-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

// NOTIF-EMPTY-LIST-001 —— 这个文件存在的理由是「ListInbox 的**解析**从来没被测过」。
//
// 服务端（Go）把 nil 切片序列化成 `null` 而不是 `[]`，而 listInbox 上一版是
// `if (!Array.isArray(body.items)) throw new Error("inbox malformed")`。
// 于是**收件箱为空**的用户拿到的不是空态，而是「通知没取到，下拉重试」的**失败态**。
// 现网 845 行只属于 2 个收件人，其余用户 100% 命中 —— 而这条 bug 活下来的原因
// 正是：没有任何测试喂过 `items: null`。服务端那条路径有集成测试，但它永远有
// 3 条数据，永远碰不到「空」这个分支。

function accepted(operationRef: string) {
  return {
    status: 200,
    json: async () => ({
      commandId: "cmd_1",
      outcome: "ACCEPTED",
      eventRefs: [],
      correlationId: "corr_1",
      operationRef
    })
  };
}

async function signedInStore(): Promise<SecureSessionStore> {
  const value = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-10-02T00:00:00Z"));
  await value.write({
    userAccountId: "user_1",
    principal: { type: "INDIVIDUAL", id: "user_1" },
    auth: {
      sessionId: "s1",
      userAccountId: "user_1",
      principal: { type: "INDIVIDUAL", id: "user_1" },
      accessToken: "a",
      refreshToken: "r",
      accessExpiresAt: "2026-10-03T00:00:00Z",
      refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
      rotation: 1
    }
  });
  return value;
}

async function makeClient(operationRef: string, sent: Array<Record<string, unknown>> = []) {
  return new NotificationClient({
    authClient: {
      request: async (_path: string, init: { body: unknown }) => {
        sent.push(init.body as Record<string, unknown>);
        return accepted(operationRef);
      }
    },
    secureSessionStore: await signedInStore()
  });
}

describe("NOTIF-EMPTY-LIST-001 listInbox tolerates an empty inbox", () => {
  it("returns [] when the server sends an empty array", async () => {
    const client = await makeClient(JSON.stringify({ items: [] }));
    await expect(client.listInbox()).resolves.toEqual([]);
  });

  it("returns [] when the server sends items:null (a Go nil slice marshals to null)", async () => {
    const client = await makeClient(JSON.stringify({ items: null }));
    const items = await client.listInbox();
    expect(items).toEqual([]);
    expect(Array.isArray(items)).toBe(true);
  });

  it("returns [] when items is absent entirely", async () => {
    const client = await makeClient(JSON.stringify({}));
    await expect(client.listInbox()).resolves.toEqual([]);
  });

  it("still returns real rows untouched", async () => {
    const rows = [
      { id: "inbox_1", recipientId: "user_1", type: "OfferCreated", title: "收到 Offer", body: "b", read: false, createdAt: "2026-10-01T00:00:00Z" }
    ];
    const client = await makeClient(JSON.stringify({ items: rows }));
    await expect(client.listInbox()).resolves.toEqual(rows);
  });

  // 反向臂：放宽 null 不等于把协议破损也一起吞掉。真正的破损是
  // 「items 存在但不是数组」—— 那必须继续抛，否则服务端换协议时会静默变成空列表，
  // 用户看到「还没有通知」而实际是数据取不到。
  it("still rejects a genuinely malformed items value", async () => {
    for (const bad of [JSON.stringify({ items: { a: 1 } }), JSON.stringify({ items: "nope" }), JSON.stringify({ items: 7 })]) {
      const client = await makeClient(bad);
      await expect(client.listInbox()).rejects.toThrow("inbox malformed");
    }
  });
});

describe("notification client wire", () => {
  it("markRead targets the inbox item and carries its id", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = await makeClient(JSON.stringify({ ok: true }), sent);
    await client.markRead("inbox_abc");
    expect(sent[0]?.commandType).toBe("MarkInboxRead");
    expect(sent[0]?.target).toEqual({ type: "InboxItem", id: "inbox_abc" });
    expect(sent[0]?.payload).toEqual({ inboxId: "inbox_abc" });
  });

  // NOTIF-PIPELINE-001 客户端一半：设备令牌注册是推送链路的**起点**。
  // 以前这个方法全仓零调用方，所以 notification.device_tokens 一直是 0 行，
  // 推送管线就算修好了也没有目标可推。这里钉住它发的命令与载荷。
  it("registerDevice sends RegisterDeviceToken with the platform token", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = await makeClient(JSON.stringify({ ok: true }), sent);
    await client.registerDevice({ deviceId: "dev_1", platform: "IOS", token: "apns_token_1" });
    expect(sent[0]?.commandType).toBe("RegisterDeviceToken");
    expect(sent[0]?.payload).toEqual({ deviceId: "dev_1", platform: "IOS", token: "apns_token_1" });
  });

  it("refuses to act on an offline fallback session", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-10-02T00:00:00Z"));
    await store.write({
      userAccountId: "user_1",
      principal: { type: "INDIVIDUAL", id: "user_1" },
      serverSession: false,
      auth: {
        sessionId: "s1", userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" },
        accessToken: "a", refreshToken: "r", accessExpiresAt: "2026-10-03T00:00:00Z",
        refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1
      }
    });
    let called = false;
    const client = new NotificationClient({
      authClient: { request: async () => { called = true; return accepted("{}"); } },
      secureSessionStore: store
    });
    await expect(client.listInbox()).rejects.toThrow(/real sign-in/);
    expect(called).toBe(false);
  });
});
