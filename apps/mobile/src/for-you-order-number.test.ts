import { describe, expect, it } from "vitest";
import { JoinActivityPayloadSchema, type CommandResult } from "@proxy/contracts";
import { ActivityCommandRejectedError, orderNoFromJoinRejection } from "./activity-client";

const activity = {
  activityId: "act_1", origin: "PLATFORM", title: "t", time: "周六", people: "1 / 2 人", price: "0₫", moneyFlow: "FREE", priceLabel: "免费",
  consumption: "AA", venueIcon: "☕", venueName: "Three Beans", venueSpend: "", venueType: "CAFE", venueTypeLabel: "咖啡", desc: "d", benefit: "b",
  qaCount: 0, interested: 0, joined: 1, capacity: 2, shares: 0, aiStatus: "NONE",
};

describe("ACT-ORDER-NO-001 For You order number reaches the UI", () => {
  it("the JoinActivity contract keeps the participation instead of silently stripping it", () => {
    const parsed = JoinActivityPayloadSchema.parse({
      activity, joined: true,
      participation: { activityId: "act_1", userId: "u1", state: "CONFIRMED", orderNo: "100260929100022012347" },
    });
    expect(parsed.participation?.orderNo).toBe("100260929100022012347");
    // 老服务端不发 participation 也得能解析。
    expect(JoinActivityPayloadSchema.parse({ activity, joined: true }).participation).toBeUndefined();
    // 不是全数字的「编号」（例如活动展示码）不能冒充订单编号。
    expect(() => JoinActivityPayloadSchema.parse({ activity, joined: true, participation: { activityId: "act_1", userId: "u1", state: "CONFIRMED", orderNo: "PX-A-260929-1234" } })).toThrow();
  });

  it("an already-placed order still surfaces its existing order number", () => {
    const rejected = (errorCode: string, safeDetails: Record<string, unknown>) =>
      new ActivityCommandRejectedError({ outcome: "REJECTED", error: { errorCode, messageKey: "activity.already_joined", category: "BUSINESS_STATE", retryability: "AFTER_USER_ACTION", safeDetails, correlationId: "c" } } as unknown as CommandResult);
    expect(orderNoFromJoinRejection(rejected("ACTIVITY_ALREADY_JOINED", { orderNo: "100260929100022012347", state: "CONFIRMED" }))).toBe("100260929100022012347");
    expect(orderNoFromJoinRejection(rejected("ACTIVITY_FULL", { orderNo: "100260929100022012347" }))).toBeUndefined();
    expect(orderNoFromJoinRejection(rejected("ACTIVITY_ALREADY_JOINED", { orderNo: "PX-A-260929-1234" }))).toBeUndefined();
    expect(orderNoFromJoinRejection(new Error("x"))).toBeUndefined();
  });

  // ORDER-NO-LEGACY-COMPAT-001：main 时代发出去的 16 位号（yyMMdd + 9 位序号 + Luhn）
  // 还在库里、还在用户手上。契约和客户端判据收成 `{21,}` 时：
  //   - zod parse 会**整体抛错**（不是丢字段）⇒ 这一屏直接报错；
  //   - orderNoFromJoinRejection 返回 undefined ⇒ 用户看到"没有编号"。
  // 干净库测不出来 —— 这条必须钉住。
  it("legacy 16-digit order numbers from main still parse and still surface", () => {
    const legacy = "2609290000012347";
    const parsed = JoinActivityPayloadSchema.parse({
      activity, joined: true,
      participation: { activityId: "act_1", userId: "u1", state: "CONFIRMED", orderNo: legacy },
      orderNo: legacy,
    });
    expect(parsed.participation?.orderNo).toBe(legacy);
    expect(parsed.orderNo).toBe(legacy);

    const rejected = (safeDetails: Record<string, unknown>) =>
      new ActivityCommandRejectedError({ outcome: "REJECTED", error: { errorCode: "ACTIVITY_ALREADY_JOINED", messageKey: "activity.already_joined", category: "BUSINESS_STATE", retryability: "AFTER_USER_ACTION", safeDetails, correlationId: "c" } } as unknown as CommandResult);
    expect(orderNoFromJoinRejection(rejected({ orderNo: legacy }))).toBe(legacy);

    // 放宽到 16 位不等于"什么都收"：15 位、带字母的仍旧拒。
    expect(() => JoinActivityPayloadSchema.parse({ activity, joined: true, orderNo: "260929000001234" })).toThrow();
    expect(orderNoFromJoinRejection(rejected({ orderNo: "26092900000123a7" }))).toBeUndefined();
  });
});
