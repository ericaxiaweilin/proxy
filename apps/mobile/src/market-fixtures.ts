// Market fixtures — R15.12.7 → R4 (2026-08-24).
// R4 决定：移除“体验上架”（小美真人货架）以不拉低小美身价。
// 市场仅保留 机会 / 活动 双 Tab：机会由客户发布、小美单向报名；活动是公共线。
// EXPERIENCE 保留为 deprecated 别名（历史路由兼容），新 UI 不再展示，统一归一到 OPPORTUNITY。
// 坐标仍用于 MAP 的粗粒度区域定位，精确地址仅授权后披露。

export type MarketTab = "EXPERIENCE" | "OPPORTUNITY" | "ACTIVITY";

// 快速 Offer 输入组装（纯函数）：发布者给真实报名人发 5 分钟 Offer。
// 金额文本转服务端要的 agreedCompensation（VND 最小单位整数）；目标
// 必须是报名名单里的 applicantId，不再允许写死演示 agent。
// slot 暂沿用 {taskId}_slot_1 约定（slot 读模型未暴露前）。
export interface SlotOfferInput {
  taskId: string;
  slotId: string;
  agentId: string;
  agreedCompensation: number;
}

export function buildSlotOfferInput(
  taskId: string,
  applicantId: string,
  amountText: string
): { ok: true; input: SlotOfferInput } | { ok: false; error: string } {
  if (!taskId.trim() || !applicantId.trim()) return { ok: false, error: "缺少任务或报名人" };
  const amount = Number(amountText.replace(/[^\d]/g, ""));
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: "请输入有效金额（VND）" };
  return {
    ok: true,
    input: {
      taskId: taskId.trim(),
      slotId: `${taskId.trim()}_slot_1`,
      agentId: applicantId.trim(),
      agreedCompensation: amount
    }
  };
}

// R16.x: wire 上 MarketOpportunitySchema 强制 MoneyFlow 4 选 1 +
// PriceLabel 必填。mobile 端本地 MarketOpportunity 必须把这两个
// 字段补齐，否则 zod parse 在 client SDK 处会失败。
export type MarketOpportunityMoneyFlow = "EARN" | "PAY" | "FREE" | "TBD";

export type OpportunityLens = "NOW" | "NEARBY" | "BOOKED" | "REMOTE";

export interface MarketOpportunity {
  id: string;
  title: string;
  shortTitle: string;
  theme: string;
  date: string;
  time: string;
  location: string;
  price: string;
  moneyFlow: MarketOpportunityMoneyFlow;
  priceLabel: string;
  owner: string;
  ownerType: "BUSINESS" | "PERSON";
  match: string;
  responses: number;
  posted: string;
  skills: string;
  verified: boolean;
  lens: OpportunityLens[];
  travel: number | null;
  signal: string;
  signalClass: string;
  countdown: string;
  coord?: [number, number];
  ownedByViewer?: boolean;
  appliedByViewer?: boolean;
  viewerApplicationId?: string;
  viewerApplicationStatus?: "SUBMITTED" | "SELECTED" | "NOT_SELECTED" | "CONFIRMED";
  viewerOrderRef?: string;
  // R15.x (P1 market 附近): server (apps/api-go/internal/marketplace/
  // service.go) 在 ListMarketOpportunities 返回 lat/lng/travelSource.
  // 客户端不传 userLat/userLng 时, lat/lng 走 seeded, travelSource=
  // "seeded"; 传了就走 haversine 路径, travelSource="user_distance".
  lat?: number;
  lng?: number;
  // R37.4 redesign: standard order type (one of 5 approved logos).
  // Optional — fixtures without this fall back to heuristic inference
  // from theme/skills/title in R37OpportunityCard.inferType().
  opportunityType?: "coffee_photo" | "walk_photo" | "coffee_chinese" | "bilingual_store" | "event_photo";
  // Scene/operator media pipeline URL. Generated samples are a visual fallback
  // only; server-provided real-scene media always wins when present.
  sceneImageUrl?: string;
  travelSource?: "seeded" | "user_distance" | "unknown";
}

export const OPPORTUNITY_LENS_LABEL: Record<OpportunityLens, string> = {
  NOW: "现在",
  NEARBY: "附近",
  BOOKED: "预约",
  REMOTE: "远程"
};
