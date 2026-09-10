import { describe, it, expect } from "vitest";
import { OpportunityTemplateSchema, ListOpportunityTemplatesPayloadSchema } from "./index";

// OPP-TEMPLATE-001: 发布目录 wire 契约。目录卡必须完整 —
// 缺参考价/参考区间/服务标准任何一项都是死卡（表单既不能展示
// 参考区间，也不能预填价格和合规默认条款）。
describe("OpportunityTemplateSchema", () => {
  const base = {
    id: "coffee",
    group: "HOT",
    title: "喝咖啡",
    sub: "咖啡馆",
    icon: "coffee",
    mark: "",
    tags: ["咖啡", "咖啡馆"],
    price: "200K",
    range: "150–300K",
    standard: "公共咖啡馆见面 · 2 小时 · 现场消费双方自结。"
  };

  it("accepts a complete catalog card", () => {
    expect(OpportunityTemplateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects unknown groups", () => {
    expect(OpportunityTemplateSchema.safeParse({ ...base, group: "SPONSORED" }).success).toBe(false);
  });

  it("rejects cards missing publish defaults (price / range / standard / tags)", () => {
    for (const field of ["price", "range", "standard"] as const) {
      expect(OpportunityTemplateSchema.safeParse({ ...base, [field]: "" }).success).toBe(false);
    }
    expect(OpportunityTemplateSchema.safeParse({ ...base, tags: [] }).success).toBe(false);
  });

  it("requires a non-empty catalog payload", () => {
    const card = OpportunityTemplateSchema.parse(base);
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({ templates: [card] }).success).toBe(true);
    expect(ListOpportunityTemplatesPayloadSchema.safeParse({ templates: [] }).success).toBe(false);
  });
});
