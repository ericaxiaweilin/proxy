// R15 UIPlan 运行时契约（Proxy_R15_UIPlan_Runtime_Contract_R1）。
// UIPlan 是模型/fixture 产出的结构化 UI 指令：信封 + 面板列表。
// 模型不得直出 HTML/路由（Gate D/E）；本文件只定义数据结构与冻结常量。
import { z } from "zod";

export const UI_PLAN_SCHEMA_VERSION = "1.0";

// Hard Demand Category（PRD v1.2 §6 冻结，模型不得静默跨类目）。
export const HARD_DEMAND_CATEGORIES = [
  "FNB_RETAIL",
  "EVENT_EXHIBITION",
  "TRAVEL_LOCAL",
  "BUSINESS_PRO",
  "CONTENT_MARKETING",
  "MOBILITY_ERRAND",
  "OTHER"
] as const;
export type HardDemandCategory = (typeof HARD_DEMAND_CATEGORIES)[number];

// Active Context（R15.12.7 冻结：只保留用户与商家；接单 / 提供能力 / 发活动都是行为，不是身份）。
export const ACTIVE_CONTEXTS = ["REQUESTER", "BUSINESS"] as const;
export type ActiveContext = (typeof ACTIVE_CONTEXTS)[number];

// 稳定 Surface 注册表（Architecture R1）。UIPlan 只能命中已登记 Surface（Gate B）；
// 未实现 Surface 仍登记在案，由渲染层展示占位。
export const REGISTERED_SURFACES = [
  "REQUESTER_HOME",
  "BUSINESS_HOME",
  "TASKS",
  "FEED",
  "ME",
  "FULFILLMENT_WORKSPACE",
  "SKILL_WORKSPACE",
  "CONVERSATION",
  "MERCHANT_STOREFRONT",
  "ORDER_EXECUTION",
  "OUTCOME",
  "ACTIVITY_DETAIL"
] as const;
export type SurfaceId = (typeof REGISTERED_SURFACES)[number];

export const UIPanelSchema = z.object({
  component_id: z.string(),
  priority: z.number(),
  data_ref: z.string().optional()
});

export const UIPlanSchema = z.object({
  ui_plan_id: z.string(),
  schema_version: z.string(),
  surface: z.string(),
  context: z.string(),
  demand_category: z.string(),
  task_archetype: z.string().optional(),
  title: z.string(),
  panels: z.array(UIPanelSchema),
  required_confirmations: z.array(z.string()).optional(),
  optional_actions: z.array(z.string()).optional(),
  navigation_policy: z.object({ stay_on_surface: z.boolean().optional() }).optional()
});

export interface UIPlanPanel {
  componentId: string;
  priority: number;
  dataRef?: string;
}

export interface UIPlan {
  uiPlanId: string;
  schemaVersion: string;
  surface: string;
  context: string;
  demandCategory: string;
  taskArchetype?: string;
  title: string;
  panels: UIPlanPanel[];
}

export interface RejectedPanel {
  componentId: string;
  reason: string;
}

// 校验决策（Gate B/C 观测字段：requested → accepted/rejected）。
export interface UIPlanDecision {
  ok: boolean;
  // 信封级失败原因；非空时调用方必须改用 fallback 计划（fail-closed）。
  fatalReason?: string;
  plan?: UIPlan;
  // 通过白名单校验、去重、排序后的面板。
  panels: UIPlanPanel[];
  rejected: RejectedPanel[];
}

// snake_case JSON → 领域对象。输入不可信，全部经 zod 解析。
export function parseUIPlan(raw: unknown): UIPlan | undefined {
  const parsed = UIPlanSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const value = parsed.data;
  return {
    uiPlanId: value.ui_plan_id,
    schemaVersion: value.schema_version,
    surface: value.surface,
    context: value.context,
    demandCategory: value.demand_category,
    ...(value.task_archetype !== undefined ? { taskArchetype: value.task_archetype } : {}),
    title: value.title,
    panels: value.panels.map((panel) => ({
      componentId: panel.component_id,
      priority: panel.priority,
      ...(panel.data_ref !== undefined ? { dataRef: panel.data_ref } : {})
    }))
  };
}

export function isHardDemandCategory(value: string): value is HardDemandCategory {
  return (HARD_DEMAND_CATEGORIES as readonly string[]).includes(value);
}

export function isRegisteredSurface(value: string): value is SurfaceId {
  return (REGISTERED_SURFACES as readonly string[]).includes(value);
}

export function isActiveContext(value: string): value is ActiveContext {
  return (ACTIVE_CONTEXTS as readonly string[]).includes(value);
}
