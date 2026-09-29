import { describe, expect, it } from "vitest";
import { templatePriceToVND, describeSuggestError, groupCount, requiredProviderCount, momentPriceQuote, quoteToVND } from "./market-template-price";

// OPP-TEMPLATE-001: 卡片参考价（K 简写）→ 表单价格（完整 VND）。
// prefill 路径的唯一转换器 — 目录卡换价不改表单逻辑。
describe("templatePriceToVND", () => {
  it("converts K shorthand to full VND", () => {
    expect(templatePriceToVND("200K")).toBe("200,000₫");
    expect(templatePriceToVND("450K")).toBe("450,000₫");
    expect(templatePriceToVND("500K")).toBe("500,000₫");
  });
  it("handles fractional thousands exactly (no float drift)", () => {
    expect(templatePriceToVND("1.5K")).toBe("1,500₫");
    expect(templatePriceToVND("250.5K")).toBe("250,500₫");
  });
  it("trims whitespace before matching", () => {
    expect(templatePriceToVND(" 300K ")).toBe("300,000₫");
  });
  it("passes through non-K values untouched (already-VND or custom)", () => {
    expect(templatePriceToVND("1,500,000₫")).toBe("1,500,000₫");
    expect(templatePriceToVND("面议")).toBe("面议");
  });
  it("passes through lowercase k untouched (only canonical K cards convert)", () => {
    expect(templatePriceToVND("200k")).toBe("200k");
    expect(templatePriceToVND("200")).toBe("200");
  });
});

// OPP-SUGGEST-001: 生成失败的降级文案 — 每个 wire 错误码有明确提示，
// 未知码兜底通用文案，手选卡片始终可用。
describe("describeSuggestError", () => {
  it("maps each wire error code to a distinct hint", () => {
    expect(describeSuggestError("AI_NOT_CONFIGURED")).toBe("智能生成暂未开放，请从下面卡片里选。");
    expect(describeSuggestError("SUGGESTION_NO_MATCH")).toBe("没有匹配的场景，换个说法或直接选卡片。");
    expect(describeSuggestError("SUGGESTION_MALFORMED")).toBe("生成结果异常，请手选卡片。");
  });
  it("falls back to a generic retry line for unknown codes", () => {
    expect(describeSuggestError("network timeout")).toBe("生成失败，请手选卡片。");
    expect(describeSuggestError("")).toBe("生成失败，请手选卡片。");
  });
});

// OPP-CATALOG-001 (R58): Moment 引擎数学 — 人数档解析、搭配人数、
// 动态报价（含 perPair 与负 delta）、TraceID 格式。
describe("groupCount", () => {
  it("takes the upper bound of a range chip", () => {
    expect(groupCount("2 人")).toBe(2);
    expect(groupCount("3–4 人")).toBe(4);
    expect(groupCount("5–6 人")).toBe(6);
  });
  it("falls back to 1 when the chip has no digits", () => {
    expect(groupCount("不限")).toBe(1);
  });
});

describe("requiredProviderCount", () => {
  const fixed11 = { ratio: "1:1", ratioText: "固定 1:1", fixed: true };
  const group = { ratio: "≤ 3:1", ratioText: "最多 3 客户", fixed: false };
  it("fixed 1:1 needs one provider per customer", () => {
    expect(requiredProviderCount("3–4 人", fixed11)).toBe(4);
  });
  it("group moments need a single provider regardless of headcount", () => {
    expect(requiredProviderCount("3–4 人", group)).toBe(1);
  });
  it("missing policy degrades to a single provider", () => {
    expect(requiredProviderCount("2 人", undefined)).toBe(1);
  });
});

describe("momentPriceQuote", () => {
  const pricing = {
    duration: { "2 小时": 0, "3 小时": 90 },
    time: { "今晚 19:00": 20, "明天 15:00": 0 },
    group: { "1 人": 0, "2 人": 70 }
  };
  it("sums base + duration + time + group deltas", () => {
    const q = momentPriceQuote(200, { group: "2 人", time: "今晚 19:00", duration: "3 小时" }, pricing, [], 1);
    expect(q.perUnit).toBe(200 + 90 + 20 + 70);
    expect(q.total).toBe(q.perUnit);
  });
  it("keeps zero deltas out of the breakdown lines", () => {
    const q = momentPriceQuote(200, { group: "1 人", time: "明天 15:00", duration: "2 小时" }, pricing, [], 1);
    expect(q.addOns).toHaveLength(0);
    expect(q.perUnit).toBe(200);
  });
  it("includes preference add-ons and negative duration deltas", () => {
    const shortPricing = { duration: { "1 小时": -40, "2 小时": 0 } };
    const q = momentPriceQuote(200, { group: "1 人", time: "今晚 19:00", duration: "1 小时" }, shortPricing, [30, 20], 1);
    expect(q.addOns.find((x) => x.label === "1 小时")?.amount).toBe(-40);
    expect(q.perUnit).toBe(200 - 40 + 30 + 20);
  });
  it("multiplies per-pair cards by the provider count", () => {
    const perPair = { duration: { "3 小时": 0 }, perPair: true };
    const q = momentPriceQuote(450, { group: "4 人", time: "09:00–12:00", duration: "3 小时" }, perPair, [], 4);
    expect(q.perUnit).toBe(450);
    expect(q.total).toBe(1800);
  });
  it("degrades to base price without a pricing rule", () => {
    const q = momentPriceQuote(320, { group: "1 人", time: "20:00–22:00", duration: "2 小时" }, undefined, [], 1);
    expect(q.perUnit).toBe(320);
  });
});

// PUBLIC-NO-001：formatTraceId（客户端随机生成 PX-N/PX-O/PX-A 展示号）已删除 ——
// 成功页编号改由服务端分配（全数字、可查询），见 public-number.test.ts。
describe("quoteToVND", () => {
  it("converts K totals to full VND strings", () => {
    expect(quoteToVND(280)).toBe("280,000₫");
    expect(quoteToVND(1800)).toBe("1,800,000₫");
  });
});
