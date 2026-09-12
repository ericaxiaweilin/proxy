import { describe, expect, it } from "vitest";
import { ListAIAssistantsPayloadSchema } from "./ai-assistants";

// AI-ASSIST-001: 公开目录 wire 契约。5 条全字段 + AI 标签必填（防
// “长得像真人推荐”）；改名/换色三处同步由服务端单测锁。
describe("ListAIAssistantsPayloadSchema", () => {
  const one = {
    id: "ai_001",
    name: "平台 AI 小美 · 周末企划",
    role: "周末企划",
    color: "#7C5CFF",
    photo: "ai-personas/ai_001.svg",
    avatar: "☕",
    tagline: "周末去哪玩，我来组局",
    aiBadge: "AI 助手"
  };

  it("accepts a full 5-assistant directory", () => {
    const r = ListAIAssistantsPayloadSchema.safeParse({
      assistants: [one, { ...one, id: "ai_002" }, { ...one, id: "ai_003" }, { ...one, id: "ai_004" }, { ...one, id: "ai_005" }]
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing AI badge or empty display field", () => {
    expect(ListAIAssistantsPayloadSchema.safeParse({ assistants: [{ ...one, aiBadge: "" }] }).success).toBe(false);
    expect(ListAIAssistantsPayloadSchema.safeParse({ assistants: [{ ...one, photo: "" }] }).success).toBe(false);
    expect(ListAIAssistantsPayloadSchema.safeParse({ assistants: [] }).success).toBe(false);
  });
});
