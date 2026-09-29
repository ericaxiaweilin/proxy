import { describe, expect, it } from "vitest";
import type { FulfillmentOrder } from "./fulfillment-client";
import { auditLines, buildTermChange, canCancelOrder, canConfirmCooperation, canProposeTermChange, isMyProposal, pendingTermChange, settlementLabel, settlementView, termChangeFormFrom, termDiff } from "./order-actions";

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

describe("ORDER-AMEND-UI-001 / ORDER-AUDIT-UI-001 order changes and history", () => {
  const terms = { startTime: "周六 15:00", duration: "2H", meetingContext: "西湖", agreedCompensation: 1200000, currency: "VND", includedScope: "", excludedScope: "", paymentMethodLabel: "" };
  const base = () => order({ lifecycle: "CONFIRMED", viewerRole: "REQUESTER", snapshot: { ...order({}).snapshot, ...terms } });

  it("only sends fields that really changed, and blocks empty / invalid proposals locally", () => {
    const o = base();
    const form = { ...termChangeFormFrom(o), description: "改地点" };
    expect(buildTermChange(o, form)).toEqual({ error: "没有改动任何条款。" });
    expect(buildTermChange(o, { ...form, description: " " })).toEqual({ error: "写一句变更原因，对方才知道为什么改。" });
    expect(buildTermChange(o, { ...form, meetingContext: "老城区" })).toEqual({ description: "改地点", changes: { meetingContext: "老城区" } });
    expect(buildTermChange(o, { ...form, agreedCompensation: "1,500,000" })).toEqual({ description: "改地点", changes: { agreedCompensation: 1500000 } });
    expect(buildTermChange(o, { ...form, agreedCompensation: "99999999" })).toHaveProperty("error");
    const settled = { ...o, settlement: { agreedAmount: 1200000, payerConfirmed: true, payeeConfirmed: false } };
    expect(buildTermChange(settled, { ...form, agreedCompensation: "1500000" })).toEqual({ error: "已经登记了结算，不能再改金额。" });
  });

  it("shows withdraw to the proposer and accept/reject to the other side, one pending at a time", () => {
    const pending = { amendmentId: "amd_1", description: "改地点", snapshot: { ...terms, meetingContext: "老城区" }, createdAt: "", status: "PROPOSED" as const, proposedBy: "user_req" };
    const o = { ...base(), amendments: [pending] };
    expect(pendingTermChange(o)).toBe(pending);
    expect(canProposeTermChange(o)).toBe(false);
    expect(isMyProposal(o, pending)).toBe(true);
    expect(isMyProposal({ ...o, viewerRole: "AGENT" }, pending)).toBe(false);
    expect(termDiff(terms, pending.snapshot)).toEqual([{ label: "地点", from: "西湖", to: "老城区" }]);
    expect(canProposeTermChange({ ...base(), lifecycle: "COMPLETED" })).toBe(false);
  });

  it("labels the audit trail from the viewer's point of view", () => {
    const lines = auditLines(base(), [
      { operation: "INSERT", newState: "OFFERED", actorId: "user_req", commandType: "CreateOffer", recordedAt: "2026-09-29T01:00:00Z" },
      { operation: "UPDATE", oldState: "OFFERED", newState: "CONFIRMED", actorId: "user_agent", commandType: "ConfirmCooperation", recordedAt: "2026-09-29T02:00:00Z" },
      { operation: "UPDATE", oldState: "CONFIRMED", newState: "CANCELLED", actorId: "ops", commandType: "", overrideReason: "ticket-42", recordedAt: "2026-09-29T03:00:00Z" },
    ]);
    expect(lines.map((l) => [l.who, l.what, l.state])).toEqual([
      ["我", "发起订单", "待确认"],
      ["对方", "确认合作", "待确认 → 已确认"],
      ["平台", "平台更正：ticket-42", "已确认 → 已取消"],
    ]);
  });
});

// ORDER-FLOW-COPY-001：订单页以前把 DIRECT_SETTLEMENT / PLATFORM_PAY 原样印给用户。
describe("ORDER-FLOW-COPY-001 settlement label", () => {
  it("shows people-language for known modes and never a raw enum", () => {
    expect(settlementLabel("DIRECT_SETTLEMENT")).toBe("线下直接结算");
    expect(settlementLabel("PLATFORM_PAY")).toBe("平台担保支付");
    expect(settlementLabel("")).toBe("待确认");
    expect(settlementLabel(undefined)).toBe("待确认");
  });
});
