// NOTIF-DEEPLINK-ROUTE-001（2026-10-02）：通知深链 → App 内真实存在的目的地。
//
// 服务端 `isResolvableDeepLink` 放行五个前缀：
//   /orders /tasks /vouchers /offers /invitations
// 但「深链合法」不等于「App 里有这一页」。这里只登记**真的有屏幕**的前缀：
//
//   /orders/<id>       → myorders（我的订单 · MyOrdersSurface，真界面）
//   /invitations/<id>  → myscenes（我的场景 · 我发起的 Scene 与收到的邀请）
//
// 其余三个（/tasks /vouchers /offers）**故意不登记** —— apps/mobile/src 下没有
// 对应屏幕。硬塞一个「看起来差不多」的页面（比如把 offer 指到「我的订单」）就是
// 编目的地：用户点进去看到的不是通知里说的那件事。宁可不跳（保持只标已读）。
//
// ⚠️ 加前缀的前提是先有那块界面，不是先有深链。
const DEEP_LINK_ROUTES: Record<string, string> = {
  "/orders": "myorders",
  "/invitations": "myscenes"
};

/**
 * 深链 → App 内路由；没有对应屏幕时返回 undefined。
 *
 * 归一和服务端一致：`proxy://orders/x` 和 `/orders/x` 是同一条 ——
 * 原生层（Universal Link / 通知 payload）给的是带 scheme 的那种。
 *
 * 返回 undefined **不是**错误：调用方应当退回「只标已读」，
 * 而不是弹一个「页面不存在」。
 */
export function deepLinkRouteFor(link: string): string | undefined {
  const path = canonicalise(link);
  if (!path) return undefined;
  const slash = path.indexOf("/", 1);
  // 必须带 id：只有前缀（`/orders`）说明这条链接本来就残缺，跳列表页是猜。
  if (slash <= 1) return undefined;
  const prefix = path.slice(0, slash);
  const id = path.slice(slash + 1).trim();
  if (!id) return undefined;
  return DEEP_LINK_ROUTES[prefix];
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
