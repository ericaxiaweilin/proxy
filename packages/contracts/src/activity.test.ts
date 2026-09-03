import { describe, it, expect } from "vitest";
import { ListActivitiesPayloadSchema } from "./index";

// Regression tripwire: server 端 activity_facet_integration_test.go
// seed 的 "Lifecycle Pin" 活动 venueType 是空字符串（"无 venue 限定"），
// mobile 端 ActivitySchema 必须接受空字符串，否则整个 ListActivities
// 在 zod parse 时整体拒绝 → market.tsx 显示"活动数据空"。
//
// v1.x history: 这个 schema mismatch 让 R15.x 一段时间内 market tab
// 看不到任何活动。修复：ActivitySchema.venueType 加 "" 成员。
describe("ActivitySchema accepts server-side Lifecycle Pin shape", () => {
  it("accepts an empty venueType for system-pinned activities", () => {
    const payload = {
      activities: [
        {
          activityId: "act_pg_1788424493120040000",
          origin: "PLATFORM" as const,
          title: "Lifecycle Pin",
          time: "Sat 19:00",
          people: "2-4",
          price: "¥88",
          consumption: "",
          venueIcon: "",
          venueName: "Proxy Lab",
          venueSpend: "",
          venueType: "" as const, // system-pinned: no venue type constraint
          venueTypeLabel: "",
          desc: "",
          benefit: "",
          qaCount: 0,
          interested: 1,
          joined: 2,
          capacity: 2,
          shares: 0
        }
      ],
      note: "活动读模型"
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("accepts a CAFE venueType for merchant activities", () => {
    const payload = {
      activities: [
        {
          activityId: "merchant_photo_day",
          origin: "MERCHANT" as const,
          title: "木光咖啡 · 周日下午拍照季",
          time: "周日 15:00–17:00",
          people: "6 / 10 人",
          price: "0₫",
          consumption: "各自消费",
          venueIcon: "☕",
          venueName: "木光咖啡 · 还剑郡",
          venueSpend: "90,000–140,000₫ / 人",
          venueType: "CAFE" as const,
          venueTypeLabel: "咖啡店",
          desc: "自然光座位已预留",
          benefit: "双人到店各点一杯",
          qaCount: 3,
          interested: 18,
          joined: 6,
          capacity: 10,
          shares: 7
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown venueType (e.g. typo)", () => {
    const payload = {
      activities: [
        {
          activityId: "x",
          origin: "PLATFORM" as const,
          title: "x",
          time: "",
          people: "",
          price: "",
          consumption: "",
          venueIcon: "",
          venueName: "",
          venueSpend: "",
          venueType: "BAR", // unknown
          venueTypeLabel: "",
          desc: "",
          benefit: "",
          qaCount: 0,
          interested: 0,
          joined: 0,
          shares: 0
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("accepts AI_PERSONA origin with aiPersona{Id,Name,Avatar} (R15.x compliance)", () => {
    // R15.x+: AI 数字人发起的活动必须带 aiPersona 三个字段，客户端用
    // 这三字段渲染 "AI 数字人" 徽标 + 头像 + 名字 (跟 X / Threads /
    // 抖音 / 小红书的 "AI 生成" 标注一致)。
    const payload = {
      activities: [
        {
          activityId: "proxy_coffee_weekend",
          origin: "AI_PERSONA" as const,
          title: "Proxy 周末咖啡企划",
          time: "本周六至周日",
          people: "特别企划",
          price: "0₫",
          consumption: "按门店场次",
          venueIcon: "☕",
          venueName: "木光咖啡 · 还剑郡",
          venueSpend: "90,000–140,000₫ / 人",
          venueType: "CAFE" as const,
          venueTypeLabel: "咖啡店",
          desc: "周末限定主题场次",
          benefit: "双人到店各点一杯",
          qaCount: 4,
          interested: 36,
          joined: 18,
          capacity: 24,
          shares: 12,
          aiPersonaId: "ai_001",
          aiPersonaName: "小美 · 周末企划",
          aiPersonaAvatar: "☕"
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activities[0].origin).toBe("AI_PERSONA");
      expect(result.data.activities[0].aiPersonaName).toBe("小美 · 周末企划");
    }
  });

  it("accepts TEST origin (server-side only, never sent to client)", () => {
    // R15.x+: TEST 用于 server 端测试 fixture 残留。List 端点会过滤掉，
    // 但 zod schema 仍要能解析 (防 server 端测试 build break)。
    const payload = {
      activities: [
        {
          activityId: "act_pg_fixture",
          origin: "TEST" as const,
          title: "Lifecycle Pin",
          time: "Sat 19:00",
          people: "2-4",
          price: "¥88",
          consumption: "",
          venueIcon: "",
          venueName: "Proxy Lab",
          venueSpend: "",
          venueType: "" as const,
          venueTypeLabel: "",
          desc: "",
          benefit: "",
          qaCount: 0,
          interested: 0,
          joined: 0,
          capacity: 2,
          shares: 0
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown origin (e.g. typo 'AI_PEROSNA')", () => {
    const payload = {
      activities: [
        {
          activityId: "x",
          origin: "AI_PEROSNA" as unknown as "PLATFORM", // intentional typo
          title: "x",
          time: "",
          people: "",
          price: "",
          consumption: "",
          venueIcon: "",
          venueName: "",
          venueSpend: "",
          venueType: "" as const,
          venueTypeLabel: "",
          desc: "",
          benefit: "",
          qaCount: 0,
          interested: 0,
          joined: 0,
          shares: 0
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
