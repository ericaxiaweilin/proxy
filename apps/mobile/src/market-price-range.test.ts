import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composePriceRange, parseOpportunityPrice, validateOpportunityPriceRange } from "./market-fixtures.js";

describe("composePriceRange (publish price range)", () => {
  it("joins min and max with an en dash", () => {
    expect(composePriceRange("1,500,000₫", "2,000,000₫")).toBe("1,500,000₫ – 2,000,000₫");
  });
  it("collapses to a single price when min equals max", () => {
    expect(composePriceRange("2,000,000₫", "2,000,000₫")).toBe("2,000,000₫");
  });
  it("returns min alone when max is empty", () => {
    expect(composePriceRange("2,000,000₫", "")).toBe("2,000,000₫");
  });
  it("returns max alone when min is empty", () => {
    expect(composePriceRange("", "2,000,000₫")).toBe("2,000,000₫");
  });
  it("returns empty when both are empty (FREE/TBD path)", () => {
    expect(composePriceRange("", "")).toBe("");
  });
  it("trims whitespace on both sides", () => {
    expect(composePriceRange("  1,500,000₫ ", " 2,000,000₫ ")).toBe("1,500,000₫ – 2,000,000₫");
  });
});

describe("paid opportunity order floor", () => {
  it("accepts the 100,000 VND boundary and supported labels", () => {
    expect(validateOpportunityPriceRange("100,000 VND")).toEqual({ ok: true });
    expect(validateOpportunityPriceRange("100K – 10M")).toEqual({ ok: true });
  });

  it("rejects any published price below the floor", () => {
    expect(validateOpportunityPriceRange("99,999₫")).toEqual({ ok: false, error: "机会订单最低保底为 100,000 VND" });
    expect(validateOpportunityPriceRange("99K – 200K").ok).toBe(false);
  });
});

// MARKET-PRICE-RANGE-PARSE-001: price 可能是**真区间**（发布页两框都填时
// composePriceRange 合成 "1,500,000₫ – 2,000,000₫"）。显示侧以前用
// `replace(/\D/g,"")` 取数字，把两端拼成 "15000002000000" —— 卡片上会显示成
// 14250001900–20250002700K。解析器必须按区间两端拆开读。
describe("parseOpportunityPrice (display-side budget parsing)", () => {
  it("reads a single plain price", () => {
    expect(parseOpportunityPrice("1,500,000₫")).toEqual({ low: 1_500_000, high: 1_500_000, hasRange: false });
  });
  it("does NOT concatenate the two ends of a real range", () => {
    // 拼起来是 15000002000000；正确答案是两个端点。
    expect(parseOpportunityPrice("1,500,000₫ – 2,000,000₫")).toEqual({ low: 1_500_000, high: 2_000_000, hasRange: true });
  });
  it("parses the K / M shorthand the publish validator accepts", () => {
    expect(parseOpportunityPrice("100K")).toEqual({ low: 100_000, high: 100_000, hasRange: false });
    expect(parseOpportunityPrice("100K – 10M")).toEqual({ low: 100_000, high: 10_000_000, hasRange: true });
  });
  it("reports hasRange=false when both ends are equal", () => {
    expect(parseOpportunityPrice("2,000,000₫ – 2,000,000₫")).toEqual({ low: 2_000_000, high: 2_000_000, hasRange: false });
  });
  it("returns zeros for TBD / FREE / empty (nothing to anchor on)", () => {
    expect(parseOpportunityPrice("")).toEqual({ low: 0, high: 0, hasRange: false });
    expect(parseOpportunityPrice("—")).toEqual({ low: 0, high: 0, hasRange: false });
  });
});

// 解析器对了还不够 —— 显示侧必须**用它**。以前三处各自 replace(/\D/g,"")，
// 修好解析器而没人调用等于没修。
describe("MARKET-PRICE-RANGE-PARSE-001 display call sites", () => {
  const card = readFileSync(fileURLToPath(new URL("./surfaces/r37-opportunity-card.tsx", import.meta.url)), "utf8");
  const detail = readFileSync(fileURLToPath(new URL("./surfaces/market.tsx", import.meta.url)), "utf8");

  it("the card parses a range instead of concatenating its two ends", () => {
    expect(card).toContain("parseOpportunityPrice");
    expect(card).not.toContain('budget.replace(/\\D/g, "")');
    // 单一预算 ×0.95 / ×1.35 外推出的区间：发布方从没填过这两框。
    expect(card).not.toContain("0.95");
    expect(card).not.toContain("1.35");
  });

  it("the detail shows a range only when the publisher actually entered two prices", () => {
    expect(detail).toContain("parseOpportunityPrice");
    expect(detail).not.toContain('budget.replace(/\\D/g, "")');
    // 那一格以前是拿单一预算造出来的；没有真区间就不该有这一格。
    expect(detail).not.toContain("Proxy 建议区间");
  });
});
