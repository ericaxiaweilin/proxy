import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

// CREATOR-SOCIAL-001：社媒条目。handle 只存用户名（服务端校验过形状），
// 显示时的 canonical 链接由 socialProfileUrl 按平台拼 —— 不拼用户给的 URL。
export type AgentSocial = { platform: string; handle: string; visibility: string };

/** 平台 → canonical 主页链接（和服务端封闭集合对齐，加平台要一起加）。 */
export function socialProfileUrl(platform: string, handle: string): string | undefined {
  switch (platform) {
    case "tiktok": return `https://www.tiktok.com/@${handle}`;
    case "instagram": return `https://www.instagram.com/${handle}`;
    case "facebook": return `https://www.facebook.com/${handle}`;
    case "zalo": return undefined; // Zalo 没有公开主页 URL 形态，只显示名字。
    default: return undefined; // 未知平台不拼 —— 拼出来就是编链接。
  }
}

export const SOCIAL_PLATFORMS = ["tiktok", "zalo", "instagram", "facebook"] as const;

/** 平台中文名（未知平台回落原文，不吞）。 */
export function socialPlatformLabel(platform: string): string {
  switch (platform) {
    case "tiktok": return "TikTok";
    case "zalo": return "Zalo";
    case "instagram": return "Instagram";
    case "facebook": return "Facebook";
    default: return platform;
  }
}
export const SOCIAL_VISIBILITIES = ["public", "merchants", "private"] as const;

export type AgentPassport = {
  // CREATOR-PROFILE-001（2026-10-02，用户「最佳匹配的creator 不能看个人主页
  // 也看不到关联的社媒账户」）：passport 里原来没有 photos —— 服务端明明发了
  // （AgentProfile.Photos），移动端类型把它丢了，于是详情页永远画不出头像。
  profile: { agentId: string; name: string; bio: string; photos: string[]; languages: string[]; serviceAreas: string[]; status: string; socials: AgentSocial[]; userAccountId?: string | undefined };
  capabilities: Array<{ capability: string; declared: boolean; verified: boolean }>;
  verifications: Array<{ id: string; capability: string; status: string }>;
  availability: Array<{ id: string; startAt: string; endAt: string; marketId: string; status: string }>;
};

/** passport 解析：照片字段缺了就给 []，不断言服务端一定发（老版本可能不发）。 */
export function parseAgentPassport(value: unknown): AgentPassport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const p = (v.profile ?? {}) as Record<string, unknown>;
  if (typeof p.agentId !== "string" || typeof p.name !== "string") return undefined;
  const photos = Array.isArray(p.photos) ? p.photos.filter((x): x is string => typeof x === "string") : [];
  const langs = Array.isArray(p.languages) ? p.languages.filter((x): x is string => typeof x === "string") : [];
  const areas = Array.isArray(p.serviceAreas) ? p.serviceAreas.filter((x): x is string => typeof x === "string") : [];
  const caps = Array.isArray(v.capabilities) ? v.capabilities.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const r = c as Record<string, unknown>;
    if (typeof r.capability !== "string") return [];
    return [{ capability: r.capability, declared: r.declared === true, verified: r.verified === true }];
  }) : [];
  // CREATOR-SOCIAL-001：socials 进解析。形状不对的条目整条丢掉（平台/用户名
  // 任一非法），不断言服务端一定发对 —— 老版本本来就没有这个字段。
  const socials: AgentSocial[] = Array.isArray((p as Record<string, unknown>).socials)
    ? ((p as Record<string, unknown>).socials as unknown[]).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const r = item as Record<string, unknown>;
        if (typeof r.platform !== "string" || typeof r.handle !== "string") return [];
        if (!(SOCIAL_PLATFORMS as readonly string[]).includes(r.platform)) return [];
        if (r.handle.length === 0 || r.handle.length > 64) return [];
        return [{
          platform: r.platform, handle: r.handle,
          visibility: typeof r.visibility === "string" ? r.visibility : "",
        }];
      })
    : [];
  const avail = Array.isArray(v.availability) ? v.availability.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const r = a as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.startAt !== "string" || typeof r.endAt !== "string") return [];
    return [{
      id: r.id, startAt: r.startAt, endAt: r.endAt,
      marketId: typeof r.marketId === "string" ? r.marketId : "",
      status: typeof r.status === "string" ? r.status : "",
    }];
  }) : [];
  return {
    profile: {
      agentId: p.agentId, name: p.name,
      bio: typeof p.bio === "string" ? p.bio : "",
      photos, languages: langs, serviceAreas: areas, socials,
      ...(typeof p.userAccountId === "string" && p.userAccountId !== "" ? { userAccountId: p.userAccountId } : {}),
      status: typeof p.status === "string" ? p.status : "",
    },
    capabilities: caps,
    verifications: [],
    availability: avail,
  };
}

export class SupplyProtocolError extends Error {}

// SUPPLY-BODY-001: operationRef 是服务端 payload 的 JSON 串。解析不出来就是
// 协议损坏，不能静默返回 {} —— 那跟"成功但为空"长得一模一样：供给列表会显示
// 0 个可邀约的人（看起来是"没有供给"），实际上是一次失败。同理，解析出来不是
// 对象（裸数字 / null / 字符串）也是损坏，一样要抛，不能退化成空对象。
export function parseSupplyBody(operationRef: string | undefined): Record<string, unknown> {
  if (!operationRef) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(operationRef) as unknown;
  } catch {
    throw new SupplyProtocolError("supply response payload was malformed");
  }
  if (!parsed || typeof parsed !== "object") throw new SupplyProtocolError("supply response payload was not an object");
  return parsed as Record<string, unknown>;
}

