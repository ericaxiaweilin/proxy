// Gate I 不变式：7 个冻结的 Hard Demand Category 全部具备确定性 fallback，
// 且每个 fallback 计划本身能通过 fail-closed 校验。
import { describe, expect, it } from "vitest";
import { allFallbackCategories, fallbackPlanFor } from "./fallback";
import { HARD_DEMAND_CATEGORIES } from "./types";
import { validateUIPlan } from "./validator";

function toWire(plan: ReturnType<typeof fallbackPlanFor>): Record<string, unknown> {
  return {
    ui_plan_id: plan.uiPlanId,
    schema_version: plan.schemaVersion,
    surface: plan.surface,
    context: plan.context,
    demand_category: plan.demandCategory,
    task_archetype: plan.taskArchetype,
    title: plan.title,
    panels: plan.panels.map((panel) => ({
      component_id: panel.componentId,
      priority: panel.priority,
      ...(panel.dataRef !== undefined ? { data_ref: panel.dataRef } : {})
    }))
  };
}

describe("Gate I fallback 覆盖", () => {
  it("7 个冻结类目全部登记且有 fallback", () => {
    expect(allFallbackCategories()).toEqual(HARD_DEMAND_CATEGORIES);
    expect(HARD_DEMAND_CATEGORIES).toHaveLength(7);
    for (const category of HARD_DEMAND_CATEGORIES) {
      const plan = fallbackPlanFor(category);
      expect(plan.demandCategory).toBe(category);
      expect(plan.surface).toBe("FULFILLMENT_WORKSPACE");
      expect(plan.panels.length).toBeGreaterThan(0);
    }
  });

  it("每个 fallback 计划都通过 fail-closed 校验", () => {
    for (const category of HARD_DEMAND_CATEGORIES) {
      const decision = validateUIPlan(toWire(fallbackPlanFor(category)));
      expect(decision.ok, category).toBe(true);
      expect(decision.rejected, category).toEqual([]);
    }
  });

  it("TRAVEL_LOCAL fallback = GOAL_SUMMARY + TIME_LOCATION + CRITICAL_QUESTION（Runtime Contract §Fallback）", () => {
    const plan = fallbackPlanFor("TRAVEL_LOCAL");
    expect(plan.panels.map((panel) => panel.componentId)).toEqual([
      "GOAL_SUMMARY",
      "TIME_LOCATION",
      "CRITICAL_QUESTION"
    ]);
  });
});
