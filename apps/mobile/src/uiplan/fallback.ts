// Gate I：每个 Hard Demand Category 必须有一个确定性最小 fallback 计划。
// 模型不可用（Phase 6 之前/底座故障）时核心需求流程仍可工作。
// 参考 Runtime Contract R1 §Fallback：TRAVEL_LOCAL → GOAL_SUMMARY + TIME_LOCATION + CRITICAL_QUESTION。
import {
  HARD_DEMAND_CATEGORIES,
  UI_PLAN_SCHEMA_VERSION,
  type HardDemandCategory,
  type UIPlan
} from "./types";

interface FallbackBlueprint {
  archetype: string;
  title: string;
  panels: Array<{ componentId: string; priority: number }>;
}

const BASE_PANELS: FallbackBlueprint["panels"] = [
  { componentId: "GOAL_SUMMARY", priority: 100 },
  { componentId: "CRITICAL_QUESTION", priority: 80 }
];

const BLUEPRINTS: Record<HardDemandCategory, FallbackBlueprint> = {
  TRAVEL_LOCAL: {
    archetype: "CITY_COMPANION",
    title: "城市同行",
    panels: [
      { componentId: "GOAL_SUMMARY", priority: 100 },
      { componentId: "TIME_LOCATION", priority: 90 },
      { componentId: "CRITICAL_QUESTION", priority: 80 }
    ]
  },
  FNB_RETAIL: { archetype: "STORE_SUPPORT", title: "餐饮 / 零售现场", panels: BASE_PANELS },
  EVENT_EXHIBITION: { archetype: "EVENT_SUPPORT", title: "活动 / 展会支持", panels: BASE_PANELS },
  BUSINESS_PRO: { archetype: "BUSINESS_RECEPTION", title: "商务 / 专业服务", panels: BASE_PANELS },
  CONTENT_MARKETING: { archetype: "CONTENT_EXECUTION", title: "内容 / 营销执行", panels: BASE_PANELS },
  MOBILITY_ERRAND: { archetype: "ERRAND_RUN", title: "出行 / 跑腿", panels: BASE_PANELS },
  OTHER: { archetype: "GENERIC_DEMAND", title: "现实需求", panels: BASE_PANELS }
};

export function fallbackPlanFor(category: HardDemandCategory, goal?: string): UIPlan {
  const blueprint = BLUEPRINTS[category];
  return {
    uiPlanId: `uip_fallback_${category.toLowerCase()}`,
    schemaVersion: UI_PLAN_SCHEMA_VERSION,
    surface: "FULFILLMENT_WORKSPACE",
    context: "REQUESTER",
    demandCategory: category,
    taskArchetype: blueprint.archetype,
    title: blueprint.title,
    panels: blueprint.panels.map((panel) => ({ ...panel, dataRef: `fallback:${category.toLowerCase()}` }))
  };
}

// 不变式：7 个冻结类目全部具备 fallback（fallback.test.ts 守护）。
export function allFallbackCategories(): readonly HardDemandCategory[] {
  return HARD_DEMAND_CATEGORIES;
}

export const FALLBACK_CRITICAL_QUESTION: Record<HardDemandCategory, { questionId: string; question: string; options: string[] }> = {
  TRAVEL_LOCAL: {
    questionId: "q_time",
    question: "先确认一个关键事实：你的时间段是？",
    options: ["明天上午", "明天下午", "后天", "时间灵活"]
  },
  FNB_RETAIL: {
    questionId: "q_scene",
    question: "现场需要什么类型的支持？",
    options: ["开业/活动", "日常运营", "体验接待"]
  },
  EVENT_EXHIBITION: {
    questionId: "q_role",
    question: "需要什么角色到场？",
    options: ["接待/签到", "现场执行", "翻译"]
  },
  BUSINESS_PRO: {
    questionId: "q_scene",
    question: "商务场景是哪种？",
    options: ["拜访陪同", "口译", "接待安排"]
  },
  CONTENT_MARKETING: {
    questionId: "q_output",
    question: "内容产出是什么？",
    options: ["拍摄", "探店内容", "品牌活动记录"]
  },
  MOBILITY_ERRAND: {
    questionId: "q_task",
    question: "具体要办什么？",
    options: ["取送件", "排队", "代驾", "临时办事"]
  },
  OTHER: {
    questionId: "q_goal",
    question: "用一句话描述你最终想完成什么？",
    options: ["先聊聊，我来补充"]
  }
};
