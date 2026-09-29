// FOR-YOU-DERIVE-001（用户「这个 for you 的资源槽冲突 派生架构做好了吗」→「开始吧」）：
// For You 四宫格的唯一派生层。
//
// 以前四个格子是四条互相独立的 index（人 / 时间 / 活动 / 地点）：
//   - 活动其实是唯一真的轴，时间和地点都是从活动身上抄下来的；
//   - 换「时间」只改一个没人读的 index（不锁时什么都不变，锁了只会冒一条冲突提示）；
//   - 选择器里什么都能点，点完才发现「已下过单 / 这个时间你已有一单 / 满了」。
// 现在：
//   - 一个组合 = 人 + 一场活动（活动自带 时间 + 场景）。人是独立轴（推荐的人没有
//     可用时间数据，不编）；时间 / 场景 / 活动三格都由「选中的那场活动」派生。
//   - 换时间 = 换到那个时间的一场**可约**活动（尽量同一家店）；换地点 = 换到那家店
//     的一场可约活动（尽量同一个时间）。选不出来的选项在选择器里直接标原因、点不了。
//   - 锁 = 约束：锁住的那一格取值固定，其它格的选项和「整组换」只在满足锁的活动里挑。
//     锁的值来自锁住那一刻的活动本身，所以不会再出现「锁的值和活动对不上」的冲突。
//   - 可约 = 活动没满 + 这场我没下过单 + 这个时间段我没有别的单（取消的不算）。
// 服务端 JoinActivity 仍然会拒重复单 / 同时段单 / 满员 —— 这里是让用户在点之前就
// 看得见，不是唯一的守卫。
import { detectOrderConflict, type ExistingOrder } from "./requester-home-combo";

export type FYActivity = {
  activityId: string;
  title: string;
  time: string;
  sceneId: string;
  joined: number;
  capacity: number;
};

/** 锁住的格子在锁住那一刻的取值。人另算（人是独立轴，锁人只影响「整组换」）。 */
export type FYLocks = { time?: string | undefined; sceneId?: string | undefined; activityId?: string | undefined };

export type FYUnavailable = "ORDERED" | "TIME_TAKEN" | "FULL";
export type FYStatus =
  | { ok: true }
  | { ok: false; reason: FYUnavailable; orderNo?: string | undefined; clashTitle?: string | undefined }
  | { ok: false; reason: "LOCKED_OUT" | "NONE" };

const sameTime = (a: string, b: string): boolean => a.trim() !== "" && a.trim() === b.trim();

export function activityStatus(activity: FYActivity, myOrders: readonly ExistingOrder[]): FYStatus {
  const conflict = detectOrderConflict({ activityId: activity.activityId, time: activity.time }, myOrders);
  if (conflict?.kind === "ALREADY_ORDERED") return { ok: false, reason: "ORDERED", orderNo: conflict.orderNo };
  if (conflict?.kind === "TIME_TAKEN") return { ok: false, reason: "TIME_TAKEN", orderNo: conflict.orderNo, clashTitle: conflict.title };
  if (activity.capacity > 0 && activity.joined >= activity.capacity) return { ok: false, reason: "FULL" };
  return { ok: true };
}

type Axis = "time" | "scene" | "activity";

/** 活动是否满足锁；ignore 是正在被挑的那一格（挑时间时不拿时间锁去筛）。 */
export function matchesLocks(activity: FYActivity, locks: FYLocks, ignore?: Axis): boolean {
  if (ignore !== "activity" && locks.activityId && activity.activityId !== locks.activityId) return false;
  if (ignore !== "time" && locks.time !== undefined && !sameTime(activity.time, locks.time)) return false;
  if (ignore !== "scene" && locks.sceneId && activity.sceneId !== locks.sceneId) return false;
  return true;
}

function isAvailable(activity: FYActivity, myOrders: readonly ExistingOrder[]): boolean {
  return activityStatus(activity, myOrders).ok;
}

/** 一组候选里的状态：有可约的就可约；都不可约就报第一个的原因；没候选就是 LOCKED_OUT / NONE。 */
function groupStatus(candidates: readonly FYActivity[], myOrders: readonly ExistingOrder[], emptyReason: "LOCKED_OUT" | "NONE"): FYStatus {
  if (candidates.length === 0) return { ok: false, reason: emptyReason };
  const statuses = candidates.map((a) => activityStatus(a, myOrders));
  return statuses.find((s) => s.ok) ?? statuses[0]!;
}

export type FYOption<T> = { value: T; status: FYStatus };

