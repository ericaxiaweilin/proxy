import { describe, it, expect } from "vitest";
import { FulfillmentClient } from "./fulfillment-client";
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
    purpose: "fulfillment",
    correlationId: "corr_test",
    requestedAt: "2026-09-05T00:00:00Z",
    outcome: "ACCEPTED",
    operationRef: JSON.stringify(payload),
    eventRefs: [],
  };
}

describe("FulfillmentClient.cancelOrder", () => {
  // R18.x CANCEL-001 mobile half.
  // The Order lifecycle enum had CANCELLED, but no command
  // ever wrote it, so the '我的订单 → 已取消' tab never
  // populated. The new cancelOrder client calls
  // CancelOrder and reads back {lifecycle, version}.
  it("cancelOrder round-trips and returns the new lifecycle", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new FulfillmentClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/CancelOrder")) {
          return { status: 200, json: async () => envelope("CancelOrder", { type: "Order", id: "ord_abc" }, { orderId: "ord_abc", lifecycle: "CANCELLED", reason: "changed plans", version: 2 }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const result = await client.cancelOrder("ord_abc", "changed plans");
    expect(result.lifecycle).toBe("CANCELLED");
    expect(result.version).toBe(2);
  });

  it("cancelOrder surfaces ORDER_NOT_FOUND as a thrown error", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new FulfillmentClient({
      secureSessionStore: store,
      authClient: { request: async () => ({
        status: 200,
        json: async () => ({
          commandId: "cmd_test",
          commandType: "CancelOrder",
          commandVersion: 1,
          outcome: "REJECTED",
          operationRef: "",
          eventRefs: [],
          correlationId: "corr_test",
          error: { errorCode: "ORDER_NOT_FOUND", messageKey: "fulfillment.order_not_found", category: "BUSINESS_STATE", retryability: "AFTER_USER_ACTION", correlationId: "corr_test" },
        }),
      }) },
    });
    await expect(client.cancelOrder("ord_ghost", "no reason")).rejects.toThrow(/ORDER_NOT_FOUND|fulfillment\.order_not_found/);
  });

  it("cancelOrder rejects signed-out session with OfflineFallbackSessionError", async () => {
    const store = makeStore();
    await writeSession(store, { signedOut: true });
    const client = new FulfillmentClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({}) }) },
    });
    await expect(client.cancelOrder("ord_abc", "offline")).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });
});

describe("FulfillmentClient execution actions (ORDER-EXEC-001)", () => {
  // 订单执行动作之前只接了打卡/证据/取消 —— 明细页按 lifecycle 出按钮，
  // 每个按钮必须真调到对应的服务端命令。这里钉方法→命令→目标的映射。
  async function captureCommand(
    call: (client: FulfillmentClient) => Promise<unknown>,
  ): Promise<{ path: string; body: Record<string, unknown> }> {
    const store = makeStore();
    await writeSession(store);
    let seen = { path: "", body: {} as Record<string, unknown> };
    const client = new FulfillmentClient({
      secureSessionStore: store,
      authClient: { request: async (path, init: { method: "POST"; body: unknown }) => {
        seen = { path, body: init.body as Record<string, unknown> };
        return { status: 200, json: async () => envelope("ok", { type: "Order", id: "ord_x" }, {}) };
      } },
    });
    await call(client);
    return seen;
  }

  it("confirmCooperation hits ConfirmCooperation on the order", async () => {
    const seen = await captureCommand((c) => c.confirmCooperation("ord_1"));
    expect(seen.path.endsWith("/ConfirmCooperation")).toBe(true);
    expect((seen.body.target as { id: string }).id).toBe("ord_1");
  });

  it("startExecution hits StartExecution on the order", async () => {
    const seen = await captureCommand((c) => c.startExecution("ord_1"));
    expect(seen.path.endsWith("/StartExecution")).toBe(true);
  });

  it("recordSettlement hits RecordDirectSettlement with the agreed payload", async () => {
    const seen = await captureCommand((c) => c.recordSettlement("ord_1", { agreedAmount: 500000, payerConfirmed: true }));
    expect(seen.path.endsWith("/RecordDirectSettlement")).toBe(true);
    const payload = seen.body.payload as Record<string, unknown>;
    expect(payload.agreedAmount).toBe(500000);
    expect(payload.payerConfirmed).toBe(true);
  });

  it("recordOutcome hits RecordOutcome with scope/onTime/note", async () => {
    const seen = await captureCommand((c) => c.recordOutcome("ord_1", { onTime: true, scopeCompleted: false, objectiveNote: "差收尾" }));
    expect(seen.path.endsWith("/RecordOutcome")).toBe(true);
    const payload = seen.body.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ onTime: true, scopeCompleted: false, objectiveNote: "差收尾" });
  });

  // STORE-STATS-001 归因：履约方指认「这笔单在我哪家店完成」。
  // 没指认必须**整条 key 不出现** —— 服务端把空串当"不归因"，但线上契约要求
  // 是"省略"而不是"传了 undefined"，两者在 wire 上不一样（exactOptionalPropertyTypes）。
  it("recordOutcome omits storeId entirely when the provider does not attribute", async () => {
    const seen = await captureCommand((c) => c.recordOutcome("ord_1", { onTime: true, scopeCompleted: true }));
    const payload = seen.body.payload as Record<string, unknown>;
    expect("storeId" in payload).toBe(false);
  });

  it("recordOutcome carries storeId when the provider attributes the order to a store", async () => {
    const seen = await captureCommand((c) => c.recordOutcome("ord_1", { onTime: true, scopeCompleted: true, storeId: "store_tb1" }));
    const payload = seen.body.payload as Record<string, unknown>;
    expect(payload.storeId).toBe("store_tb1");
  });

  it("recordSatisfaction hits RecordSatisfaction with resolved/repeat", async () => {
    const seen = await captureCommand((c) => c.recordSatisfaction("ord_1", { resolved: "PARTIAL", repeatIntent: "MAYBE" }));
    expect(seen.path.endsWith("/RecordSatisfaction")).toBe(true);
    const payload = seen.body.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ resolved: "PARTIAL", repeatIntent: "MAYBE" });
  });
});
