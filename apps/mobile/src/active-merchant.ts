// MERCHANT-ACTIVE-ACCOUNT-001（2026-10-04，用户：「商家-home 首页的招牌在售为什么还是空白，明明我的
// 测试账户完善了菜单与 hot 标志」）。
//
// 一个人可以有多个商家账号（经营主体）。以前商家端每个页面**各自**记一份当前账号、各自默认取
// 列表第一个：首页停在「Three Beans · Bắc Ninh」（没有菜单），而用户在店铺页给「Three Beans」
// （Cầu Giấy）加了 6 道菜和 HOT —— 首页当然是空的。
//
// 这里是纯规则（可单测）：当前账号 = 上次选过且还在列表里的那个，否则列表第一个。
// 持久化和跨页面通知在 active-merchant-store.ts。

// 首页「招牌与在售」的排序：只要在售的，HOT 在前，其余保持原顺序（店主排的菜单顺序）。
export function sortMenuForHome<T extends { available: boolean; isHot?: boolean | undefined }>(items: readonly T[]): T[] {
  const available = items.filter((item) => item.available);
  return [...available.filter((item) => item.isHot), ...available.filter((item) => !item.isHot)];
}

export function resolveActiveMerchant(accountIds: readonly string[], remembered: string | undefined): string | undefined {
  if (remembered && accountIds.includes(remembered)) return remembered;
  return accountIds[0];
}