export function timeOptions(activities: readonly FYActivity[], myOrders: readonly ExistingOrder[], locks: FYLocks): FYOption<string>[] {
  const times = [...new Set(activities.map((a) => a.time.trim()).filter(Boolean))];
  return times.map((time) => {
    const atTime = activities.filter((a) => sameTime(a.time, time));
    const allowed = atTime.filter((a) => matchesLocks(a, locks, "time"));
    return { value: time, status: groupStatus(allowed, myOrders, atTime.length > 0 ? "LOCKED_OUT" : "NONE") };
  });
}

/** sceneIds：要列出的场景（咖啡店），包括暂时没有活动的——那种标 NONE，不藏。 */
export function sceneOptions(sceneIds: readonly string[], activities: readonly FYActivity[], myOrders: readonly ExistingOrder[], locks: FYLocks): FYOption<string>[] {
  return sceneIds.map((sceneId) => {
    const atScene = activities.filter((a) => a.sceneId === sceneId);
    const allowed = atScene.filter((a) => matchesLocks(a, locks, "scene"));
    return { value: sceneId, status: groupStatus(allowed, myOrders, atScene.length > 0 ? "LOCKED_OUT" : "NONE") };
  });
}

export function activityOptions(activities: readonly FYActivity[], myOrders: readonly ExistingOrder[], locks: FYLocks): FYOption<string>[] {
  return activities.map((a) => ({
    value: a.activityId,
    status: matchesLocks(a, locks, "activity") ? activityStatus(a, myOrders) : { ok: false, reason: "LOCKED_OUT" as const },
  }));
}

function firstPreferred(candidates: readonly FYActivity[], prefer: (a: FYActivity) => boolean): FYActivity | undefined {
  return candidates.find(prefer) ?? candidates[0];
}

/** 换时间：挑那个时间的一场可约活动，尽量不换店。挑不出来返回 undefined（选项本就点不了）。 */
export function pickForTime(time: string, current: FYActivity | undefined, activities: readonly FYActivity[], myOrders: readonly ExistingOrder[], locks: FYLocks): string | undefined {
  const candidates = activities.filter((a) => sameTime(a.time, time) && matchesLocks(a, locks, "time") && isAvailable(a, myOrders));
  return firstPreferred(candidates, (a) => a.sceneId === current?.sceneId)?.activityId;
}

/** 换地点：挑那家店的一场可约活动，尽量不换时间。 */
export function pickForScene(sceneId: string, current: FYActivity | undefined, activities: readonly FYActivity[], myOrders: readonly ExistingOrder[], locks: FYLocks): string | undefined {
  const candidates = activities.filter((a) => a.sceneId === sceneId && matchesLocks(a, locks, "scene") && isAvailable(a, myOrders));
  return firstPreferred(candidates, (a) => current !== undefined && sameTime(a.time, current.time))?.activityId;
}

/** 整组换：在满足锁的可约活动里随机挑一场，尽量不是现在这场。没有可约的返回 undefined。 */
export function shufflePick(activities: readonly FYActivity[], myOrders: readonly ExistingOrder[], locks: FYLocks, currentId: string | undefined, random: () => number = Math.random): string | undefined {
  const pool = activities.filter((a) => matchesLocks(a, locks) && isAvailable(a, myOrders));
  const fresh = pool.filter((a) => a.activityId !== currentId);
  const from = fresh.length > 0 ? fresh : pool;
  if (from.length === 0) return undefined;
  return from[Math.floor(random() * from.length) % from.length]!.activityId;
}

/**
 * 当前选中的活动：用户选过且还在列表里就用它（哪怕刚下完单变成不可约——那时要显示
 * 「已下过单 · 查看这张订单」，不能偷偷跳走）；否则从可约的里按 seed 挑；一个可约
 * 的都没有就按 seed 挑任意一场（格子照样画，按钮置灰 + 说明原因）。
 */
export function resolveSelected(activities: readonly FYActivity[], selectedId: string | undefined, myOrders: readonly ExistingOrder[], seed: number): FYActivity | undefined {
  if (activities.length === 0) return undefined;
  const chosen = selectedId ? activities.find((a) => a.activityId === selectedId) : undefined;
  if (chosen) return chosen;
  const available = activities.filter((a) => isAvailable(a, myOrders));
  const from = available.length > 0 ? available : activities;
  return from[Math.abs(seed) % from.length];
}

/** 锁住某一格时记下的值（取自当前活动）。 */
export function lockValueFor(slot: Axis, activity: FYActivity): FYLocks {
  if (slot === "time") return { time: activity.time };
  if (slot === "scene") return { sceneId: activity.sceneId };
  return { activityId: activity.activityId };
}
