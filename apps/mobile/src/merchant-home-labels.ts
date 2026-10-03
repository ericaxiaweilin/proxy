// MERCHANT-HOME-004（2026-10-02）：服务端枚举不能直接印给中文商家看。
//
// 原来 controlPlane 的「决策」格和 balanceHead 的状态 pill 直接显示
// NO_ACTION / DEMAND_RISING / INSUFFICIENT_SIGNAL —— 商家看到的是一串英文代号。
// 未知值回落原文：服务端加了新状态也不能静默消失（吞掉等于告诉商家"一切正常"）。
export const DECISION_KIND_LABEL: Record<string, string> = {
  NO_ACTION: "暂不行动",
  STOP_TRAFFIC: "停止引流",
  LOW_PEAK_FILL: "低峰补量",
};
export const DEMAND_SUPPLY_STATE_LABEL: Record<string, string> = {
  INSUFFICIENT_SIGNAL: "信号不足",
  BALANCED: "供需平衡",
  OVER_CAPACITY_RISK: "超容风险",
  CAPACITY_TIGHT: "容量偏紧",
  DEMAND_RISING: "需求上升",
  SUPPLY_EXCESS: "供给过剩",
};
export function decisionKindLabel(kind: string | undefined): string {
  if (!kind) return "暂不行动";
  return DECISION_KIND_LABEL[kind] ?? kind;
}
export function demandSupplyStateLabel(state: string | undefined): string {
  if (!state) return "信号不足";
  return DEMAND_SUPPLY_STATE_LABEL[state] ?? state;
}
