import type { MessageKey, MessageVars } from "./i18n";
import type { InboxItem } from "./notification-client";

// NOTIF-BELL-001（2026-10-01，用户：「新增了铃铛提醒」）
//
// 原型 docs/design/references/Proxy_Home_Notifications_20261001_7b9953.html 的首页
// 顶栏多了一颗铃铛（角标写死 "9+"），点开是一页「通知」。
//
// 这个文件只放**纯函数**，界面在 surfaces/notification-center.tsx。
// 分开的理由跟 scene-shop-directory.ts 一样：vitest 能 import 纯 .ts，
// 不能 import .tsx —— 逻辑放在 .tsx 里就等于没测。
//
// ⚠️ 角标不是写死的 "9+"。原型那颗角标是**设计稿的示意数字**；这里数的是
//    `ListInbox` 回来的一行行 `read` 字段，没有未读就**不画角标**。

/** 未读条数。`ListInbox` 回的是全量（含已读），角标只数未读。 */
export function unreadCount(items: ReadonlyArray<Pick<InboxItem, "read">>): number {
  return items.filter((item) => !item.read).length;
}

/**
 * 角标文案。1–9 原样，>9 收成 "9+"（原型那个 9+ 的形状留着，但它是**数出来**的），
 * 0 条返回 undefined ⇒ 调用方不渲染角标，而不是渲染一个 "0"。
 */
export function badgeText(unread: number): string | undefined {
  if (!Number.isFinite(unread) || unread <= 0) return undefined;
  return unread > 9 ? "9+" : String(unread);
}

/**
 * 相对时间的**字典键** + 变量。
 *
 * 档位跟 composer-body 的 formatRelativeTime 完全一致（刚刚 / 分钟 / 小时 / 天 / 较早），
 * 但那一个只会说中文 —— 它的返回是 "3 分钟前" 这种字面量。I18N-SETTINGS-001 之后
 * 新界面不许再写死中文，所以这里只回键，由界面用 t() 取当前语言。
 *
 * 解析不出时间（脏数据）时按「刚刚」处理，不抛 —— 一条通知的时间戳坏掉不该让整页白屏。
 */
export function relativeTimeKey(iso: string, now: number = Date.now()): { key: MessageKey; vars?: MessageVars } {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return { key: "notifRelJustNow" };
  const diffMs = now - parsed;
  if (diffMs < 60_000) return { key: "notifRelJustNow" };
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return { key: "notifRelMinutes", vars: { n: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "notifRelHours", vars: { n: hours } };
  const days = Math.floor(hours / 24);
  if (days < 30) return { key: "notifRelDays", vars: { n: days } };
  return { key: "notifRelOlder" };
}

/**
 * 把 `ListInbox` 的结果按时间倒序（新的在上）。服务端目前已经 ORDER BY 了，
 * 但界面不该依赖一个没被钉住的排序 —— 这里再排一次，服务端顺序变了也不会翻页。
 */
export function sortNewestFirst(items: ReadonlyArray<InboxItem>): InboxItem[] {
  return [...items].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return tb - ta;
  });
}
