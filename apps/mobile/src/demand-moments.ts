// demand-moments.ts — R58 发布需求一期的 Moment 模板 + 发布映射。
//
// 模板内容（Moment + 城市协助 + 参考价）来自 R58 原型；一期为前端常量，
// 后续可转服务端配置。备注随机会落库展示（500 字内）；选人匹配走
// 二期草稿流，一期发布即公开市场。
//
// 2026-10-06 用户：「唱歌不要搞 😂」—— KTV 那条模板整条撤掉（含
// MOMENT_ACTION_ID 里的映射），roster 钉 `demand-moments.test.ts` 同步收窄。
// 注释里不再写条目数：原来写「6 个 Moment」，撤一条就烂一个数。
//
// 同日紧接着用户：「说错 加运动」—— 补回两条运动模板（打球 / 骑行）支撑 rail
// 第四档。**这不是把唱歌换了个名字加回来**：KTV 是娱乐向的聚会模板，运动是另一类。
// 一撤一加，roster 净 +1 条。

import type { PublishMarketOpportunityInput } from "@proxy/contracts";
import type { SupplierCandidate } from "./supply-client";
import type { SceneSpot } from "./activity-create-form";
// 距离这一格复用场景目录那套：归属词命中（scenesForAction）+ 直线距离
// （sceneDistanceMeters）+ 原型口径的文案（shopCardDistance）。三样都是纯函数，
// 不另写一份 —— 同一个动作在首页入口卡、场景目录页、发布向导里必须算得一样。
import { scenesForAction } from "./scene-category-entries";
import { sceneDistanceMeters, shopCardDistance, type SceneOrigin } from "./scene-shop-directory";
// 只借字形**类型**（`import type` 会被完全擦除，不把 RN 组件拉进这个纯模块）。
import type { ProxyIconName } from "./components/proxy-icon";

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
  /**
   * R58 原型分类：热门 / 见面 / 娱乐 / 出行 / 主题。
   *
   * 2026-10-06 补 `"sport"`：用户「说错 加运动」—— 发布器 rail 加第四档「运动」。
   * 原型里**没有**这一档，所以它不属于 R58 原型分类；但 rail 要按家族筛运动模板，
   * 就得有个字段能认出来。挂在 category 上而不是另起一个字段：它和 meet/fun/… 是
   * 同一维的东西（这一条属于哪一类）。
   *
   * 注意 `"fun"` 现在**没有任何模板**：唯一那条 fun（唱歌）随 KTV 一起撤了。
   * rail 的「娱乐」不是按 fun 家族筛的（见 demand-wizard.tsx 的 moments 过滤）。
   */
  /**
   * 这一类 Moment **绑定场景**还是**绑定人**。
   *
   * 2026-10-06 用户：「骑行绑定人 不是场景 …… 就2种 一种是时间+距离 一种是时间」。
   * 卡片底行因此只有两种形状：
   *   · `"scene"` —— 发生在一个固定场所（咖啡馆 / 餐厅 / 街区 / 美术馆）：底行
   *     `时间 + 距离`，距离 = 你的定位 → **这一类最近的**那一个真实场景。
   *   · `"person"` —— 不在固定场所（骑行 / 打球 / 城市协助）：底行**只有时间**。
   *     人那一侧以后接「附近某位接单者的接单时间」；**这个数据源现在不存在**
   *     （`SupplierCandidate` 只有 availability 窗口和一个响应**分数**，没有接单时长），
   *     所以先只画时间 —— 不编一个距离，也不编一个接单时间。
   *
   * 为什么要有这个字段：以前「骑行没有距离」是**归属词恰好没命中**的副产品。
   * 哪天场景目录里加了一条骑行场景，它就会突然冒出距离，跟「绑定人」这条口径相反。
   * 现在绑人就是绑人：目录里有什么都不画距离。
   */
  binding: "scene" | "person";
  category: "meet" | "fun" | "outdoor" | "theme" | "sport";
  /** R58 原型卡片 tags（如 咖啡/咖啡馆）。 */
  tags: string[];
};

