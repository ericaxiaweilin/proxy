import { describe, it, expect } from "vitest";
import { ListMarketOpportunitiesPayloadSchema, MarketOpportunitySchema } from "./index";

// R16.x: MONEYFLOW-006 — wire schema 必须强制 MoneyFlow 4 选 1 +
// PriceLabel 必填。客户端不能传"裸金额"，服务端 normalizeOpportunityMoney
// 在 wire 上也不允许兜底：只有 server 内部默认 flow 才能推断。
describe("MarketOpportunitySchema enforces MoneyFlow + PriceLabel", () => {
  const base = {
    id: "opp_1",
    title: "test",
    shortTitle: "test",
    theme: "test",
    date: "today",
    time: "10:00",
    location: "hank",
    owner: "owner",
    ownerType: "BUSINESS" as const,
    match: "100%",
    responses: 0,
    posted: "now",
    skills: "x",
    verified: true,
    lens: ["NEARBY" as const],
    travel: 10,
    signal: "new",
    signalClass: "",
    countdown: "now",
    price: "1,000,000₫"
  };

  it("accepts EARN with price + label", () => {
    const r = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "EARN", priceLabel: "完成后你可获得" });
    expect(r.success).toBe(true);
  });

  it("accepts PAY with price + label", () => {
    const r = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "PAY", priceLabel: "你需支付" });
    expect(r.success).toBe(true);
  });

  it("accepts FREE with zero/empty price + label", () => {
    const r = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "FREE", price: "0₫", priceLabel: "免费" });
    expect(r.success).toBe(true);
  });

  it("accepts TBD with empty price + label", () => {
    const r = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "TBD", price: "", priceLabel: "费用待确认" });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown moneyFlow value", () => {
    const r = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "GARBAGE" as unknown as "EARN", priceLabel: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects empty priceLabel", () => {
    const r = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "EARN", priceLabel: "" });
    expect(r.success).toBe(false);
  });

  it("rejects empty moneyFlow (must be explicit 4-way)", () => {
    const r = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: undefined as unknown as "EARN", priceLabel: "完成后你可获得" });
    expect(r.success).toBe(false);
  });

  it("list rejects an opportunity that lacks moneyFlow", () => {
    const r = ListMarketOpportunitiesPayloadSchema.safeParse({
      opportunities: [{ ...base, moneyFlow: undefined as unknown as "EARN", priceLabel: "完成后你可获得" }]
    });
    expect(r.success).toBe(false);
  });

  it("PROFILE-READ-001: accepts an empty PERSON owner without failing the whole list", () => {
    const rows = [
      { ...base, moneyFlow: "EARN" as const, priceLabel: "完成后你可获得", owner: "", ownerType: "PERSON" as const },
      { ...base, moneyFlow: "EARN" as const, priceLabel: "完成后你可获得", owner: "Bonsaidon", ownerType: "BUSINESS" as const }
    ];
    const r = ListMarketOpportunitiesPayloadSchema.safeParse({ opportunities: rows });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.opportunities).toHaveLength(2);
      expect(r.data.opportunities[0]?.owner).toBe("");
    }
  });

  it("R58 demand notes: accepts optional desc, rejects over-500", () => {
    const ok = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "EARN" as const, priceLabel: "完成后你可获得", desc: "需要会说中文" });
    expect(ok.success).toBe(true);
    const without = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "EARN" as const, priceLabel: "完成后你可获得" });
    expect(without.success).toBe(true);
    const over = MarketOpportunitySchema.safeParse({ ...base, moneyFlow: "EARN" as const, priceLabel: "完成后你可获得", desc: "x".repeat(501) });
    expect(over.success).toBe(false);
  });
});

// MERCHANT-PUBLISH-001: 发布输入可带 merchantId（店 id），个人发布不带。
// 输出读模型 owner/ownerType 由服务端注记盖章（见 api 层测试）。
describe("PublishMarketOpportunityInputSchema merchant identity", () => {
  it("accepts an optional merchantId", async () => {
    const { PublishMarketOpportunityInputSchema } = await import("./index");
    const base = {
      title: "t", shortTitle: "t", theme: "t", date: "today", time: "10:00",
      location: "x", price: "100₫", moneyFlow: "EARN" as const,
      skills: "x", lens: ["NEARBY" as const]
    };
    expect(PublishMarketOpportunityInputSchema.safeParse(base).success).toBe(true);
    const withShop = PublishMarketOpportunityInputSchema.safeParse({ ...base, merchantId: "biz_1" });
    expect(withShop.success).toBe(true);
    if (withShop.success) expect(withShop.data.merchantId).toBe("biz_1");
    expect(PublishMarketOpportunityInputSchema.safeParse({ ...base, merchantId: "" }).success).toBe(false);
  });
});