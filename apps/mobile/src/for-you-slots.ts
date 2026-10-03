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

// ---------------------------------------------------------------------------
// HOME-FORYOU-ORDER-009（2026-10-01，用户 P0：「点击圆圈 不是选择 是查看这张订单
// 我只有几个用户有订单」）
//
// 圆圈重掷「人」这一格时，候选人数为 0 / 1 的两条分支原来一个 else 都没有：
// 既不换人，也不给任何提示 —— 点圆圈像死的。而这恰恰是「库里只有几个人有距离
// 数据」时最常见的形态（PERSON-DISTANCE-ZERO-001：无坐标真人不进名单）。
//
// 这里把它从 requester-home 里原样搬出来成纯函数，好让三条分支都能**跑出来**
// 验，而不是在源码里 grep 那几个 if —— grep 只能证明「字面量还在」，证明不了
// 「只有一个人时真的会说话」。
export type PersonSlotPick =
  /** 换到了一个有空的（online）人。 */
  | { kind: "free"; index: number }
  /** 一个有空的都没有，但名单里多于一人：随便换，并如实说明换不出「有空的」。 */
  | { kind: "noneFreeButOthers"; index: number }
  /** 名单里恰好一个人且他不在线 —— 他已经是当前选择，换不出去，如实说明。 */
  | { kind: "onlyCandidate"; index: number }
  /** 名单是空的：没有可选的人，如实说明。 */
  | { kind: "noCandidates" };

/**
 * 圆圈重掷人的取号规则。
 *
 * `free` 分支在 online 的人里按 cursor **轮转**（HOME-FORYOU-FREE-001）—— 原来这里
 * 是 `Math.random()`，与「有没有空」毫无关系。轮转也让连点两次不会给同一个人。
 *
 * @param people 已经过滤好的候选名单（半径 / 语言 / 在线等筛选都在外面做完了）。
 * @param cursor 轮转游标，只在真的换到人时前进。
 */
export function pickPersonSlot(
  people: ReadonlyArray<{ id: string; online: boolean }>,
  cursor: number,
  random: () => number = Math.random
): PersonSlotPick {
  const freeIndexes = people.flatMap((p, index) => (p.online ? [index] : []));
  if (freeIndexes.length > 0) {
    // 用**当前**游标取，再由调用方前进 —— 第一次点必须落在第一个有空的身上。
    // （写成 cursor+1 会跳过第一个人，那是我搬这段时自己引入的 off-by-one。）
    const offset = ((cursor % freeIndexes.length) + freeIndexes.length) % freeIndexes.length;
    return { kind: "free", index: freeIndexes[offset]! };
  }
  if (people.length === 0) return { kind: "noCandidates" };
  if (people.length === 1) return { kind: "onlyCandidate", index: 0 };
  const index = Math.min(people.length - 1, Math.max(0, Math.floor(random() * people.length)));
  return { kind: "noneFreeButOthers", index };
}

/**
 * HOME-FORYOU-ORDER-010（2026-10-01，用户 P0：「for you 的选择变成查看这张订单」）：
 * **初次**落在哪一场活动上，要避开你已经下过单的那几场。
 *
 * activityIndex 初始是 `forYouSeed >> 7` —— 一个种子下标，**不看订单**；
 * sceneActivities 也不排除已下单的。于是首屏（以及每次 myOrders 才异步到齐之前）
 * 完全可能停在一张你已经有票的活动上，`existingOrder` 为真 ⇒ CTA 一直显示
 * 「查看这张订单」，「选择」那条路整个看不见。圆圈刷新能换走，但用户得先意识到
 * 「我该点那个圆圈」—— 而这正是报上来的那个不可用的状态。
 *
 * 注意：单靠"刷新时避开"（ORDER-009）不够，因为**首屏**这一下没人点圆圈。
 * myOrders 是 mount 之后才到的，所以这一步只能等它到齐再做 —— 到齐了就挪开。
 *
 * 一个可挪的都没有时**保持不动**：那时「查看这张订单」就是实话，不该乱跳。
 */
export function resolveActivityIndexAvoidingOrders(
  activities: ReadonlyArray<{ activityId: string }>,
  joinedByMe: ReadonlySet<string>,
  currentIndex: number
): number {
  if (activities.length < 2) return 0;
  const current = ((currentIndex % activities.length) + activities.length) % activities.length;
  if (!joinedByMe.has(activities[current]!.activityId)) return current;
  for (let step = 1; step < activities.length; step += 1) {
    const candidate = (current + step) % activities.length;
    if (!joinedByMe.has(activities[candidate]!.activityId)) return candidate;
  }
  return current;
}
