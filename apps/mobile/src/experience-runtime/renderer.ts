// Frontend Runtime Renderer — §15
//  Schema Validation → Capability → Data Binding → Layout → Action Dispatch
//  不直接渲染 HTML，仅将受控 Schema 转为 Spec/组件树
import type { UISchema, UISchemaNode, SurfacePlan } from "@proxy/contracts";

export type RenderContext = {
  surfacePlan: SurfacePlan;
  resolveDataRef?: (ref: string) => Record<string, unknown> | undefined;
};

export type RenderedNode = {
  type: string;
  props: Record<string, unknown>;
  children?: RenderedNode[];
  actionId?: string;
};

export type RenderResult =
  | { ok: true; tree: RenderedNode; fallbackUsed: false }
  | { ok: false; reason: string; fallbackUsed: true; fallbackPlanId: string | undefined };

export function renderUISchema(schema: UISchema, ctx: RenderContext): RenderResult {
  try {
    const tree = renderNode(schema.root, ctx);
    return { ok: true, tree, fallbackUsed: false };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const fb: string | undefined = ctx.surfacePlan.fallback_plan_id ?? undefined;
    if (fb !== undefined) return { ok: false, reason: msg, fallbackUsed: true, fallbackPlanId: fb };
    return { ok: false, reason: msg, fallbackUsed: true, fallbackPlanId: undefined };
  }
}

function renderNode(node: UISchemaNode, ctx: RenderContext): RenderedNode {
  const props: Record<string, unknown> = { ...(node.props ?? {}) };
  if (node.data_ref && ctx.resolveDataRef) {
    const data = ctx.resolveDataRef(node.data_ref);
    if (data) props.__data = data;
  }
  // Action 必须来自 allowlist，已在 Go/TS 双侧校验；此处再守一次
  if (node.action_id && !isAllowedAction(node.action_id)) {
    throw new Error(`UNKNOWN_ACTION: ${node.action_id}`);
  }
  const rendered: RenderedNode = {
    type: node.type,
    props,
    ...(node.action_id ? { actionId: node.action_id } : {}),
  };
  if (node.children?.length) {
    rendered.children = node.children.map((c) => renderNode(c, ctx));
  }
  return rendered;
}

const ALLOWED_ACTIONS = new Set([
  "open_surface", "open_merchant", "open_map", "open_route",
  "apply_coupon", "start_match", "submit_choice", "confirm_reservation",
  "dismiss", "refresh", "open_fastest_plan", "open_registered_route",
]);

function isAllowedAction(id: string): boolean {
  return ALLOWED_ACTIONS.has(id);
}

// Fallback 链 — §18
export function resolveRenderFallback(plan: SurfacePlan): string | undefined {
  return plan.fallback_plan_id ?? undefined;
}
