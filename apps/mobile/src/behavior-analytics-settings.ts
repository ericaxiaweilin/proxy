import type { SecureStorageDriver } from "./secure-session";

// TWIN-SIGNALS-001: 动态浏览统计开关（行为采集总闸）。
//
// ⛔ 2026-09-27 合规修正 —— 这个开关**原来是默认开，读不到也按开**。
// 那个默认现在是违法的，必须显式同意。
//
// 依据（一手条文）：
//   * Nghị định 356/2025/NĐ-CP Art. 4.1(l)：敏感个人数据包含
//     「追踪在电信服务、**社交网络**、在线通讯服务及其他网络空间服务中
//     的使用行为与活动的数据」。本模块管的正是这一类 —— 你看了哪条动态、
//     多图动态里具体看了哪张照片多久、放大过几次。
//   * 同法令 Art. 6.1：同意必须是**可验证的形式**；Art. 6.2：控制者须
//     **保存**同意，发生争议时**举证责任在控制者**。
//   * 同法令 Art. 6.3：**不得设置默认同意机制**，也不得用含糊、误导的
//     指示让数据主体分不清「同意」与「不同意」。
//   * Nghị định 330/2026/NĐ-CP Điều 39.1(a)：处理与已同意目的不符的
//     个人数据，罚 2,000–4,000 万越南盾。
//
// 所以语义是：
//   * 未显式设置过（读不到）= **不同意**，一个事件都不造；
//   * 读失败 = **不同意**（fail-closed）。旧注释担心「读失败就关会让一次
//     存储抖动永久饿死数据」—— 那是把数据管道的重要性排在数据主体权利
//     前面，顺序反了。用户重新打开开关就恢复，代价是可见且可撤销的；
//     而未经同意采集敏感数据是不可撤销的。
//
// 产品后果要认下来：新装用户/从未开过任何一项的用户，分身偏好 Ingredient
// 没有数据可吃。这是法律要求的起点，不是 bug —— 要数据就先拿到同意。

// COMP-CONSENT-PIPELINE-001（2026-10-08，用户）：同意必须**按目的分别给出**，
// 不能打包成一个总开关。理由是 Art. 6.3 之外更直接的一条 —— 「同意」只有在
// 数据主体知道它换来了什么的时候才是同意；推荐内容、分身洞察、运营逐人明细
// 是三件不同的事，捆在一起问「你要不要我们看你的浏览行为」，用户答的那一声
// 无法对应到任何**一个**目的，也就无法对应到服务端按目的的同意检查。
//
// 三个字面量必须和服务端一字不差（服务端只认这三个；旧的 BEHAVIOR_ANALYTICS
// 已退役，授予会回 CONSENT_PURPOSE_NOT_AVAILABLE）。不一致的后果很隐蔽：
// 用户以为开了，服务端仍然按 CONSENT_REQUIRED 拒收，而客户端埋点本来就是
// 静默失败 —— 于是「开了也没数据」，且不报任何错。
export const CONSENT_PURPOSES = ["RECOMMENDATION", "TWIN_INSIGHT", "OPERATOR_AUDIENCE_DETAIL"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** 同意动作的来源标记，写进服务端同意记录 —— 举证时能看出是 App 里点的。 */
export const BEHAVIOR_ANALYTICS_CONSENT_SOURCE = "APP_SETTINGS";

/**
 * 旧的总闸键。**永远不要把它读成同意**。
 *
 * 旧的同意不能带过来：它是一个同时覆盖三个用途的一次性表态，而服务端已经
 * 把 BEHAVIOR_ANALYTICS 退役 —— 用户必须在三个目的上**各自重新选择**一次。
 * 所以这里只在第一次写入新键时把它删掉（整洁），从不读它。
 */
const LEGACY_KEY = "proxy.behavior-analytics-enabled.v1";

/** 每个目的一个键。目的在键名里 ⇒ 读写天然互不影响，不可能串。 */
function keyFor(purpose: ConsentPurpose): string {
  return `proxy.consent.${purpose}.v1`;
}

export type BehaviorAnalyticsStore = {
  /**
   * 读**一个**目的的意愿。返回 `undefined` = 用户从未表达过意愿，
   * **不等于同意**；读不到 / 读出错也是 `undefined`（fail-closed）。
   */
  read(purpose: ConsentPurpose): Promise<boolean | undefined>;
  /** 只写**这一个**目的。别的目的一个字节都不动。 */
  write(purpose: ConsentPurpose, value: boolean): Promise<void>;
};

/**
 * 「到底要不要造行为事件」—— 唯一的采集前提判定。
 *
 * 三个目的**任一**为开就造事件（服务端再按目的分派），**全部**关着就一个
 * 都不造。fail-closed：读抛错一律当作全关。
 */
export async function anyCaptureEnabled(store: BehaviorAnalyticsStore): Promise<boolean> {
  try {
    for (const purpose of CONSENT_PURPOSES) {
      if ((await store.read(purpose)) === true) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function createBehaviorAnalyticsStore(driver: SecureStorageDriver): BehaviorAnalyticsStore {
  return {
    async read(purpose: ConsentPurpose): Promise<boolean | undefined> {
      try {
        const raw = await driver.getItem(keyFor(purpose));
        if (raw === "1") return true;
        if (raw === "0") return false;
        return undefined;
      } catch {
        return undefined;
      }
    },
    async write(purpose: ConsentPurpose, value: boolean): Promise<void> {
      await driver.setItem(keyFor(purpose), value ? "1" : "0");
      // 顺手清掉旧总闸的键。失败无所谓 —— 它从来不被读，删它只是整洁。
      await driver.deleteItem(LEGACY_KEY).catch(() => undefined);
    },
  };
}