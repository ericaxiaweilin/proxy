// NEXT-STEPS-001：引导推送那条 `/nudge/<TARGET>` 的解法与上面那张表不同
// （它指向一个动作而不是一条记录），所以单独一个函数 nudgeRouteFor；但四个
// TARGET 落到哪一页，与首页那张卡共用同一份映射 —— 一处改，两处不漂。
import { targetToRoute, type NextStepDestination } from "./next-steps";

// NOTIF-DEEPLINK-ROUTE-001（2026-10-02）：通知深链 → App 内真实存在的目的地。
//
// 服务端 `isResolvableDeepLink` 放行前缀：
//   /orders /tasks /vouchers /offers /invitations
// MARKET-SELECT-NOTIFY-001 又加了 /market（「你被选中了」「附近有个单适合你」
// 两条通知带的深链），NEXT-STEPS-001 再加 /posts /profiles /nudge。但「深链合法」
// 不等于「App 里有这一页」—— 这里只登记 **真的有屏幕**的前缀：
//
//   /orders/<id>       → myorders（我的订单 · MyOrdersSurface，真界面）
//   /invitations/<id>  → myscenes（我的场景 · 我发起的 Scene 与收到的邀请）
//   /market/<id>       → market（市场 · MarketSurface，直达那一单订单详情）
//   /posts/<id>        → feed（动态。没有独立的「单条帖子」页 —— 帖子就在动态流里，
//                        所以落动态流并**带上 id**：那是通知里说的那一条）
//   /profiles/<id>     → otherprofile（对方主页 · OtherProfileSurface，feed 点头像
//                        与市场选人步点头像走的是同一页）
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
  "/market": "market",
  // NEXT-STEPS-001：评论 / 转发 / 关注通知带的深链，服务端已在
  // notification.deepLinkPrefixes 里放行。见上面注释里这两个前缀为什么落到
  // 动态流与对方主页。
  "/posts": "feed",
  "/profiles": "otherprofile"
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

/**
 * NEXT-STEPS-001：`/nudge/<TARGET>`（引导推送「发第一条动态」等）→ 落点。
 *
 * 与 deepLinkRouteFor **故意分开**，因为它的形状不同：引导深链指向的是**一个
 * 动作**（去动态发帖），不是**某一条记录**，所以没有 id 可带。若把它塞进上面那个
 * 函数，就只能给一个假 id —— 那是把「前缀必须带 id」那条规则反过来糟蹋。
 *
 * TARGET 用 targetToRoute 解（同一份映射，首页那张卡也用它）。解不出来的 TARGET
 * 返回 undefined：调用方退回「只标已读」，不跳。
 *
 * 形状仍然是**有 id 式的**：必须是 `/nudge/<TARGET>`，`/nudge` 与 `/nudge/` 都
 * 不认（残缺的引导链接指向哪一步是猜的）。
 */
export function nudgeRouteFor(link: string): NextStepDestination | undefined {
  const path = canonicalise(link);
  if (!path) return undefined;
  const slash = path.indexOf("/", 1);
  if (slash <= 1) return undefined;
  if (path.slice(0, slash) !== "/nudge") return undefined;
  const target = path.slice(slash + 1).trim();
  if (!target) return undefined;
  return targetToRoute(target);
}