// CREATOR-HOME-001：userAccountId 是 agent→user 链路（公开主页用）。
// 服务端从 agent_profiles.user_account_id 直接带出来；没有就是没关联，不断言一定有。
export type SupplierCandidate = {
  agentId: string;
  userAccountId?: string | undefined;
  name: string;
  photos: string[];
  languages: string[];
  // MERCHANT-CREATOR-TAGS-001：只含 VERIFIED 未过期的能力编码（服务端 verifiedCapabilityCodes）。
  // 老服务端不带该字段时解析为 []，调用方按“无标签”处理。
  verifiedCapabilities?: string[];
  // MERCHANT-CREATOR-TAGS-001：粉丝数没有聚合来源；商家看到的是已关联
  // 社媒账号（platform + handle + 自填粉丝数，可见性已在服务端按调用方过滤）。
  // followerCount 必有（缺失记 0=未披露）。老服务端不带 socials 字段时为空数组。
  socials?: Array<{ platform: string; handle: string; followerCount: number }>;
  // MERCHANT-CREATOR-TAGS-001：评价分有真实来源 —— 服务端 matching.Score
  // 算出来的 Total（0..100；履约40/评价30/经验15/响应10/预算5）。
  // 无成交记录时 Total 取先验值、hasTrackRecord=false，UI 印「新人」不编分。
  // completedOrders 是真实成交单量（Postgres 订单表），商家页「服务量」来源。
  rating?: { total: number; hasTrackRecord: boolean; satisfactionRate: number; fulfillmentRate: number; completedOrders: number };
  // MERCHANT-CREATOR-PROMO-001：creator 的 ACTIVE 专属码（码是传播物，
  // 商家可见是设计）。没有码是 ""，调用方按无码处理。
  promoCode?: string;
  // MERCHANT-CREATOR-TAGS-001：创作者自声明内容垂类（展示过滤在客户端）。
  // 老服务端不带该字段时解析为 []。
  verticalTags?: string[];
  serviceType: string;
  referencePrice: number;
  currency: string;
  availability?: { startAt: string; endAt: string; marketId: string };
  eligibility: { eligible: boolean; capabilitiesOk: boolean; availabilityOk: boolean; marketOk: boolean };
};

export function parseSupplierCandidates(value: unknown): SupplierCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.agentId !== "string" || typeof item.name !== "string") return [];
    const eligibility = item.eligibility && typeof item.eligibility === "object" ? item.eligibility as Record<string, unknown> : {};
    const availability = item.availability && typeof item.availability === "object" ? item.availability as Record<string, unknown> : undefined;
    const parsedAvailability = availability && typeof availability.startAt === "string" && typeof availability.endAt === "string" && typeof availability.marketId === "string" ? { startAt: availability.startAt, endAt: availability.endAt, marketId: availability.marketId } : undefined;
    // 评价分：total 必须是数（服务端 matching.Score 的真实输出），不是数
    // 说明是老服务端 —— 不编，调用方按「无评分」处理（不渲染胶囊）。
    const ratingRaw = item.rating && typeof item.rating === "object" ? item.rating as Record<string, unknown> : undefined;
    const parsedRating = ratingRaw && typeof ratingRaw.total === "number" ? {
      total: ratingRaw.total,
      hasTrackRecord: ratingRaw.hasTrackRecord === true,
      satisfactionRate: typeof ratingRaw.satisfactionRate === "number" ? ratingRaw.satisfactionRate : 0,
      fulfillmentRate: typeof ratingRaw.fulfillmentRate === "number" ? ratingRaw.fulfillmentRate : 0,
      completedOrders: typeof ratingRaw.completedOrders === "number" && ratingRaw.completedOrders > 0 ? Math.floor(ratingRaw.completedOrders) : 0,
    } : undefined;
    return [{ agentId: item.agentId,
      ...(typeof item.userAccountId === "string" && item.userAccountId !== "" ? { userAccountId: item.userAccountId } : {}),
      name: item.name,
      photos: Array.isArray(item.photos) ? item.photos.filter((photo): photo is string => typeof photo === "string" && photo.length > 0) : [],
      languages: Array.isArray(item.languages) ? item.languages.filter((language): language is string => typeof language === "string") : [],
      verticalTags: Array.isArray(item.verticalTags) ? item.verticalTags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0) : [],
      socials: Array.isArray(item.socials) ? item.socials.flatMap((entry): Array<{ platform: string; handle: string; followerCount: number }> => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.platform !== "string" || typeof record.handle !== "string" || record.handle === "") return [];
        // 粉丝数字段必有：缺失/非法一律记 0（未披露），调用方不再需要判空。
        const count = typeof record.followerCount === "number" && record.followerCount > 0 ? Math.floor(record.followerCount) : 0;
        return [{ platform: record.platform, handle: record.handle, followerCount: count }];
      }) : [],
      verifiedCapabilities: Array.isArray(item.verifiedCapabilities) ? item.verifiedCapabilities.filter((capability): capability is string => typeof capability === "string" && capability.length > 0) : [],
      serviceType: typeof item.serviceType === "string" ? item.serviceType : "",
      referencePrice: typeof item.referencePrice === "number" ? item.referencePrice : 0,
      currency: typeof item.currency === "string" ? item.currency : "VND",
      ...(parsedAvailability ? { availability: parsedAvailability } : {}),
      ...(parsedRating ? { rating: parsedRating } : {}),
      // 专属码：非空字符串才带出来，别的形状一律按无码。
      ...(typeof item.promoCode === "string" && item.promoCode !== "" ? { promoCode: item.promoCode } : {}),
      eligibility: { eligible: eligibility.eligible === true, capabilitiesOk: eligibility.capabilitiesOk === true, availabilityOk: eligibility.availabilityOk === true, marketOk: eligibility.marketOk === true },
    }];
  });
}

