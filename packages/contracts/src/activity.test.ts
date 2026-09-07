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
          moneyFlow: "FREE" as const,
          priceLabel: "免费",
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
          moneyFlow: "FREE" as const,
          priceLabel: "免费参加",
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
          moneyFlow: "FREE" as const,
          priceLabel: "免费",
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

  it("accepts PLATFORM origin with aiStatus=AI_GENERATED + aiActorKind=PLATFORM_AI (R16.x cold-start)", () => {
    // R16.x: AI 不能作为 origin 主体。冷启动活动由 Proxy 平台发布，AI
    // 助理在“起草”阶段是 PLATFORM_AI。UI 端同时读取 origin 徽标
    // (PLATFORM) + aiStatus (AI_GENERATED) + aiActorKind + aiPersona*。
    const payload = {
      activities: [
        {
          activityId: "proxy_coffee_weekend",
          origin: "PLATFORM" as const,
          title: "Proxy 周末咖啡企划",
          time: "本周六至周日",
          people: "特别企划",
          price: "0₫",
          moneyFlow: "FREE" as const,
          priceLabel: "免费参加",
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
          aiStatus: "AI_GENERATED" as const,
          aiActorKind: "PLATFORM_AI" as const,
          aiPersonaId: "ai_001",
          aiPersonaName: "平台 AI 小美 · 周末企划",
          aiPersonaAvatar: "☕"
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activities[0]!.origin).toBe("PLATFORM");
      expect(result.data.activities[0]!.aiStatus).toBe("AI_GENERATED");
      expect(result.data.activities[0]!.aiActorKind).toBe("PLATFORM_AI");
      expect(result.data.activities[0]!.aiPersonaName).toBe("平台 AI 小美 · 周末企划");
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
          moneyFlow: "FREE" as const,
          priceLabel: "免费",
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

  it("rejects an unknown origin (e.g. typo 'PLATFROM' / 'AI_PEROSNA')", () => {
    const payload = {
      activities: [
        {
          activityId: "x",
          origin: "AI_PEROSNA" as unknown as "PLATFORM", // R16.x 不再允许 AI_PERSONA；遗留 typo 同样拒绝
          title: "x",
          time: "",
          people: "",
          price: "",
          moneyFlow: "FREE" as const,
          priceLabel: "免费",
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

// ACT-MY-ACTIVITIES-001: R17.x “我的活动” 物化路径 wire
// schema。ListMyActivitiesPayloadSchema 必须要
// (1) created + joined 两个 array 均可为空 (匿名路径在
//     server 侧拒接), 但 schema 本身不限制 size;
// (2) 接受与 ListActivities 一样的 ActivitySchema, 所以
//     aiStatus / aiActorKind / ownerId / moneyFlow /
//     priceLabel 都要在 schema 上透传;
// (3) 拒接 origin='TEST' 的活动出现在“我的活动”里 (server
//     端 ListByOwner/ListByParticipant 已经过滤了)。
import { ListMyActivitiesPayloadSchema } from "./index";
describe("ListMyActivitiesPayloadSchema (R17.x my-activities wire)", () => {
  it("accepts created + joined populated (USER origin)", () => {
    const payload = {
      created: [
        {
          activityId: "act_mine_1",
          origin: "USER" as const,
          title: "我发起的咖啡局",
          time: "周六",
          people: "0 / 4 人",
          price: "0₫",
          moneyFlow: "FREE" as const,
          priceLabel: "免费参加",
          consumption: "各自承担到店消费",
          venueIcon: "☕",
          venueName: "木光",
          venueSpend: "",
          venueType: "CAFE" as const,
          venueTypeLabel: "咖啡店",
          desc: "我发起的",
          benefit: "",
          qaCount: 0,
          interested: 2,
          joined: 1,
          capacity: 4,
          shares: 0,
          ownerId: "me"
        }
      ],
      joined: [
        {
          activityId: "act_joined_1",
          origin: "MERCHANT" as const,
          title: "东交伴手手作课",
          time: "周日",
          people: "3 / 8 人",
          price: "60,000₫",
          moneyFlow: "PAY_TO_JOIN" as const,
          priceLabel: "60,000₫ / 人",
          consumption: "60,000₫ 纯手作费",
          venueIcon: "✶",
          venueName: "东交手作",
          venueSpend: "0₫",
          venueType: "RESTAURANT" as const,
          venueTypeLabel: "餐厅",
          desc: "手作课",
          benefit: "香片一份",
          qaCount: 1,
          interested: 5,
          joined: 3,
          capacity: 8,
          shares: 2
        }
      ],
      note: "我的活动: created = 我发起的, joined = 我参加的"
    };
    const result = ListMyActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toHaveLength(1);
      expect(result.data.joined).toHaveLength(1);
      expect(result.data.created[0]!.ownerId).toBe("me");
      expect(result.data.joined[0]!.moneyFlow).toBe("PAY_TO_JOIN");
    }
  });
  it("accepts empty created + joined (actor 没记录)", () => {
    const result = ListMyActivitiesPayloadSchema.safeParse({ created: [], joined: [] });
    expect(result.success).toBe(true);
  });
  it("rejects activities whose origin is TEST (not supposed to surface in 'my')", () => {
    // server 侧 ListByOwner/ListByParticipant 都会加 "origin<>'TEST'",
    // 所以 TEST 不会出现在响应里。如果 schema 接受 TEST 但 server
    // 返回了 TEST, 是 server 侧过滤漏了。这里 schema 同样拒绝
    // TEST 以作为 “server 也不应准它进入我的活动” 的 双重保险。
    const payload = {
      created: [
        {
          activityId: "act_test_leak",
          origin: "TEST" as any,
          title: "leak",
          time: "",
          people: "",
          price: "",
          moneyFlow: "FREE" as const,
          priceLabel: "免费",
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
          capacity: 0,
          shares: 0
        }
      ],
      joined: []
    };
    const result = ListMyActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

// AI-PERSONA-PHOTO-001: R17.x 平台 AI 5 角色带照片资产。
// Activity.aiPersonaPhoto (string, optional) 必发随 aiPersonaId
// 一起。不能 "看起来像真人" — 这是 AI-rendered avatar, 不是真人
// 拍摄。Schema 要 (1) 接受 photo 字段 (2) 不接受空 string
// 充数 (3) 接受不填 (USER / MERCHANT 发起的非 AI 活动).
describe("ActivitySchema.aiPersonaPhoto (R17.x platform AI 5 personas)", () => {
  it("accepts aiPersonaPhoto on a PLATFORM_AI GENERATED activity", () => {
    const payload = {
      activities: [
        {
          activityId: "proxy_coffee_weekend",
          origin: "PLATFORM" as const,
          title: "Proxy 周末咖啡企划",
          time: "本周六至周日",
          people: "特别企划",
          price: "0₫",
          moneyFlow: "FREE" as const,
          priceLabel: "免费参加",
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
          aiStatus: "AI_GENERATED" as const,
          aiActorKind: "PLATFORM_AI" as const,
          aiPersonaId: "ai_001",
          aiPersonaName: "平台 AI 小美 · 周末企划",
          aiPersonaAvatar: "☕",
          aiPersonaPhoto: "ai-personas/ai_001.svg"
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activities[0]!.aiPersonaPhoto).toBe("ai-personas/ai_001.svg");
    }
  });
  it("accepts activities without aiPersonaPhoto (USER / MERCHANT origin)", () => {
    // 不是所有活动都有 AI 角色。USER 发的活动不能“为了“资产
    // 完整 “被要求附 aiPersonaPhoto”。
    const payload = {
      activities: [
        {
          activityId: "user_coffee_walk",
          origin: "USER" as const,
          title: "我发起的咖啡局",
          time: "周六",
          people: "0 / 4 人",
          price: "0₫",
          moneyFlow: "FREE" as const,
          priceLabel: "免费参加",
          consumption: "各自承担",
          venueIcon: "☕",
          venueName: "木光",
          venueSpend: "",
          venueType: "CAFE" as const,
          venueTypeLabel: "咖啡店",
          desc: "",
          benefit: "",
          qaCount: 0,
          interested: 0,
          joined: 0,
          capacity: 4,
          shares: 0,
          aiStatus: "NONE" as const
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
  it("rejects an empty aiPersonaPhoto (no allow-list of '' allowed — photo is the wire contract)", () => {
    // Empty string 是 “看起来像真人” 风险的路由 — server 不应
    // 下发空 string 充数. zod 的 .min(1) 丢接.
    const payload = {
      activities: [
        {
          activityId: "ai_empty_photo",
          origin: "PLATFORM" as const,
          title: "x",
          time: "",
          people: "",
          price: "",
          moneyFlow: "FREE" as const,
          priceLabel: "免费",
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
          capacity: 0,
          shares: 0,
          aiStatus: "AI_GENERATED" as const,
          aiActorKind: "PLATFORM_AI" as const,
          aiPersonaId: "ai_001",
          aiPersonaName: "平台 AI 小美",
          aiPersonaAvatar: "☕",
          aiPersonaPhoto: "" // 拒绝: 不能下发空 string
        }
      ]
    };
    const result = ListActivitiesPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
