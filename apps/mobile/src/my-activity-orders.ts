// MY-ORDERS-DETAIL-001（用户「我的订单 保留的信息太简单了 完善」）：
// 「我的订单 → 活动报名」每一单的展示字段。以前一行只有 标题 / 时间·场地 /
// 活动编号（还是整场活动共用的号，不是你这一单的号）。这里把下单成功页上
// 有的真实信息都带回来：订单编号、下单时间、状态、活动时间、场地、人数、
// 费用、到店消费。没有的字段不画，不补假值。
import type { Activity, ActivityJoinOrder, ActivityOrderSnapshot } from "@proxy/contracts";

export type JoinStateTone = "ok" | "muted" | "warn";

export function joinStateLabel(state: ActivityJoinOrder["state"] | undefined): { label: string; tone: JoinStateTone } {
  switch (state) {
    case "ATTENDED":
      return { label: "已签到", tone: "ok" };
    case "CANCELLED":
      return { label: "已取消", tone: "muted" };
    case "NO_SHOW":
      return { label: "未到场", tone: "warn" };
    case "REQUESTED":
      return { label: "待确认", tone: "muted" };
    case "WAITLISTED":
      return { label: "候补中", tone: "muted" };
    default:
      // 报名行存在 = 报名成立；状态记录取不到时（服务端重启后）也按已确认。
      return { label: "已确认", tone: "ok" };
  }
}

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 下单时间按越南本地时间显示（和订单编号切日同一口径），如「9月28日 14:30」。 */
export function formatJoinedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const local = new Date(ms + VIETNAM_OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${local.getUTCMonth() + 1}月${local.getUTCDate()}日 ${hh}:${mm}`;
}

/**
 * ORDER-RECIPE-001：这一单的票面。服务端存过快照就原样用（saved=true）；
 * 快照上线前的老订单没有，只能按活动**现在**的信息拼一份（saved=false），
 * 同行人 / 当时选的地点区域这些当时的选择找不回来，不编。
 */
export function orderSnapshotFor(activity: Activity, order: ActivityJoinOrder | undefined): { snapshot: ActivityOrderSnapshot; saved: boolean } {
  if (order?.snapshot) return { snapshot: order.snapshot, saved: true };
  return {
    saved: false,
    snapshot: {
      orderNo: order?.orderNo ?? "",
      orderedAt: order?.joinedAt ?? "",
      activity: {
        activityId: activity.activityId,
        title: activity.title,
        ...(activity.code ? { code: activity.code } : {}),
        ...(activity.time ? { time: activity.time } : {}),
        ...(activity.venueName ? { venueName: activity.venueName } : {}),
        ...(activity.priceLabel ? { priceLabel: activity.priceLabel } : {}),
        ...(activity.moneyFlow ? { moneyFlow: activity.moneyFlow } : {}),
        ...(activity.venueSpend ? { venueSpend: activity.venueSpend } : {}),
        joined: activity.joined,
        ...(activity.capacity ? { capacity: activity.capacity } : {}),
      },
      ...(activity.time ? { time: activity.time } : {}),
      ...(activity.venueName ? { place: { name: activity.venueName } } : {}),
    },
  };
}

export function activityOrderFields(activity: Activity, order: ActivityJoinOrder | undefined): Array<[string, string]> {
  const { snapshot } = orderSnapshotFor(activity, order);
  const fields: Array<[string, string]> = [];
  const joinedAt = order ? formatJoinedAt(order.joinedAt) : "";
  if (joinedAt) fields.push(["下单时间", joinedAt]);
  const time = snapshot.time || snapshot.activity.time;
  if (time) fields.push(["活动时间", time]);
  // 店名常自带「· 区域」后缀（"Three Beans · Cầu Giấy"），已带就不再拼一遍区域。
  const place = snapshot.place
    ? snapshot.place.area && !snapshot.place.name.includes(snapshot.place.area) ? `${snapshot.place.name} · ${snapshot.place.area}` : snapshot.place.name
    : snapshot.activity.venueName;
  if (place) fields.push(["地点", place]);
  if (snapshot.companion) fields.push(["同行", `${snapshot.companion.name}（系统推荐）`]);
  const { joined, capacity } = snapshot.activity;
  fields.push(["人数", capacity && capacity > 0 ? `${joined} / ${capacity} 人` : `${joined} 人`]);
  if (snapshot.activity.priceLabel) fields.push(["费用", snapshot.activity.priceLabel]);
  if (snapshot.activity.venueSpend) fields.push(["到店消费", snapshot.activity.venueSpend]);
  return fields;
}

/**
 * FOR-YOU-SLOT-001：一张票一项。同一场活动可以有多单（约了不同的小美），所以「我的订单」
 * 按单列，不按活动列。取消了的单不列（与 ListMyActivities.joined 只含未取消的口径一致）；
 * 老数据没有订单信息的活动仍列一项（order 为 undefined，如实说编号没取到）。
 * 按下单时间倒序；没有下单时间的排在最后，保持原相对顺序。
 */
export type JoinEntry = { key: string; activity: Activity; order: ActivityJoinOrder | undefined };

export function joinEntries(activities: readonly Activity[], orders: readonly ActivityJoinOrder[]): JoinEntry[] {
  const entries: JoinEntry[] = [];
  for (const activity of activities) {
    const mine = orders.filter((o) => o.activityId === activity.activityId && o.state !== "CANCELLED");
    if (mine.length === 0) entries.push({ key: activity.activityId, activity, order: undefined });
    for (const order of mine) entries.push({ key: `${activity.activityId}|${order.companionId ?? ""}`, activity, order });
  }
  const time = (e: JoinEntry): number => {
    const ms = e.order ? Date.parse(e.order.joinedAt) : NaN;
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  return entries.map((e, i) => ({ e, i })).sort((x, y) => time(y.e) - time(x.e) || x.i - y.i).map(({ e }) => e);
}
