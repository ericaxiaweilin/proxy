// Market fixtures — R15.12.7 → R4 (2026-08-24).
// R4 决定：移除“体验上架”（小美真人货架）以不拉低小美身价。
// 市场仅保留 机会 / 活动 双 Tab：机会由客户发布、小美单向报名；活动是公共线。
// EXPERIENCE 保留为 deprecated 别名（历史路由兼容），新 UI 不再展示，统一归一到 OPPORTUNITY。
// 坐标仍用于 MAP 的粗粒度区域定位，精确地址仅授权后披露。

export type MarketTab = "EXPERIENCE" | "OPPORTUNITY" | "ACTIVITY";

// 发布机会的价格区间合成：发布页填最低 / 最高两框，wire 上仍走
// 机会 price 自由字符串（server 只要求 EARN/PAY 非空非零、FREE/TBD
// 为空/零，不解析金额）。两框相等或只填一边时退化为单价。
export function composePriceRange(min: string, max: string): string {
  const lo = min.trim();
  const hi = max.trim();
  if (!lo) return hi;
  if (!hi || hi === lo) return lo;
  return `${lo} – ${hi}`;
}

export const MIN_OPPORTUNITY_ORDER_VND = 100_000;
export const MAX_OPPORTUNITY_ORDER_VND = 10_000_000;

function parseVNDLabel(value: string): number | undefined {
  let clean = value.trim().toUpperCase().replace(/VND|₫/g, "").trim();
  let multiplier = 1;
  if (clean.endsWith("K")) { multiplier = 1_000; clean = clean.slice(0, -1); }
  else if (clean.endsWith("M")) { multiplier = 1_000_000; clean = clean.slice(0, -1); }
  const amount = Number(clean.replace(/,/g, "").trim());
  return Number.isFinite(amount) ? amount * multiplier : undefined;
}

export function validateOpportunityPriceRange(label: string): { ok: true } | { ok: false; error: string } {
  const parts = label.split(/[–—-]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "请输入订单金额" };
  for (const part of parts) {
    const amount = parseVNDLabel(part);
    if (amount === undefined || !Number.isInteger(amount)) return { ok: false, error: "请输入有效的 VND 金额" };
    if (amount < MIN_OPPORTUNITY_ORDER_VND) return { ok: false, error: "机会订单最低保底为 100,000 VND" };
    if (amount > MAX_OPPORTUNITY_ORDER_VND) return { ok: false, error: "机会订单金额不能超过 10,000,000 VND" };
  }
  return { ok: true };
}

// 快速 Offer 输入组装（纯函数）：发布者给真实报名人发 5 分钟 Offer。
// 金额文本转服务端要的 agreedCompensation（VND 最小单位整数，精度 1₫）；
// 目标必须是报名名单里的 applicantId，不再允许写死演示 agent。
// slot 暂沿用 {taskId}_slot_1 约定（slot 读模型未暴露前）。
//
// 金额边界：
//   - 下限 MIN_OFFER_VND = 100_000 — 机会订单统一最低保底；发布、
//     报价、快速 Offer 三个入口必须一致，不能靠客户端提示代替服务端守门。
//   - 上限 MAX_OFFER_VND = 10_000_000 — 镜像服务端 maxAmountVND
//    （fulfillment/service.go 防超大金额脏数据），超了直接报，不等
//     服务端 INVALID_SLOT_OFFER_AMOUNT。
export const MIN_OFFER_VND = MIN_OPPORTUNITY_ORDER_VND;
export const MAX_OFFER_VND = 10_000_000;

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
  if (amount < MIN_OFFER_VND) return { ok: false, error: `金额过低，至少 ${MIN_OFFER_VND}₫` };
  if (amount > MAX_OFFER_VND) return { ok: false, error: "金额超过上限" };
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
