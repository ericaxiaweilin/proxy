import { describe, expect, it } from "vitest";
import { composePriceRange, validateOpportunityPriceRange } from "./market-fixtures.js";

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
