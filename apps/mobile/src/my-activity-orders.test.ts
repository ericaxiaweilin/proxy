import { describe, expect, it } from "vitest";
import type { Activity, ActivityJoinOrder } from "@proxy/contracts";
import { activityOrderFields, formatJoinedAt, joinStateLabel, orderSnapshotFor, joinEntries } from "./my-activity-orders";

const activity = (over: Partial<Activity> = {}): Activity => ({
  activityId: "a1",
  title: "周日杯测小聚",
  time: "周日 10:00–11:30",
  venueName: "Three Beans · Cầu Giấy",
  joined: 3,
  capacity: 8,
  priceLabel: "免费参加",
  venueSpend: "45,000–90,000₫ / 人",
  ...over,
} as Activity);

describe("MY-ORDERS-DETAIL-001 我的订单 · 活动报名明细", () => {
  it("formats the order time in Vietnam local time", () => {
    // 07:30 UTC = 14:30 in Vietnam.
    expect(formatJoinedAt("2026-09-28T07:30:00Z")).toBe("9月28日 14:30");
    // 18:05 UTC = next day 01:05 in Vietnam.
    expect(formatJoinedAt("2026-09-28T18:05:00Z")).toBe("9月29日 01:05");
    expect(formatJoinedAt("not a date")).toBe("");
  });

  it("maps participation states, defaulting to confirmed", () => {
    expect(joinStateLabel(undefined).label).toBe("已确认");
    expect(joinStateLabel("CONFIRMED").label).toBe("已确认");
    expect(joinStateLabel("ATTENDED").label).toBe("已签到");
    expect(joinStateLabel("CANCELLED").label).toBe("已取消");
    expect(joinStateLabel("NO_SHOW")).toEqual({ label: "未到场", tone: "warn" });
  });

  it("lists every real field and omits missing ones instead of faking them", () => {
    const order: ActivityJoinOrder = { activityId: "a1", orderNo: "100260928143000000001", joinedAt: "2026-09-28T07:30:00Z" };
    expect(activityOrderFields(activity(), order)).toEqual([
      ["下单时间", "9月28日 14:30"],
      ["活动时间", "周日 10:00–11:30"],
      ["地点", "Three Beans · Cầu Giấy"],
      ["人数", "3 / 8 人"],
      ["费用", "免费参加"],
      ["到店消费", "45,000–90,000₫ / 人"],
    ]);
    const bare = activityOrderFields(activity({ venueSpend: "", capacity: 0, priceLabel: "" } as Partial<Activity>), undefined);
    expect(bare.map(([label]) => label)).toEqual(["活动时间", "地点", "人数"]);
  });

  it("sorts newest order first, keeping orderless rows last", () => {
    const orders: ActivityJoinOrder[] = [
      { activityId: "old", joinedAt: "2026-09-20T00:00:00Z" },
      { activityId: "new", joinedAt: "2026-09-28T00:00:00Z" },
    ];
    const list = [activity({ activityId: "none" }), activity({ activityId: "old" }), activity({ activityId: "new" })];
    expect(joinEntries(list, orders).map((e) => e.activity.activityId)).toEqual(["new", "old", "none"]);
  });

  // FOR-YOU-SLOT-001：同一场活动约了不同的小美是不同的单 —— 一张票一项，取消的不列。
  it("lists one entry per order, so two companions on one activity are two tickets", () => {
    const orders: ActivityJoinOrder[] = [
      { activityId: "tb", companionId: "mai", orderNo: "1", joinedAt: "2026-10-04T01:00:00Z" },
      { activityId: "tb", companionId: "linh", orderNo: "2", joinedAt: "2026-10-04T02:00:00Z" },
      { activityId: "tb", companionId: "trang", orderNo: "3", joinedAt: "2026-10-04T03:00:00Z", state: "CANCELLED" },
    ];
    const entries = joinEntries([activity({ activityId: "tb" })], orders);
    expect(entries.map((e) => e.order?.orderNo)).toEqual(["2", "1"]);
    expect(new Set(entries.map((e) => e.key)).size).toBe(2);
  });
});

describe("ORDER-RECIPE-001 我的订单照下单快照画", () => {
  const snapshot = {
    orderNo: "100260928143000000001",
    orderedAt: "2026-09-28T07:30:00Z",
    source: "FOR_YOU",
    activity: { activityId: "a1", title: "周日杯测小聚（下单时）", time: "周日 10:00–11:30", priceLabel: "免费参加", moneyFlow: "FREE", joined: 2, capacity: 8 },
    time: "周日 10:00–11:30",
    place: { name: "Three Beans · Cầu Giấy", area: "Cầu Giấy" },
    companion: { id: "u_nam", name: "Nam" },
  };
  it("uses the stored snapshot, not today's activity", () => {
    const order: ActivityJoinOrder = { activityId: "a1", orderNo: snapshot.orderNo, joinedAt: snapshot.orderedAt, snapshot };
    const got = orderSnapshotFor(activity({ title: "活动改名了", joined: 7 }), order);
    expect(got.saved).toBe(true);
    expect(got.snapshot.activity.title).toBe("周日杯测小聚（下单时）");
    const fields = activityOrderFields(activity({ title: "活动改名了", joined: 7 }), order);
    expect(fields).toContainEqual(["地点", "Three Beans · Cầu Giấy"]);
    expect(fields).toContainEqual(["同行", "Nam（系统推荐）"]);
    expect(fields).toContainEqual(["人数", "2 / 8 人"]);
  });
  it("falls back to the activity for pre-snapshot orders and says so", () => {
    const got = orderSnapshotFor(activity(), { activityId: "a1", orderNo: "100260920064844000001", joinedAt: "2026-09-20T00:00:00Z" });
    expect(got.saved).toBe(false);
    expect(got.snapshot.orderNo).toBe("100260920064844000001");
    expect(got.snapshot.companion).toBeUndefined();
  });
});
