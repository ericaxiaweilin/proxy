// activity-moments.ts — R58 创建活动二期的活动模板 + 发布映射。
//
// 模板内容（6 个活动）来自 R58 原型；一期为前端常量，后续可转服务端
// 配置。费用映射：免费→HOST_COVERS（加入者无到店支出）、AA→SPLIT、
// 自定义→SPLIT + 金额写入 desc（可见，不静默）；人数区间取上沿为席位。

import type { PublishActivityInput } from "./activity-client";

export type ActivityTemplate = {
  id: string;
  emoji: string;
  title: string;
  meta: string;
  defaultTime: string;
  venueName: string;
  venueIcon: string;
  venueType: "CAFE" | "RESTAURANT" | "PARK" | "LAKE" | "STREET" | "OTHER";
  defaultTheme: string;
  desc: string;
};

export const ACTIVITY_TEMPLATES: ActivityTemplate[] = [
  { id: "sunset-ride", emoji: "◎", title: "西湖日落骑行", meta: "4–6人 · 15:00–18:00", defaultTime: "周六 15:00–18:00", venueName: "西湖", venueIcon: "🚲", venueType: "LAKE", defaultTheme: "日落", desc: "一起骑行看日落" },
  { id: "film-walk", emoji: "▣", title: "老城区胶片街拍", meta: "3–6人 · 下午", defaultTime: "周日下午", venueName: "老城区", venueIcon: "📷", venueType: "STREET", defaultTheme: "胶片", desc: "胶片街拍漫游" },
  { id: "coffee-party", emoji: "☕", title: "周末咖啡局", meta: "4–8人 · 周末", defaultTime: "周六下午", venueName: "西湖", venueIcon: "☕", venueType: "CAFE", defaultTheme: "", desc: "周末咖啡小聚" },
  { id: "exhibition", emoji: "展", title: "一起看展", meta: "4–8人 · 下午", defaultTime: "周日下午", venueName: "美术馆", venueIcon: "🎫", venueType: "OTHER", defaultTheme: "", desc: "一起看展" },
  { id: "citywalk-local", emoji: "⌇", title: "本地人 City Walk", meta: "4–10人 · 半天", defaultTime: "周六下午", venueName: "老城区", venueIcon: "🚶", venueType: "STREET", defaultTheme: "本地人", desc: "本地人带路漫游" },
  { id: "ktv", emoji: "♪", title: "周末 KTV", meta: "4–8人 · 晚间", defaultTime: "周六晚", venueName: "老城区", venueIcon: "🎤", venueType: "OTHER", defaultTheme: "", desc: "周末 KTV 局" }
];

export const ACTIVITY_SIZES = [
  { label: "2–4 人", value: 4 },
  { label: "4–6 人", value: 6 },
  { label: "6–10 人", value: 10 }
];

export const ACTIVITY_TIMES = ["周六下午", "周日下午"];
export const ACTIVITY_THEMES = ["日落", "奥黛", "胶片", "本地人", "无主题"];
export const ACTIVITY_SIGNUPS = [
  { id: "OPEN", label: "自由报名" },
  { id: "REVIEW", label: "审核后加入" },
  { id: "INVITE_ONLY", label: "仅邀请" }
] as const;
export const ACTIVITY_FEES = [
  { id: "FREE", label: "免费" },
  { id: "AA", label: "AA" },
  { id: "CUSTOM", label: "自定义" }
] as const;

export type ActivityFeeId = (typeof ACTIVITY_FEES)[number]["id"];
export type ActivitySignupId = (typeof ACTIVITY_SIGNUPS)[number]["id"];

export type ActivitySpecs = {
  capacity: number;
  time: string;
  venueName: string;
  theme: string;
  signup: ActivitySignupId;
  fee: ActivityFeeId;
  customFee: string;
  notes: string;
};

export function defaultActivitySpecs(template: ActivityTemplate): ActivitySpecs {
  return {
    capacity: 6,
    time: template.defaultTime,
    venueName: template.venueName,
    theme: template.defaultTheme,
    signup: "OPEN",
    fee: "FREE",
    customFee: "",
    notes: template.desc
  };
}

/**
 * 向导规格映射为发布输入。费用：免费→HOST_COVERS、AA→SPLIT、
 * 自定义→SPLIT + 金额写入 desc 尾（可见）；人数取区间上沿。
 */
export function buildActivityPublishInput(
  template: ActivityTemplate,
  specs: ActivitySpecs,
  sceneId: string
): PublishActivityInput {
  const consumptionTerm = specs.fee === "FREE" ? "HOST_COVERS" : "SPLIT";
  const feeSuffix = specs.fee === "CUSTOM" && specs.customFee.trim() !== ""
    ? `\n费用安排：${specs.customFee.trim()}`
    : "";
  return {
    title: template.title,
    time: specs.time.trim() === "" ? template.defaultTime : specs.time.trim(),
    capacity: specs.capacity,
    venueName: specs.venueName.trim() === "" ? template.venueName : specs.venueName.trim(),
    venueIcon: template.emoji,
    venueType: template.venueType,
    realitySceneId: sceneId,
    desc: `${specs.notes.trim() === "" ? template.desc : specs.notes.trim()}${feeSuffix}`,
    consumptionTerm,
    signupMode: specs.signup,
    ...(specs.theme === "" || specs.theme === "无主题" ? {} : { theme: specs.theme })
  };
}
