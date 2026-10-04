// FOR-YOU-DERIVE-001 / FOR-YOU-SLOT-001：For You 四宫格的唯一派生层。
//
// requester-home.tsx 的四宫格、四个选择器、圆圈刷新都从这里派生。不要在别处再写一份
// 「能不能约」的判断。
//
// 资源模型（2026-10-04 用户裁决：「for you 是 4 个自由资源槽，核心服务于小美真人……
// 20 个真人 × 3 个时间段 = 最大 60 个可以用」）：
//   - 资源单位是「小美 × 时段」。一个组合 = 人 + 一场活动（活动自带 时间 + 场景）。
//   - 小美的一个时段只接一单，谁约的都算（服务端 ux_participants_companion_slot 兜底）。
//   - 我自己同一时段可以约多个小美——不查我的时段。
//   - 咖啡店 / 活动是场景载体，不扣名额（店的承载上限后期再做，现在不限）。
//   - 同一组 (活动, 我, 小美) 我已经下过 ⇒ 「查看这张订单」。
// 所以可约 = 这个人在这场活动的时段没被约走 + 这一组我没下过。
//
// 时间 / 场景 / 活动三格都由「选中的那场活动」派生；人是独立轴，但「能不能约」要看人。
// 锁 = 约束：锁住的那一格取值固定，其它格的选项和「整组换」只在满足锁的组合里挑。
import { detectOrderConflict, sceneIdOfActivity, type BusySlots, type ComboScene, type ExistingOrder } from "./requester-home-combo";

export type FYActivity = {
  activityId: string;
  title: string;
  time: string;
  sceneId: string;
};

export type FYPerson = { id: string; online?: boolean | undefined };

/** 判断「能不能约」需要的全部事实：我的订单、已被约走的小美时段、当前选中的人。 */
export type FYContext = {
  myOrders: readonly ExistingOrder[];
  busy: BusySlots;
  personId: string | undefined;
};

/** 锁住的格子在锁住那一刻的取值。 */
export type FYLocks = { time?: string | undefined; sceneId?: string | undefined; activityId?: string | undefined; personId?: string | undefined };

export type FYUnavailable = "ORDERED" | "PERSON_BUSY";
export type FYStatus =
  | { ok: true }
  | { ok: false; reason: FYUnavailable; orderNo?: string | undefined }
  | { ok: false; reason: "LOCKED_OUT" | "NONE" };

const sameTime = (a: string, b: string): boolean => a.trim() !== "" && a.trim() === b.trim();

/** 这个人 + 这场活动能不能约。没选人时只看活动本身（人另由 CTA 要求补上）。 */
export function activityStatus(activity: FYActivity, ctx: FYContext): FYStatus {
  const conflict = detectOrderConflict({ activityId: activity.activityId, time: activity.time, companionId: ctx.personId }, ctx.myOrders, ctx.busy);
  if (conflict?.kind === "ALREADY_ORDERED") return { ok: false, reason: "ORDERED", orderNo: conflict.orderNo };
  if (conflict?.kind === "COMPANION_BUSY") return { ok: false, reason: "PERSON_BUSY" };
  return { ok: true };
}

type Axis = "time" | "scene" | "activity" | "person";

/** 活动是否满足锁；ignore 是正在被挑的那一格（挑时间时不拿时间锁去筛）。 */
export function matchesLocks(activity: FYActivity, locks: FYLocks, ignore?: Axis): boolean {
  if (ignore !== "activity" && locks.activityId && activity.activityId !== locks.activityId) return false;
  if (ignore !== "time" && locks.time !== undefined && !sameTime(activity.time, locks.time)) return false;
  if (ignore !== "scene" && locks.sceneId && activity.sceneId !== locks.sceneId) return false;
  return true;
}

function isAvailable(activity: FYActivity, ctx: FYContext): boolean {
  return activityStatus(activity, ctx).ok;
}

