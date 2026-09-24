// Gate J：确定性 fixtures 的不变式。TRAVEL_LOCAL 完整计划必须通过 fail-closed
// 校验；候选读模型对齐后端 simulated seed；其余类目走各自 fallback。
import { describe, expect, it } from "vitest";
import { fixturePlanFor, resolveReadModel } from "./fixtures";
import { HARD_DEMAND_CATEGORIES, type UIPlan } from "./types";
import { validateUIPlan } from "./validator";

function toWire(plan: UIPlan): Record<string, unknown> {
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

describe("fixturePlanFor（Gate J 确定性计划）", () => {
  it("TRAVEL_LOCAL 完整计划通过校验且面板降序", () => {
    const plan = fixturePlanFor("TRAVEL_LOCAL", "想找中文流利的同行者");
    const decision = validateUIPlan(toWire(plan));
    expect(decision.ok).toBe(true);
    expect(decision.rejected).toEqual([]);
    expect(decision.panels.map((panel) => panel.componentId)).toEqual([
      "GOAL_SUMMARY",
      "KNOWN_FACTS",
      "TIME_LOCATION",
      "CANDIDATE_RAIL",
      "CONTEXTUAL_QUOTE",
      "CRITICAL_QUESTION"
    ]);
  });

  it("其余 6 个类目的 fixture 计划都通过校验", () => {
    for (const category of HARD_DEMAND_CATEGORIES) {
      if (category === "TRAVEL_LOCAL") continue;
      const decision = validateUIPlan(toWire(fixturePlanFor(category, "一个目标文本")));
      expect(decision.ok, category).toBe(true);
    }
  });
});

describe("resolveReadModel（Gate F：组件只见塑形 props）", () => {
  // MATCH-LIVE-001：演示数据不再提供任何候选人 —— 以前写死 Linh 26 单 / Mai 12 单，「找人」页永远是这两张假卡。
  it("候选不来自演示数据：没有真实结果时是空 + unavailable", () => {
    const plan = fixturePlanFor("TRAVEL_LOCAL");
    const props = resolveReadModel("candidate_batch:cb_fixture_88", "CANDIDATE_RAIL", plan) as { candidates: unknown[]; status?: string };
    expect(props.candidates).toEqual([]);
    expect(props.status).toBe("unavailable");
  });

  it("CRITICAL_QUESTION 按类目提供问题；TIME_LOCATION 提供时间地点", () => {
    const plan = fixturePlanFor("TRAVEL_LOCAL");
    const question = resolveReadModel(undefined, "CRITICAL_QUESTION", plan) as { questionId: string };
    expect(question.questionId).toBe("q_time");
    const timeLocation = resolveReadModel(undefined, "TIME_LOCATION", plan) as { location: string };
    expect(timeLocation.location).toContain("河内");
  });
});