// MERCHANT-CREATOR-INVITE-001：定向邀约。商家发（带 merchantId，网关验成员
// 身份后盖章）、creator 收（按 principal == agentID 鉴权）。
// 出价是区间不是一口价：min==max=一口价，全 0=出价待商议；negotiable=false
// 的单不许还价。PENDING 是 creator 的回合，COUNTERED 回到商家手里轮流出价。
export type CollabInvitationStatus = "PENDING" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";

export type CollabInvitationPurpose = "SALES" | "UGC" | "TRAFFIC" | "OTHER";

export type CollabInvitation = {
  id: string;
  merchantId: string;
  agentId: string;
  serviceType: string;
  startAt?: string | undefined;
  durationH: number;
  priceMinVnd: number;
  priceMaxVnd: number;
  negotiable: boolean;
  purpose: CollabInvitationPurpose | "";
  message: string;
  status: CollabInvitationStatus;
  termsVersion: number;
  counterBy?: string | undefined;
  currency: string;
  createdAt: string;
  respondedAt?: string | undefined;
  expiresAt: string;
};

export type CollabInvitationTerms = {
  priceMinVnd: number;
  priceMaxVnd: number;
  negotiable: boolean;
  purpose: CollabInvitationPurpose | "";
  message?: string | undefined;
  startAt?: string | undefined;
  durationH?: number | undefined;
};

const INVITATION_STATUSES: ReadonlySet<string> = new Set(["PENDING", "COUNTERED", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"]);

export function parseCollabInvitation(value: unknown): CollabInvitation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id === "") return undefined;
  if (typeof item.merchantId !== "string" || typeof item.agentId !== "string") return undefined;
  if (typeof item.status !== "string" || !INVITATION_STATUSES.has(item.status)) return undefined;
  if (typeof item.createdAt !== "string" || typeof item.expiresAt !== "string") return undefined;
  return {
    id: item.id,
    merchantId: item.merchantId,
    agentId: item.agentId,
    serviceType: typeof item.serviceType === "string" ? item.serviceType : "",
    ...(typeof item.startAt === "string" && item.startAt !== "" ? { startAt: item.startAt } : {}),
    durationH: typeof item.durationH === "number" ? item.durationH : 0,
    priceMinVnd: typeof item.priceMinVnd === "number" && item.priceMinVnd > 0 ? Math.floor(item.priceMinVnd) : 0,
    priceMaxVnd: typeof item.priceMaxVnd === "number" && item.priceMaxVnd > 0 ? Math.floor(item.priceMaxVnd) : 0,
    negotiable: item.negotiable !== false,
    purpose: item.purpose === "SALES" || item.purpose === "UGC" || item.purpose === "TRAFFIC" || item.purpose === "OTHER" ? item.purpose : "",
    message: typeof item.message === "string" ? item.message : "",
    status: item.status as CollabInvitationStatus,
    termsVersion: typeof item.termsVersion === "number" ? item.termsVersion : 1,
    ...(typeof item.counterBy === "string" && item.counterBy !== "" ? { counterBy: item.counterBy } : {}),
    currency: typeof item.currency === "string" ? item.currency : "VND",
    createdAt: item.createdAt,
    ...(typeof item.respondedAt === "string" && item.respondedAt !== "" ? { respondedAt: item.respondedAt } : {}),
    expiresAt: item.expiresAt,
  };
}

export function parseCollabInvitations(value: unknown): CollabInvitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = parseCollabInvitation(entry);
    return parsed ? [parsed] : [];
  });
}

// MERCHANT-CREATOR-PROMO-001：专属营销码。creator 认领自己的码（memorable，
// 全局唯一）；商家绑定优惠（直减，商家承诺）；店员报码落归因行。
export type PromoCode = {
  code: string;
  agentId: string;
  status: string;
  createdAt: string;
};

export type PromoBenefit = {
  merchantId: string;
  code: string;
  faceValueVnd: number;
  // 门槛：满多少才减（0 = 无门槛）。老服务端不带时按 0。
  minSpendVnd: number;
  scopeName: string;
  validUntil: string;
  status: string;
  // 绑定来源：MANUAL（逐个绑）/ AUTO（自动档报码时建的）。老服务端不带时按 MANUAL。
  source: string;
  // 调整原因（商家手填，团队回看用），可空。
  note: string;
  createdAt: string;
};

export type PromoQuote = {
  id: string;
  merchantId: string;
  agentId: string;
  code: string;
  amountVnd: number;
  discountVnd: number;
  firstVisit: boolean;
  quotedAt: string;
};

export type PromoStats = {
  byCode: Record<string, { quotes: number; firstVisits: number; attributedVnd: number; discountGivenVnd: number }>;
  quotes: number;
  firstVisits: number;
  attributedVnd: number;
  discountGivenVnd: number;
};

export function parsePromoCode(value: unknown): PromoCode | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.code !== "string" || item.code === "") return undefined;
  if (typeof item.agentId !== "string" || typeof item.createdAt !== "string") return undefined;
  return {
    code: item.code,
    agentId: item.agentId,
    status: typeof item.status === "string" ? item.status : "",
    createdAt: item.createdAt,
  };
}

