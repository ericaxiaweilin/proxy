// IDENTITY-POINTS-001：我的身份等级（铜 / 银 / 金 × 1–3 星）与积分。读 GET /v1/me/identity-tier。
// 读不到就返回 undefined，界面什么都不画——不编分数。积分不是钱，不能提现。

export type TierStep = { tier: "BRONZE" | "SILVER" | "GOLD"; name: string; stars: number; min: number };
export type IdentityTier = {
  level: TierStep & { points: number; next?: TierStep; toNext?: number; highest: boolean };
  earnRules: Array<{ reason: string; label: string; points: number }>;
  recent: Array<{ reason: string; delta: number; createdAt: string }>;
};

type Transport = { request(path: string, init: { method: "GET" }): Promise<{ status: number; json(): Promise<unknown> }> };

export async function fetchIdentityTier(authClient: Transport): Promise<IdentityTier | undefined> {
  try {
    const res = await authClient.request("/v1/me/identity-tier", { method: "GET" });
    if (res.status < 200 || res.status >= 300) return undefined;
    const body = (await res.json()) as Partial<IdentityTier> | undefined;
    if (!body?.level || typeof body.level.points !== "number") return undefined;
    return { level: body.level, earnRules: body.earnRules ?? [], recent: body.recent ?? [] };
  } catch {
    return undefined;
  }
}

const REASON: Record<string, string> = {
  PROFILE_COMPLETE: "完善资料", POST_PUBLISHED: "发布帖文", ACTIVITY_JOINED: "参加活动", ORDER_COMPLETED: "完成订单", CAMPAIGN: "活动奖励",
};
export const reasonLabel = (reason: string): string => REASON[reason] ?? reason;

/** 「铜 ★★」 */
export const tierLabel = (l: Pick<TierStep, "name" | "stars">): string => `${l.name}${"★".repeat(l.stars)}`;

/** 本级到下一级的进度 0..100；满级 100。 */
export function tierProgress(l: IdentityTier["level"]): number {
  if (l.highest || !l.next) return 100;
  const span = l.next.min - l.min;
  return span <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(((l.points - l.min) / span) * 100)));
}
