// TREASURE-001：寻宝的纯逻辑（雷达位置、方位、倒计时、原因码文案、长按进度）。没有 React / 原生依赖，vitest 直接测。

export const OPEN_RADIUS_M = 100;
export const HOLD_MS = 900; // 按住蓄力多久才发请求（和 PAO0 同一个手感）

export type TreasureChest = {
  id: string; sceneId: string; name: string; area: string; lat: number; lng: number;
  distanceM: number; points: number; remaining: number; expiresAt: string; openedByMe: boolean;
};
export type TreasureBooking = {
  activityId: string; companionId: string; title: string; sceneId: string; name: string; lat: number; lng: number;
  distanceM: number; points: number; withVoucher: boolean;
};
export type TreasureNearby = {
  chests: TreasureChest[]; companionBookings: TreasureBooking[]; openedToday: number; dailyCap: number; radiusM: number; totalPoints: number;
};
export type TreasureResult = { kind: "SOLO" | "COMPANION"; points: number; sceneName: string; distanceM: number; claimId?: string; totalPoints: number };

/** 我 → 目标的方位角（度，0 = 正北，顺时针）。 */
export function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const rad = Math.PI / 180;
  const dLng = (toLng - fromLng) * rad;
  const y = Math.sin(dLng) * Math.cos(toLat * rad);
  const x = Math.cos(fromLat * rad) * Math.sin(toLat * rad) - Math.sin(fromLat * rad) * Math.cos(toLat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const COMPASS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
export function compassLabel(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/**
 * 雷达上的半径（0..1）：近处放大、远处压缩（对数刻度），100 米内贴近中心，5 公里到边缘。
 * 这样「走近了」在雷达上肉眼可见，而不是一堆点挤在外圈。
 */
export function radarRadius(distanceM: number, maxM = 5000): number {
  const d = Math.max(0, Math.min(distanceM, maxM));
  return Math.log10(1 + d / 20) / Math.log10(1 + maxM / 20);
}

/** 雷达上的点坐标（相对圆心，单位 = 半径的比例，x 向右、y 向下）。 */
export function radarPoint(bearing: number, distanceM: number, maxM = 5000): { x: number; y: number } {
  const r = radarRadius(distanceM, maxM);
  const a = (bearing * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

export function distanceText(m: number): string {
  return m < 1000 ? `${Math.max(0, Math.round(m))} 米` : `${(m / 1000).toFixed(1)} 公里`;
}

/** 到期倒计时「2 小时 5 分」「35 分钟」；已过期 = 空串。 */
export function remainingText(expiresAt: string, now: Date): string {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const min = Math.ceil(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} 小时${min % 60 > 0 ? ` ${min % 60} 分` : ""}` : `${min} 分钟`;
}

export function canOpenAt(distanceM: number): boolean {
  return distanceM <= OPEN_RADIUS_M;
}

/** 服务端原因码 → 人话。不认识的码给通用一句，不透传英文码。 */
export function reasonText(code: string, distanceM?: number): string {
  switch (code) {
    case "TOO_FAR": return distanceM ? `离店还有 ${Math.max(0, distanceM - OPEN_RADIUS_M)} 米，再走近一点` : "离店还有点远，再走近一点";
    case "ACCURACY_TOO_LOW": return "定位还不够准，等几秒再试";
    case "ALREADY_OPENED": return "这个你已经开过了";
    case "CHEST_GONE": return "这个宝箱已经被开空或到期了";
    case "DAILY_CAP": return "今天开得够多了，明天再来";
    case "SPEED_IMPLAUSIBLE": return "位置变化太快，请稍后再试";
    case "NOT_ELIGIBLE": return "这一单现在还不能开同行箱";
    case "BAD_LOCATION": return "还没拿到定位";
    case "rate_limited": return "操作太快了，稍等一下";
    default: return "没开成，请稍后再试";
  }
}

/** 长按进度 0..1。 */
export function holdProgress(elapsedMs: number): number {
  return Math.max(0, Math.min(1, elapsedMs / HOLD_MS));
}

/** 粒子：按分数档位决定数量（普通 / 同行加成更多）。 */
export function particleCount(kind: "SOLO" | "COMPANION", reduceMotion: boolean): number {
  if (reduceMotion) return 4;
  return kind === "COMPANION" ? 22 : 12;
}
