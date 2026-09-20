// AGENT-CLAIM-NUMBER-001: 接单编号展示口径（无依赖，可单测）。
// 编号由服务端注册时顺序分配（1 起、无跳号），客户端只负责展示。
export function formatClaimNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10000000) return "";
  return String(value).padStart(3, "0");
}
