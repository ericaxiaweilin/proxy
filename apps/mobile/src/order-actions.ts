import type { FulfillmentOrder } from "./fulfillment-client";

// 订单详情页「该出哪个按钮」的判定。服务端是最终裁判（状态 + 身份 double-check），
// 这里只保证不摆一定会被拒的按钮。

// ORDER-CONFIRM-AGENT-001：报价是需求方发的，确认合作是服务方的同意。
export function canConfirmCooperation(order: FulfillmentOrder): boolean {
  return order.lifecycle === "OFFERED" && order.viewerRole === "AGENT";
}

export type SettlementView = {
  // 我这一侧（需求方 = 付款方，服务方 = 收款方）是否已确认。
  mineConfirmed: boolean;
  theirsConfirmed: boolean;
  // 对方已登记的金额：后到的一方必须对上它（ORDER-SETTLE-GUARD-001）。
  recordedAmount: number | undefined;
  myRoleLabel: "付款方" | "收款方";
};

export function settlementView(order: FulfillmentOrder): SettlementView {
  const isPayer = order.viewerRole === "REQUESTER";
  const record = order.settlement;
  return {
    mineConfirmed: Boolean(record && (isPayer ? record.payerConfirmed : record.payeeConfirmed)),
    theirsConfirmed: Boolean(record && (isPayer ? record.payeeConfirmed : record.payerConfirmed)),
    recordedAmount: record?.agreedAmount,
    myRoleLabel: isPayer ? "付款方" : "收款方",
  };
}

// ORDER-SETTLE-GUARD-001：双方都确认过线下结算的订单不能再取消。
export function canCancelOrder(order: FulfillmentOrder): boolean {
  const live = order.lifecycle === "OFFERED" || order.lifecycle === "CONFIRMED" || order.lifecycle === "EXECUTING";
  const settled = Boolean(order.settlement?.payerConfirmed && order.settlement?.payeeConfirmed);
  return live && !settled;
}
