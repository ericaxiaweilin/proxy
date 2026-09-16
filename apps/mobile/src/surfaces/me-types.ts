import type { ExperienceAction } from "@proxy/contracts";

// PROFILE-QR-004：`qrPayload` / `qrTitle` 是可选的二维码透传 —— 商家卡片画的是
// 店铺码，就必须在打开「我的二维码」页时把店铺码带进去，不许页里偷偷画成个人码。
export type MeSubPage = {
  title: string;
  desc: string;
  icon: string;
  route: string;
  qrPayload?: string | undefined;
  qrTitle?: string | undefined;
} | undefined;
export type AvailabilityState = "AVAILABLE" | "BUSY" | "PAUSED" | "HIDDEN";

// R18.x HUB-PROFILE-001: the me-hub top card (profile
// card + identity card) used to render the hardcoded
// `persona.name` + `persona.avatarText` ("Huyen" / "H")
// for the requester and "Bonsaidon" / "B" for the
// business, regardless of who was actually signed in.
// The user-profile name + handle + city + avatar are
// already hydrated from profileStore (and post-save
// from server via ProfileClient); the hub card just
// never read them. resolveHubProfile() projects those
// fields onto a tiny shape the render path uses:
//
//   - displayName: profileStore name if non-empty,
//     else fall back to the persona hardcode so the
//     card never renders blank for a freshly-installed
//     user that has not yet edited their profile.
//   - initial: first grapheme of the display name.
//   - city: profileStore city, else the persona city.
//   - handle: at-prefixed handle, or empty string if
//     the user has not set one yet.
//
// Centralising the resolver here means the hub card,
// the identity card, and the future 个人总管理 /
// 个人主页 cards all use the same precedence and
// we can tripwire the "real profile reaches the hub"
// property with one small vitest.
export interface HubProfile {
  displayName: string;
  initial: string;
  city: string;
  handle: string;
  hasAvatar: boolean;
}

export interface HubProfileInput {
  personaName: string;
  personaAvatarText: string;
  personaCity: string;
  profileName?: string;
  profileCity?: string;
  profileHandle?: string;
  hasAvatar: boolean;
}

export function resolveHubProfile(input: HubProfileInput): HubProfile {
  const profileName = (input.profileName ?? "").trim();
  const fallbackName = profileName.length > 0 ? profileName : input.personaName;
  const initial = (fallbackName || input.personaAvatarText).slice(0, 1).toUpperCase();
  const city = (input.profileCity ?? "").trim() || input.personaCity;
  const handle = (input.profileHandle ?? "").trim();
  return {
    displayName: fallbackName,
    initial,
    city,
    handle: handle.length > 0 ? (handle.startsWith("@") ? handle : `@${handle}`) : "",
    hasAvatar: input.hasAvatar,
  };
}
export type EnterpriseOpsStage = "READY" | "DRAFT_READY" | "CONFIRMED" | "PUBLISHED";

export interface MenuRow {
  icon: string;
  label: string;
  desc: string;
  grad?: boolean;
  action?: ExperienceAction;
  route?: string;
}

export interface MenuSection {
  id?: string;
  title: string;
  hint: string;
  rows: MenuRow[];
}

export type PersonalHubTab = "FEED" | "PHOTOS" | "RECORDS";
export type SocialVisibility = "仅自己" | "商家可见" | "公开展示";
export type SocialAccount = { key: string; mark: string; dark?: boolean; name: string; handle: string; url: string; visibility: SocialVisibility };

export const INITIAL_SOCIAL_ACCOUNTS: SocialAccount[] = [
  { key: "tiktok", mark: "TT", dark: true, name: "TikTok", handle: "", url: "", visibility: "仅自己" },
  { key: "zalo", mark: "Z", name: "Zalo", handle: "", url: "", visibility: "仅自己" },
  { key: "instagram", mark: "IG", name: "Instagram", handle: "", url: "", visibility: "仅自己" },
  { key: "linkedin", mark: "in", name: "LinkedIn", handle: "", url: "", visibility: "仅自己" },
  { key: "x", mark: "X", dark: true, name: "X", handle: "", url: "", visibility: "仅自己" }
];

export const AVAILABILITY_OPTIONS: ReadonlyArray<{ id: AvailabilityState; title: string; desc: string }> = [
  { id: "AVAILABLE", title: "可接单", desc: "进入人物发现与合适机会分发" },
  { id: "BUSY", title: "忙碌", desc: "保留主页，降低即时机会" },
  { id: "PAUSED", title: "暂不接单", desc: "暂停机会分发" },
  { id: "HIDDEN", title: "隐身", desc: "从公开人物发现中隐藏" }
];

export type AbilityType = "同行" | "翻译" | "拍照";

export type AbilityInstance = {
  id: string;
  type: AbilityType;
  fields: Array<{ label: string; value: string }>;
  note?: string;
};

