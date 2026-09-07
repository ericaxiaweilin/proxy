import { describe, expect, it } from "vitest";
import { composePriceRange } from "./market-fixtures.js";

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
