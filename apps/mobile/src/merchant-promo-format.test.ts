import { describe, expect, it } from "vitest";

import { formatPromoTerms, formatWan, promoReasonLine, PROMO_TEMPLATES, templateTerms } from "./merchant-promo-format";
import { parseScannedQr } from "./profile-qr";
import { couponQrValue, parseCouponQr, parseMerchantCreatorPromo, parsePairPromoViews, parsePromoQr } from "./supply-client";
import type { PairPromoView } from "./supply-client";

// MERCHANT-CREATOR-PROMO-002：专属码的纯格式化 + 扫码解析 + wire 解析。
describe("MERCHANT-CREATOR-PROMO-002 金额与条款的说法", () => {
  it("按万写，和原型一致", () => {
    expect(formatWan(100_000)).toBe("10万");
    expect(formatWan(25_000)).toBe("2.5万");
    expect(formatWan(8_000)).toBe("8,000");
    expect(formatWan(0)).toBe("0");
    expect(formatPromoTerms(500_000, 100_000)).toBe("满50万减10万");
    expect(formatPromoTerms(0, 50_000)).toBe("无门槛减5万");
  });
  it("快捷模板就是原型那三档", () => {
    expect(PROMO_TEMPLATES).toEqual(["无门槛减3万", "满30万减5万", "满50万减10万"]);
    expect(templateTerms(2)).toEqual({ minSpendVnd: 500_000, faceValueVnd: 100_000 });
  });
});

const view = (over: Partial<PairPromoView["promo"]>, note?: string): PairPromoView => ({
  promo: {
    code: "AN-WORKSHOP", merchantId: "m", merchantName: "Workshop", agentId: "a", creatorName: "An",
    terms: { minSpendVnd: 500_000, faceValueVnd: 50_000, displayText: "满50万减5万", scope: "STORE_CATEGORY", category: "餐饮", validUntil: "" },
    status: "ACTIVE", mode: "SUGGESTED", note: "",
    suggestion: { percentBp: 1000, minSpendVnd: 500_000, faceValueVnd: 50_000, basis: [
      { key: "followers", label: "粉丝量级", value: "1.2w（中腰部）", available: true, effectBp: 100 },
      { key: "repurchase", label: "历史复购率", value: "样本不足", available: false, effectBp: 0 },
    ] },
    ...over,
  },
  stats: { issued: 0, redeemed: 0, couponRedeem: 0, newCustomers: 0, spendVnd: 0, discountVnd: 0 },
  ...(note ? { lastChange: { id: "c", before: { minSpendVnd: 500_000, faceValueVnd: 50_000, displayText: "", scope: "STORE_ALL", category: "", validUntil: "" }, after: { minSpendVnd: 0, faceValueVnd: 50_000, displayText: "无门槛减5万", scope: "STORE_ALL", category: "", validUntil: "" }, mode: "MANUAL", note, changedAt: "2026-10-04" } } : {}),
});

describe("MERCHANT-CREATOR-PROMO-002 卡片上的「为什么是这个折扣」", () => {
  it("系统建议只列有数据的依据，不编", () => {
    expect(promoReasonLine(view({}))).toBe("基于 粉丝量级 1.2w（中腰部） 自动生成");
  });
  it("一条依据都没有时如实说数据不够", () => {
    expect(promoReasonLine(view({ suggestion: { percentBp: 800, minSpendVnd: 500_000, faceValueVnd: 40_000, basis: [] } }))).toContain("数据还不够");
  });
  it("手动调整说清系统建议了多少、改成了什么、为什么", () => {
    const manual = view({ mode: "MANUAL", terms: { minSpendVnd: 0, faceValueVnd: 50_000, displayText: "无门槛减5万", scope: "STORE_ALL", category: "", validUntil: "" } }, "她粉丝偏年轻");
    expect(promoReasonLine(manual)).toBe("系统建议 10%，已被商家手动改为 无门槛减5万：她粉丝偏年轻");
  });
});

describe("MERCHANT-CREATOR-PROMO-002 扫码", () => {
  it("扫一扫认出达人在某家店的专属码（只认带横杠的一对一码）", () => {
    expect(parseScannedQr("PROXY-PROMO:AN-WORKSHOP")).toEqual({ kind: "promo", code: "AN-WORKSHOP", name: "" });
    expect(parseScannedQr("PROXY-PROMO:LINH88")).toBeNull();
  });
  it("店员核销扫码：顾客券和专属码各认各的", () => {
    expect(parseCouponQr(couponQrValue("cp_abc123"))).toBe("cp_abc123");
    expect(parseCouponQr("PROXY-PROMO:AN-WORKSHOP")).toBeUndefined();
    expect(parsePromoQr("PROXY-PROMO:an-workshop")).toBe("AN-WORKSHOP");
    expect(parsePromoQr("PROXY-PROMO:LINH88")).toBe("LINH88");
  });
});

describe("MERCHANT-CREATOR-PROMO-002 wire 解析", () => {
  it("缺字段按保守值，坏行丢掉不拖垮整个列表", () => {
    expect(parseMerchantCreatorPromo({ code: "AN-WORKSHOP", agentId: "a" })?.terms.scope).toBe("STORE_ALL");
    expect(parseMerchantCreatorPromo({ code: "" })).toBeUndefined();
    const views = parsePairPromoViews([{ promo: { code: "AN-WORKSHOP", agentId: "a", mode: "MANUAL" }, stats: { newCustomers: 3 } }, { promo: {} }, null]);
    expect(views).toHaveLength(1);
    expect(views[0]!.promo.mode).toBe("MANUAL");
    expect(views[0]!.stats.newCustomers).toBe(3);
  });
});
