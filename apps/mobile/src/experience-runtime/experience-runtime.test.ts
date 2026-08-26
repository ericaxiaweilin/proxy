import { describe, it, expect } from "vitest";
import { validateUISchema, validateDelta } from "./validator";
import { buildClientCapability, checkCapabilityForSchema } from "./capability";
import { applyDelta, canApplyDelta } from "./delta-patcher";
import { renderUISchema } from "./renderer";
import type { SurfacePlan, UISchema, SurfaceDelta } from "@proxy/contracts";

describe("experience-runtime mobile", () => {
  const rainSchema: UISchema = {
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

  const basePlan: SurfacePlan = {
    surface_plan_id: "sp_184", surface_id: "home", surface_version: 184,
    decision_id: "dec_82A1", experience_intent_id: "exp_rain_31", context_snapshot_id: "ctx_1842",
    render_mode: "PRIMITIVE_COMPOSITION", native_component: null, schema_ref: "uis_8821",
    slots: { top_context: [], primary: ["fast_delivery"] }, ttl_s: 600, fallback_plan_id: "fb_92", policy_version: "surface_policy_v5",
  };

  it("validates rain schema", () => {
    expect(validateUISchema(rainSchema).ok).toBe(true);
  });

  it("rejects schema with script", () => {
    const bad = { schema_version: "ui_schema_v3", root: { type: "text", props: { text: "<script>" } } };
    expect(validateUISchema(bad).ok).toBe(false);
  });

  it("capability check pass/fail", () => {
    const cap = buildClientCapability({
      clientVersion: "2.7.1", platform: "ios", uiRuntimeVersion: "3.2",
      capabilities: ["stack:v3", "grid:v2", "merchant_card:v5"],
      maxSchemaDepth: 8, maxNodes: 80,
    });
    expect(checkCapabilityForSchema(cap, rainSchema).ok).toBe(true);
    const smallCap = buildClientCapability({ clientVersion: "1.0", platform: "ios", uiRuntimeVersion: "1.0", capabilities: ["stack:v1"], maxSchemaDepth: 1, maxNodes: 80 });
    expect(checkCapabilityForSchema(smallCap, rainSchema).ok).toBe(false);
  });

  it("delta version guard + patch with local state preserved", () => {
    const delta: SurfaceDelta = {
      surface_id: "home", base_version: 184, new_version: 185, delta_id: "delta_981",
      created_at: new Date().toISOString(),
      operations: [
        { op: "insert", slot: "top_context", node: "rain_context_31" },
        { op: "update", node: "fast_delivery", patch: { eta: "25–40分钟" } },
        { op: "remove", node: "outdoor_companion" },
      ],
    };
    expect(validateDelta(delta).ok).toBe(true);
    expect(canApplyDelta(184, delta)).toBe(true);
    expect(canApplyDelta(183, delta)).toBe(false);

    const state = { plan: basePlan, schema: rainSchema, localEphemeralState: { fast_delivery: { expanded: true }, rain_context_31: { dismissed: false } } };
    const result = applyDelta(state, delta);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.plan.surface_version).toBe(185);
      expect(result.state.plan.slots["top_context"]).toContain("rain_context_31");
      // local state preserved
      expect(result.state.localEphemeralState["fast_delivery"]).toEqual({ expanded: true });
    }
  });

  it("delta mismatch must fallback to snapshot", () => {
    const delta: SurfaceDelta = {
      surface_id: "home", base_version: 186, new_version: 187, delta_id: "delta_982",
      created_at: new Date().toISOString(), operations: [{ op: "update", node: "x", patch: {} }],
    };
    const state = { plan: basePlan, schema: rainSchema, localEphemeralState: {} };
    const result = applyDelta(state, delta);
    expect(result.ok).toBe(false);
  });

  it("renderer maps schema to tree and guards unknown action", () => {
    const ok = renderUISchema(rainSchema, { surfacePlan: basePlan });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.tree.type).toBe("stack");

    const badSchema: UISchema = {
      schema_version: "ui_schema_v3",
      root: { type: "stack", children: [{ type: "primary_action", props: { label: "x" }, action_id: "evil_rm_rf" }] },
    };
    const bad = renderUISchema(badSchema, { surfacePlan: basePlan });
    expect(bad.ok).toBe(false);
    expect(bad.fallbackUsed).toBe(true);
  });

  it("invalidate clears local state", () => {
    const delta: SurfaceDelta = {
      surface_id: "home", base_version: 184, new_version: 185, delta_id: "delta_983",
      created_at: new Date().toISOString(), operations: [{ op: "invalidate", node: "fast_delivery" }],
    };
    const state = { plan: basePlan, schema: rainSchema, localEphemeralState: { fast_delivery: { expanded: true } } };
    const result = applyDelta(state, delta);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.localEphemeralState["fast_delivery"]).toBeUndefined();
  });
});
