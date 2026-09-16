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
  /** R58 原型分类：热门 / 见面 / 娱乐 / 出行 / 主题。 */
  category: "meet" | "fun" | "outdoor" | "theme";
  /** R58 原型卡片 tags（如 咖啡/咖啡馆）。 */
  tags: string[];
};

export const MOMENT_TEMPLATES: MomentTemplate[] = [
  { id: "coffee", emoji: "☕", title: "喝咖啡", venue: "咖啡馆", venueLabel: "咖啡馆 · 轻松见面", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "今晚 19:00", defaultDuration: "2 小时", theme: "咖啡", timeTags: ["晚间"], skills: "中文 · 轻松见面", priceRef: "150–300K", defaultPrice: "200,000₫", category: "meet", tags: ["咖啡", "咖啡馆"] },
  { id: "meal", emoji: "餐", title: "吃饭", venue: "餐厅", venueLabel: "餐厅 · 默认 1:1", ratios: ["1:1", "≤ 3:1"], defaultRatio: "1:1", defaultTime: "今晚 18:30", defaultDuration: "2 小时", theme: "用餐", timeTags: ["晚间"], skills: "中文 · 本地餐厅", priceRef: "200–400K", defaultPrice: "300,000₫", category: "meet", tags: ["用餐", "餐厅"] },
  { id: "ktv", emoji: "♪", title: "唱歌", venue: "KTV", venueLabel: "KTV · 夜间 Moment", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "20:00–22:00", defaultDuration: "2 小时", theme: "唱歌", timeTags: ["晚间"], skills: "中文 · 夜间", priceRef: "300–500K", defaultPrice: "400,000₫", category: "fun", tags: ["唱歌", "KTV"] },
  { id: "photo", emoji: "相", title: "拍照", venue: "街区", venueLabel: "街拍 / 旅行照", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "2 小时", theme: "拍照", timeTags: ["下午"], skills: "中文 · 街拍", priceRef: "300–600K", defaultPrice: "400,000₫", category: "outdoor", tags: ["拍照", "街区"] },
  { id: "citywalk", emoji: "走", title: "City Walk", venue: "街区", venueLabel: "街区漫游 · 本地路线", ratios: ["1:1", "≤ 4:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "半天", theme: "City Walk", timeTags: ["下午", "周末"], skills: "中文 · 本地路线", priceRef: "150–300K", defaultPrice: "200,000₫", category: "outdoor", tags: ["City Walk", "街区"] },
  { id: "exhibition", emoji: "展", title: "看展", venue: "美术馆", venueLabel: "美术馆 · 一起看", ratios: ["1:1", "≤ 3:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "半天", theme: "看展", timeTags: ["下午", "周末"], skills: "中文 · 艺术", priceRef: "150–300K", defaultPrice: "200,000₫", category: "theme", tags: ["看展", "美术馆"] },
  { id: "pro", emoji: "证", title: "城市协助", venue: "按需", venueLabel: "翻译 / 签证 / 法律 / 商务 · 专业认证优先", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "", defaultDuration: "2 小时", theme: "服务协助", timeTags: [], skills: "中文 · 专业协助", priceRef: "面议", defaultPrice: "", category: "theme", tags: ["专业", "认证"] }
];

// UI-ORDER-LOGO-001: 发布向导的 Moment 图标必须复用场景动作既有 logo（首页「动作」行
// 与市场订单类型 logo 用的就是它），不再自己画一套 emoji（此前是 ☕/餐/♪/相/走/展/证）。
// 图标资产见 assets/scene-activity/actions/*.svg，规范清单见
// components/scene-activity-discovery.tsx 的 SCENE_ACTIONS。
export const MOMENT_ACTION_ID: Record<string, string> = {
  coffee: "coffee",
  meal: "dining",
  ktv: "music",
  photo: "photo",
  citywalk: "city-walk",
  exhibition: "exhibition",
  pro: "urban-support"
};

/**
 * R58 城市协助 · Professional 服务目录（对齐原型 pro-card 四类）：
 * 现场翻译 / 签证协助 / 法律咨询 / 商务协助。价格与备注取自原型服务条目。
 */
export type ProService = {
  id: string;
  title: string;
  sub: string;
  mark: string;
  tags: string[];
  price: string;
  range: string;
  note: string;
  cert: string;
};

export const PRO_SERVICES: readonly ProService[] = [
  { id: "translate", title: "现场翻译", sub: "商务 / 生活", mark: "文", tags: ["翻译", "现场"], price: "500K", range: "400–800K", note: "按明确场景提供翻译协助 · 默认 2 小时。", cert: "语言 / 时长 / 场景" },
  { id: "visa", title: "签证协助", sub: "材料 / 流程 / 预约", mark: "签", tags: ["签证", "预约"], price: "面议", range: "按材料与周期", note: "材料清单、流程陪同与预约协助。", cert: "材料 / 流程 / 预约" },
  { id: "legal", title: "法律咨询", sub: "按执业资格与领域匹配", mark: "法", tags: ["法律", "咨询"], price: "面议", range: "按领域与时长", note: "按执业资格与领域匹配专业人士。", cert: "按执业资格与领域匹配" },
  { id: "business", title: "商务协助", sub: "会议 / 本地协调 / 陪同", mark: "商", tags: ["商务", "陪同"], price: "面议", range: "按会议与陪同", note: "会议支持、本地协调与现场陪同。", cert: "会议 / 本地协调 / 陪同" }
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
  // OPP-REAL-COORDS-001: 地图选点坐标（可选）。有 = 发布带真 lat/lng、订单上图；
  // 无 = 老行为（纯文字地点、无钉）。草稿持久化顺带存取。
  lat?: number | undefined;
  lng?: number | undefined;
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
  const hasPin =
    typeof specs.lat === "number" && typeof specs.lng === "number" &&
    Number.isFinite(specs.lat) && Number.isFinite(specs.lng);
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
    ...(notes === "" ? {} : { desc: notes.slice(0, 500) }),
    ...(hasPin ? { lat: specs.lat as number, lng: specs.lng as number } : {})
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
