// MERCHANT-CREATOR-TAGS-001：能力编码 → 商家侧中文标签的唯一实现。
//
// 为什么单独一个文件：和 creator-pricing.ts 同一个理由 —— 没有 RN 依赖，
// 边界能被单元测试真的断言，而不是只 grep 源码。
// 标签文案抄 skill-workspace.tsx 的静态 SKILLS 目录（运营 Source of Truth）；
// 目录里没有的编码原样透出（那是服务端给的真值，不编一个假中文盖住它）。
const KNOWN_CAPABILITY_LABELS: Record<string, string> = {
  ZH: "中文",
  EN: "英语",
  VI: "越南语",
  PHOTOGRAPHY: "摄影",
  HOSTING: "主持",
  GUIDE: "城市向导",
  TRANSLATION: "同传/陪同翻译",
  EVENT_OPS: "活动执行",
};

/** 能力编码转商家侧标签。未知编码原样返回，不编造。 */
export function labelCapability(code: string): string {
  return KNOWN_CAPABILITY_LABELS[code] ?? code;
}

/** 商家列表卡要印的标签：已验证能力转中文，最多 max 个（默认 2）。 */
export function visibleCapabilityTags(codes: string[] | undefined, max = 2): string[] {
  if (!Array.isArray(codes)) return [];
  return codes
    .filter((code): code is string => typeof code === "string" && code.length > 0)
    .slice(0, Math.max(0, max))
    .map(labelCapability);
}

// MERCHANT-CREATOR-TAGS-001：商家必看三标签 —— 类型 / 服务范围 / 粉丝。
// 类型是 serviceType 枚举的展示名，范围是 marketId→城市，粉丝数没有聚合
// 来源所以印已关联社媒账号（去平台自验）。未知编码原样透出，不编造。

const SERVICE_TYPE_LABELS: Record<string, string> = {
  CITY_COMPANION: "本地生活",
};

/** 服务类型转中文。未知类型原样返回。 */
export function labelServiceType(code: string): string {
  return SERVICE_TYPE_LABELS[code] ?? code;
}

const MARKET_LABELS: Record<string, string> = {
  hn: "河内",
  hcm: "胡志明",
};

/** marketId 转城市中文。未知市场原样返回。空返回空字符串（调用方不渲染）。 */
export function labelMarket(marketId: string | undefined): string {
  if (!marketId) return "";
  return MARKET_LABELS[marketId] ?? marketId;
}

const SOCIAL_EMOJI: Record<string, string> = {
  tiktok: "🎵",
  instagram: "📷",
  facebook: "📘",
  zalo: "💬",
};

/** 社媒账号转标签，如 `🎵 @linh_hanoi`。handle 为空返回空字符串（不渲染）。 */
export function labelSocial(platform: string, handle: string): string {
  if (!handle) return "";
  const mark = SOCIAL_EMOJI[platform] ?? "🔗";
  return `${mark} @${handle}`;
}

// MERCHANT-CREATOR-TAGS-001：粉丝数是创作者自填（和报价一个性质），
// 商家点账号去平台自验。每个 creator 必有该字段（缺失记 0=未披露），
// 所以这里 0 也照印 —— “没有就是 bug”，调用方不许再判空隐藏。
export function formatFansCount(count: number | undefined): string {
  if (typeof count !== "number" || !(count >= 0)) return "0";
  const n = Math.floor(count);
  if (n < 10000) return `${n}`;
  const w = n / 10000;
  return `${Number.isInteger(w) ? `${w}` : w.toFixed(1)}w`;
}

// MERCHANT-CREATOR-TAGS-001：评价分/等级分有真实来源 —— 服务端 matching.Score
// 的 Total（0..100；履约40/评价30/经验15/响应10/预算5）。
// 等级只是展示映射（分档阈值调这里），分永远是服务端算出来的，不手写。
// 无成交记录（hasTrackRecord=false）一律印「新人」：先验分是系统的保守估计，
// 不是她的成绩，不给她定级，也不把先验分当成绩印。
export function formatCreatorGrade(total: number | undefined, hasTrackRecord: boolean): string {
  if (!hasTrackRecord) return "新人";
  if (typeof total !== "number" || !(total >= 0)) return "新人";
  if (total >= 85) return "S";
  if (total >= 70) return "A";
  if (total >= 55) return "B";
  return "C";
}

// Total 带两位小数（53 / 87.5），展示去尾零。
export function formatCreatorScore(total: number | undefined): string {
  if (typeof total !== "number" || !(total >= 0)) return "—";
  return `${Math.round(total * 10) / 10}`;
}

// 整行标签：有记录印「S · 87.5分」，新人印「新人 · 暂无评价」。
// 老服务端不带 rating 时返回空串，调用方不渲染胶囊（不编）。
export function creatorRatingLabel(rating: { total: number; hasTrackRecord: boolean } | undefined): string {
  if (!rating) return "";
  if (!rating.hasTrackRecord) return "新人 · 暂无评价";
  return `${formatCreatorGrade(rating.total, true)} · ${formatCreatorScore(rating.total)}分`;
}

// MERCHANT-CREATOR-TAGS-001：语言一律写全称。中国用户不认 VI/ZH 这类缩写。
const LANGUAGE_LABELS: Record<string, string> = {
  ZH: "中文",
  VI: "越南语",
  EN: "英语",
};

/** 语言编码转全称。未知编码原样透出。 */
export function labelLanguage(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

// MERCHANT-CREATOR-TAGS-001：展示用垂类封闭名单。餐厅与咖啡并入“餐饮”；
// KTV/SPA 这类只允许被关联（匹配、详情、跳转都可以用），绝不明示 ——
// 不在名单里的编码在这里直接返回空字符串，调用方不渲染。这是产品红线。
const DISPLAY_VERTICAL_LABELS: Record<string, string> = {
  RESTAURANT: "餐饮",
  CAFE: "餐饮",
  TOUR: "旅游",
  SPORT: "运动",
};

/** 内容垂类转展示标签。不在展示名单的一律返回空（不明示）。 */
export function labelVertical(code: string): string {
  return DISPLAY_VERTICAL_LABELS[code] ?? "";
}
