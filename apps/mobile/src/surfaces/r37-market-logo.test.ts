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
    expect(master).not.toContain("translateX");
    expect(master).not.toContain("translateY");
  });

  it("uses real scene media first and labels generated fallbacks", () => {
    expect(card).toContain("opportunity.sceneImageUrl ? { uri: opportunity.sceneImageUrl }");
    expect(card).toContain("SAMPLE_SCENE_IMAGE[type]");
    expect(card).toContain("AI 样张");
  });

  it("uses a scene photo as a substantial mobile card anchor", () => {
    expect(card).toMatch(/thumb:\s*\{[^}]*flex:\s*1[^}]*minHeight:\s*136[^}]*width:\s*104/);
    expect(card).not.toMatch(/thumb:\s*\{[^}]*height:\s*88[^}]*width:\s*64/);
  });

  it("keeps the square scene photo flush to the card's top, bottom, and left edges", () => {
    expect(card).toContain('card: { backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12 }');
    expect(card).not.toMatch(/thumb:\s*\{[^}]*borderRadius/);
    expect(card).toContain('body: { flex: 1, minWidth: 0, paddingBottom: 12, paddingRight: 14, paddingTop: 12 }');
  });
});
