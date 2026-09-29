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
      participation: { activityId: "act_1", userId: "u1", state: "CONFIRMED", orderNo: "2609290000012347" },
    });
    expect(parsed.participation?.orderNo).toBe("2609290000012347");
    // 老服务端不发 participation 也得能解析。
    expect(JoinActivityPayloadSchema.parse({ activity, joined: true }).participation).toBeUndefined();
    // 不是全数字的「编号」（例如活动展示码）不能冒充订单编号。
    expect(() => JoinActivityPayloadSchema.parse({ activity, joined: true, participation: { activityId: "act_1", userId: "u1", state: "CONFIRMED", orderNo: "PX-A-260929-1234" } })).toThrow();
  });

  it("an already-placed order still surfaces its existing order number", () => {
    const rejected = (errorCode: string, safeDetails: Record<string, unknown>) =>
      new ActivityCommandRejectedError({ outcome: "REJECTED", error: { errorCode, messageKey: "activity.already_joined", category: "BUSINESS_STATE", retryability: "AFTER_USER_ACTION", safeDetails, correlationId: "c" } } as unknown as CommandResult);
    expect(orderNoFromJoinRejection(rejected("ACTIVITY_ALREADY_JOINED", { orderNo: "2609290000012347", state: "CONFIRMED" }))).toBe("2609290000012347");
    expect(orderNoFromJoinRejection(rejected("ACTIVITY_FULL", { orderNo: "2609290000012347" }))).toBeUndefined();
    expect(orderNoFromJoinRejection(rejected("ACTIVITY_ALREADY_JOINED", { orderNo: "PX-A-260929-1234" }))).toBeUndefined();
    expect(orderNoFromJoinRejection(new Error("x"))).toBeUndefined();
  });
});
