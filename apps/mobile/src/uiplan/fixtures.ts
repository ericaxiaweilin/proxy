// Gate J：主要 Task Archetype 的确定性 UIPlan fixtures。
// Phase 1-5 不接模型与真实 API：类目选择 → 确定性计划；读模型数据对齐后端
// simulated seed（agent_linh / agent_mai / agent_minh），Phase 9 换成真实读模型。
import { FALLBACK_CRITICAL_QUESTION, fallbackPlanFor } from "./fallback";
import { UI_PLAN_SCHEMA_VERSION, type HardDemandCategory, type UIPlan } from "./types";

// ---- Read Models（fixture 版，data_ref 注水来源） ----

export interface NeedReadModel {
  needId: string;
  title: string;
  summary: string;
  category: HardDemandCategory;
  archetype: string;
  startAt: string;
  durationH: number;
  location: string;
  meetingPoint: string | null;
  goal?: string;
}

export interface QuoteReadModel {
  servicePriceVnd: number;
  currency: string;
  note: string;
  breakdown: Array<{ item: string; amountVnd: number }>;
}

// MATCH-LIVE-001：候选不再有演示数据。以前这里写死 Linh（履约 98%、26 单）/ Mai（12 单），「找人」页永远显示
// 这两张假卡片。真实候选由 FulfillmentWorkspace 调后端 ListCityCompanionCandidates 拿（按履约 / 评价排序），
// 这里只给「不可用」态，让面板如实说明。
const TRAVEL_LOCAL_NEED: NeedReadModel = {
  needId: "need_fixture_travel",
  title: "河内城市同行",
  summary: "在河内找一位本地同行者：中文沟通、陪同城市活动，按本单需求确定行程。",
  category: "TRAVEL_LOCAL",
  archetype: "CITY_COMPANION",
  startAt: "明天 09:00",
  durationH: 8,
  location: "河内 · 还剑湖附近",
  meetingPoint: "还剑湖北门"
};

const TRAVEL_LOCAL_QUOTE: QuoteReadModel = {
  servicePriceVnd: 1200000,
  currency: "VND",
  note: "本单服务价格（8H），属于本单 Offer，不是人的长期标价；沿途消费另计、自愿。",
  breakdown: [
    { item: "城市同行 8H", amountVnd: 1200000 },
    { item: "平台保障", amountVnd: 0 }
  ]
};

// data_ref → 组件 props（orchestrator 注水用）。读模型按组件语义塑形，
// 组件不直接访问 Domain Truth（Gate F）。
export function resolveReadModel(dataRef: string | undefined, componentId: string, plan: UIPlan): Record<string, unknown> {
  void dataRef;
  switch (componentId) {
    case "CATEGORY_ANCHOR":
      return { category: plan.demandCategory, label: plan.title, tags: [] };
    case "GOAL_SUMMARY":
      return {
        title: plan.title,
        summary: goalSummaryFor(plan),
        category: plan.demandCategory,
        archetype: plan.taskArchetype ?? null
      };
    case "CRITICAL_QUESTION": {
      const question = FALLBACK_CRITICAL_QUESTION[plan.demandCategory as HardDemandCategory] ?? FALLBACK_CRITICAL_QUESTION.OTHER;
      return question;
    }
    case "KNOWN_FACTS":
      return { facts: knownFactsFor(plan) };
    case "INFERRED_FACTS":
      return { facts: [{ fact: "语言需求：中文", basis: "目标文本提到中文沟通" }] };
    case "TIME_LOCATION":
      return {
        startAt: TRAVEL_LOCAL_NEED.startAt,
        durationH: TRAVEL_LOCAL_NEED.durationH,
        location: TRAVEL_LOCAL_NEED.location,
        meetingPoint: TRAVEL_LOCAL_NEED.meetingPoint
      };
    case "CANDIDATE_RAIL":
      return { candidates: [], status: "unavailable" };
    case "CONTEXTUAL_QUOTE":
      return { ...TRAVEL_LOCAL_QUOTE };
    case "WAITING_STATUS":
      return { status: "WAITING_AGENT_RESPONSE", message: "正在等待候选 Agent 应答，通常几分钟内回复。" };
    default:
      return {};
  }
}

// ---- 确定性计划（类目 → UIPlan） ----

const TRAVEL_DEFAULT_GOAL = "在河内找一位中文流利的本地同行者，一起完成今天的城市活动。";

export function fixturePlanFor(category: HardDemandCategory, goal?: string): UIPlan {
  if (category === "TRAVEL_LOCAL") {
    return {
      uiPlanId: "uip_fixture_travel_local",
      schemaVersion: UI_PLAN_SCHEMA_VERSION,
      surface: "FULFILLMENT_WORKSPACE",
      context: "REQUESTER",
      demandCategory: category,
      taskArchetype: "CITY_COMPANION",
      title: "河内城市同行",
      panels: [
        { componentId: "GOAL_SUMMARY", priority: 100, dataRef: "need:need_fixture_travel" },
        { componentId: "KNOWN_FACTS", priority: 95, dataRef: "need:need_fixture_travel" },
        { componentId: "TIME_LOCATION", priority: 90, dataRef: "need:need_fixture_travel" },
        { componentId: "CANDIDATE_RAIL", priority: 80, dataRef: "candidate_batch:cb_fixture_88" },
        { componentId: "CONTEXTUAL_QUOTE", priority: 70, dataRef: "quote:q_fixture_19" },
        { componentId: "CRITICAL_QUESTION", priority: 60, dataRef: "need:need_fixture_travel" }
      ]
    };
  }
  // 其余类目：fallback 计划 + 用户 Goal 作为已知事实回显。
  const plan = fallbackPlanFor(category);
  if (goal && goal.trim() !== "") {
    plan.panels = [
      { componentId: "GOAL_SUMMARY", priority: 100 },
      { componentId: "KNOWN_FACTS", priority: 90 },
      { componentId: "CRITICAL_QUESTION", priority: 80 }
    ];
  }
  return { ...plan, uiPlanId: `uip_fixture_${category.toLowerCase()}` };
}

function goalSummaryFor(plan: UIPlan): string {
  if (plan.demandCategory === "TRAVEL_LOCAL") return TRAVEL_DEFAULT_GOAL;
  return `你选择的大类是「${plan.title}」。先给一个大类锚点，智能辅助会继续理解你的最终目标。`;
}

function knownFactsFor(plan: UIPlan): string[] {
  if (plan.demandCategory === "TRAVEL_LOCAL") {
    return ["城市：河内", "时长：8H", "语言：中文", "集合点：还剑湖北门"];
  }
  return [`需求大类：${plan.title}`];
}