/** 一组候选里的状态：有可约的就可约；都不可约就报第一个的原因；没候选就是 LOCKED_OUT / NONE。 */
function groupStatus(candidates: readonly FYActivity[], ctx: FYContext, emptyReason: "LOCKED_OUT" | "NONE"): FYStatus {
  if (candidates.length === 0) return { ok: false, reason: emptyReason };
  const statuses = candidates.map((a) => activityStatus(a, ctx));
  return statuses.find((s) => s.ok) ?? statuses[0]!;
}

export type FYOption<T> = { value: T; status: FYStatus };

export function timeOptions(activities: readonly FYActivity[], ctx: FYContext, locks: FYLocks): FYOption<string>[] {
  const times = [...new Set(activities.map((a) => a.time.trim()).filter(Boolean))];
  return times.map((time) => {
    const atTime = activities.filter((a) => sameTime(a.time, time));
    const allowed = atTime.filter((a) => matchesLocks(a, locks, "time"));
    return { value: time, status: groupStatus(allowed, ctx, atTime.length > 0 ? "LOCKED_OUT" : "NONE") };
  });
}

/** sceneIds：要列出的场景（咖啡店），包括暂时没有活动的——那种标 NONE，不藏。 */
export function sceneOptions(sceneIds: readonly string[], activities: readonly FYActivity[], ctx: FYContext, locks: FYLocks): FYOption<string>[] {
  return sceneIds.map((sceneId) => {
    const atScene = activities.filter((a) => a.sceneId === sceneId);
    const allowed = atScene.filter((a) => matchesLocks(a, locks, "scene"));
    return { value: sceneId, status: groupStatus(allowed, ctx, atScene.length > 0 ? "LOCKED_OUT" : "NONE") };
  });
}

export function activityOptions(activities: readonly FYActivity[], ctx: FYContext, locks: FYLocks): FYOption<string>[] {
  return activities.map((a) => ({
    value: a.activityId,
    status: matchesLocks(a, locks, "activity") ? activityStatus(a, ctx) : { ok: false, reason: "LOCKED_OUT" as const },
  }));
}

/** 人的选项：这个人在满足锁的活动里还有没有一场能约（有一个空时段就能选）。 */
export function personOptions(people: readonly FYPerson[], activities: readonly FYActivity[], ctx: FYContext, locks: FYLocks): FYOption<string>[] {
  const allowed = activities.filter((a) => matchesLocks(a, locks, "person"));
  return people.map((p) => ({ value: p.id, status: groupStatus(allowed, { ...ctx, personId: p.id }, activities.length > 0 ? "LOCKED_OUT" : "NONE") }));
}

function firstPreferred(candidates: readonly FYActivity[], prefer: (a: FYActivity) => boolean): FYActivity | undefined {
  return candidates.find(prefer) ?? candidates[0];
}

/** 换时间：挑那个时间的一场可约活动，尽量不换店。挑不出来返回 undefined（选项本就点不了）。 */
export function pickForTime(time: string, current: FYActivity | undefined, activities: readonly FYActivity[], ctx: FYContext, locks: FYLocks): string | undefined {
  const candidates = activities.filter((a) => sameTime(a.time, time) && matchesLocks(a, locks, "time") && isAvailable(a, ctx));
  return firstPreferred(candidates, (a) => a.sceneId === current?.sceneId)?.activityId;
}

/** 换地点：挑那家店的一场可约活动，尽量不换时间。 */
export function pickForScene(sceneId: string, current: FYActivity | undefined, activities: readonly FYActivity[], ctx: FYContext, locks: FYLocks): string | undefined {
  const candidates = activities.filter((a) => a.sceneId === sceneId && matchesLocks(a, locks, "scene") && isAvailable(a, ctx));
  return firstPreferred(candidates, (a) => current !== undefined && sameTime(a.time, current.time))?.activityId;
}

/**
 * 换人之后：当前这场对新的人还能约就不动；不能约（她这个时段被约走了 / 这一组我下过）
 * 就换到她能约的一场，尽量同一家店。挑不出来返回 undefined（人选项本就点不了）。
 */
export function pickForPerson(current: FYActivity | undefined, activities: readonly FYActivity[], ctx: FYContext, locks: FYLocks): string | undefined {
  if (current && matchesLocks(current, locks, "person") && isAvailable(current, ctx)) return current.activityId;
  const candidates = activities.filter((a) => matchesLocks(a, locks, "person") && isAvailable(a, ctx));
  return firstPreferred(candidates, (a) => a.sceneId === current?.sceneId)?.activityId;
}

