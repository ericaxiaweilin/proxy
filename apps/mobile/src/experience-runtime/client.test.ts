import { describe, it, expect, vi } from "vitest";
import { ExperienceRuntimeClient } from "./client.js";
import type { ExperienceIntent, ClientCapability } from "@proxy/contracts";

function mockTransport(responseJson: unknown, status = 200) {
  return {
    request: vi.fn().mockResolvedValue({
      status,
      json: async () => responseJson,
    }),
  };
}

function mockSessionStore() {
  return {
    read: async () => ({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "sess_001" },
    }),
    write: async () => {},
    clear: async () => {},
  } as unknown as import("../secure-session").SecureSessionStore;
}

describe("ExperienceRuntimeClient", () => {
  const intent: ExperienceIntent = {
    intent_id: "exp_rain_31", type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
    objective: "REDUCE_TIME_AND_DECISION_COST", priority: 0.82, intervention_level: "SOFT_NUDGE",
    context_snapshot_id: "ctx_1842", decision_id: "dec_82A1",
    allowed_actions: ["open_fastest_plan"], forbidden_actions: [], required_information: [],
    expires_at: new Date(Date.now() + 900000).toISOString(), reason_codes: ["eta_64m"],
  };
  const cap: ClientCapability = {
    client_version: "2.7.1", platform: "ios", ui_runtime_version: "3.2",
    capabilities: ["stack:v3", "grid:v2"], limits: { max_schema_depth: 8, max_nodes: 80, supports_stream_delta: true },
  };

  it("compiles surface via command", async () => {
    const compileResult = {
      surface_plan: {
        surface_plan_id: "sp_dec_82A1_v185", surface_id: "home", surface_version: 185,
        decision_id: "dec_82A1", experience_intent_id: "exp_rain_31", context_snapshot_id: "ctx_1842",
        render_mode: "PRIMITIVE_COMPOSITION", slots: { top_context: ["rain"] }, ttl_s: 600, policy_version: "surface_policy_v5",
      },
      ui_schema: { schema_version: "ui_schema_v3", root: { type: "stack", children: [{ type: "alert", props: { text: "雨势正在变大" } }] } },
      delta: { surface_id: "home", base_version: 184, new_version: 185, delta_id: "delta_981", created_at: new Date().toISOString(), operations: [{ op: "insert", slot: "top_context", node: "rain" }] },
      fallback_plan_id: "fb_92",
    };
    const transport = mockTransport({
      commandId: "cmd_1", outcome: "ACCEPTED", eventRefs: [], correlationId: "c1",
      aggregate: { type: "ExperienceSurface", id: "sp_dec_82A1_v185", version: 185, state: "READY" },
      operationRef: JSON.stringify(compileResult),
    });
    const client = new ExperienceRuntimeClient({ transport: transport as unknown as import("./client").RuntimeTransport, secureSessionStore: mockSessionStore() });
    const res = await client.compileSurface({ intent, capability: cap, currentSurfaceVersion: 184 });
    expect(res.surface_plan.surface_version).toBe(185);
    expect(res.delta?.delta_id).toBe("delta_981");
  });

  it("throws NO_UI_CHANGE for low priority", async () => {
    const transport = mockTransport({
      commandId: "cmd_1", outcome: "ACCEPTED", eventRefs: [], correlationId: "c1",
      aggregate: { type: "ExperienceSurface", id: "exp_low", version: 1, state: "NO_UI_CHANGE" },
      operationRef: JSON.stringify({ result: "NO_UI_CHANGE", intent_id: "exp_low" }),
    });
    const client = new ExperienceRuntimeClient({ transport: transport as unknown as import("./client").RuntimeTransport, secureSessionStore: mockSessionStore() });
    await expect(client.compileSurface({ intent: { ...intent, intent_id: "exp_low", priority: 0.05 }, capability: cap })).rejects.toThrow("NO_UI_CHANGE");
  });

  it("fetches snapshot", async () => {
    const transport = mockTransport({
      surface_plan: { surface_plan_id: "sp_1", surface_id: "home", surface_version: 185, decision_id: "dec_1", experience_intent_id: "exp_1", context_snapshot_id: "ctx_1", render_mode: "PRIMITIVE_COMPOSITION", slots: {}, ttl_s: 600, policy_version: "v5" },
      ui_schema: { schema_version: "ui_schema_v3", root: { type: "stack", children: [] } },
      as_of: new Date().toISOString(),
    });
    const client = new ExperienceRuntimeClient({ transport: transport as unknown as import("./client").RuntimeTransport, secureSessionStore: mockSessionStore() });
    const snap = await client.fetchSurfaceSnapshot("home");
    expect(snap.surface_plan.surface_id).toBe("home");
  });
});
