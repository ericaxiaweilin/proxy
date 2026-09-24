// R15 Component Registry（Proxy_R15_UI_Component_Registry_R1）的 Catalog 侧。
// 基于 json-render（Apache-2.0）：Catalog 用 zod 声明组件白名单与 props schema，
// 模型/fixture 只能引用这里登记的组件（Gate C）。description 同时是未来模型
// 生成提示词的语义来源（Phase 6），按 Registry R1 契约写明允许 Surface。
import { defineCatalog } from "@json-render/core";
// 子路径导出仅含 zod schema，不拉入 react-native 运行时（validator/测试可在 node 环境使用）。
import { schema } from "@json-render/react-native/schema";
import { z } from "zod";

export const CandidateSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  offerVnd: z.number(),
  fulfillmentRate: z.number(),
  satisfactionRate: z.number(),
  completedOrders: z.number(),
  // MATCH-LIVE-001：false = 还没有完成过订单（新人），界面显示「暂无记录」，不把 0% 画成履约很差。
  hasTrackRecord: z.boolean().optional(),
  languages: z.array(z.string()),
  proofs: z.array(z.string())
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const proxyCatalog = defineCatalog(schema, {
  components: {
    // ---- Request / Goal ----
    CATEGORY_ANCHOR: {
      props: z.object({
        category: z.string(),
        label: z.string(),
        tags: z.array(z.string())
      }),
      description: "需求大类锚点卡。允许 Surface：REQUESTER_HOME、FULFILLMENT_WORKSPACE。"
    },
    GOAL_SUMMARY: {
      props: z.object({
        title: z.string(),
        summary: z.string(),
        category: z.string(),
        archetype: z.string().nullable()
      }),
      description: "目标摘要：一句话复述用户最终想完成什么。允许 Surface：FULFILLMENT_WORKSPACE。"
    },
    CRITICAL_QUESTION: {
      props: z.object({
        questionId: z.string(),
        question: z.string(),
        options: z.array(z.string()),
        selectedAnswer: z.string().optional()
      }),
      description: "关键问题：模型只允许问最小必要澄清，选项化回答。允许 Surface：FULFILLMENT_WORKSPACE。"
    },
    KNOWN_FACTS: {
      props: z.object({ facts: z.array(z.string()) }),
      description: "已知事实列表（用户明确给出）。允许 Surface：FULFILLMENT_WORKSPACE。"
    },
    INFERRED_FACTS: {
      props: z.object({
        facts: z.array(z.object({ fact: z.string(), basis: z.string() }))
      }),
      description: "推断事实列表（含推断依据，可解释性）。允许 Surface：FULFILLMENT_WORKSPACE。"
    },
    // ---- Time / Place ----
    TIME_LOCATION: {
      props: z.object({
        startAt: z.string(),
        durationH: z.number(),
        location: z.string(),
        meetingPoint: z.string().nullable()
      }),
      description: "时间窗 + 地点 + 集合点。允许 Surface：FULFILLMENT_WORKSPACE、ORDER_EXECUTION。"
    },
    // ---- Human Supply ----
    CANDIDATE_RAIL: {
      // MATCH-LIVE-001：status 让面板如实说「在排 / 没人 / 出错 / 需要登录」，不再用演示人顶替。
      props: z.object({
        candidates: z.array(CandidateSchema),
        status: z.enum(["loading", "ready", "empty", "error", "unavailable"]).optional()
      }),
      description:
        "候选轨道：真实供给查询返回的候选卡（本单报价 + 履约/满意/单量 + 证明）。允许 Surface：FULFILLMENT_WORKSPACE。"
    },
    // ---- Commerce / Price ----
    CONTEXTUAL_QUOTE: {
      props: z.object({
        servicePriceVnd: z.number(),
        currency: z.string(),
        note: z.string(),
        breakdown: z.array(z.object({ item: z.string(), amountVnd: z.number() }))
      }),
      description: "本单情境报价：服务价格属于本单 Offer，不是人的长期标价。允许 Surface：FULFILLMENT_WORKSPACE。"
    },
    // ---- Conversation / Confirmation ----
    WAITING_STATUS: {
      props: z.object({ status: z.string(), message: z.string() }),
      description: "等待状态（等 Agent 应答 / 等确认）。允许 Surface：FULFILLMENT_WORKSPACE、ORDER_EXECUTION。"
    }
  },
  actions: {
    answer_critical_question: {
      params: z.object({ questionId: z.string(), answer: z.string().optional() }),
      description: "回答关键问题（Product State 更新，不写 Domain Truth）。"
    },
    select_candidate: {
      params: z.object({ agentId: z.string().optional() }),
      description: "选择候选 Agent（仅本地选择态，确认成交走后端命令）。"
    }
  }
});

// 组件白名单（validator 使用，Gate C）。
export const CATALOG_COMPONENT_IDS = [
  "CATEGORY_ANCHOR",
  "GOAL_SUMMARY",
  "CRITICAL_QUESTION",
  "KNOWN_FACTS",
  "INFERRED_FACTS",
  "TIME_LOCATION",
  "CANDIDATE_RAIL",
  "CONTEXTUAL_QUOTE",
  "WAITING_STATUS"
] as const;
export type ProxyComponentId = (typeof CATALOG_COMPONENT_IDS)[number];

export const CATALOG_ACTION_IDS = ["answer_critical_question", "select_candidate"] as const;
export type ProxyActionId = (typeof CATALOG_ACTION_IDS)[number];

export function isRegisteredComponent(value: string): value is ProxyComponentId {
  return (CATALOG_COMPONENT_IDS as readonly string[]).includes(value);
}