export const MOMENT_TEMPLATES: MomentTemplate[] = [
  { id: "coffee", binding: "scene", emoji: "☕", title: "喝咖啡", venue: "咖啡馆", venueLabel: "咖啡馆 · 轻松见面", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "今晚 19:00", defaultDuration: "2 小时", theme: "咖啡", timeTags: ["晚间"], skills: "中文 · 轻松见面", priceRef: "150–300K", defaultPrice: "200,000₫", category: "meet", tags: ["咖啡", "咖啡馆"] },
  { id: "meal", binding: "scene", emoji: "餐", title: "吃饭", venue: "餐厅", venueLabel: "餐厅 · 默认 1:1", ratios: ["1:1", "≤ 3:1"], defaultRatio: "1:1", defaultTime: "今晚 18:30", defaultDuration: "2 小时", theme: "用餐", timeTags: ["晚间"], skills: "中文 · 本地餐厅", priceRef: "200–400K", defaultPrice: "300,000₫", category: "meet", tags: ["用餐", "餐厅"] },
  { id: "photo", binding: "scene", emoji: "相", title: "拍照", venue: "街区", venueLabel: "街拍 / 旅行照", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "2 小时", theme: "拍照", timeTags: ["下午"], skills: "中文 · 街拍", priceRef: "300–600K", defaultPrice: "400,000₫", category: "outdoor", tags: ["拍照", "街区"] },
  { id: "citywalk", binding: "scene", emoji: "走", title: "City Walk", venue: "街区", venueLabel: "街区漫游 · 本地路线", ratios: ["1:1", "≤ 4:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "半天", theme: "City Walk", timeTags: ["下午", "周末"], skills: "中文 · 本地路线", priceRef: "150–300K", defaultPrice: "200,000₫", category: "outdoor", tags: ["City Walk", "街区"] },
  { id: "exhibition", binding: "scene", emoji: "展", title: "看展", venue: "美术馆", venueLabel: "美术馆 · 一起看", ratios: ["1:1", "≤ 3:1"], defaultRatio: "1:1", defaultTime: "下午", defaultDuration: "半天", theme: "看展", timeTags: ["下午", "周末"], skills: "中文 · 艺术", priceRef: "150–300K", defaultPrice: "200,000₫", category: "theme", tags: ["看展", "美术馆"] },
  // 2026-10-06 用户：「说错 加运动」—— rail 第四档「运动」的两条模板。
  // 图标复用场景动作既有 logo（sport.svg / cycling.svg，见 MOMENT_ACTION_ID），
  // 没有新画资产。两条都取自 SCENE_ACTIONS 的 sport 家族（scene-activity-discovery.tsx
  // 的 ACTION_DETAILS：跑步/骑行/羽毛球/网球/瑜伽都挂 familyId "sport"）。
  // 只加两条、不铺满那个家族：用户要的是「基本够了」，不是把运动做成一个子目录。
  { id: "ballgame", binding: "person", emoji: "球", title: "打球", venue: "球馆", venueLabel: "球馆 · 约一场", ratios: ["1:1", "≤ 3:1"], defaultRatio: "1:1", defaultTime: "周末 15:00", defaultDuration: "2 小时", theme: "运动", timeTags: ["下午", "周末"], skills: "中文 · 球类运动", priceRef: "200–400K", defaultPrice: "300,000₫", category: "sport", tags: ["运动", "球馆"] },
  { id: "ride", binding: "person", emoji: "骑", title: "骑行", venue: "绿道", venueLabel: "城市绿道 · 一起骑", ratios: ["1:1", "≤ 4:1"], defaultRatio: "1:1", defaultTime: "周末 早上", defaultDuration: "半天", theme: "骑行", timeTags: ["周末"], skills: "中文 · 骑行", priceRef: "150–300K", defaultPrice: "200,000₫", category: "sport", tags: ["骑行", "绿道"] },
  { id: "pro", binding: "person", emoji: "证", title: "城市协助", venue: "按需", venueLabel: "翻译 / 签证 / 法律 / 商务 · 专业认证优先", ratios: ["1:1"], defaultRatio: "1:1", defaultTime: "", defaultDuration: "2 小时", theme: "服务协助", timeTags: [], skills: "中文 · 专业协助", priceRef: "面议", defaultPrice: "", category: "theme", tags: ["专业", "认证"] }
];

// UI-ORDER-LOGO-001: 发布向导的 Moment 图标必须复用场景动作既有 logo（首页「动作」行
// 与市场订单类型 logo 用的就是它），不再自己画一套 emoji（此前是 ☕/餐/♪/相/走/展/证）。
// 图标资产见 assets/scene-activity/actions/*.svg，规范清单见
// components/scene-activity-discovery.tsx 的 SCENE_ACTIONS。
export const MOMENT_ACTION_ID: Record<string, string> = {
  coffee: "coffee",
  meal: "dining",
  photo: "photo",
  citywalk: "city-walk",
  exhibition: "exhibition",
  // 2026-10-06「加运动」：打球 → sport.svg，骑行 → cycling.svg。两个 action id
  // 都在 SCENE_ACTIONS 里（label 运动 / 骑行），不需要新资产。
  ballgame: "sport",
  ride: "cycling",
  pro: "urban-support"
};

/**
 * 卡片右上角的「起步价」（原型卡片 `item-price`：`num` + `unit`）。
 *
 * 2026-10-06 用户：「移除1:1 因为概念理解复杂 变成起步价格」—— 这一格原来是
 * `defaultRatio`（`1:1`）。那个概念要用户先懂「几个人对几个人」才读得懂，撤掉，
 * 换成模板自己的起步价。
 *
 * 取数：`defaultPrice`（`200,000₫`）优先；「面议」类模板（`defaultPrice` 为空，
 * 如城市协助）回落 `priceRef`（`面议`）。**标签只在真有数字时才挂** ——
 * 「面议 / 起步价」自相矛盾，那时 unit 返回空串，卡面只留「面议」。
 */
export function momentStartPrice(template: MomentTemplate): { amount: string; unit: string } {
  return template.defaultPrice.trim() !== ""
    ? { amount: template.defaultPrice, unit: "起步价" }
    : { amount: template.priceRef, unit: "" };
}

/**
 * 卡片右下角的距离（原型 `item-meta` 的 `dist`，如 `1.2km`）。
 *
 * 2026-10-06 用户：「有距离」。追问数据源后用户选的是**接真实距离**（不是照抄
 * 原型里那串写死的 1.2km），所以这里一个数都不编：
 *   · 距离 = 你的**真实定位** → 「这类 Moment 最近的**真实场景**」的直线距离。
 *   · 场景目录走 GET /v1/reality-scenes（公开免登，与首页 / 场景目录页同一份）。
 *   · 归属哪一类：模板 id → 动作 id（`MOMENT_ACTION_ID`），再交给 `scenesForAction`
 *     按归属词命中 —— 和首页场景入口卡同一个函数，不另写一套子串匹配。
 *   · **绑定人的模板直接返回空串**（`binding === "person"`：骑行 / 打球 / 城市协助）——
 *     它们是产品口径上的「不绑场景」，跟目录里有没有这类场景无关。
 *   · 绑定场景的模板拿不到就返回**空串**、整格不画：没定位 / 这一类一个真实场景
 *     都没有 / 最近的那个也在 50km 外（`shopCardDistance` 的 FAR_AWAY 口径）。
 *     不拿河内市中心当「你的位置」—— 那会把所有距离都算成假的。
 */
export function momentDistanceLabel(
  scenes: readonly SceneSpot[],
  templateId: string,
  origin: SceneOrigin | undefined,
): string {
  // 绑定人 ⇒ 永远不画距离。放在**最前面**，连定位都不看：这是产品口径，不是
  // 「目录里碰巧没有这类场景」。以后场景目录里加了一条骑行场景，这里也不会
  // 突然冒出距离（那正是用户「骑行绑定人 不是场景」要防的）。
  if (MOMENT_TEMPLATES.find((item) => item.id === templateId)?.binding === "person") return "";
  if (!origin) return "";
  const actionId = MOMENT_ACTION_ID[templateId];
  if (actionId === undefined) return "";
  let nearest: number | undefined;
  for (const scene of scenesForAction(scenes, actionId)) {
    const meters = sceneDistanceMeters(origin, scene);
    if (meters === undefined) continue;
    if (nearest === undefined || meters < nearest) nearest = meters;
  }
  return shopCardDistance(nearest);
}

/**
 * 卡片底行的 meta（原型 `item-meta`：`dist · dur`）。
 *
 * 2026-10-06 用户：「就2种 一种是时间+距离 一种是时间」—— 底行**只有这两种形状**。
 * 原因是时间那一格**恒非空**（模板自己的 `defaultDuration`）：距离拿得到就是
 * `时间 + 距离`；拿不到（绑定人 / 没定位 / 这一类没场景 / 最近的在 50km 外）就只剩
 * `时间`。**永远不会出现「只有距离」**—— 那需要一个空的时间，而模板不允许。
 *
 * DEMAND-DURATION-001：时长那一格走 normalizeDuration（「半天」→「4 小时」）——
 * 卡面跟规格步滚轮说同一种话，不是一边半天一边 4 小时。
 *
 * 距离那一格不写「—」占位（那看着像加载失败，见 formatShopDistance）。
 *
 * ⚠️ 顺序沿用原型：**距离在前**。用户那句「时间+距离」说的是「哪两格一起出现」，
 * 不是先后顺序 —— 原型是 `metaParts = [it.dist, it.dur]`。
 */
export function momentMetaLine(distance: string, template: MomentTemplate): string {
  return [distance, normalizeDuration(template.defaultDuration)].filter((part) => part !== "").join(" · ");
}

// DEMAND-SCENE-FIRST-001 的 momentSceneOptions/SceneOption 已删（2026-10-06）：
// 选场景步改为直接挂 SceneShopDirectory（home 场景 list 本体），它自己加载目录、
// 排距离、筛区域 —— 向导不再需要一份预打分的候选数组。卡面距离仍走 momentDistanceLabel。

/**
 * R58 城市协助 · Professional 服务目录（对齐原型 pro-card 四类）：
 * 现场翻译 / 签证协助 / 法律咨询 / 商务协助。价格与备注取自原型服务条目。
 *
 * 2026-10-06 用户：「本质是把2个散的合并成一个 而不是把城市协助放在外面」——
 * 这四条不再单独占一张入口卡 + 一格子卡（professionalEntry + proGrid），
 * 而是整格搬进发布器左 rail 的「专业」分类，与 Moment 用同一套行样式渲染。
 * 因此每条服务补一个 `cat`：它就是「专业」分类下那排子标签（原型 sub-tabs）的归属。
 */
export type ProDomain = "trans" | "visa" | "legal" | "biz";

export type ProService = {
  id: string;
  /** 子域：决定它落在哪个子标签下。 */
  cat: ProDomain;
  title: string;
  sub: string;
  /**
   * 单字标记（文 / 签 / 法 / 商）。**现在是兜底**，不是主视觉 —— 见 PRO_LOGOS。
   * R58 原型的 pro-card 本来就只有文字（`<b>现场翻译</b><small>…</small>`，无图标），
   * 服务端 `apps/api-go/internal/marketplace/templates.go` 也只给 Mark 文本。
   */
  mark: string;
  tags: string[];
  price: string;
  range: string;
  note: string;
  cert: string;
};

export const PRO_SERVICES: readonly ProService[] = [
  { id: "translate", cat: "trans", title: "现场翻译", sub: "商务 / 生活", mark: "文", tags: ["翻译", "现场"], price: "500K", range: "400–800K", note: "按明确场景提供翻译协助 · 默认 2 小时。", cert: "语言 / 时长 / 场景" },
  { id: "visa", cat: "visa", title: "签证协助", sub: "材料 / 流程 / 预约", mark: "签", tags: ["签证", "预约"], price: "面议", range: "按材料与周期", note: "材料清单、流程陪同与预约协助。", cert: "材料 / 流程 / 预约" },
  { id: "legal", cat: "legal", title: "法律咨询", sub: "按执业资格与领域匹配", mark: "法", tags: ["法律", "咨询"], price: "面议", range: "按领域与时长", note: "按执业资格与领域匹配专业人士。", cert: "按执业资格与领域匹配" },
  { id: "business", cat: "biz", title: "商务协助", sub: "会议 / 本地协调 / 陪同", mark: "商", tags: ["商务", "陪同"], price: "面议", range: "按会议与陪同", note: "会议支持、本地协调与现场陪同。", cert: "会议 / 本地协调 / 陪同" }
];

/**
 * 「专业」四行服务的 logo。2026-10-06 用户连着两轮问：「专业服务为什么没有 logo
 * 图片资产 之前设计了 自己找找」/「还是没找回专业的 logo 啊 找不到了吗」。
 *
 * 查证结论（说清楚，免得再被问第三次）：
 *   · **这四条服务从来没有过图片资产** —— R58 原型的 pro-card 是纯文字
 *     （`<b>现场翻译</b><small>语言 / 时长 / 场景</small><span>能力认证</span>`，一个图标都没有），
 *     服务端 `templates.go` 也只给 Mark 文本。全仓 49 个 SVG 里没有签证/法律/商务。
 *   · **但页面上确实「丢」过一个 logo**：城市协助那张入口卡（`professionalEntry`）原来渲染
 *     `urban-support.svg`（`acc0d67d` 按 UI-ORDER-LOGO-001 补的）。2026-10-06 合并进双栏时
 *     那张卡整块删掉，logo 跟着没了 —— 用户说的「找回」就是这个。
 *
 * 所以这里把四行接回既有 logo，**不新画资产**：
 *   · `scene` = `SCENE_ACTIONS` 的 action id（`assets/scene-activity/actions/*.svg`）
 *   · `icon`  = `ProxyIcon` 的矢量字形 —— **只在没有对应图片资产时**用。
 *     先例：`components/market-type-logo.tsx` 的 `chat_companion`（那里写着「没有对应的
 *     SCENE_ACTIONS 图片资产 …… 用 ProxyIcon 的矢量 chat 字形，不用假图片凑数」）。
 *
 * 逐条依据：
 *   · 现场翻译 → translation：SCENE_ACTIONS 的 label 就是「翻译」；
 *     `market-type-logo.tsx` 的 bilingual_store 也用它。
 *   · 签证协助 → travel：SCENE_ACTIONS 的 label「出游」（护照 / 出入境），四枚里最贴近的。
 *   · 法律咨询 → fileText：**没有任何** scene-action 是法律/合同的；fileText 是本仓既有的
 *     法务字形（`me.tsx` 设置页 settingsRowLegalDocs 用的就是它）。
 *   · 商务协助 → urban-support：SCENE_ACTIONS 的 label「城市协助」；`ACTION_DETAILS` 里
 *     business-companion（商务陪同）挂的就是 familyId urban-support，城市协助模板本来也映射它
 *     （MOMENT_ACTION_ID.pro）。
 */
export type ProLogo = { scene: string } | { icon: ProxyIconName };

export const PRO_LOGOS: Record<string, ProLogo> = {
  translate: { scene: "translation" },
  visa: { scene: "travel" },
  legal: { icon: "fileText" },
  business: { scene: "urban-support" }
};

/**
 * 发布器「专业」分类下的一排子标签（原型 sub-tabs：全部 / 翻译 / 签证 / 法律 / 商务）。
 * 注意与 Moment 的 quick-filter 无关 —— 那排是 Moment 属性（ratios / timeTags），
 * 进「专业」会整排藏起来。
 *
 * 原型那一排还多一个「城市协助」（装着「城市向导」「陪诊协助」两条）。本仓这两条
 * 概念都有（`creator-capability-labels.ts` 的 GUIDE=城市向导、场景主题 medical-companion=陪诊），
 * 但把它们加成新的服务条目是**产品内容决定**，不是 UI 决定 —— 没有自行发明，
 * 所以这里暂时只有四个子域。要加，条目和子标签一起加。
 */
export const PRO_TABS: readonly { k: "all" | ProDomain; label: string }[] = [
  { k: "all", label: "全部" },
  { k: "trans", label: "翻译" },
  { k: "visa", label: "签证" },
  { k: "legal", label: "法律" },
  { k: "biz", label: "商务" }
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

// DEMAND-HEADCOUNT-002（2026-10-07，用户：「你们几人是输入框 改为选择 默认1人
// 最大上限为6人」）：人数不再是自由输入，是 1–6 人的选择。模板数据里的
// ratios/defaultRatio 保留（快筛还用），只是不渲染；DemandSpecs.ratio 存
// "1"–"6"（默认 "1"），发布行恒带「N 人」。
export const HEADCOUNT_OPTIONS = ["1", "2", "3", "4", "5", "6"] as const;
export const DEFAULT_HEADCOUNT = "1";
export const MAX_HEADCOUNT = 6;

/**
 * 人数归一：新 UI 只产出 1–6，这里收的是老草稿/外来值 —— 前导数字截断并
 * 夹到 1–6（如「2 大 1 小」→「2」、「10」→「6」），没数字的一律回默认「1」。
 */
export function normalizeHeadcount(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const leading = raw.match(/^\d+/);
  if (leading?.[0] !== undefined) {
    const parsed = Number.parseInt(leading[0], 10);
    if (Number.isFinite(parsed)) return String(Math.min(Math.max(parsed, 1), MAX_HEADCOUNT));
  }
  return DEFAULT_HEADCOUNT;
}

// DEMAND-TIMESLOT-001（2026-10-07，用户：「不要写今晚 … 时间下拉就可以
// 06:00-22:00，支持 m 精度」）：时间段不再是自由输入，是 06:00–22:00 半小时一档
// 的下拉（33 档，HH:MM 自带分钟精度）。模板的 defaultTime 只当默认值的来源。
export const TIME_SLOT_MIN_HOUR = 6;
export const TIME_SLOT_MAX_HOUR = 22;
export const DEFAULT_TIME_SLOT = "19:00";

function formatTimeSlot(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${minute === 0 ? "00" : "30"}`;
}

export const TIME_SLOT_OPTIONS: readonly string[] = (() => {
  const out: string[] = [];
  for (let hour = TIME_SLOT_MIN_HOUR; hour <= TIME_SLOT_MAX_HOUR; hour += 1) {
    out.push(formatTimeSlot(hour, 0));
    if (hour !== TIME_SLOT_MAX_HOUR) out.push(formatTimeSlot(hour, 30));
  }
  return out;
})();

/**
 * 时间归一：新 UI 只产出档位值，这里收的是模板默认值/老草稿/外来值 ——
 * HH:MM 截出来夹到 06:00–22:00、分钟就近贴到 :00/:30（如「19:47」→「20:00」，
 * 「05:10」→「06:00」）；没数字的按早晚关键词给（中午→12:00，下午→15:00，
 * 早上→09:00，晚上→19:00），都没有回默认 19:00。「今晚」这类词到此为止。
 */
export function normalizeTimeSlot(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const clock = raw.match(/(\d{1,2}):(\d{2})/);
  if (clock?.[1] !== undefined && clock?.[2] !== undefined) {
    const parsedHour = Number.parseInt(clock[1], 10);
    const parsedMinute = Number.parseInt(clock[2], 10);
    if (Number.isFinite(parsedHour) && Number.isFinite(parsedMinute)) {
      let hour = Math.min(Math.max(parsedHour, TIME_SLOT_MIN_HOUR), TIME_SLOT_MAX_HOUR);
      if (parsedMinute >= 45) hour += 1;
      if (hour > TIME_SLOT_MAX_HOUR) return formatTimeSlot(TIME_SLOT_MAX_HOUR, 0);
      const minute = parsedMinute < 15 || parsedMinute >= 45 ? 0 : 30;
      return formatTimeSlot(hour, minute);
    }
  }
  if (/中午/.test(raw)) return "12:00";
  if (/上午|早|晨/.test(raw)) return "09:00";
  if (/下午|午/.test(raw)) return "15:00";
  if (/晚|夜|宵/.test(raw)) return "19:00";
  return DEFAULT_TIME_SLOT;
}

// DEMAND-DURATION-001（2026-10-07，用户：「时长也用滚轮 1H-8H就可以」）：
// 时长不再是「2 小时 / 半天 / 全天」三颗 chips，是 1–8 小时的滚轮（8 档，
// 「N 小时」）。模板的 defaultDuration（「半天」…）只当默认值的来源。
export const DURATION_MIN_HOURS = 1;
export const DURATION_MAX_HOURS = 8;
export const DEFAULT_DURATION = "2 小时";

export const DURATION_OPTIONS: readonly string[] = (() => {
  const out: string[] = [];
  for (let hours = DURATION_MIN_HOURS; hours <= DURATION_MAX_HOURS; hours += 1) {
    out.push(`${hours} 小时`);
  }
  return out;
})();

/**
 * 时长归一：新 UI 只产出 1–8 小时，这里收的是模板默认值/老草稿/外来值 ——
 * 前导数字截出来夹到 1–8（如「10 小时」→「8 小时」）；没数字的按词给
 * （半天→4 小时，全天/一天→8 小时），都没有回默认 2 小时。
 */
export function normalizeDuration(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const leading = raw.match(/^\d+/);
  if (leading?.[0] !== undefined) {
    const parsed = Number.parseInt(leading[0], 10);
    if (Number.isFinite(parsed)) return `${Math.min(Math.max(parsed, DURATION_MIN_HOURS), DURATION_MAX_HOURS)} 小时`;
  }
  if (/半天/.test(raw)) return "4 小时";
  if (/全天|一天|整天/.test(raw)) return "8 小时";
  return DEFAULT_DURATION;
}

export function defaultSpecsFor(template: MomentTemplate): DemandSpecs {
  return {
    // DEMAND-HEADCOUNT-002：默认 1 人（选择器首项高亮即此值）。
    ratio: DEFAULT_HEADCOUNT,
    // DEMAND-TIMESLOT-001：模板的 defaultTime（「今晚 19:00」「下午」…）只当
    // 默认值的来源，收敛到下拉档位上 —— 线上不再出现「今晚」这种词。
    time: normalizeTimeSlot(template.defaultTime),
    // DEMAND-DURATION-001：模板的 defaultDuration（「半天」…）同理，只当来源，
    // 收敛到 1–8 小时档位上。
    duration: normalizeDuration(template.defaultDuration),
    // DEMAND-SCENE-GATE-002（2026-10-07，用户：「模拟器没改好 没选择还是弹出了
    // 下面的选项」）：place **不再默认填 template.venue** —— 那一列全是**类别词**
    // （咖啡馆 / 餐厅 / 街区 / 美术馆 / 球馆 / 绿道 / 按需），没有一个是地点。
    // 填进去会让两件事一起假成立：
    //   ① 绑场景模板第 1 段下面那句「已选：咖啡馆」在没选的时候出现；
    //   ② 「选完场景才出下面选项」的闸（按 place 非空判）被默认值顶开。
    // 发布载荷不受影响：buildDemandPublishInput 的 location 本来就
    // `place 空 → template.venue` 回落，打出来的位置一模一样；界面上 venue
    // 该出现的地方（输入框 placeholder、底部汇总）也都各自有回落。
    place: "",
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
  specs: DemandSpecs,
  // DEMAND-TARGET-KEEP-001（2026-10-07，用户：「不能丢弃搭子选择」）：选中的搭子
  // 必须跟着需求一起发出去。契约里这条一直是有的 —— PublishMarketOpportunityInput
  // 的 targetUserId（OPP-TARGETED-001「选人 → 向 TA 发出邀约」：带上后服务端把机会
  // 快照成定向，只对 TA 和 owner 可见、只收 TA 报名）。兄弟实现 market.tsx 一直在发
  // （targetAgent.agentId），**只有发布需求向导没接** —— 向导收了 selectedPerson、
  // 界面上还写着「意向人选：X」，发布出去的却永远是公开市场，选择被丢在半路。
  targetUserId?: string | undefined
): PublishMarketOpportunityInput {
  // DEMAND-HEADCOUNT-002：人数恒为 1–6 的选择（默认 1 人），发布行恒带「N 人」。
  // 老草稿的自由文本经 normalizeHeadcount 收敛（前导数字截断夹到 1–6），不再原样透传。
  // DEMAND-TIMESLOT-001：时间恒为下拉档位（HH:MM，06:00–22:00），老自由文本
  // （「今晚 19:00」「下午」…）经 normalizeTimeSlot 收敛 —— 线上不再出现「今晚」。
  // DEMAND-DURATION-001：时长恒为 1–8 小时档位，「半天 / 全天」经
  // normalizeDuration 收敛（半天→4 小时，全天→8 小时）。
  const headcount = normalizeHeadcount(specs.ratio);
  const slot = normalizeTimeSlot(specs.time);
  const duration = normalizeDuration(specs.duration);
  const time = [slot, duration, `${headcount} 人`]
    .filter((part) => part.trim() !== "").join(" · ");
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
    // ORDER-SCENARIO-001: 场景跟着 moment 家族走 —— pro（城市协助）标 assistance，
    // 其余普通消费标 ordinary。订单流程按它分档（城市协助永远全流程）。
    scenario: template.id === "pro" ? "assistance" : "ordinary",
    date: slot,
    time: time === "" ? template.defaultTime : time,
    location: specs.place.trim() === "" ? template.venue : specs.place.trim(),
    price: specs.price.trim(),
    moneyFlow: "EARN",
    skills,
    lens: ["NOW", "NEARBY"],
    ...(notes === "" ? {} : { desc: notes.slice(0, 500) }),
    ...(hasPin ? { lat: specs.lat as number, lng: specs.lng as number } : {}),
    // DEMAND-TARGET-KEEP-001：定向邀约。空串/undefined 都不带 —— 不带 = 公开发布，
    // 行为与之前完全一致（契约注释原话）。写成一整条而非 `targetUserId` 直传，
    // 是为了让「没选人」这条路径的 wire 形状与改动前逐字节相同。
    ...(targetUserId === undefined || targetUserId.trim() === ""
      ? {}
      : { targetUserId: targetUserId.trim() })
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
