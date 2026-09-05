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
      refreshExpiresAt: "2099-10-25T00:00:00Z",
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