export type FYPick = { personId: string | undefined; activityId: string };

/**
 * 整组换（圆圈）：在满足锁的**可约**组合（人 × 活动）里随机挑一组。
 * 用户：「点击圆圈 能自动刷新的只有人物，时间 场所 地点没有刷新」——所以优先挑四格都
 * 跟现在不一样的组合（人 / 活动 / 时间 / 场景各算一分，取分最高的那一档），同档里优先
 * 在线的人（HOME-FORYOU-FREE-001），再随机。没有人可选时只换活动。没有可约的返回 undefined。
 */
export function shufflePick(
  activities: readonly FYActivity[],
  people: readonly FYPerson[],
  base: Omit<FYContext, "personId">,
  locks: FYLocks,
  current: { personId?: string | undefined; activity?: FYActivity | undefined },
  random: () => number = Math.random
): FYPick | undefined {
  const persons: (FYPerson | undefined)[] = people.length === 0
    ? [undefined]
    : locks.personId !== undefined ? people.filter((p) => p.id === locks.personId) : [...people];
  type Scored = FYPick & { score: number; online: boolean };
  const pool: Scored[] = [];
  for (const person of persons) {
    const ctx: FYContext = { ...base, personId: person?.id };
    for (const a of activities) {
      if (!matchesLocks(a, locks) || !isAvailable(a, ctx)) continue;
      const score = (person?.id !== current.personId ? 1 : 0)
        + (a.activityId !== current.activity?.activityId ? 1 : 0)
        + (current.activity === undefined || !sameTime(a.time, current.activity.time) ? 1 : 0)
        + (a.sceneId !== current.activity?.sceneId ? 1 : 0);
      pool.push({ personId: person?.id, activityId: a.activityId, score, online: person?.online === true });
    }
  }
  if (pool.length === 0) return undefined;
  const top = Math.max(...pool.map((p) => p.score));
  const best = pool.filter((p) => p.score === top);
  const online = best.filter((p) => p.online);
  const from = online.length > 0 ? online : best;
  const picked = from[Math.floor(random() * from.length) % from.length]!;
  return { personId: picked.personId, activityId: picked.activityId };
}

/**
 * 当前选中的活动：用户选过且还在列表里就用它（哪怕刚下完单变成不可约——那时要显示
 * 「已下过单 · 查看这张订单」，不能偷偷跳走）；否则从当前这个人能约的里按 seed 挑；
 * 一个能约的都没有就按 seed 挑任意一场（格子照样画，按钮置灰 + 说明原因）。
 */
export function resolveSelected(activities: readonly FYActivity[], selectedId: string | undefined, ctx: FYContext, seed: number): FYActivity | undefined {
  if (activities.length === 0) return undefined;
  const chosen = selectedId ? activities.find((a) => a.activityId === selectedId) : undefined;
  if (chosen) return chosen;
  const available = activities.filter((a) => isAvailable(a, ctx));
  const from = available.length > 0 ? available : activities;
  return from[Math.abs(seed) % from.length];
}

/** 锁住某一格时记下的值（取自当前活动 / 当前的人）。 */
export function lockValueFor(slot: Axis, activity: FYActivity, personId?: string | undefined): FYLocks {
  if (slot === "person") return { personId };
  if (slot === "time") return { time: activity.time };
  if (slot === "scene") return { sceneId: activity.sceneId };
  return { activityId: activity.activityId };
}

/** 把场景格的活动（已挂在真实咖啡店上）转成派生层的形状；解不出场景的丢掉。 */
export function toForYouActivities(
  activities: readonly { activityId: string; title: string; time: string; venueName: string; realitySceneId?: string | undefined }[],
  scenes: readonly ComboScene[]
): FYActivity[] {
  return activities.flatMap((a) => {
    const sceneId = sceneIdOfActivity(a, scenes);
    return sceneId ? [{ activityId: a.activityId, title: a.title, time: a.time, sceneId }] : [];
  });
}

