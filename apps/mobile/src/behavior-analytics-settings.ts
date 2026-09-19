import type { SecureStorageDriver } from "./secure-session";

// TWIN-SIGNALS-001: 动态浏览统计开关（行为采集总闸）。
//
// 默认开 —— 分身偏好 Ingredient 靠它，没有数据引擎就是空转。
// 这个默认是产品决策不是暗度陈仓：设置页「隐私与数据」里有一整行开关+
// 一句话说明，一键可关；关掉后上报函数直接短路，连事件都不造。
// 未显式设置过（读不到）= 开，和默认一致；读失败也按开处理 ——
// 读失败就关会让一次存储抖动永久饿死数据，且用户并没有表达过意愿。
const KEY = "proxy.behavior-analytics-enabled.v1";

export type BehaviorAnalyticsStore = {
  read(): Promise<boolean | undefined>;
  write(value: boolean): Promise<void>;
};

export function createBehaviorAnalyticsStore(driver: SecureStorageDriver): BehaviorAnalyticsStore {
  return {
    async read(): Promise<boolean | undefined> {
      try {
        const raw = await driver.getItem(KEY);
        if (raw === "1") return true;
        if (raw === "0") return false;
        return undefined;
      } catch {
        return undefined;
      }
    },
    async write(value: boolean): Promise<void> {
      await driver.setItem(KEY, value ? "1" : "0");
    },
  };
}
