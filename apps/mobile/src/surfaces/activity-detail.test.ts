import { describe, expect, it } from "vitest";
import { activityAIDisclosure, activityMoneySummary } from "./activity-detail-model";

describe("activity detail responsibility and money direction", () => {
  it("shows the direction label before the amount", () => {
    expect(activityMoneySummary({ price: "500,000₫", priceLabel: "参加后你可获得" })).toBe("参加后你可获得 · 500,000₫");
  });

  it("states that generated content is reviewed and AI cannot transact", () => {
    const disclosure = activityAIDisclosure({
      aiStatus: "AI_GENERATED",
      aiActorKind: "PLATFORM_AI",
      aiPersonaName: "平台 AI 小美"
    });
    expect(disclosure).toContain("发布方审核并承担责任");
    expect(disclosure).toContain("AI 不能报名、接单或收付款");
  });

  it("does not add an AI disclosure to human-authored activity", () => {
    expect(activityAIDisclosure({ aiStatus: "NONE" })).toBeUndefined();
  });
});
