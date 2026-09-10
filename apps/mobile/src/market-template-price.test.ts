import { describe, expect, it } from "vitest";
import { templatePriceToVND } from "./market-template-price";

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
