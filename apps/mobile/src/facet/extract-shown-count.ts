/**
 * R15.50 — extractShownCount: 从 server 返的 currentState 文本中拆"已展示 N 条"的数字。
 *
 * 拆出后给 PREVIEW 板块"已展示"行用 — 避免 "已展示 N 条 · 本周新增 3 个素材" 那种
 * 完全由前端 hardcode 制造的假数据。
 *
 * 输入格式 (server facet/reasoning.go ReasonedDecision.CurrentState):
 *   - "基础 1 条"       → 1
 *   - "已展示 4 条"     → 4
 *   - "副空间 3 条"     → 3 (R15.44 副空间为主场景)
 *   - "内容稀缺"        → null (没数字)
 *   - ""                → null
 *
 * 设计: 不写死在白名单 — 任何 "N 条" 形式都拆 (regex 第一匹配), 这样 server 端
 * 改 wording 也不需要 client 同步。
 */
export function extractShownCount(state: string): number | null {
  if (!state) return null;
  const match = state.match(/(\d+)\s*条/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
