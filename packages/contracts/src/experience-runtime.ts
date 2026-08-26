import { z } from "zod";

/**
 * Proxy Context-Driven Experience Runtime — v1
 * Architecture source: Proxy_Context_Driven_Experience_Runtime_Enhanced_UI_Architecture_v1.md
 *
 * 核心不变量（§28 Architecture Freeze）：
 * 1. ExperienceIntent 是 Decision ↔ UI 唯一语义桥梁
 * 2. SurfacePlan 是客户端唯一执行 Contract
 * 3. 后台只生成受控 UI Schema，不生成任意 JS/CSS/HTML
 * 4. UI 分三层：Native Domain / Primitive / Promoted Native Experience
 * 5. Client Capability 必须 versioned
 * 6. Realtime 使用 Versioned Delta
 * 7. Delta 乱序回退 full snapshot
 * 8. Action 必须进 Action Registry
 * 9. Context Change 需经 Decision/Human Value 才可改变 UI
 * 10. Primitive Composition 高频后可晋升 Native
 * 11. local_ephemeral_state 不被 Delta 粗暴覆盖
 * 12. NO_UI_CHANGE 合法
 * 13. Privacy/Safety/Explicit Negative 等 Guardrail 不可绕过
 */

// ── 6. Experience Intent ──

export const InterventionLevelSchema = z.enum([
  "PASSIVE",
  "SOFT_NUDGE",
  "ACTIVE",
  "PUSH",
  "POPUP",
]);
export type InterventionLevel = z.infer<typeof InterventionLevelSchema>;

export const ExperienceObjectiveSchema = z.enum([
  "REDUCE_TIME_AND_DECISION_COST",
  "INCREASE_CONVENIENCE",
  "ENSURE_SAFETY",
  "IMPROVE_FULFILLMENT",
  "REDUCE_RISK",
  "GENERAL_ASSIST",
]);
export type ExperienceObjective = z.infer<typeof ExperienceObjectiveSchema>;

export const ExperienceIntentSchema = z
  .object({
    intent_id: z.string().min(1),
    type: z.string().min(1), // e.g. HELP_USER_HANDLE_RAIN_AFTER_WORK, open vocabulary
    objective: ExperienceObjectiveSchema,
    priority: z.number().min(0).max(1),
    intervention_level: InterventionLevelSchema,
    context_snapshot_id: z.string().min(1),
    decision_id: z.string().min(1),
    allowed_actions: z.array(z.string().min(1)).default([]),
    forbidden_actions: z.array(z.string().min(1)).default([]),
    required_information: z.array(z.string().min(1)).default([]),
    expires_at: z.string().datetime(),
    reason_codes: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type ExperienceIntent = z.infer<typeof ExperienceIntentSchema>;

// ── 4.2 + 9. UI Schema ──

// Allowlist 来自文档 §4.1 §4.2 与 §9 示例。新增类型必须经 Registry 评审后加入。
export const PrimitiveTypeSchema = z.enum([
  // 基础表达
  "text",
  "title",
  "subtitle",
  "image",
  "icon",
  "badge",
  "divider",
  "spacer",
  // 布局
  "row",
  "column",
  "stack",
  "grid",
  "list",
  "carousel",
  "section",
  "slot",
  // 状态/数值
  "price",
  "distance",
  "eta",
  "countdown",
  "status",
  "progress",
  "score",
  "availability",
  "metric",
  "alert",
  // Action
  "primary_action",
  "secondary_action",
  "choice",
  "chip",
  "toggle",
  "confirm",
  "dismiss",
  // 业务引用 Primitive
  "map",
  "route",
  "merchant",
  "merchant_list",
  "person",
  "offer",
  "coupon",
  "place",
  "need",
  "reservation",
  // 输入
  "input",
  "select",
  "datetime_choice",
  "quantity",
  "location_choice",
  // 提示
  "notice",
  "inline_message",
  "warning",
  "success",
  "empty_state",
]);
export type PrimitiveType = z.infer<typeof PrimitiveTypeSchema>;

// UI Schema 节点：递归树，必须通过 Registry 校验（§8 / §17.2）
export type UISchemaNode = {
  type: PrimitiveType;
  props?: Record<string, unknown>;
  children?: UISchemaNode[];
  data_ref?: string;
  action_id?: string;
};

export const UISchemaNodeSchema: z.ZodType<UISchemaNode> = z.lazy(() =>
  z
    .object({
      type: PrimitiveTypeSchema,
      props: z.record(z.unknown()).optional(),
      children: z.array(UISchemaNodeSchema).optional(),
      data_ref: z.string().min(1).optional(),
      action_id: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((val, ctx) => {
      // 禁止任意脚本/外链（§17.1）
      const propsStr = JSON.stringify(val.props ?? {});
      if (/<script/i.test(propsStr) || /javascript:/i.test(propsStr)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "remote code not allowed" });
      }
    }),
) as unknown as z.ZodType<UISchemaNode>;

export const UISchemaSchema = z
  .object({
    schema_version: z.string().min(1), // e.g. ui_schema_v3
    root: UISchemaNodeSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    const stats = collectSchemaStats(val.root);
    if (stats.depth > 12) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `max_depth exceeded: ${stats.depth}` });
    if (stats.nodes > 120) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `max_nodes exceeded: ${stats.nodes}` });
    if (stats.actions > 8) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `max_actions exceeded: ${stats.actions}` });
    if (stats.images > 12) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `max_images exceeded: ${stats.images}` });
  });
