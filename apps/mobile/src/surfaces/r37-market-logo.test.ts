import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const palette = readFileSync(new URL("./r37-type-palette.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./r37-opportunity-card.tsx", import.meta.url), "utf8");
const master = readFileSync(new URL("../components/market-type-logo.tsx", import.meta.url), "utf8");
const market = readFileSync(new URL("./market.tsx", import.meta.url), "utf8");

describe("MARKET-LOGO-SINGLE-TILE-001", () => {
  it("renders the shared scene taxonomy logos at the full visual size", () => {
    expect(palette).toContain("<MarketTypeLogo");
    expect(palette).not.toContain("order-type-logos/");
    expect(palette).not.toContain("pillLabel");
    expect(palette).not.toContain("pillSub");
    expect(palette).toContain('scroll: { gap: 3');
    expect(palette).toContain('accessibilityState={{ selected: active }}');
  });

  it("does not wrap opportunity logos in a second colored logo", () => {
    expect(card).toContain("<MarketTypeLogo");
    expect(card).not.toContain("order-type-logos/");
    expect(master).toContain("const SIZE = { FILTER: 42, CARD: 30 }");
    expect(master).toContain("const MASTER:");
    expect(master).not.toContain("translateX");
    expect(master).not.toContain("translateY");
    expect(master).toContain('import { SCENE_ACTIONS }');
    expect(master).toContain('coffee_photo: actionIcon("photo")');
    expect(master).toContain('walk_photo: actionIcon("city-walk")');
    expect(master).toContain('bilingual_store: actionIcon("translation")');
    expect(master).not.toContain("order-type-logos/");
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

// R37-DETAIL-001: 点「我想接」之后进的是订单详情。R37 那次只改了卡片和筛选
// palette，详情页原封不动 —— 卡片上是「标准订单类型 + 咖啡 + 拍照」，点进去
// 却变成英文 OPPORTUNITY kicker，视觉直接断掉。这里钉三件事：
//   1. 详情页头部真的用批准的类型 logo；
//   2. 英文 kicker 不许回来；
//   3. 卡片和详情共用同一张文案表（不然改了卡片详情页又漂移）。
describe("MARKET-R37-DETAIL-001", () => {
  it("carries the approved type logo into the order detail screen", () => {
    expect(market).toContain("<MarketTypeLogo");
    // 用同一个推断函数：卡片推断成「咖啡 + 拍照」、详情推断成别的类型，
    // 用户点进去会觉得看错了订单。
    expect(market).toContain("inferOpportunityTypeForFilter(opportunity)");
  });

  it("no longer labels the detail with the English OPPORTUNITY kicker", () => {
    expect(market).not.toContain(">OPPORTUNITY<");
    expect(market).toContain("标准订单类型");
  });

  it("shares one type-label table between card and detail", () => {
    expect(card).toContain("export const TYPE_LABEL");
    expect(market).toContain("TYPE_LABEL[detailType]");
  });
});
