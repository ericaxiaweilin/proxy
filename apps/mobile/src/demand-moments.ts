// demand-moments.ts — R58 发布需求一期的 Moment 模板 + 发布映射。
//
// 模板内容（6 个 Moment + 参考价）来自 R58 原型；一期为前端常量，
// 后续可转服务端配置。备注随机会落库展示（500 字内）；选人匹配走
// 二期草稿流，一期发布即公开市场。

import type { PublishMarketOpportunityInput } from "@proxy/contracts";
import type { SupplierCandidate } from "./supply-client";

export type MomentTemplate = {
  id: string;
  emoji: string;
  title: string;
  venue: string;
  venueLabel: string;
  ratios: string[];
  defaultRatio: string;
  defaultTime: string;
  defaultDuration: string;
  theme: string;
  /** 时间筛选标签（晚间/下午/周末）。 */
  timeTags: string[];
  skills: string;
  /** 参考价区间展示文案（如 "150–300K"）。 */
  priceRef: string;
  /** 默认填入的参考价。 */
  defaultPrice: string;
};

export const MOMENT_TEMPLATES: MomentTemplate[] = [
  { id: "coffee", emoji: "☕", title: "喝咖啡", venue: "咖啡馆", venueLabel: "咖啡馆 · 轻松见面", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "今晚 19:00", defaultDuration: "2 小时", theme: "咖啡", timeTags: ["晚间"], skills: "中文 · 轻松见面", priceRef: "150–300K", defaultPrice: "200,000₫" },
  { id: "meal", emoji: "餐", title: "吃饭", venue: "餐厅", venueLabel: "餐厅 · 默认 1:1", ratios: ["1:1", "≤ 3:1"], defaultRatio: "1:1", defaultTime: "今晚 18:30", defaultDuration: "2 小时", theme: "用餐", timeTags: ["晚间"], skills: "中文 · 本地餐厅", priceRef: "200–400K", defaultPrice: "300,000₫" },
  { id: "ktv", emoji: "♪", title: "唱歌", venue: "KTV", venueLabel: "KTV · 夜间 Moment", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "20:00–22:00", defaultDuration: "2 小时", theme: "唱歌", timeTags: ["晚间"], skills: "中文 · 夜间", priceRef: "300–500K", defaultPrice: "400,000₫" },
  { id: "photo", emoji: "相", title: "拍照", venue: "街区", venueLabel: "街拍 / 旅行照", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "2 小时", theme: "拍照", timeTags: ["下午"], skills: "中文 · 街拍", priceRef: "300–600K", defaultPrice: "400,000₫" },
  { id: "citywalk", emoji: "走", title: "City Walk", venue: "街区", venueLabel: "街区漫游 · 本地路线", ratios: ["1:1", "≤ 4:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "半天", theme: "City Walk", timeTags: ["下午", "周末"], skills: "中文 · 本地路线", priceRef: "150–300K", defaultPrice: "200,000₫" },
  { id: "exhibition", emoji: "展", title: "看展", venue: "美术馆", venueLabel: "美术馆 · 一起看", ratios: ["1:1", "≤ 3:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "半天", theme: "看展", timeTags: ["下午", "周末"], skills: "中文 · 艺术", priceRef: "150–300K", defaultPrice: "200,000₫" },
  { id: "pro", emoji: "证", title: "城市协助", venue: "按需", venueLabel: "翻译 / 签证 / 法律 / 商务 · 专业认证优先", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "", defaultDuration: "2 小时", theme: "服务协助", timeTags: [], skills: "中文 · 专业协助", priceRef: "面议", defaultPrice: "" }
];

export type DemandSpecs = {
  ratio: string;
  time: string;
  duration: string;
  place: string;
  prefs: string[];
  price: string;
  /** R58 备注（可选，500 字内，落库随机会展示）。 */
  notes: string;
};

export function defaultSpecsFor(template: MomentTemplate): DemandSpecs {
  return {
    ratio: template.defaultRatio,
    time: template.defaultTime,
    duration: template.defaultDuration,
    place: template.venue,
    prefs: ["公共场所见面"],
    price: template.defaultPrice,
    notes: ""
  };
}

/**
 * 向导规格映射为发布输入。时间/时长/人数并入 time 展示；
 * 场景偏好并入 skills；一期 moneyFlow 固定 EARN（Moment 服务皆为获酬）。
 */export function buildDemandPublishInput(
  template: MomentTemplate,
  specs: DemandSpecs
): PublishMarketOpportunityInput {
  const time = [specs.time, specs.duration, specs.ratio].filter((part) => part.trim() !== "").join(" · ");
  const skills = [template.skills, ...specs.prefs.map((pref) => pref.trim()).filter((pref) => pref !== "")]
    .join(" · ");
  const notes = specs.notes.trim();
  return {
    title: template.title,
    shortTitle: template.title,
    theme: template.theme,
    date: specs.time.trim() === "" ? "近期" : specs.time.trim(),
    time: time === "" ? template.defaultTime : time,
    location: specs.place.trim() === "" ? template.venue : specs.place.trim(),
    price: specs.price.trim(),
    moneyFlow: "EARN",
    skills,
    lens: ["NOW", "NEARBY"],
    ...(notes === "" ? {} : { desc: notes.slice(0, 500) })
  };
}

export type PeopleSheetFilters = {
  language: string;
  certifiedOnly: boolean;
  maxBudget: number;
  day: string;
};

export const DEFAULT_PEOPLE_FILTERS: PeopleSheetFilters = {
  language: "不限",
  certifiedOnly: false,
  maxBudget: 0,
  day: "不限"
};

/** 当地日边界（毫秒）。day: 今晚/明天/周末/不限。 */
export function dayWindow(day: string, now: number): { start: number; end: number } | undefined {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const dayMs = 24 * 3600 * 1000;
  if (day === "今晚") {
    const start = base.getTime() + 18 * 3600 * 1000;
    return { start, end: base.getTime() + dayMs };
  }
  if (day === "明天") {
    return { start: base.getTime() + dayMs, end: base.getTime() + 2 * dayMs };
  }
  if (day === "周末") {
    const dow = base.getDay();
    const toSat = (6 - dow + 7) % 7;
    const sat = base.getTime() + toSat * dayMs;
    return { start: sat, end: sat + 2 * dayMs };
  }
  return undefined;
}

/**
 * 选人筛选（纯函数）：快捷 chips + 面板筛选项同时生效（AND）。
 * 无档期数据的人在指定日期时被滤掉；预算只看参考价。
 */
export function filterSuppliers(
  people: SupplierCandidate[],
  quick: string[],
  sheet: PeopleSheetFilters,
  now: number = Date.now()
): SupplierCandidate[] {
  const window = dayWindow(sheet.day, now);
  return people.filter((person) => {
    for (const filter of quick) {
      if (filter === "推荐" && !person.eligibility.eligible) return false;
      if (filter === "附近" && !person.eligibility.marketOk) return false;
      if (filter === "现在可用" && !person.eligibility.availabilityOk) return false;
      if (filter === "已认证" && !person.eligibility.capabilitiesOk) return false;
    }
    if (sheet.language !== "不限" && !person.languages.includes(sheet.language)) return false;
    if (sheet.certifiedOnly && !person.eligibility.capabilitiesOk) return false;
    if (sheet.maxBudget > 0 && !(person.referencePrice > 0 && person.referencePrice <= sheet.maxBudget)) return false;
    if (window) {
      if (!person.availability) return false;
      const start = Date.parse(person.availability.startAt);
      const end = Date.parse(person.availability.endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (end < window.start || start > window.end) return false;
    }
    return true;
  });
}