export type UISchema = z.infer<typeof UISchemaSchema>;

function collectSchemaStats(node: UISchemaNode, depth = 1): { depth: number; nodes: number; actions: number; images: number } {
  let maxDepth = depth;
  let nodes = 1;
  let actions = node.action_id ? 1 : 0;
  let images = node.type === "image" ? 1 : 0;
  for (const child of node.children ?? []) {
    const s = collectSchemaStats(child, depth + 1);
    maxDepth = Math.max(maxDepth, s.depth);
    nodes += s.nodes;
    actions += s.actions;
    images += s.images;
  }
  return { depth: maxDepth, nodes, actions, images };
}

export function getSchemaStats(schema: UISchema) {
  return collectSchemaStats(schema.root);
}

// ── 10. SurfacePlan ──

export const SurfacePlanRenderModeSchema = z.enum(["NATIVE_COMPONENT", "PRIMITIVE_COMPOSITION", "FALLBACK"]);
export type SurfacePlanRenderMode = z.infer<typeof SurfacePlanRenderModeSchema>;

export const SurfacePlanSchema = z
  .object({
    surface_plan_id: z.string().min(1),
    surface_id: z.string().min(1), // e.g. home
    surface_version: z.number().int().nonnegative(),
    decision_id: z.string().min(1),
    experience_intent_id: z.string().min(1),
    context_snapshot_id: z.string().min(1),
    render_mode: SurfacePlanRenderModeSchema,
    native_component: z.string().min(1).nullable().optional(),
    schema_ref: z.string().min(1).nullable().optional(),
    slots: z.record(z.array(z.string().min(1))).default({}),
    ttl_s: z.number().int().positive(),
    fallback_plan_id: z.string().min(1).nullable().optional(),
    policy_version: z.string().min(1),
  })
  .strict();
export type SurfacePlan = z.infer<typeof SurfacePlanSchema>;

// ── 11. Client Capability Protocol ──

export const ClientCapabilitySchema = z.object({
  client_version: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
  ui_runtime_version: z.string().min(1),
  capabilities: z.array(z.string().regex(/^[a-z_]+:v\d+$/)), // e.g. stack:v3, grid:v2
  limits: z.object({
    max_schema_depth: z.number().int().positive(),
    max_nodes: z.number().int().positive(),
    supports_stream_delta: z.boolean(),
  }),
});
export type ClientCapability = z.infer<typeof ClientCapabilitySchema>;

export function isCapabilitySupported(capability: string, required: string): boolean {
  // required like "grid:v2" — client must have >= version
  const [reqName, reqVerRaw] = required.split(":v");
  const reqVer = Number(reqVerRaw);
  for (const cap of capability.split(",").map((s) => s.trim())) {
    const [name, verRaw] = cap.split(":v");
    if (name === reqName && Number(verRaw) >= reqVer) return true;
  }
  return false;
}

// ── 12 / 13. Realtime Delta ──

export const DeltaOperationTypeSchema = z.enum(["insert", "remove", "update", "move", "replace", "show", "hide", "invalidate"]);
export type DeltaOperationType = z.infer<typeof DeltaOperationTypeSchema>;

