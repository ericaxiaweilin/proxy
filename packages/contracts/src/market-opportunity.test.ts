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
});