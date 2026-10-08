// NOTIF-DEEPLINK-ROUTE-001（2026-10-02）：通知深链 → App 内真实存在的目的地。
//
// 服务端 `isResolvableDeepLink` 放行前缀：
//   /orders /tasks /vouchers /offers /invitations
// MARKET-SELECT-NOTIFY-001 又加了 /market（「你被选中了」「附近有个单适合你」
// 两条通知带的深链）。但「深链合法」不等于「App 里有这一页」—— 这里只登记
// **真的有屏幕**的前缀：
//
//   /orders/<id>       → myorders（我的订单 · MyOrdersSurface，真界面）
//   /invitations/<id>  → myscenes（我的场景 · 我发起的 Scene 与收到的邀请）
//   /market/<id>       → market（市场 · MarketSurface，直达那一单订单详情）
//
// 其余三个（/tasks /vouchers /offers）**故意不登记** —— apps/mobile/src 下没有
// 对应屏幕。硬塞一个「看起来差不多」的页面（比如把 offer 指到「我的订单」）就是
// 编目的地：用户点进去看到的不是通知里说的那件事。宁可不跳（保持只标已读）。
//
// ⚠️ 加前缀的前提是先有那块界面，不是先有深链。
const DEEP_LINK_ROUTES: Record<string, string> = {
  "/orders": "myorders",
  "/invitations": "myscenes",
  // MARKET-SELECT-NOTIFY-001：「你被选中了」「附近有个单适合你」两条通知带的
  // 就是它。落点是 MarketSurface 里**已有的**订单详情页（OpportunityDetail）：
  // 报名过的人看到自己的申请（被选中时那颗「确认合作」按钮就在详情页里），
  // 没报名的看到「报名报价」。不新造一屏 —— 通知点进去看到的必须是平时那一页。
  "/market": "market"
};

/** 一条能落地的深链 = 目的地路由 + 通知指向的那条记录自己的 id。 */
export type DeepLinkRoute = {
  route: string;
  id: string;
};

/**
 * 深链 → App 内路由**加上那一条记录自己的 id**；没有对应屏幕时返回 undefined。
 *
 * 归一和服务端一致：`proxy://orders/x` 和 `/orders/x` 是同一条 ——
 * 原生层（Universal Link / 通知 payload）给的是带 scheme 的那种。
 *
 * 为什么带 id：只有路由名不够用。「附近有个单适合你」指的是**某一个**订单，
 * 只把用户丢进市场列表等于让用户自己在列表里找那条刚推给他的通知 ——
 * 落地必须指向通知里说的那件事。所以调用方拿到 id 之后自己决定怎么用它
 * （myorders / myscenes 目前只是进列表页，不需要 id；market 要用）。
 *
 * 返回 undefined **不是**错误：调用方应当退回「只标已读」，
 * 而不是弹一个「页面不存在」。
 */
export function deepLinkRouteFor(link: string): DeepLinkRoute | undefined {
  const path = canonicalise(link);
  if (!path) return undefined;
  const slash = path.indexOf("/", 1);
  // 必须带 id：只有前缀（`/orders`）说明这条链接本来就残缺，跳列表页是猜。
  if (slash <= 1) return undefined;
  const prefix = path.slice(0, slash);
  const id = path.slice(slash + 1).trim();
  if (!id) return undefined;
  const route = DEEP_LINK_ROUTES[prefix];
  if (!route) return undefined;
  return { route, id };
}

function canonicalise(link: string): string {
  const raw = link.trim();
  if (raw === "" || !raw.startsWith("/")) {
    // 只认 `proxy://` 这一种 scheme（app.json 里写的就是它）。
    const marker = "proxy://";
    const at = raw.toLowerCase().indexOf(marker);
    if (at < 0) return "";
    const rest = raw.slice(at + marker.length);
    return rest.startsWith("/") ? rest : "/" + rest;
  }
  // 站内路径：`//evil.com/...` 这种协议相对地址不是我们的链接。
  if (raw.startsWith("//")) return "";
  return raw;
}
