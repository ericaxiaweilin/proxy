import { describe, expect, it } from "vitest";
import type { FulfillmentOrder } from "./fulfillment-client";
import { canCancelOrder, canConfirmCooperation, settlementView } from "./order-actions";

function order(overrides: Partial<FulfillmentOrder>): FulfillmentOrder {
  return {
    orderId: "ord_1",
    requesterId: "user_req",
    agentId: "user_agent",
    needId: "need_1",
    lifecycle: "OFFERED",
    snapshot: {
      requester: "user_req", agent: "user_agent", serviceSku: "cc", duration: "", startTime: "", meetingContext: "",
      agreedCompensation: 1200000, currency: "VND", includedScope: "", excludedScope: "", settlementMode: "DIRECT_SETTLEMENT", paymentMethodLabel: "",
    },
    createdAt: "2026-09-28T00:00:00Z",
    updatedAt: "2026-09-28T00:00:00Z",
    viewerRole: "REQUESTER",
    ...overrides,
  };
}

describe("order actions", () => {
  // ORDER-CONFIRM-AGENT-001：需求方不能自己确认自己发的报价。
  it("ORDER-CONFIRM-AGENT-001 only the agent sees the confirm action", () => {
    expect(canConfirmCooperation(order({ viewerRole: "REQUESTER" }))).toBe(false);
    expect(canConfirmCooperation(order({ viewerRole: "AGENT" }))).toBe(true);
    expect(canConfirmCooperation(order({ viewerRole: "AGENT", lifecycle: "CONFIRMED" }))).toBe(false);
  });

  // ORDER-SETTLE-GUARD-001：每一方只确认自己那一侧；双方确认后不能取消。
  it("ORDER-SETTLE-GUARD-001 settlement is confirmed per side and locks cancellation only when mutual", () => {
    const payerOnly = { agreedAmount: 1200000, payerConfirmed: true, payeeConfirmed: false };
    expect(settlementView(order({ viewerRole: "REQUESTER", settlement: payerOnly }))).toMatchObject({ mineConfirmed: true, theirsConfirmed: false, myRoleLabel: "付款方" });
    expect(settlementView(order({ viewerRole: "AGENT", settlement: payerOnly }))).toMatchObject({ mineConfirmed: false, theirsConfirmed: true, recordedAmount: 1200000, myRoleLabel: "收款方" });
    expect(canCancelOrder(order({ lifecycle: "EXECUTING", settlement: payerOnly }))).toBe(true);
    expect(canCancelOrder(order({ lifecycle: "EXECUTING", settlement: { ...payerOnly, payeeConfirmed: true } }))).toBe(false);
    expect(canCancelOrder(order({ lifecycle: "COMPLETED" }))).toBe(false);
  });
});
