import { describe, it, expect } from "vitest";
import {
  ExperienceIntentSchema,
  UISchemaSchema,
  SurfacePlanSchema,
  SurfaceDeltaSchema,
  canApplyDelta,
  ClientCapabilitySchema,
  getSchemaStats,
} from "./experience-runtime.js";

describe("Experience Runtime contracts", () => {
  it("validates ExperienceIntent", () => {
    const intent = {
      intent_id: "exp_rain_31",
      type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
      objective: "REDUCE_TIME_AND_DECISION_COST",
      priority: 0.82,
      intervention_level: "SOFT_NUDGE",
      context_snapshot_id: "ctx_1842",
      decision_id: "dec_82A1",
      allowed_actions: ["open_fastest_plan"],
      forbidden_actions: [],
      required_information: [],
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      reason_codes: ["heavy_rain", "eta_64m"],
    };
    expect(ExperienceIntentSchema.safeParse(intent).success).toBe(true);
  });

  it("validates UI Schema (stack example from §3.1)", () => {
    const schema = {
      schema_version: "ui_schema_v3",
      root: {
        type: "stack",
        children: [
          { type: "title", props: { text: "雨势正在变大" } },
          { type: "eta", props: { value_min: 64 } },
          { type: "merchant_list", props: { limit: 3 }, data_ref: "candidate_set_82" },
        ],
      },
    };
    const parsed = UISchemaSchema.safeParse(schema);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const stats = getSchemaStats(parsed.data);
      expect(stats.nodes).toBe(4);
    }
  });

  it("rejects schema with remote script", () => {
    const schema = {
      schema_version: "ui_schema_v3",
      root: { type: "text", props: { text: "<script>alert(1)</script>" } },
    };
    expect(UISchemaSchema.safeParse(schema).success).toBe(false);
  });

  it("validates SurfacePlan", () => {
    const plan = {
      surface_plan_id: "sp_185",
      surface_id: "home",
      surface_version: 185,
      decision_id: "dec_82A1",
      experience_intent_id: "exp_rain_31",
      context_snapshot_id: "ctx_1842",
      render_mode: "PRIMITIVE_COMPOSITION",
      native_component: null,
      schema_ref: "uis_8821",
      slots: { top_context: ["node_rain_31"], primary: ["nearby_meal"] },
      ttl_s: 600,
      fallback_plan_id: "fb_92",
      policy_version: "surface_policy_v5",
    };
    expect(SurfacePlanSchema.safeParse(plan).success).toBe(true);
  });

  it("validates Delta version guard", () => {
    const delta = {
      surface_id: "home",
      base_version: 184,
      new_version: 185,
      delta_id: "delta_981",
      created_at: new Date().toISOString(),
      operations: [{ op: "insert", slot: "top_context", node: "rain_context_31" }],
    };
    const parsed = SurfaceDeltaSchema.safeParse(delta);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(canApplyDelta(184, parsed.data)).toBe(true);
      expect(canApplyDelta(183, parsed.data)).toBe(false);
    }
  });

  it("rejects delta with new_version <= base_version", () => {
    const delta = {
      surface_id: "home",
      base_version: 185,
      new_version: 185,
      delta_id: "delta_981",
      created_at: new Date().toISOString(),
      operations: [{ op: "update", node: "fast_delivery", patch: { eta: "25-40" } }],
    };
    expect(SurfaceDeltaSchema.safeParse(delta).success).toBe(false);
  });

  it("validates ClientCapability versioned format", () => {
    const cap = {
      client_version: "2.7.1",
      platform: "ios",
      ui_runtime_version: "3.2",
      capabilities: ["stack:v3", "grid:v2", "merchant_card:v5"],
      limits: { max_schema_depth: 8, max_nodes: 80, supports_stream_delta: true },
    };
    expect(ClientCapabilitySchema.safeParse(cap).success).toBe(true);
    const bad = { ...cap, capabilities: ["supports_map"] };
    expect(ClientCapabilitySchema.safeParse(bad).success).toBe(false);
  });

  it("full §20暴雨下班案例: Intent -> UI Schema -> SurfacePlan -> Delta", () => {
    const schema = {
      schema_version: "ui_schema_v3",
      root: {
        type: "stack",
        props: { spacing: "m" },
        children: [
          { type: "alert", props: { level: "context", text: "雨势正在变大" } },
          { type: "text", props: { text: "现在回家预计 64 分钟" } },
          { type: "grid", props: { columns: 2 }, children: [
            { type: "metric", props: { label: "附近吃饭", value: "3个选择" } },
            { type: "metric", props: { label: "直接配送", value: "25–40分钟" } },
          ]},
          { type: "merchant_list", data_ref: "candidate_set_82", props: { limit: 3 } },
          { type: "primary_action", props: { label: "看看最快方案" }, action_id: "open_fastest_plan" },
        ],
      },
    };
    expect(UISchemaSchema.safeParse(schema).success).toBe(true);
  });
});
