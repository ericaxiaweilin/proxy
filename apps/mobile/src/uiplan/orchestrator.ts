// UI Orchestrator 的渲染段（Architecture R1：hydrate → render）。
// 已校验的 UIPlan → json-render Spec（扁平元素树）。read-model 注水在这里完成，
// 组件只拿到塑形后的 props，永远不接触 Domain Truth（Gate F）。
import type { Spec } from "@json-render/react-native";
import type { RejectedPanel, UIPlan, UIPlanDecision, UIPlanPanel } from "./types";

export type ResolveReadModel = (
  dataRef: string | undefined,
  componentId: string,
  plan: UIPlan
) => Record<string, unknown>;

// Gate M 观测：requested / rendered / rejected / fallback_used。
export interface PlanObservability {
  uiPlanId: string;
  requestedComponents: number;
  renderedComponents: number;
  rejectedComponents: RejectedPanel[];
  fallbackUsed: boolean;
}

interface SpecElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  on?: Record<string, { action: string; params?: Record<string, unknown> }>;
}

export function planToSpec(decision: UIPlanDecision, resolve: ResolveReadModel): { spec: Spec | null; observability: PlanObservability | null } {
  if (!decision.ok || !decision.plan) {
    return { spec: null, observability: null };
  }
  const plan = decision.plan;
  const elements: Record<string, SpecElement> = {};
  const childKeys: string[] = [];

  decision.panels.forEach((panel, index) => {
    const key = `panel_${index}`;
    const props = resolve(panel.dataRef, panel.componentId, plan);
    const element: SpecElement = { type: panel.componentId, props };
    // 交互走 action emit（material action 需后端命令，这里仅 Product State 级动作）。
    if (panel.componentId === "CRITICAL_QUESTION") {
      element.on = {
        press: {
          action: "answer_critical_question",
          params: {
            questionId: String(props.questionId ?? ""),
            answer: { "$state": "/critical_answer" }
          }
        }
      };
    }
    if (panel.componentId === "CANDIDATE_RAIL") {
      element.on = { press: { action: "select_candidate", params: {} } };
    }
    elements[key] = element;
    childKeys.push(key);
  });

  // 根节点使用 json-render 标准 Column 容器（includeStandard=true）。
  elements.root = { type: "Column", props: { gap: 12 }, children: childKeys };
  const spec = { root: "root", elements } as unknown as Spec;
  return {
    spec,
    observability: {
      uiPlanId: plan.uiPlanId,
      requestedComponents: plan.panels.length,
      renderedComponents: decision.panels.length,
      rejectedComponents: decision.rejected,
      fallbackUsed: plan.uiPlanId.includes("fallback")
    }
  };
}

export function panelSummary(panel: UIPlanPanel): string {
  return `${panel.componentId}@${panel.priority}`;
}
