// STORE-STATS-001 归因：完成订单时「这笔单在我哪家店完成」的选择器数据源。
//
// 抽成独立 .ts 是为了能被测 —— 放在 .tsx 里就只能靠 grep 文本钉着，而文本钉守不住
// 行为（「ACTIVE 过滤还在吗」「一个账号读失败会不会把别人的店一起丢掉」这类问题，
// 只有跑起来才知道）。
//
// 纪律和「我的店铺」hub 一致：只认 ACTIVE 企业；**逐个账号读，一个失败不中断**
// —— 丢掉能读到的店比报个错更糟，但失败也要如实置位，因为
// 「列表读不出来」和「你确实没有店」不能长得一样。
import type { BusinessClient } from "./business-client";

export type StoreOption = { id: string; name: string };

export type StoreOptionsResult = {
  rows: StoreOption[];
  // 至少有一次读取失败。true 时 rows 仍可能是非空的（部分成功）。
  // false + rows 为空 = 这个人确实没有店 —— 这两件事界面必须分开说。
  failed: boolean;
};

export async function loadStoreOptions(business: BusinessClient): Promise<StoreOptionsResult> {
  let accounts: Array<{ id: string }>;
  try {
    accounts = (await business.listMyAccounts()).filter((account) => account.status === "ACTIVE");
  } catch {
    // 连企业列表都读不到。和「没有店」同样是「没有可选项」，但必须置 failed，
    // 否则界面会把「读失败」静默说成「你没有店」。
    return { rows: [], failed: true };
  }
  const rows: StoreOption[] = [];
  let failed = false;
  for (const account of accounts) {
    try {
      for (const store of await business.listStores(account.id)) {
        rows.push({ id: store.id, name: store.name });
      }
    } catch {
      failed = true;
    }
  }
  return { rows, failed };
}