export function parsePromoBenefit(value: unknown): PromoBenefit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.merchantId !== "string" || typeof item.code !== "string" || item.code === "") return undefined;
  return {
    merchantId: item.merchantId,
    code: item.code,
    faceValueVnd: typeof item.faceValueVnd === "number" && item.faceValueVnd > 0 ? Math.floor(item.faceValueVnd) : 0,
    minSpendVnd: typeof item.minSpendVnd === "number" && item.minSpendVnd > 0 ? Math.floor(item.minSpendVnd) : 0,
    scopeName: typeof item.scopeName === "string" ? item.scopeName : "",
    validUntil: typeof item.validUntil === "string" ? item.validUntil : "",
    status: typeof item.status === "string" ? item.status : "",
    source: item.source === "AUTO" ? "AUTO" : "MANUAL",
    note: typeof item.note === "string" ? item.note : "",
    createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
  };
}

export function parsePromoQuote(value: unknown): PromoQuote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id === "") return undefined;
  if (typeof item.merchantId !== "string" || typeof item.code !== "string") return undefined;
  if (typeof item.quotedAt !== "string") return undefined;
  return {
    id: item.id,
    merchantId: item.merchantId,
    agentId: typeof item.agentId === "string" ? item.agentId : "",
    code: item.code,
    amountVnd: typeof item.amountVnd === "number" && item.amountVnd > 0 ? Math.floor(item.amountVnd) : 0,
    discountVnd: typeof item.discountVnd === "number" && item.discountVnd > 0 ? Math.floor(item.discountVnd) : 0,
    firstVisit: item.firstVisit === true,
    quotedAt: item.quotedAt,
  };
}

export type PromoAutoBenefit = {
  merchantId: string;
  enabled: boolean;
  faceValueVnd: number;
  minSpendVnd: number;
  scopeName: string;
  validityDays: number;
};

export function parsePromoAutoBenefit(value: unknown): PromoAutoBenefit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.merchantId !== "string") return undefined;
  return {
    merchantId: item.merchantId,
    enabled: item.enabled === true,
    faceValueVnd: typeof item.faceValueVnd === "number" && item.faceValueVnd > 0 ? Math.floor(item.faceValueVnd) : 0,
    minSpendVnd: typeof item.minSpendVnd === "number" && item.minSpendVnd > 0 ? Math.floor(item.minSpendVnd) : 0,
    scopeName: typeof item.scopeName === "string" ? item.scopeName : "",
    validityDays: typeof item.validityDays === "number" && item.validityDays > 0 ? Math.floor(item.validityDays) : 0,
  };
}

// MERCHANT-CREATOR-PROMO-001：专属码二维码载荷。扫出来就是这个字符串，
// 报码框认它（也认裸码，兼容手抄）。前缀防误扫 —— 随手扫到别的二维码，
// 形状对不上直接拒，不会把电话号码当成码报上去。
export function promoQrValue(code: string): string {
  return `PROXY-PROMO:${code.trim().toUpperCase()}`;
}

// MERCHANT-CREATOR-PROMO-002：也认商家 × creator 专属码（AN-WORKSHOP，带横杠）。
export const PAIR_PROMO_CODE_RE = /^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}(-[2-9])?$/;

export function parsePromoQr(text: string): string | undefined {
  const raw = text.trim();
  const code = raw.startsWith("PROXY-PROMO:") ? raw.slice("PROXY-PROMO:".length) : raw;
  const normalized = code.trim().toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(normalized) || PAIR_PROMO_CODE_RE.test(normalized) ? normalized : undefined;
}

// 顾客券包里那张券的二维码：店员扫它核销，新客由系统按顾客身份判定。
export function couponQrValue(couponId: string): string {
  return `PROXY-COUPON:${couponId.trim()}`;
}

export function parseCouponQr(text: string): string | undefined {
  const raw = text.trim();
  if (!raw.startsWith("PROXY-COUPON:")) return undefined;
  const id = raw.slice("PROXY-COUPON:".length).trim();
  return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : undefined;
}

// ---------------------------------------------------------------- MERCHANT-CREATOR-PROMO-002

export type PairPromoTerms = {
  minSpendVnd: number;
  faceValueVnd: number;
  displayText: string;
  scope: "STORE_CATEGORY" | "STORE_ALL";
  category: string;
  // 空 = 长期有效。
  validUntil: string;
};

export type PromoBasisItem = { key: string; label: string; value: string; available: boolean; effectBp: number };

export type PromoSuggestion = { percentBp: number; minSpendVnd: number; faceValueVnd: number; basis: PromoBasisItem[] };

export type MerchantCreatorPromo = {
  code: string;
  merchantId: string;
  merchantName: string;
  agentId: string;
  creatorName: string;
  terms: PairPromoTerms;
  status: string;
  mode: "SUGGESTED" | "MANUAL";
  suggestion: PromoSuggestion;
  note: string;
};

export type PairPromoStats = { issued: number; redeemed: number; couponRedeem: number; newCustomers: number; spendVnd: number; discountVnd: number };

export type PromoChange = { id: string; before: PairPromoTerms; after: PairPromoTerms; mode: string; note: string; changedAt: string };

export type PairPromoView = { promo: MerchantCreatorPromo; stats: PairPromoStats; lastChange?: PromoChange | undefined };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function parsePairPromoTerms(value: unknown): PairPromoTerms {
  const t = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    minSpendVnd: Math.max(0, Math.floor(num(t.minSpendVnd))),
    faceValueVnd: Math.max(0, Math.floor(num(t.faceValueVnd))),
    displayText: str(t.displayText),
    scope: t.scope === "STORE_CATEGORY" ? "STORE_CATEGORY" : "STORE_ALL",
    category: str(t.category),
    validUntil: str(t.validUntil),
  };
}

