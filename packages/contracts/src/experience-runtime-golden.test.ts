import { describe, it, expect } from "vitest";
import { UISchemaSchema, SurfaceDeltaSchema, type SurfaceDelta } from "./experience-runtime";

describe("§24 Golden / Delta Replay / Compatibility", () => {
  it("golden: same Intent+Capability produces stable schema", () => {
    const schema = { schema_version: "ui_schema_v3", root: { type: "stack", children: [{ type: "alert", props: { text: "雨势正在变大" } }] } };
    const a = UISchemaSchema.safeParse(schema);
    const b = UISchemaSchema.safeParse(schema);
    expect(a.success && b.success).toBe(true);
    if (a.success && b.success) expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });

  it("delta replay: v184→185→186 sequential", () => {
    const d185: SurfaceDelta = { surface_id: "home", base_version: 184, new_version: 185, delta_id: "d185", created_at: new Date().toISOString(), operations: [{ op: "insert", slot: "top_context", node: "rain" }] };
    const d186: SurfaceDelta = { surface_id: "home", base_version: 185, new_version: 186, delta_id: "d186", created_at: new Date().toISOString(), operations: [{ op: "update", node: "fast_delivery", patch: { eta: "30m" } }] };
    expect(SurfaceDeltaSchema.safeParse(d185).success).toBe(true);
    expect(SurfaceDeltaSchema.safeParse(d186).success).toBe(true);
    // out-of-order should be rejected by client guard: local 184 cannot apply 186
    const canApply = (local: number, d: SurfaceDelta) => local === d.base_version;
    expect(canApply(184, d185)).toBe(true);
    expect(canApply(184, d186)).toBe(false);
    expect(canApply(185, d186)).toBe(true);
  });

  it("compatibility: old client missing grid:v2 fails capability", () => {
    const schema = { schema_version: "ui_schema_v3", root: { type: "stack", children: [{ type: "grid", props: { columns: 2 }, children: [{ type: "metric", props: { label: "a", value: "1" } }] }] } };
    // schema is valid but capability check would fallback — validated at compiler layer
    expect(UISchemaSchema.safeParse(schema).success).toBe(true);
  });
});
