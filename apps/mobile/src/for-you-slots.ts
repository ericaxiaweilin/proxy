/**
 * HOME-FORYOU-REFRESH-001（2026-09-29，用户：「点击圆圈就是刷新全部可用插槽 你检查逻辑
 * 插槽资源冲突」）—— For You 中心圆圈的「换一组」取号规则。
 *
 * 以前的 remixForYou 只是在**本地旧列表**里对每条轴 `Math.random()`：
 *   1. 不重新拉数据 —— 别人刚报满的活动还当可用，点「确认下单」才撞 ACTIVITY_FULL；
 *   2. 不看名额 —— 已满的活动照样被抽中；
 *   3. 不看自己 —— 已经下过单的活动照样被抽中（进去只能看到「之前已经下过」）；
 *   4. 不看锁 —— 锁了地点 / 时间，活动照样在全量里随机，抽到别的场地 / 时间就当场
 *      制造 HOME-FORYOU-CONFLICT-001 冲突，「选择」按钮被禁用；
 *   5. 可能抽回同一个 —— 点了圆圈看起来什么都没发生。
 *
 * 这里只做**选哪一个**（纯函数、可测）；拉取新数据由调用方做，拿到新列表后再调用。
 * 「可用」= 还有名额 且 我没下过单 且 与锁定的地点 / 时间一致。
 */
import { sceneIdOfActivity, type ComboActivity, type ComboScene } from "./requester-home-combo";

export type SlotActivity = ComboActivity & {
  joined: number;
  /** 0 = 不限名额。 */
  capacity: number;
};

export type SlotLocks = {
  /** 锁定的活动：只要它仍可用就保留，不换。 */
  activityId?: string | undefined;
  /** 锁定的地点（场景 id）：只从在这个场景办的活动里选。 */
  placeSceneId?: string | undefined;
  /** 锁定的时间：只从这个时间的活动里选。 */
  time?: string | undefined;
};

export type SlotPick =
  | { kind: "picked"; index: number; changed: boolean }
  | { kind: "none"; reason: "NO_AVAILABLE" | "LOCKED_ACTIVITY_UNAVAILABLE" };

export function hasOpenSeat(activity: Pick<SlotActivity, "joined" | "capacity">): boolean {
  return activity.capacity <= 0 || activity.joined < activity.capacity;
}

/** 活动是否能作为「可用插槽」：有名额、我没下过单、和锁定的地点 / 时间不冲突。 */
export function isAvailableSlot(
  activity: SlotActivity,
  scenes: readonly ComboScene[],
  locks: SlotLocks,
  joinedByMe: ReadonlySet<string>
): boolean {
  if (!hasOpenSeat(activity) || joinedByMe.has(activity.activityId)) return false;
  if (locks.time !== undefined && activity.time !== locks.time) return false;
  if (locks.placeSceneId !== undefined && sceneIdOfActivity(activity, scenes) !== locks.placeSceneId) return false;
  return true;
}

/**
 * 在**刚拉到的**活动列表里选下一组的活动下标。
 *
 * - 锁了活动：它仍可用就原样保留；已经不可用（满了 / 我已下单）⇒ 如实报
 *   `LOCKED_ACTIVITY_UNAVAILABLE`，不偷偷换掉用户锁定的东西。
 * - 否则在可用集合里随机，**优先换一个不同的**；只剩当前这一个可用时保留它。
 * - 一个可用的都没有 ⇒ `NO_AVAILABLE`（调用方提示解锁或稍后再试），不回退到
 *   一个会在下单时失败的组合。
 */
export function pickRefreshedActivity(
  activities: readonly SlotActivity[],
  scenes: readonly ComboScene[],
  locks: SlotLocks,
  joinedByMe: ReadonlySet<string>,
  currentActivityId: string | undefined,
  random: () => number = Math.random
): SlotPick {
  if (locks.activityId !== undefined) {
    const index = activities.findIndex((activity) => activity.activityId === locks.activityId);
    if (index >= 0 && isAvailableSlot(activities[index]!, scenes, { ...locks, activityId: undefined }, joinedByMe)) {
      return { kind: "picked", index, changed: false };
    }
    return { kind: "none", reason: "LOCKED_ACTIVITY_UNAVAILABLE" };
  }
  const available: number[] = [];
  activities.forEach((activity, index) => {
    if (isAvailableSlot(activity, scenes, locks, joinedByMe)) available.push(index);
  });
  if (available.length === 0) return { kind: "none", reason: "NO_AVAILABLE" };
  const others = available.filter((index) => activities[index]!.activityId !== currentActivityId);
  const pool = others.length > 0 ? others : available;
  const index = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
  return { kind: "picked", index, changed: activities[index]!.activityId !== currentActivityId };
}