export function parsePromoSuggestion(value: unknown): PromoSuggestion {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const basis = Array.isArray(v.basis) ? v.basis.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== "object") return [];
    const b = raw as Record<string, unknown>;
    return typeof b.key === "string" ? [{ key: b.key, label: str(b.label), value: str(b.value), available: b.available === true, effectBp: num(b.effectBp) }] : [];
  }) : [];
  return { percentBp: num(v.percentBp), minSpendVnd: num(v.minSpendVnd), faceValueVnd: num(v.faceValueVnd), basis };
}

export function parseMerchantCreatorPromo(value: unknown): MerchantCreatorPromo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Record<string, unknown>;
  if (typeof p.code !== "string" || p.code === "" || typeof p.agentId !== "string") return undefined;
  return {
    code: p.code,
    merchantId: str(p.merchantId),
    merchantName: str(p.merchantName),
    agentId: p.agentId,
    creatorName: str(p.creatorName),
    terms: parsePairPromoTerms(p.terms),
    status: str(p.status) || "ACTIVE",
    mode: p.mode === "MANUAL" ? "MANUAL" : "SUGGESTED",
    suggestion: parsePromoSuggestion(p.suggestion),
    note: str(p.note),
  };
}

export function parsePairPromoStats(value: unknown): PairPromoStats {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { issued: num(v.issued), redeemed: num(v.redeemed), couponRedeem: num(v.couponRedeem), newCustomers: num(v.newCustomers), spendVnd: num(v.spendVnd), discountVnd: num(v.discountVnd) };
}

function parsePromoChange(value: unknown): PromoChange | undefined {
  if (!value || typeof value !== "object") return undefined;
  const c = value as Record<string, unknown>;
  return { id: str(c.id), before: parsePairPromoTerms(c.before), after: parsePairPromoTerms(c.after), mode: str(c.mode), note: str(c.note), changedAt: str(c.changedAt) };
}

export function parsePairPromoViews(value: unknown): PairPromoView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== "object") return [];
    const v = raw as Record<string, unknown>;
    const promo = parseMerchantCreatorPromo(v.promo);
    if (!promo) return [];
    const lastChange = parsePromoChange(v.lastChange);
    return [lastChange ? { promo, stats: parsePairPromoStats(v.stats), lastChange } : { promo, stats: parsePairPromoStats(v.stats) }];
  });
}

export type PromoCoupon = { couponId: string; code: string; merchantId: string; agentId: string; issuedAt: string; promo: MerchantCreatorPromo | undefined; redeemed: boolean };

export function parsePromoCoupon(value: unknown, promo: unknown, redeemed: unknown): PromoCoupon | undefined {
  if (!value || typeof value !== "object") return undefined;
  const c = value as Record<string, unknown>;
  if (typeof c.couponId !== "string" || c.couponId === "") return undefined;
  return { couponId: c.couponId, code: str(c.code), merchantId: str(c.merchantId), agentId: str(c.agentId), issuedAt: str(c.issuedAt), promo: parseMerchantCreatorPromo(promo), redeemed: redeemed === true };
}

export function parsePromoStats(value: unknown): PromoStats {
  const fallback: PromoStats = { byCode: {}, quotes: 0, firstVisits: 0, attributedVnd: 0, discountGivenVnd: 0 };
  if (!value || typeof value !== "object") return fallback;
  const item = value as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && v > 0 ? Math.floor(v) : 0);
  const byCode: PromoStats["byCode"] = {};
  if (item.byCode && typeof item.byCode === "object") {
    for (const [code, entry] of Object.entries(item.byCode as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      byCode[code] = {
        quotes: num(record.quotes),
        firstVisits: num(record.firstVisits),
        attributedVnd: num(record.attributedVnd),
        discountGivenVnd: num(record.discountGivenVnd),
      };
    }
  }
  return {
    byCode,
    quotes: num(item.quotes),
    firstVisits: num(item.firstVisits),
    attributedVnd: num(item.attributedVnd),
    discountGivenVnd: num(item.discountGivenVnd),
  };
}

export class SupplyClient {
  private seq = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async getAgentPassport(agentId?: string): Promise<AgentPassport> {
    const payload: Record<string, unknown> = {};
    if (agentId) payload.agentId = agentId;
    const body = this.body(await this.command("GetAgentPassport", { type: "AgentProfile", id: agentId ?? "mine" }, payload));
    // CREATOR-PROFILE-001：走解析不裸 cast —— SUPPLY-BODY-001 同一条规矩，
    // 解析不出对象就抛，不能静默返回 {} 假装"这个人没资料"。
    const parsed = parseAgentPassport(body);
    if (!parsed) throw new SupplyProtocolError("agent passport malformed");
    return parsed;
  }

  // CREATOR-SOCIAL-001：社媒绑定/解绑（只能绑自己的，服务端按 principal 校验）。
  public async linkAgentSocial(input: { agentId: string; platform: string; handle: string; visibility?: string }): Promise<AgentSocial[]> {
    const payload: Record<string, unknown> = { agentId: input.agentId };
    payload.platform = input.platform;
    payload.handle = input.handle;
    if (input.visibility) payload.visibility = input.visibility;
    const body = this.body(await this.command("LinkAgentSocial", { type: "AgentProfile", id: input.agentId }, payload));
    const raw = (body as Record<string, unknown>).socials;
    return Array.isArray(raw) ? (parseAgentPassport({ profile: { agentId: input.agentId, name: "", socials: raw } })?.profile.socials ?? []) : [];
  }

