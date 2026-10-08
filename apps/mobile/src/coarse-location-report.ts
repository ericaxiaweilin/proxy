// 粗略位置上报（TWIN-SIGNALS-001 的位置分支）：纯函数，所有依赖由调用方注入。
//
// 为什么单独一个文件、而且**什么依赖都不自己拿**：这个函数要同时回答两件事
// ——「用户准不准采」和「拿到定位了吗」。这两件事在 App 里分别落在 secure
// storage（行为采集的三个目的）和 location consent 客户端（实时位置授权，
// FUZZY_REGION / PRECISE_GPS）上，还各自可能读失败。把它们做成参数，单测就
// 能把每一条规则钉死，不用碰 keychain、不用弹系统授权框。
//
// 四条规则，全部 fail-closed：
//   1. 最多 30 分钟一次 —— 这是行为追踪数据（Nghị định 356/2025 Art. 4.1(l)），
//      频次本身就是采集强度的一部分；没有节流就等于持续追踪。
//   2. 行为采集同意或实时位置同意读不到 / 读失败 ⇒ 一个坐标都不发，而且
//      **连定位都不去取**：没同意就发起定位请求，本身就越过了同意。
//   3. 取不到定位（getFix 返回 undefined）⇒ 不发，也不记「已发」。
//   4. 坐标只出现在 send 的两个参数里：不写日志、不落盘。服务端那一次 ~1km
//      网格化之后，原值不该在客户端再留第二份。

/** 上报间隔下限：30 分钟。 */
export const COARSE_LOCATION_MIN_INTERVAL_MS = 30 * 60 * 1000;

export type CoarseLocationReportDeps = {
  /** 毫秒时间戳。测试注入固定时钟，避免墙钟漂移改写断言。 */
  now: () => number;
  /** 上一次成功上报的时刻；undefined = 从没发过。 */
  lastSentAt: () => number | undefined;
  /** 记住这次上报时刻。注入实现负责持久化 —— 本模块不留任何状态。 */
  markSent: (at: number) => void;
  /** 三个行为采集目的里有没有开着任何一个（fail-closed 由实现负责）。 */
  captureEnabled: () => Promise<boolean>;
  /** 实时位置同意是否有效（FUZZY_REGION 或 PRECISE_GPS 任一）。 */
  locationConsentActive: () => Promise<boolean>;
  /** 取当前定位；取不到返回 undefined，不许编坐标。 */
  getFix: () => Promise<{ lat: number; lng: number } | undefined>;
  /** 上报。只在两道同意都成立、且真的拿到定位之后才被调用。 */
  send: (lat: number, lng: number) => Promise<void>;
};

// 一个会抛的「同意读取」等于「没同意」。写在这里而不是每个调用点各写一遍：
// 漏一处就是一次未授权上报，而且那种 bug 在真机上完全看不出来。
async function granted(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch {
    return false;
  }
}

export async function reportCoarseLocationIfDue(deps: CoarseLocationReportDeps): Promise<void> {
  const at = deps.now();
  const last = deps.lastSentAt();
  // 从没发过（undefined）就允许发。时钟倒流（at < last）算进「不到 30 分钟」
  // 而不是放行：节流的方向永远是收紧。
  if (last !== undefined && at - last < COARSE_LOCATION_MIN_INTERVAL_MS) return;
  if (!(await granted(deps.captureEnabled))) return;
  if (!(await granted(deps.locationConsentActive))) return;
  let fix: { lat: number; lng: number } | undefined;
  try {
    fix = await deps.getFix();
  } catch {
    fix = undefined;
  }
  if (!fix) return;
  try {
    await deps.send(fix.lat, fix.lng);
  } catch {
    // 发送失败不抛，也不 markSent —— 下次到期还会再试（真 client 内部已静默，
    // 这里再兜一层）。埋点永远不抛。
    return;
  }
  deps.markSent(at);
}