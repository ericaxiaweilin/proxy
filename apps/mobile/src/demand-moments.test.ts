import { describe, expect, it } from "vitest";
import { PublishMarketOpportunityInputSchema } from "@proxy/contracts";
import { buildDemandPublishInput, defaultSpecsFor, MOMENT_TEMPLATES } from "./demand-moments";

describe("R58 demand wizard mapping", () => {
  it("ships six moment templates with defaults", () => {
    expect(MOMENT_TEMPLATES.map((template) => template.id)).toEqual(
      ["coffee", "meal", "ktv", "photo", "citywalk", "exhibition"]
    );
    for (const template of MOMENT_TEMPLATES) {
      expect(template.title.trim()).not.toBe("");
      expect(template.ratios).toContain(template.defaultRatio);
      expect(template.defaultPrice.trim()).not.toBe("");
    }
  });

  it("maps specs to a schema-valid publish input", () => {
    const template = MOMENT_TEMPLATES[0]!;
    const input = buildDemandPublishInput(template, {
      ...defaultSpecsFor(template),
      ratio: "1:1",
      time: "今晚 19:00",
      duration: "2 小时",
      place: "西湖",
      prefs: ["公共场所见面", "中文"],
      price: "200,000₫"
    });
    expect(input.title).toBe("喝咖啡");
    expect(input.moneyFlow).toBe("EARN");
    expect(input.time).toContain("今晚 19:00");
    expect(input.skills).toContain("公共场所见面");
    expect(PublishMarketOpportunityInputSchema.safeParse(input).success).toBe(true);
  });

  it("falls back without ever emitting empty required fields", () => {
    const template = MOMENT_TEMPLATES[3]!;
    const input = buildDemandPublishInput(template, {
      ratio: "", time: "", duration: "", place: "", prefs: [], price: "0₫", notes: ""
    });
    expect(PublishMarketOpportunityInputSchema.safeParse(input).success).toBe(true);
    expect(input.location).toBe(template.venue);
  });

  it("carries notes to desc only when present", () => {
    const template = MOMENT_TEMPLATES[0]!;
    const withNotes = buildDemandPublishInput(template, { ...defaultSpecsFor(template), notes: "需要会说中文" });
    expect(withNotes.desc).toBe("需要会说中文");
    const withoutNotes = buildDemandPublishInput(template, { ...defaultSpecsFor(template), notes: "   " });
    expect(withoutNotes.desc).toBeUndefined();
    expect(PublishMarketOpportunityInputSchema.safeParse(withNotes).success).toBe(true);
  });
});
