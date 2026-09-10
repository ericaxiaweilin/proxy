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
