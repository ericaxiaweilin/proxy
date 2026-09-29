import type { SecureStorageDriver } from "./secure-session";

// TWIN-SIGNALS-001: 动态浏览统计开关（行为采集总闸）。
//
// ⛔ 2026-09-27 合规修正 —— 这个开关**原来是默认开，读不到也按开**。
// 那个默认现在是违法的，必须显式同意。
//
// 依据（一手条文）：
//   * Nghị định 356/2025/NĐ-CP Art. 4.1(l)：敏感个人数据包含
//     「追踪在电信服务、**社交网络**、在线通讯服务及其他网络空间服务中
//     的使用行为与活动的数据」。本开关管的正是这一类 —— 你看了哪条动态、
//     多图动态里具体看了哪张照片多久、放大过几次。
//   * 同法令 Art. 6.1：同意必须是**可验证的形式**；Art. 6.2：控制者须
//     **保存**同意，发生争议时**举证责任在控制者**。
//   * 同法令 Art. 6.3：**不得设置默认同意机制**，也不得用含糊、误导的
//     指示让数据主体分不清「同意」与「不同意」。
//   * Nghị định 330/2026/NĐ-CP Điều 39.1(a)：处理与已同意目的不符的
//     个人数据，罚 2,000–4,000 万越南盾。
//
// 所以语义改成：
//   * 未显式设置过（读不到）= **不同意**，一个事件都不造；
//   * 读失败 = **不同意**（fail-closed）。旧注释担心「读失败就关会让一次
//     存储抖动永久饿死数据」—— 那是把数据管道的重要性排在数据主体权利
//     前面，顺序反了。用户重新打开开关就恢复，代价是可见且可撤销的；
//     而未经同意采集敏感数据是不可撤销的。
//
// 产品后果要认下来：新装用户/从未开过这个开关的用户，分身偏好 Ingredient
// 没有数据可吃。这是法律要求的起点，不是 bug —— 要数据就先拿到同意。
const KEY = "proxy.behavior-analytics-enabled.v1";

/**
 * COMP-PURPOSE-CONSENT-001：这个开关对应的**数据保护目的**。
 *
 * ⚠️ 必须和服务端 `localnet.PurposeBehaviorAnalytics` **完全一致**。
 * 两边不一致的后果很隐蔽：用户以为开了，服务端仍然按 CONSENT_REQUIRED 拒收，
 * 而客户端埋点本来就是静默失败 —— 于是「开了也没数据」，且不报任何错。
 * 门禁里有一条跨语言钉专门比对这两个字面量（COMP-PURPOSE-CONSENT-001）。
 */
export const BEHAVIOR_ANALYTICS_PURPOSE = "BEHAVIOR_ANALYTICS";

/** 同意动作的来源标记，写进服务端同意记录 —— 举证时能看出是 App 里点的。 */
export const BEHAVIOR_ANALYTICS_CONSENT_SOURCE = "APP_SETTINGS";

export type BehaviorAnalyticsStore = {
  /** 返回 `undefined` = 用户从未表达过意愿，**不等于同意**。 */
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
