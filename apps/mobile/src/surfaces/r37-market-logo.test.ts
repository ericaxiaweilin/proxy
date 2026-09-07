import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const palette = readFileSync(new URL("./r37-type-palette.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./r37-opportunity-card.tsx", import.meta.url), "utf8");

describe("MARKET-LOGO-SINGLE-TILE-001", () => {
  it("renders approved palette logos at the full visual size", () => {
    expect(palette).toContain("height: 42, width: 42");
    expect(palette).toContain('backgroundColor: "transparent"');
  });

  it("does not wrap opportunity logos in a second colored logo", () => {
    expect(card).toContain("height: 30, width: 30");
    expect(card).toContain('backgroundColor: "transparent"');
  });
});