export const DeltaOperationSchema = z
  .object({
    op: DeltaOperationTypeSchema,
    slot: z.string().min(1).optional(),
    node: z.string().min(1).optional(),
    target_node: z.string().min(1).optional(),
    patch: z.record(z.unknown()).optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DeltaOperation = z.infer<typeof DeltaOperationSchema>;

export const SurfaceDeltaSchema = z
  .object({
    surface_id: z.string().min(1),
    base_version: z.number().int().nonnegative(),
    new_version: z.number().int().nonnegative(),
    delta_id: z.string().min(1),
    created_at: z.string().datetime(),
    expires_at: z.string().datetime().optional(),
    operations: z.array(DeltaOperationSchema).min(1),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.new_version <= val.base_version) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "new_version must be > base_version" });
    }
  });
export type SurfaceDelta = z.infer<typeof SurfaceDeltaSchema>;

export function canApplyDelta(localVersion: number, delta: SurfaceDelta): boolean {
  return localVersion === delta.base_version;
}

// ── 16. Action Registry ──

export const RegisteredActionIdSchema = z.enum([
  "open_surface",
  "open_merchant",
  "open_map",
  "open_route",
  "apply_coupon",
  "start_match",
  "submit_choice",
  "confirm_reservation",
  "dismiss",
  "refresh",
  "open_fastest_plan",
  "open_registered_route",
]);
export type RegisteredActionId = z.infer<typeof RegisteredActionIdSchema>;

export const ActionDefinitionSchema = z.object({
  action_id: RegisteredActionIdSchema,
  input_schema: z.record(z.unknown()).optional(),
  permission: z.string().min(1).optional(),
  requires_confirmation: z.boolean().optional().default(false),
  risk_level: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().default("LOW"),
  allowed_surfaces: z.array(z.string().min(1)).optional().default([]),
  telemetry_policy: z.string().optional(),
});
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

export const ACTION_REGISTRY: Record<RegisteredActionId, ActionDefinition> = {
  open_surface: { action_id: "open_surface", risk_level: "LOW", allowed_surfaces: ["home", "tasks", "feed"], requires_confirmation: false },
  open_merchant: { action_id: "open_merchant", risk_level: "LOW", allowed_surfaces: ["home", "feed", "merchant"], requires_confirmation: false },
  open_map: { action_id: "open_map", risk_level: "LOW", allowed_surfaces: ["home", "map"], requires_confirmation: false },
  open_route: { action_id: "open_route", risk_level: "LOW", allowed_surfaces: ["home", "map"], requires_confirmation: false },
  apply_coupon: { action_id: "apply_coupon", risk_level: "MEDIUM", allowed_surfaces: ["home", "coupon"], requires_confirmation: false },
  start_match: { action_id: "start_match", risk_level: "MEDIUM", allowed_surfaces: ["home"], requires_confirmation: false },
  submit_choice: { action_id: "submit_choice", risk_level: "LOW", allowed_surfaces: ["home", "tasks"], requires_confirmation: false },
  confirm_reservation: { action_id: "confirm_reservation", risk_level: "HIGH", requires_confirmation: true, allowed_surfaces: ["reservation"] },
  dismiss: { action_id: "dismiss", risk_level: "LOW", allowed_surfaces: ["home", "inbox"], requires_confirmation: false },
  refresh: { action_id: "refresh", risk_level: "LOW", allowed_surfaces: ["home", "feed"], requires_confirmation: false },
  open_fastest_plan: { action_id: "open_fastest_plan", risk_level: "LOW", allowed_surfaces: ["home"], requires_confirmation: false },
  open_registered_route: { action_id: "open_registered_route", risk_level: "LOW", allowed_surfaces: ["home", "me"], requires_confirmation: false },
};

// ── 5. 更新能力梯度 L0-L4 ──

export const UpdateLevelSchema = z.enum(["L0", "L1", "L2", "L3", "L4"]);
export type UpdateLevel = z.infer<typeof UpdateLevelSchema>;

// ── Surface Compiler 输入/输出（§7/§8） ──

export const SurfaceCompileRequestSchema = z.object({
  experience_intent: ExperienceIntentSchema,
  client_capability: ClientCapabilitySchema,
  current_surface_version: z.number().int().nonnegative().optional(),
  policy_version: z.string().min(1).optional(),
});
export type SurfaceCompileRequest = z.infer<typeof SurfaceCompileRequestSchema>;

export const SurfaceCompileResultSchema = z.object({
  surface_plan: SurfacePlanSchema,
  ui_schema: UISchemaSchema.nullable().optional(),
  delta: SurfaceDeltaSchema.nullable().optional(),
  fallback_plan_id: z.string().min(1).nullable().optional(),
});
export type SurfaceCompileResult = z.infer<typeof SurfaceCompileResultSchema>;
