import type { FulfillmentOrder, OrderAmendment, OrderAuditEntry, OrderTermChanges, OrderTerms } from "./fulfillment-client";

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

// ---------------------------------------------------------------------------
// ORDER-AMEND-UI-001：条款变更。服务端规则（ORDER-AMEND-001）：只有 CONFIRMED /
// EXECUTING 能改；同一时间只有一条待处理的提议；提出方只能撤回，另一方接受 / 拒绝；
// 已登记结算后不能改价。这里只决定「该出哪些按钮 / 字段」，服务端仍是裁判。

export function canProposeTermChange(order: FulfillmentOrder): boolean {
  return (order.lifecycle === "CONFIRMED" || order.lifecycle === "EXECUTING") && pendingTermChange(order) === undefined;
}

export function pendingTermChange(order: FulfillmentOrder): OrderAmendment | undefined {
  return order.amendments?.find((amendment) => amendment.status === "PROPOSED");
}

/** 我是不是这条提议的提出方（决定显示「撤回」还是「接受 / 拒绝」）。 */
export function isMyProposal(order: FulfillmentOrder, amendment: OrderAmendment): boolean {
  const me = order.viewerRole === "REQUESTER" ? order.requesterId : order.agentId;
  return amendment.proposedBy === me;
}

/** 结算已登记（任一方）后，金额不能再改。 */
export function canChangePrice(order: FulfillmentOrder): boolean {
  return !order.settlement;
}

export type TermChangeForm = { startTime: string; meetingContext: string; agreedCompensation: string; description: string };

export function termChangeFormFrom(order: FulfillmentOrder): TermChangeForm {
  return {
    startTime: order.snapshot.startTime,
    meetingContext: order.snapshot.meetingContext,
    agreedCompensation: order.snapshot.agreedCompensation > 0 ? String(order.snapshot.agreedCompensation) : "",
    description: "",
  };
}

/**
 * 把表单变成提议：只带**真的变了**的字段。返回错误文案（中文）或提议。
 * 没写说明 / 什么都没改 / 金额非法 / 结算后改价 —— 都在本地先拦下，省一次必失败的请求。
 */
export function buildTermChange(order: FulfillmentOrder, form: TermChangeForm): { error: string } | { description: string; changes: OrderTermChanges } {
  const description = form.description.trim();
  if (!description) return { error: "写一句变更原因，对方才知道为什么改。" };
  const changes: OrderTermChanges = {};
  if (form.startTime.trim() !== order.snapshot.startTime) changes.startTime = form.startTime.trim();
  if (form.meetingContext.trim() !== order.snapshot.meetingContext) changes.meetingContext = form.meetingContext.trim();
  const amountText = form.agreedCompensation.replace(/[^0-9]/g, "");
  if (amountText !== "" && Number(amountText) !== order.snapshot.agreedCompensation) {
    if (!canChangePrice(order)) return { error: "已经登记了结算，不能再改金额。" };
    const amount = Number(amountText);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10_000_000) return { error: "金额要在 1 到 10,000,000 VND 之间。" };
    changes.agreedCompensation = amount;
  }
  if (Object.keys(changes).length === 0) return { error: "没有改动任何条款。" };
  return { description, changes };
}

export type TermDiff = { label: string; from: string; to: string };

const TERM_LABELS: ReadonlyArray<[keyof OrderTerms, string]> = [
  ["startTime", "时间"], ["duration", "时长"], ["meetingContext", "地点"], ["agreedCompensation", "金额"],
  ["includedScope", "包含"], ["excludedScope", "不含"], ["paymentMethodLabel", "支付方式"],
];

/** 提议相对当前条款改了什么（接受前给对方看清楚）。 */
export function termDiff(current: OrderTerms, proposed: OrderTerms): TermDiff[] {
  const out: TermDiff[] = [];
  for (const [key, label] of TERM_LABELS) {
    const from = current[key];
    const to = proposed[key];
    if (from === to) continue;
    const show = (value: string | number): string => (key === "agreedCompensation" ? `${Number(value).toLocaleString()} ${current.currency || "VND"}` : String(value || "—"));
    out.push({ label, from: show(from), to: show(to) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ORDER-AUDIT-UI-001：变更记录（数据来自存储层审计，只追加）。

const COMMAND_LABELS: Readonly<Record<string, string>> = {
  CreateOffer: "发起订单",
  AcceptSlotOffer: "接单",
  RespondTopicInvite: "接受邀约",
  OrderMaterialized: "订单生成",
  ConfirmCooperation: "确认合作",
  StartExecution: "开始执行",
  CheckInOrder: "到场打卡",
  SubmitEvidence: "提交凭证",
  RecordDirectSettlement: "确认结算",
  RecordOutcome: "确认完成",
  RecordSatisfaction: "评价",
  RecordMaterialOrderChange: "提出条款变更",
  RespondMaterialOrderChange: "处理条款变更",
  CancelOrder: "取消订单",
};

const STATE_LABELS: Readonly<Record<string, string>> = {
  OFFERED: "待确认", CONFIRMED: "已确认", EXECUTING: "进行中", COMPLETED: "已完成", CANCELLED: "已取消",
};

export type AuditLine = { when: string; who: string; what: string; state: string };

export function auditLines(order: FulfillmentOrder, entries: readonly OrderAuditEntry[]): AuditLine[] {
  const me = order.viewerRole === "REQUESTER" ? order.requesterId : order.agentId;
  return entries.map((entry) => {
    const who = entry.actorId === me ? "我" : entry.actorId === order.requesterId || entry.actorId === order.agentId ? "对方" : entry.overrideReason ? "平台" : "系统";
    const what = entry.overrideReason ? `平台更正：${entry.overrideReason}` : COMMAND_LABELS[entry.commandType] ?? "订单更新";
    const from = entry.oldState ? STATE_LABELS[entry.oldState] ?? entry.oldState : "";
    const to = entry.newState ? STATE_LABELS[entry.newState] ?? entry.newState : "";
    const state = from && to && from !== to ? `${from} → ${to}` : to;
    return { when: localStamp(entry.recordedAt), who, what, state };
  });
}

/** 服务端给的是 UTC；界面显示手机本地时间「MM-DD HH:mm」。解析不了就原样。 */
function localStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
