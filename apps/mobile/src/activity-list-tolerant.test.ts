import { describe, expect, it, vi } from "vitest";
import { parseActivityList } from "./activity-client";

// ACT-LIST-TOLERANT-001：一条脏活动不能让整个活动列表（For You / 市场 / 我的订单）变空。
const good = (id: string) => ({
  activityId: id, origin: "MERCHANT", title: id, time: "周日 10:00", people: "0 / 8 人", price: "0₫", moneyFlow: "FREE",
  priceLabel: "免费参加", consumption: "各自消费", venueIcon: "☕", venueName: "Three Beans · Cầu Giấy", venueSpend: "",
  venueType: "CAFE", venueTypeLabel: "咖啡", desc: "", benefit: "", qaCount: 0, interested: 0, joined: 0, capacity: 8, shares: 0,
});

describe("ACT-LIST-TOLERANT-001", () => {
  it("keeps valid activities and drops only the malformed ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const list = parseActivityList({ activities: [good("tb_sun_cupping"), { ...good("act_companion_1"), origin: "" }, good("tb_sat_buddy")] });
    expect(list.map((a) => a.activityId)).toEqual(["tb_sun_cupping", "tb_sat_buddy"]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it("an all-valid list passes through untouched", () => {
    expect(parseActivityList({ activities: [good("a"), good("b")] })).toHaveLength(2);
  });
});
