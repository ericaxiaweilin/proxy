// UIPlan validator（fail-closed）的确定性测试：信封级拒绝 / Gate B / Gate C / 去重 / 排序。
import { describe, expect, it } from "vitest";
import { validateUIPlan } from "./validator";

interface WirePanel {
  component_id: string;
  priority: number;
  data_ref?: string;
}

function wirePlan(overrides: Record<string, unknown> = {}, panels?: WirePanel[]): Record<string, unknown> {
  return {
    ui_plan_id: "uip_test",
    schema_version: "1.0",
    surface: "FULFILLMENT_WORKSPACE",
    context: "REQUESTER",
    demand_category: "TRAVEL_LOCAL",
    title: "测试计划",
    panels: panels ?? [{ component_id: "GOAL_SUMMARY", priority: 100 }],
    ...overrides
  };
}

describe("validateUIPlan fail-closed 信封校验", () => {
  it("垃圾输入整体拒绝（SCHEMA_INVALID）", () => {
    expect(validateUIPlan(null).ok).toBe(false);
    expect(validateUIPlan({}).fatalReason).toBe("SCHEMA_INVALID");
    expect(validateUIPlan("not-a-plan").fatalReason).toBe("SCHEMA_INVALID");
  });

  it("schema_version 不是 1.0 时拒绝", () => {
    const decision = validateUIPlan(wirePlan({ schema_version: "2.0" }));
    expect(decision.ok).toBe(false);
    expect(decision.fatalReason).toBe("SCHEMA_VERSION_UNSUPPORTED");
  });

  it("未注册 Surface 拒绝（Gate B：禁止发明路由，Gate E）", () => {
    const decision = validateUIPlan(wirePlan({ surface: "SECRET_PAGE" }));
    expect(decision.ok).toBe(false);
    expect(decision.fatalReason).toBe("SURFACE_NOT_REGISTERED");
  });

  it("非法 Active Context / 非法类目拒绝", () => {
    expect(validateUIPlan(wirePlan({ context: "ADMIN" })).fatalReason).toBe("CONTEXT_INVALID");
    expect(validateUIPlan(wirePlan({ demand_category: "SPACE_TRAVEL" })).fatalReason).toBe("CATEGORY_INVALID");
  });

  it("空 panels 拒绝", () => {
    expect(validateUIPlan(wirePlan({}, [])).fatalReason).toBe("NO_PANELS");
  });
});

describe("validateUIPlan 面板级处理", () => {
  it("未注册组件丢弃并记入 rejected（Gate C），合法面板保留", () => {
    const decision = validateUIPlan(
      wirePlan({}, [
        { component_id: "GOAL_SUMMARY", priority: 100 },
        { component_id: "EVIL_IFRAME", priority: 90 }
      ])
    );
    expect(decision.ok).toBe(true);
    expect(decision.panels.map((panel) => panel.componentId)).toEqual(["GOAL_SUMMARY"]);
    expect(decision.rejected).toEqual([{ componentId: "EVIL_IFRAME", reason: "COMPONENT_NOT_REGISTERED" }]);
  });

  it("全部面板都未注册时整体拒绝（NO_VALID_PANELS）", () => {
    const decision = validateUIPlan(wirePlan({}, [{ component_id: "EVIL_IFRAME", priority: 1 }]));
    expect(decision.ok).toBe(false);
    expect(decision.fatalReason).toBe("NO_VALID_PANELS");
  });

  it("重复组件去重：保留 priority 更高者", () => {
    const decision = validateUIPlan(
      wirePlan({}, [
        { component_id: "CRITICAL_QUESTION", priority: 60 },
        { component_id: "CRITICAL_QUESTION", priority: 90 }
      ])
    );
    expect(decision.panels).toHaveLength(1);
    expect(decision.panels[0]?.priority).toBe(90);
    expect(decision.rejected.some((entry) => entry.reason === "DUPLICATE_PANEL")).toBe(true);
  });

  it("面板按 priority 降序排列", () => {
    const decision = validateUIPlan(
      wirePlan({}, [
        { component_id: "CRITICAL_QUESTION", priority: 60 },
        { component_id: "TIME_LOCATION", priority: 90 },
        { component_id: "GOAL_SUMMARY", priority: 100 }
      ])
    );
    expect(decision.panels.map((panel) => panel.componentId)).toEqual([
      "GOAL_SUMMARY",
      "TIME_LOCATION",
      "CRITICAL_QUESTION"
    ]);
  });
});
