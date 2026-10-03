import { describe, expect, it } from "vitest";
import { deepLinkRouteFor } from "./notif-deeplink-route";

// NOTIF-DEEPLINK-ROUTE-001：只登记**真的有屏幕**的前缀。
// 反向臂是这一条的重点：把没有界面的前缀也映射出去 = 编目的地。
describe("NOTIF-DEEPLINK-ROUTE-001 深链落到真的存在的页面", () => {
  it("订单通知落到「我的订单」", () => {
    expect(deepLinkRouteFor("/orders/ord_1")).toBe("myorders");
  });

  it("邀请通知落到「我的场景」", () => {
    expect(deepLinkRouteFor("/invitations/inv_1")).toBe("myscenes");
  });

  it("带 scheme 的同一条链接也认（原生层给的是这种）", () => {
    expect(deepLinkRouteFor("proxy://orders/ord_1")).toBe("myorders");
    expect(deepLinkRouteFor("proxy://invitations/inv_1")).toBe("myscenes");
  });

  it("没有界面的三个前缀不编目的地", () => {
    // /tasks /vouchers /offers 在 apps/mobile/src 下没有对应屏幕。
    // 把它们指到「我的订单」就是让用户点进去看到的不是通知里说的那件事。
    for (const link of ["/tasks/t_1", "/vouchers/v_1", "/offers/off_1"]) {
      expect(deepLinkRouteFor(link), link).toBeUndefined();
    }
  });

  it("残缺的链接不跳（只有前缀没有 id 时不能猜成列表页）", () => {
    expect(deepLinkRouteFor("/orders")).toBeUndefined();
    expect(deepLinkRouteFor("/orders/")).toBeUndefined();
    expect(deepLinkRouteFor("/orders/   ")).toBeUndefined();
  });

  it("站外地址与空串不认", () => {
    for (const link of ["", "   ", "//evil.com/orders/1", "https://evil.com/orders/1", "javascript:alert(1)"]) {
      expect(deepLinkRouteFor(link), JSON.stringify(link)).toBeUndefined();
    }
  });

  it("路由表里没有的前缀不认", () => {
    expect(deepLinkRouteFor("/wallet/w_1")).toBeUndefined();
  });
});
