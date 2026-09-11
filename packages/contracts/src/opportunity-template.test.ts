import { describe, it, expect } from "vitest";
import { OpportunityTemplateSchema, ListOpportunityTemplatesPayloadSchema, SuggestOpportunityTemplatePayloadSchema, MarketOpportunitySchema } from "./index";

// OPP-TEMPLATE-001: 发布目录 wire 契约。目录卡必须完整 —
// 缺参考价/参考区间/服务标准任何一项都是死卡（表单既不能展示
// 参考区间，也不能预填价格和合规默认条款）。
const baseTemplate = {
  id: "coffee",
  group: "HOT",
  title: "喝咖啡",
  sub: "咖啡馆",
  icon: "coffee",
  mark: "",
  tags: ["咖啡", "咖啡馆"],
  price: "200K",
  range: "150–300K",
  standard: "公共咖啡馆见面 · 2 小时 · 现场消费双方自结。"
};

describe("OpportunityTemplateSchema", () => {
  const base = baseTemplate;

  it("accepts a complete catalog card", () => {
    expect(OpportunityTemplateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects unknown groups", () => {
    expect(OpportunityTemplateSchema.safeParse({ ...base, group: "SPONSORED" }).success).toBe(false);
  });

  it("rejects cards missing publish defaults (price / range / standard / tags)", () => {
    for (const field of ["price", "range", "standard"] as const) {
      expect(OpportunityTemplateSchema.safeParse({ ...base, [field]: "" }).success).toBe(false);
    }
    expect(OpportunityTemplateSchema.safeParse({ ...base, tags: [] }).success).toBe(false);
  });

  it("requires a non-empty catalog payload", () => {
    const card = OpportunityTemplateSchema.parse(base);
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({ templates: [card] }).success).toBe(true);
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({ templates: [] }).success).toBe(false);
  });
});

// OPP-CATALOG-001 (R58): 目录引擎 wire 契约 — 分类轨道 + Moment 规格
// + 比例政策 + 动态定价。旧载荷（仅卡列表）必须继续过（向后兼容），
// 新字段必须全量可表达（发布流一屏数据源）。
describe("ListOpportunityTemplatesPayloadSchema — catalog engine (R58)", () => {
  const card = OpportunityTemplateSchema.parse(baseTemplate);
  const fullPayload = {
    templates: [card],
    categories: [{
      id: "hot", label: "热门", hint: "高频 Moment",
      items: ["coffee", "dining"]
    }],
    specs: [{
      templateId: "coffee",
      groups: ["1 人", "2 人"],
      times: ["今晚 19:00", "明天 15:00"],
      durations: ["1 小时", "2 小时"],
      places: ["附近", "西湖"]
    }],
    policies: [{
      templateId: "coffee",
      mode: "Moment" as const,
      ratio: "1:1",
      ratioText: "固定 1:1",
      fixed: true,
      groups: ["1 人"],
      prefs: [{
        key: "chat", label: "聊天",
        options: [{ value: "轻松聊天", add: 0 }, { value: "工作交流", add: 30 }]
      }]
    }],
    pricing: [{
      templateId: "coffee",
      duration: { "2 小时": 0, "3 小时": 90 },
      time: { "今晚 19:00": 20 },
      group: { "1 人": 0 },
      perPair: false
    }]
  };

  it("accepts the full R58 engine payload", () => {
    expect(ListOpportunityTemplatesPayloadSchema.safeParse(fullPayload).success).toBe(true);
  });

  it("rejects malformed engine dimensions", () => {
    // 空规格维度 = 表单渲染死项
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({
      ...fullPayload,
      specs: [{ templateId: "coffee", groups: [], times: [], durations: [], places: [] }]
    }).success).toBe(false);
    // 比例政策缺 ratioText = 表单徽章缺文案
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({
      ...fullPayload,
      policies: [{ ...fullPayload.policies[0], ratioText: "" }]
    }).success).toBe(false);
    // 未知 mode
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({
      ...fullPayload,
      policies: [{ ...fullPayload.policies[0], mode: "SPONSORED" }]
    }).success).toBe(false);
  });

  it("keeps the plain card-list payload valid (backward compat)", () => {
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({ templates: [card] }).success).toBe(true);
  });
});

// OPP-SUGGEST-001: 搜索"生成"的 wire 返回 — template 必是完整目录卡，
// reason 是匹配理由。
describe("SuggestOpportunityTemplatePayloadSchema", () => {
  it("accepts a real catalog card with a reason", () => {
    const parsed = SuggestOpportunityTemplatePayloadSchema.safeParse({
      template: baseTemplate, reason: "喝咖啡"
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects a template missing publish defaults", () => {
    expect(SuggestOpportunityTemplatePayloadSchema.safeParse({
      template: { ...baseTemplate, standard: "" }, reason: "x"
    }).success).toBe(false);
  });
});

// OPP-TARGETED-001: 读模型上的定向邀约标记 — 非空时表示只对目标人和
// owner 可见；缺省 = 公开卡（向后兼容：老 payload 不带此字段必须照常
// parse 通过）。
describe("MarketOpportunitySchema targetAccountId", () => {
  const publicCard = {
    id: "opp_1", title: "公开", shortTitle: "公开", theme: "喝咖啡", date: "周六", time: "15:00",
    location: "河内", price: "200,000₫", moneyFlow: "EARN" as const, priceLabel: "完成后你可获得",
    owner: "owner", ownerType: "PERSON" as const, match: "90%", responses: 0, posted: "刚刚",
    skills: "咖啡", verified: true, lens: ["NEARBY" as const], travel: null, signal: "", signalClass: "", countdown: ""
  };
  it("parses a public card without the field (backward compat)", () => {
    expect(MarketOpportunitySchema.safeParse(publicCard).success).toBe(true);
  });
  it("parses a directed card with a target", () => {
    expect(MarketOpportunitySchema.safeParse({ ...publicCard, targetAccountId: "user_linh" }).success).toBe(true);
  });
  it("rejects an empty-string target (server omits the field instead)", () => {
    expect(MarketOpportunitySchema.safeParse({ ...publicCard, targetAccountId: "" }).success).toBe(false);
  });
});
