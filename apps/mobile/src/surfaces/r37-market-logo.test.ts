import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const palette = readFileSync(new URL("./r37-type-palette.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./r37-opportunity-card.tsx", import.meta.url), "utf8");
const master = readFileSync(new URL("../components/market-type-logo.tsx", import.meta.url), "utf8");

describe("MARKET-LOGO-SINGLE-TILE-001", () => {
  it("renders approved palette logos at the full visual size", () => {
    expect(palette).toContain("<MarketTypeLogo");
    expect(palette).not.toContain("order-type-logos/");
  });

  it("does not wrap opportunity logos in a second colored logo", () => {
    expect(card).toContain("<MarketTypeLogo");
    expect(card).not.toContain("order-type-logos/");
    expect(master).toContain("const SIZE = { FILTER: 42, CARD: 30 }");
    expect(master).toContain("const MASTER:");
  });
});
