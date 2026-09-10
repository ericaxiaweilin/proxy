import { describe, expect, it } from "vitest";
import { templatePriceToVND, describeSuggestError } from "./market-template-price";

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
