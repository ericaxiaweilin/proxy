// UI Orchestrator 的校验段（Architecture R1：schema validation → allowlist →
// dedupe → ordering）。输入是不可信输入（模型输出或 fixture），fail-closed：
// 信封级违规整体拒绝并转 fallback；面板级违规逐个丢弃并记入 rejected（Gate M 观测）。
import { isRegisteredComponent } from "./catalog";
import {
  isActiveContext,
  isHardDemandCategory,
  isRegisteredSurface,
  parseUIPlan,
  UI_PLAN_SCHEMA_VERSION,
  type UIPlanDecision,
  type UIPlanPanel,
  type RejectedPanel
} from "./types";

export function validateUIPlan(raw: unknown): UIPlanDecision {
  const plan = parseUIPlan(raw);
  if (!plan) {
    return { ok: false, fatalReason: "SCHEMA_INVALID", panels: [], rejected: [] };
  }
  if (plan.schemaVersion !== UI_PLAN_SCHEMA_VERSION) {
    return { ok: false, fatalReason: "SCHEMA_VERSION_UNSUPPORTED", panels: [], rejected: [] };
  }
  // Gate B：UIPlan 必须命中已注册的稳定 Surface（禁止发明路由，Gate E）。
  if (!isRegisteredSurface(plan.surface)) {
    return { ok: false, fatalReason: "SURFACE_NOT_REGISTERED", panels: [], rejected: [] };
  }
  if (!isActiveContext(plan.context)) {
    return { ok: false, fatalReason: "CONTEXT_INVALID", panels: [], rejected: [] };
  }
  if (!isHardDemandCategory(plan.demandCategory)) {
    return { ok: false, fatalReason: "CATEGORY_INVALID", panels: [], rejected: [] };
  }
  if (plan.panels.length === 0) {
    return { ok: false, fatalReason: "NO_PANELS", panels: [], rejected: [] };
  }

  const rejected: RejectedPanel[] = [];
  const byComponent = new Map<string, UIPlanPanel>();
  for (const panel of plan.panels) {
    // Gate C：面板必须引用已注册组件；未登记一律丢弃。
    if (!isRegisteredComponent(panel.componentId)) {
      rejected.push({ componentId: panel.componentId, reason: "COMPONENT_NOT_REGISTERED" });
      continue;
    }
    const existing = byComponent.get(panel.componentId);
    if (existing) {
      // 重复组件：保留 priority 更高者，另一份记为去重丢弃。
      rejected.push({ componentId: panel.componentId, reason: "DUPLICATE_PANEL" });
      if (panel.priority > existing.priority) {
        byComponent.set(panel.componentId, panel);
      }
      continue;
    }
    byComponent.set(panel.componentId, panel);
  }

  const accepted = [...byComponent.values()].sort((a, b) => b.priority - a.priority);
  if (accepted.length === 0) {
    return { ok: false, fatalReason: "NO_VALID_PANELS", panels: [], rejected };
  }
  return { ok: true, plan, panels: accepted, rejected };
}
