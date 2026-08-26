import { describe, expect, it } from "vitest";
import { meOwnedRouteForLabel } from "./me-owned-routes";

describe("Me-owned routes", () => {
  it("cannot be redirected to a root surface by a managed menu action", () => {
    expect(meOwnedRouteForLabel("我的订单")).toBe("myorders");
    expect(meOwnedRouteForLabel("我的活动")).toBe("myactivities");
    expect(meOwnedRouteForLabel("收藏")).toBe("favorites");
    expect(meOwnedRouteForLabel("能力与可用时间")).toBe("available");
    expect(meOwnedRouteForLabel("关注与收藏")).toBeUndefined();
  });
});
