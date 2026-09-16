// SCENE-CHECKIN-100M-001: 场景打卡门禁纯逻辑。
//
// 之前「我在这里」是谁点谁就算 —— 没定位能标，在河内点胡志明的店也能标，
// 标完还显示「N 人说在这里」，等于给没到场的人发到场证明。现在打卡只认
// GPS 真值：100 米内可打（含自动打卡），之外一律拒绝并明说原因。
//
// 本文件纯 TS（reality-scene-map.tsx import react-native-maps，vitest
// 进不来，判定逻辑放这里才能真正测到 —— 与 reality-scene-address.ts 同取向）。

/** 打卡半径（米）。进了这个圈才算到过 —— 与自动足迹的 300m 是两回事，别混用。 */
export const CHECKIN_RADIUS_METERS = 100;

export type CheckinEligibility =
  | { eligible: true; reason: "ok" }
  | { eligible: false; reason: "no_fix" | "too_far" };

/**
 * 打卡资格判定。distanceMeters 拿不到（没授权/没定位）= 没证据 = 不能打，
 * 不是"默认能打"也不是"默认已打过"。非法值（NaN/负数）同 no_fix。
 */
export function checkinEligibility(distanceMeters: number | undefined): CheckinEligibility {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return { eligible: false, reason: "no_fix" };
  }
  if (distanceMeters > CHECKIN_RADIUS_METERS) return { eligible: false, reason: "too_far" };
  return { eligible: true, reason: "ok" };
}

/** 距离人话：1000 下写米，以上写公里（一位小数）。只格式化，不判定。 */
export function formatCheckinDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "距离未知";
  if (distanceMeters < 1000) return `约 ${Math.round(distanceMeters)} 米`;
  return `约 ${(distanceMeters / 1000).toFixed(1)} 公里`;
}

/**
 * 打卡区一行文案。已打卡优先（状态是事实）；没打卡按资格说人话 ——
 * 「太远」必须报距离，否则用户不知道走多近才算到。
 */
export function checkinHint(checkedIn: boolean, distanceMeters: number | undefined): string {
  if (checkedIn) return "已打卡 · 90 分钟后自动结束，再点一次取消。";
  const eligibility = checkinEligibility(distanceMeters);
  if (eligibility.reason === "no_fix") return "需要定位才能打卡：先在地图上定位，再回来打卡。";
  if (eligibility.reason === "too_far") {
    return `还太远，打不了卡（${formatCheckinDistance(distanceMeters as number)}）：走近到 100 米内自动打卡。`;
  }
  return "就在这儿，点一下打卡。";
}