  public async unlinkAgentSocial(input: { agentId: string; platform: string }): Promise<void> {
    await this.command("UnlinkAgentSocial", { type: "AgentProfile", id: input.agentId }, { agentId: input.agentId, platform: input.platform });
  }

  public async declareCapability(input: { capability: string }): Promise<void> {
    await this.command("DeclareCapability", { type: "AgentProfile", id: "mine" }, input as unknown as Record<string, unknown>);
  }

  public async verifyCapability(input: { agentId: string; capability: string }): Promise<void> {
    await this.command("VerifyCapability", { type: "AgentProfile", id: input.agentId }, input as unknown as Record<string, unknown>);
  }

  public async setAvailabilityWindow(input: { startAt: string; endAt: string; marketId: string }): Promise<{ windowId: string }> {
    const body = this.body(await this.command("SetAvailabilityWindow", { type: "AvailabilityWindow", id: "new" }, input as unknown as Record<string, unknown>));
    return { windowId: (body.windowId as string) ?? (body.id as string) ?? "" };
  }

  public async querySuppliers(input: { marketId?: string; capability?: string; limit?: number }): Promise<SupplierCandidate[]> {
    // 后端 QuerySuppliers 要求 marketId + startAt + durationH，capability 映射到 Capabilities/Languages
    const startAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    const payload: Record<string, unknown> = {
      marketId: input.marketId ?? "hn",
      startAt,
      durationH: 8,
      serviceType: "CITY_COMPANION",
      languages: input.capability ? [input.capability] : undefined,
      capabilities: input.capability ? [input.capability] : undefined,
    };
    // 清理 undefined
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    const body = this.body(await this.command("QuerySuppliers", { type: "AgentProfile", id: "query" }, payload));
    return parseSupplierCandidates(body.suppliers ?? body.candidates).slice(0, input.limit ?? 20);
  }

  // MERCHANT-CREATOR-INVITE-001：商家发定向邀约。merchantId 进 payload，
  // 网关验成员身份后盖章（伪造别人 merchantId 到不了 service）。
  // 出价是区间（min==max 即一口价）；purpose 必填三选一+其他。
  public async inviteCreator(input: { merchantId: string; agentId: string } & CollabInvitationTerms): Promise<CollabInvitation> {
    const payload: Record<string, unknown> = {
      merchantId: input.merchantId, agentId: input.agentId, serviceType: "CITY_COMPANION",
      priceMinVnd: input.priceMinVnd, priceMaxVnd: input.priceMaxVnd,
      negotiable: input.negotiable, purpose: input.purpose,
    };
    if (input.message !== undefined) payload.message = input.message;
    if (input.startAt !== undefined) payload.startAt = input.startAt;
    if (input.durationH !== undefined) payload.durationH = input.durationH;
    const body = this.body(await this.command("InviteCreator", { type: "CollabInvitation", id: "new" }, payload));
    const parsed = parseCollabInvitation(body.invitation);
    if (!parsed) throw new SupplyProtocolError("invitation malformed");
    return parsed;
  }

  public async listSentInvitations(input: { merchantId: string }): Promise<CollabInvitation[]> {
    const body = this.body(await this.command("ListCollabInvitations", { type: "CollabInvitation", id: "query" }, { merchantId: input.merchantId, role: "sent" }));
    return parseCollabInvitations(body.invitations);
  }

  public async cancelInvitation(input: { merchantId: string; invitationId: string }): Promise<void> {
    await this.command("CancelCollabInvitation", { type: "CollabInvitation", id: input.invitationId }, { merchantId: input.merchantId, invitationId: input.invitationId });
  }

  // MERCHANT-CREATOR-PROMO-001：专属营销码 client。认领/查码走 creator 本人口径；
  // 绑定/报码/查绑定查报码走 merchantId（网关盖章，和邀约同一套）。
  public async claimPromoCode(input: { agentId: string; code: string }): Promise<PromoCode> {
    const body = this.body(await this.command("ClaimPromoCode", { type: "PromoCode", id: "new" }, { agentId: input.agentId, code: input.code }));
    const parsed = parsePromoCode(body.promoCode);
    if (!parsed) throw new SupplyProtocolError("promo code malformed");
    return parsed;
  }

  public async listMyPromoCodes(): Promise<PromoCode[]> {
    const body = this.body(await this.command("ListPromoAssets", { type: "PromoCode", id: "query" }, { role: "my" }));
    if (!Array.isArray(body.promoCodes)) return [];
    return body.promoCodes.flatMap((entry: unknown) => {
      const parsed = parsePromoCode(entry);
      return parsed ? [parsed] : [];
    });
  }

  public async myPromoStats(): Promise<PromoStats> {
    const body = this.body(await this.command("GetPromoStats", { type: "PromoStats", id: "mine" }, { role: "mine" }));
    return parsePromoStats(body.stats);
  }

  public async disablePromoCode(input: { code: string }): Promise<void> {
    await this.command("DisablePromoCode", { type: "PromoCode", id: input.code }, { code: input.code });
  }

  public async disablePromoBenefit(input: { merchantId: string; code: string }): Promise<void> {
    await this.command("DisablePromoBenefit", { type: "PromoBenefit", id: input.code }, { merchantId: input.merchantId, code: input.code });
  }

