import {
  anyCaptureEnabled,
  createBehaviorAnalyticsStore,
  type BehaviorAnalyticsStore
} from "./behavior-analytics-settings";
import type { LocalNetClient } from "./localnet-client";

// TWIN-SIGNALS-001: 曝光埋点 helper。Analytics 不是 Truth：
// - 采集前提是**用户显式同意**（隐私与数据 → 动态浏览统计，三个目的各自
//   独立、全部默认关）；没同意、没设置过、读失败 —— 一个事件都不造
//   （见 behaviorAnalyticsEnabled）；
// - 发送失败由 LocalNetClient.recordPostImpression 内部静默，调用方用
//   void 触发，不用等；
// - 停留封顶 5 分钟 —— 切后台忘关、息屏都只记 5 分钟，不造垃圾数据。
const MAX_WATCH_MS = 5 * 60 * 1000;

// 默认 store 懒加载：native-secure-storage 拖进 react-native，顶层静态
// import 会让 vitest 在 collect 期就炸（单测只走注入的 store，从不调这里）。
let defaultStore: BehaviorAnalyticsStore | undefined;
async function getDefaultStore(): Promise<BehaviorAnalyticsStore> {
  if (!defaultStore) {
    const { nativeSecureStorageDriver } = await import("./native-secure-storage");
    defaultStore = createBehaviorAnalyticsStore(nativeSecureStorageDriver);
  }
  return defaultStore;
}

export function beginPostView(): number {
  return Date.now();
}

// MEDIA-DWELL-001: 单张照片停留计时跟帖子停留计时是同一个"开始时刻"概念
// （Date.now()），没有必要另起一个函数名——调用方传给 endMediaView 就行。
export const beginMediaView = beginPostView;

async function behaviorAnalyticsEnabled(store?: BehaviorAnalyticsStore): Promise<boolean> {
  try {
    // TWIN-SIGNALS-001 fix: `store ?? getDefaultStore()` is a union of
    // `BehaviorAnalyticsStore | Promise<BehaviorAnalyticsStore>` — awaiting
    // the whole `.read()` call left the Promise branch un-awaited before
    // `.read()` was accessed on it, which doesn't exist on a Promise.
    const activeStore = store ?? await getDefaultStore();
    // ⛔ 2026-09-27 合规修正：原来是 `!== false`（读不到 / 读失败 = 采集）。
    // Nghị định 356/2025 Art. 6.3 禁止默认同意机制，Art. 4.1(l) 把社交网络上的
    // 行为追踪数据列为**敏感个人数据**。所以这里必须 fail-closed：
    // 只有用户**显式开过**某一项（读到 "1"）才采集，其余一律不采集。
    //
    // COMP-CONSENT-PIPELINE-001（2026-10-08）：同意拆成三个目的之后，
    // 这里问的不再是「那个开关开了吗」而是「三个目的里有没有至少一个
    // 开着」。事件本身不记目的（那是服务端按目的分派的事），所以客户端
    // 只需要这个「有没有」的答案 —— 这也是 anyCaptureEnabled fail-closed
    // 的原因：任何一项读不出来都当没开。
    return await anyCaptureEnabled(activeStore);
  } catch {
    return false;
  }
}

export async function endPostView(
  localNet: Pick<LocalNetClient, "recordPostImpression">,
  postId: string,
  startedAt: number,
  store?: BehaviorAnalyticsStore
): Promise<void> {
  if (!postId) return;
  if (!(await behaviorAnalyticsEnabled(store))) return;
  const watchMs = Math.min(Math.max(0, Date.now() - startedAt), MAX_WATCH_MS);
  try {
    await localNet.recordPostImpression(postId, watchMs);
  } catch {
    // 双保险：真正的 client 内部已经静默，这里再兜一层 —— 埋点永远不抛。
  }
}

// 活动详情页停留跟帖子停留是同一个「开始时刻」概念（Date.now()），复用同一个函数。
export const beginActivityView = beginPostView;

// 活动详情页的停留 —— 跟 endPostView 同一套采集闸、同一套封顶、同一个
// 「开始时刻」概念（beginPostView 就是 beginActivityView），只是上报目标从
// 「这条帖子」换成「这个活动」。封顶与 <1s 不记的理由完全一样：切后台忘关、
// 息屏、以及从列表点进详情又立刻退回去，都不该被记成一次浏览。
// <1s 的门槛放在这里而不是调用方，是为了让每个调用点都不必重复写它 ——
// 漏写一个调用点就是一次假浏览，而假浏览正是这套闸当初要消灭的东西。
const MIN_ACTIVITY_VIEW_MS = 1000;

export async function endActivityView(
  localNet: Pick<LocalNetClient, "recordActivityView">,
  activityId: string,
  startedAt: number,
  store?: BehaviorAnalyticsStore
): Promise<void> {
  if (!activityId) return;
  if (!(await behaviorAnalyticsEnabled(store))) return;
  const watchMs = Math.min(Math.max(0, Date.now() - startedAt), MAX_WATCH_MS);
  if (watchMs < MIN_ACTIVITY_VIEW_MS) return;
  try {
    await localNet.recordActivityView(activityId, watchMs);
  } catch {
    // 双保险：真正的 client 内部已经静默，这里再兜一层 —— 埋点永远不抛。
  }
}

// MEDIA-DWELL-001: 单张照片/视频的停留——跟 endPostView 同一套开关和封顶，
// 只是上报目标从"这条帖子"细到"帖子里的这一张"。调用方每次划到下一张媒体
// 都要 flush 上一张（见 MediaViewer 里的分段逻辑），不是整个查看会话关闭
// 才报一次。
export async function endMediaView(
  localNet: Pick<LocalNetClient, "recordMediaImpression">,
  mediaAssetId: string,
  startedAt: number,
  store?: BehaviorAnalyticsStore
): Promise<void> {
  if (!mediaAssetId) return;
  if (!(await behaviorAnalyticsEnabled(store))) return;
  const watchMs = Math.min(Math.max(0, Date.now() - startedAt), MAX_WATCH_MS);
  try {
    await localNet.recordMediaImpression(mediaAssetId, watchMs);
  } catch {
    // 双保险：真正的 client 内部已经静默，这里再兜一层 —— 埋点永远不抛。
  }
}

// CONTENT-ANALYTICS-001: 全屏看图放大（双击 / 捏合）。同一套开关：关了就一个事件都不造。
export async function recordMediaZoom(
  localNet: Pick<LocalNetClient, "recordMediaZoom">,
  mediaAssetId: string,
  store?: BehaviorAnalyticsStore
): Promise<void> {
  if (!mediaAssetId) return;
  if (!(await behaviorAnalyticsEnabled(store))) return;
  try {
    await localNet.recordMediaZoom(mediaAssetId);
  } catch {
    // 埋点永远不抛。
  }
}
