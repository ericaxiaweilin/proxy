import { describe, expect, it } from "vitest";
import { deepLinkRouteFor, nudgeRouteFor } from "./notif-deeplink-route";

// NOTIF-DEEPLINK-ROUTE-001：只登记**真的有屏幕**的前缀。
// 反向臂是这一条的重点：把没有界面的前缀也映射出去 = 编目的地。
describe("NOTIF-DEEPLINK-ROUTE-001 深链落到真的存在的页面", () => {
  it("订单通知落到「我的订单」", () => {
    expect(deepLinkRouteFor("/orders/ord_1")).toEqual({ route: "myorders", id: "ord_1" });
  });

  it("邀请通知落到「我的场景」", () => {
    expect(deepLinkRouteFor("/invitations/inv_1")).toEqual({ route: "myscenes", id: "inv_1" });
  });

  it("带 scheme 的同一条链接也认（原生层给的是这种）", () => {
    expect(deepLinkRouteFor("proxy://orders/ord_1")).toEqual({ route: "myorders", id: "ord_1" });
    expect(deepLinkRouteFor("proxy://invitations/inv_1")).toEqual({ route: "myscenes", id: "inv_1" });
  });

  // MARKET-SELECT-NOTIFY-001: 「你被选中了」「附近有个单适合你」两条通知带的
  // 就是 /market/<opportunityId>。必须**连 id 一起**给 —— 只给路由等于把用户丢回
  // 市场列表让他自己找刚才那条通知，而 Fast 模式那单只给他 5 分钟。
  it("市场通知落到市场页，并把那一个订单的 id 一起带出去", () => {
    expect(deepLinkRouteFor("/market/opp_1")).toEqual({ route: "market", id: "opp_1" });
  });

  it("市场通知带 scheme 的同一条也认", () => {
    expect(deepLinkRouteFor("proxy://market/opp_1")).toEqual({ route: "market", id: "opp_1" });
  });

  it("没有界面的三个前缀不编目的地", () => {
    // /tasks /vouchers /offers 在 apps/mobile/src 下没有对应屏幕。
    // 把它们指到「我的订单」就是让用户点进去看到的不是通知里说的那件事。
    for (const link of ["/tasks/t_1", "/vouchers/v_1", "/offers/off_1"]) {
      expect(deepLinkRouteFor(link), link).toBeUndefined();
    }
  });

  // 只有前缀没有 id 时不能猜：既不能落到市场页，也不能落到某一单（详情要 id）。
  it("残缺的链接不跳（只有前缀没有 id 时不能猜成列表页）", () => {
    expect(deepLinkRouteFor("/orders")).toBeUndefined();
    expect(deepLinkRouteFor("/orders/")).toBeUndefined();
    expect(deepLinkRouteFor("/orders/   ")).toBeUndefined();
    expect(deepLinkRouteFor("/market")).toBeUndefined();
    expect(deepLinkRouteFor("/market/")).toBeUndefined();
    expect(deepLinkRouteFor("/market/   ")).toBeUndefined();
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

// NEXT-STEPS-001：新增的三个前缀。
//
// `/posts` 与 `/profiles` 服务端已在 notification.deepLinkPrefixes 里放行（评论 /
// 转发 / 关注通知）。`/nudge/<TARGET>` 是引导推送，指向**一个动作**而不是一条记录，
// 所以走单独的 nudgeRouteFor —— 不往 deepLinkRouteFor 里塞假 id，那会把「前缀必须
// 带 id」反过来糟蹋。
describe("NEXT-STEPS-001 /posts 与 /profiles 落到真的存在的页面", () => {
  it("帖子通知落动态流，并把那一条帖子的 id 一起带出去", () => {
    // 没有独立的「单条帖子」页（帖子就在动态流里），所以落点是动态流 + id：
    // 那个 id 是通知里说的那一条，不是「最近的一条」。
    expect(deepLinkRouteFor("/posts/post_1")).toEqual({ route: "feed", id: "post_1" });
    expect(deepLinkRouteFor("proxy://posts/post_1")).toEqual({ route: "feed", id: "post_1" });
  });

  it("关注 / 评论通知落对方主页（OtherProfileSurface 那一页）", () => {
    expect(deepLinkRouteFor("/profiles/user_1")).toEqual({ route: "otherprofile", id: "user_1" });
    expect(deepLinkRouteFor("proxy://profiles/user_1")).toEqual({ route: "otherprofile", id: "user_1" });
  });

  // 「前缀必须带 id」那条规则对新增的两个前缀一样成立：只有前缀时，落到动态流等于
  // 让用户自己在流里找刚才那条通知。
  it("只有前缀没有 id 时不跳（这两个前缀也一样）", () => {
    for (const link of ["/posts", "/posts/", "/posts/   ", "/profiles", "/profiles/", "/profiles/   "]) {
      expect(deepLinkRouteFor(link), link).toBeUndefined();
    }
  });
});

describe("NEXT-STEPS-001 /nudge/<TARGET> 落到那一步该去的页面", () => {
  it("四个 TARGET 各落到自己该去的那一页", () => {
    expect(nudgeRouteFor("/nudge/EDIT_PROFILE")).toEqual({ kind: "meSubPage", route: "personalmanage" });
    expect(nudgeRouteFor("/nudge/COMPOSE_POST")).toEqual({ kind: "feed" });
    expect(nudgeRouteFor("/nudge/PUBLISH_DEMAND")).toEqual({ kind: "market", tab: "OPPORTUNITY" });
    expect(nudgeRouteFor("/nudge/BROWSE_ACTIVITIES")).toEqual({ kind: "market", tab: "ACTIVITY" });
  });

  it("带 scheme 的同一条也认（原生层交上来的是这种）", () => {
    expect(nudgeRouteFor("proxy://nudge/COMPOSE_POST")).toEqual({ kind: "feed" });
  });

  // 引导深链指不出 TARGET 时「指向哪一步」是猜的 —— 不跳，只标已读。
  it("残缺的引导链接不跳；不认识的 TARGET 也不跳", () => {
    for (const link of ["/nudge", "/nudge/", "/nudge/   ", "/nudge/INVENT_TEAM", "/nudge/compose_post", "/nudge/COMPOSE_POST/extra"]) {
      expect(nudgeRouteFor(link), link).toBeUndefined();
    }
  });

  it("别的前缀不该从 nudgeRouteFor 出去（它只解 /nudge）", () => {
    for (const link of ["/orders/ord_1", "/market/opp_1", "/posts/post_1", "", "   ", "//evil.com/nudge/COMPOSE_POST", "https://evil.com/nudge/COMPOSE_POST"]) {
      expect(nudgeRouteFor(link), JSON.stringify(link)).toBeUndefined();
    }
  });
});