  public async bindPromoBenefit(input: { merchantId: string; code: string; faceValueVnd: number; minSpendVnd?: number; scopeName: string; validUntil: string; note?: string }): Promise<PromoBenefit> {
    const body = this.body(await this.command("BindPromoBenefit", { type: "PromoBenefit", id: "new" }, {
      merchantId: input.merchantId, code: input.code, faceValueVnd: input.faceValueVnd,
      minSpendVnd: input.minSpendVnd ?? 0, scopeName: input.scopeName, validUntil: input.validUntil,
      ...(input.note ? { note: input.note } : {}),
    }));
    const parsed = parsePromoBenefit(body.benefit);
    if (!parsed) throw new SupplyProtocolError("promo benefit malformed");
    return parsed;
  }

  public async listMerchantBenefits(input: { merchantId: string }): Promise<{ benefits: PromoBenefit[]; autoBenefit?: PromoAutoBenefit | undefined }> {
    const body = this.body(await this.command("ListPromoAssets", { type: "PromoBenefit", id: "query" }, { merchantId: input.merchantId, role: "bound" }));
    const benefits = Array.isArray(body.benefits) ? body.benefits.flatMap((entry: unknown) => {
      const parsed = parsePromoBenefit(entry);
      return parsed ? [parsed] : [];
    }) : [];
    const auto = parsePromoAutoBenefit(body.autoBenefit);
    return auto ? { benefits, autoBenefit: auto } : { benefits };
  }

  // MERCHANT-CREATOR-PROMO-001：自动档。开一次，以后没绑过的码来报码自动建绑定。
  public async setAutoPromoBenefit(input: { merchantId: string; enabled: boolean; faceValueVnd?: number; minSpendVnd?: number; scopeName?: string; validityDays?: number }): Promise<PromoAutoBenefit> {
    const payload: Record<string, unknown> = { merchantId: input.merchantId, enabled: input.enabled };
    if (input.faceValueVnd !== undefined) payload.faceValueVnd = input.faceValueVnd;
    if (input.minSpendVnd !== undefined) payload.minSpendVnd = input.minSpendVnd;
    if (input.scopeName !== undefined) payload.scopeName = input.scopeName;
    if (input.validityDays !== undefined) payload.validityDays = input.validityDays;
    const body = this.body(await this.command("SetAutoPromoBenefit", { type: "PromoAutoBenefit", id: "mine" }, payload));
    const parsed = parsePromoAutoBenefit(body.autoBenefit);
    if (!parsed) throw new SupplyProtocolError("auto benefit malformed");
    return parsed;
  }

  public async quotePromoCode(input: { merchantId: string; code: string; couponId?: string; amountVnd?: number; firstVisit?: boolean }): Promise<{ quote: PromoQuote; faceValueVnd: number; minSpendVnd: number; scopeName: string }> {
    const payload: Record<string, unknown> = { merchantId: input.merchantId, code: input.code };
    if (input.couponId) payload.couponId = input.couponId;
    if (input.amountVnd !== undefined) payload.amountVnd = input.amountVnd;
    if (input.firstVisit !== undefined) payload.firstVisit = input.firstVisit;
    const body = this.body(await this.command("QuotePromoCode", { type: "PromoQuote", id: "new" }, payload));
    const quote = parsePromoQuote(body.quote);
    const benefit = (body.benefit ?? {}) as Record<string, unknown>;
    if (!quote) throw new SupplyProtocolError("promo quote malformed");
    return {
      quote,
      faceValueVnd: typeof benefit.faceValueVnd === "number" ? benefit.faceValueVnd : 0,
      minSpendVnd: typeof benefit.minSpendVnd === "number" && benefit.minSpendVnd > 0 ? benefit.minSpendVnd : 0,
      scopeName: typeof benefit.scopeName === "string" ? benefit.scopeName : "",
    };
  }

  // ---------------------------------------------------------------- MERCHANT-CREATOR-PROMO-002

  // 品类不由客户端传：服务端读本店门店资料。merchantName 只在门店资料读不到时用作码里的店名段。
  public async issueMerchantCreatorPromo(input: { merchantId: string; agentId: string; merchantName: string }): Promise<MerchantCreatorPromo> {
    const body = this.body(await this.command("IssueMerchantCreatorPromo", { type: "MerchantCreatorPromo", id: "new" }, { ...input }));
    const parsed = parseMerchantCreatorPromo(body.promo);
    if (!parsed) throw new SupplyProtocolError("merchant creator promo malformed");
    return parsed;
  }

  public async adjustMerchantCreatorPromo(input: {
    merchantId: string; code: string; applySuggestion?: boolean; minSpendVnd?: number; faceValueVnd?: number;
    displayText?: string; scope?: "STORE_CATEGORY" | "STORE_ALL"; validityDays?: number; note?: string; disable?: boolean;
  }): Promise<MerchantCreatorPromo> {
    const body = this.body(await this.command("AdjustMerchantCreatorPromo", { type: "MerchantCreatorPromo", id: input.code }, { ...input }));
    const parsed = parseMerchantCreatorPromo(body.promo);
    if (!parsed) throw new SupplyProtocolError("merchant creator promo malformed");
    return parsed;
  }