export const ABILITY_SCHEMAS: Record<AbilityType, { icon: string; subtitle: string; fields: Array<{ id: string; label: string; shortLabel: string; type: "select" | "chips"; options: string[] }> }> = {
  "同行": {
    icon: "◎",
    subtitle: "现实场景陪伴与本地协助",
    fields: [
      { id: "area", label: "服务区域", shortLabel: "区域", type: "select", options: ["河内", "胡志明市", "岘港"] },
      { id: "topic", label: "主题", shortLabel: "主题", type: "chips", options: ["旅行", "消费", "美食", "购物", "城市探索"] },
      { id: "mode", label: "服务方式", shortLabel: "方式", type: "chips", options: ["线下"] },
      { id: "time", label: "时间规则", shortLabel: "时间", type: "chips", options: ["跟随未来30天行程", "仅已安排时段"] }
    ]
  },
  "翻译": {
    icon: "译",
    subtitle: "消费与日常场景的现场沟通",
    fields: [
      { id: "pair", label: "语言组合", shortLabel: "语言", type: "select", options: ["中文 ↔ 越南语", "英语 ↔ 越南语", "中文 ↔ 英语"] },
      { id: "scene", label: "适用场景", shortLabel: "场景", type: "chips", options: ["消费", "日常", "旅行", "简单商务"] },
      { id: "mode", label: "服务方式", shortLabel: "方式", type: "chips", options: ["线下", "语音", "视频"] },
      { id: "area", label: "线下区域", shortLabel: "区域", type: "select", options: ["河内", "胡志明市", "岘港", "不限"] }
    ]
  },
  "拍照": {
    icon: "⌁",
    subtitle: "旅行与消费场景的轻量拍摄",
    fields: [
      { id: "scene", label: "拍摄场景", shortLabel: "场景", type: "chips", options: ["旅行", "探店", "人物", "活动"] },
      { id: "device", label: "设备", shortLabel: "设备", type: "chips", options: ["手机", "相机"] },
      { id: "area", label: "服务区域", shortLabel: "区域", type: "select", options: ["河内", "胡志明市", "岘港"] },
      { id: "time", label: "时间规则", shortLabel: "时间", type: "chips", options: ["跟随未来30天行程", "仅已安排时段"] }
    ]
  }
};

export const DEFAULT_ABILITIES: AbilityInstance[] = [
  {
    id: "companion",
    type: "同行",
    fields: [
      { label: "区域", value: "河内" },
      { label: "主题", value: "旅行 / 消费" },
      { label: "方式", value: "线下" },
      { label: "时间", value: "跟随行程" }
    ]
  },
  {
    id: "translation",
    type: "翻译",
    fields: [
      { label: "语言", value: "中文 ↔ 越南语" },
      { label: "场景", value: "消费 / 日常" },
      { label: "方式", value: "线下" },
      { label: "区域", value: "河内" }
    ]
  }
];

export type AvailabilityRule = { days: number[]; start: number; end: number };
export type AvOverride = { type: "full" | "off" | "custom"; start?: number; end?: number };

export function avKeyOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function avFmt(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function describeAvRule(rule: AvailabilityRule): string {
  const sorted = [...rule.days].sort((a, b) => a - b);
  let prefix = "自定义";
  if (sorted.length === 7) prefix = "每天";
  else if (JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5])) prefix = "工作日";
  else if (JSON.stringify(sorted) === JSON.stringify([0, 6])) prefix = "周末";
  return `${prefix} · ${avFmt(rule.start)}–${avFmt(rule.end)}`;
}

export function avStateFor(d: Date, rule: AvailabilityRule, overrides: Record<string, AvOverride>): { type: "base" | "full" | "off" | "custom" | "blank"; start?: number; end?: number } {
  const ov = overrides[avKeyOf(d)];
  if (ov) return ov;
  if (rule.days.includes(d.getDay())) return { type: "base", start: rule.start, end: rule.end };
  return { type: "blank" };
}

export const AV_DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

export function nextDays(count: number): Array<{ key: string; date: Date; label: string }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const key = avKeyOf(date);
    const label = index === 0 ? "今天" : index === 1 ? "明天" : `${date.getMonth() + 1}/${date.getDate()} 周${AV_DAY_NAMES[date.getDay()]}`;
    return { key, date, label };
  });
}

// R18.x HUB-SOCIAL-001: the me-hub top card used to
// render the hardcoded persona.profileCard.social
// (["TT","Z","IG","in"]) no matter what the user
// actually configured in the social accounts editor.
// resolveHubSocials() projects the live socialAccounts
// list onto a small shape the render path can iterate:
//   - empty handle → hide (the user has not set it up)
//   - visibility != "公开展示" → hide (the user opted
//     the row out of the public hub card)
//   - otherwise expose {key, mark, dark} so the card
//     can pick a style. When the list is empty after
//     the filter, expose isEmpty so the card can swap
//     to a "去 我的 → 社媒账户 设置" hint instead of
//     showing a meaningless blank row.
export interface HubSocial {
  key: string;
  mark: string;
  dark: boolean;
}

export function resolveHubSocials(accounts: ReadonlyArray<SocialAccount>): { visible: HubSocial[]; isEmpty: boolean } {
  const visible = accounts
    .filter((account) => account.handle.trim().length > 0 && account.visibility === "公开展示")
    .map((account) => ({ key: account.key, mark: account.mark, dark: Boolean(account.dark) }));
  return { visible, isEmpty: visible.length === 0 };
}