  // 打开就自动给本店市场里还没有码的 creator 发码（服务端做，商家不用逐个生成）。
  public async listMerchantCreatorPromos(input: { merchantId: string; marketId: string; merchantName: string }): Promise<{ promos: PairPromoView[]; totals: PairPromoStats; conversionBp: number; storeCategory: string; storeCategoryRaw: string }> {
    const body = this.body(await this.command("ListMerchantCreatorPromos", { type: "MerchantCreatorPromo", id: "query" }, { merchantId: input.merchantId, marketId: input.marketId, merchantName: input.merchantName }));
    return {
      promos: parsePairPromoViews(body.promos), totals: parsePairPromoStats(body.totals),
      conversionBp: typeof body.conversionBp === "number" ? body.conversionBp : -1,
      storeCategory: typeof body.storeCategory === "string" ? body.storeCategory : "",
      storeCategoryRaw: typeof body.storeCategoryRaw === "string" ? body.storeCategoryRaw : "",
    };
  }

  public async merchantCreatorPromoBasis(input: { merchantId: string; code: string }): Promise<{ suggestion: PromoSuggestion; changes: PromoChange[] }> {
    const body = this.body(await this.command("GetMerchantCreatorPromoBasis", { type: "MerchantCreatorPromo", id: input.code }, { merchantId: input.merchantId, code: input.code }));
    const changes = Array.isArray(body.changes) ? body.changes.flatMap((c: unknown) => { const parsed = parsePromoChange(c); return parsed ? [parsed] : []; }) : [];
    return { suggestion: parsePromoSuggestion(body.suggestion), changes };
  }

  // 顾客扫 creator 的专属码领券（每人每码一张，再领返回原来那张）。
  public async claimPromoCoupon(input: { code: string }): Promise<{ coupon: PromoCoupon; alreadyClaimed: boolean }> {
    const body = this.body(await this.command("ClaimPromoCoupon", { type: "PromoIssue", id: "new" }, { code: input.code }));
    const coupon = parsePromoCoupon(body.coupon, body.promo, false);
    if (!coupon) throw new SupplyProtocolError("promo coupon malformed");
    return { coupon, alreadyClaimed: body.alreadyClaimed === true };
  }

  public async listMyPromoCoupons(): Promise<PromoCoupon[]> {
    const body = this.body(await this.command("ListMyPromoCoupons", { type: "PromoIssue", id: "mine" }, {}));
    return Array.isArray(body.coupons) ? body.coupons.flatMap((raw: unknown) => {
      const v = (raw ?? {}) as Record<string, unknown>;
      const parsed = parsePromoCoupon(v.coupon, v.promo, v.redeemed);
      return parsed ? [parsed] : [];
    }) : [];
  }

  // creator 看自己在每家店的专属码和战绩。
  public async listMyMerchantPromos(input: { agentId: string }): Promise<{ promos: Array<{ promo: MerchantCreatorPromo; stats: PairPromoStats }>; totals: PairPromoStats }> {
    const body = this.body(await this.command("ListMyMerchantPromos", { type: "MerchantCreatorPromo", id: input.agentId }, { agentId: input.agentId }));
    const promos = Array.isArray(body.promos) ? body.promos.flatMap((raw: unknown) => {
      const v = (raw ?? {}) as Record<string, unknown>;
      const promo = parseMerchantCreatorPromo(v.promo);
      return promo ? [{ promo, stats: parsePairPromoStats(v.stats) }] : [];
    }) : [];
    return { promos, totals: parsePairPromoStats(body.totals) };
  }

  public async merchantPromoStats(input: { merchantId: string }): Promise<PromoStats> {
    const body = this.body(await this.command("GetPromoStats", { type: "PromoStats", id: "query" }, { merchantId: input.merchantId, role: "merchant" }));
    return parsePromoStats(body.stats);
  }

  // MERCHANT-CREATOR-INVITE-001：creator 收邀约 + 回复。principal 就是 agent 本人，
  // 服务端按 Principal.ID == agentID 校验 —— 调这个方法的面必须保证是本人视角。
  public async listReceivedInvitations(): Promise<CollabInvitation[]> {
    const body = this.body(await this.command("ListCollabInvitations", { type: "CollabInvitation", id: "query" }, { role: "received" }));
    return parseCollabInvitations(body.invitations);
  }

  public async respondInvitation(input: { invitationId: string; decision: "ACCEPTED" | "DECLINED" | "COUNTERED"; merchantId?: string | undefined } & Partial<CollabInvitationTerms>): Promise<CollabInvitation> {
    const payload: Record<string, unknown> = { invitationId: input.invitationId, decision: input.decision };
    // 商家回合（COUNTERED 的接受/拒绝/再议）带 merchantId，网关验成员身份后盖章；
    // creator 侧不带，走 Principal.ID == agentID 口径。
    if (input.merchantId) payload.merchantId = input.merchantId;
    if (input.decision === "COUNTERED") {
      payload.priceMinVnd = input.priceMinVnd ?? 0;
      payload.priceMaxVnd = input.priceMaxVnd ?? 0;
      payload.negotiable = input.negotiable ?? true;
      payload.purpose = input.purpose ?? "";
      if (input.message !== undefined) payload.message = input.message;
      if (input.startAt !== undefined) payload.startAt = input.startAt;
      if (input.durationH !== undefined) payload.durationH = input.durationH;
    }
    const body = this.body(await this.command("RespondCollabInvitation", { type: "CollabInvitation", id: input.invitationId }, payload));
    const parsed = parseCollabInvitation(body.invitation);
    if (!parsed) throw new SupplyProtocolError("invitation malformed");
    return parsed;
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (p: string) => `mobile_supply_${p}_${Date.now().toString(36)}_${(++this.seq).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "supply",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("supply command malformed");
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "supply rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected supply status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("supply actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    return parseSupplyBody(result.operationRef);
  }
}
