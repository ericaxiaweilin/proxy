// SPORT-BADMINTON-001：home 场景「运动 · 羽毛球」入口背后那张表的**纯逻辑**部分。
//
// 原型：Downloads/deepseek_html_20260925_e64f86.html（陪打羽毛球：列表 → 选择城市 → 详情）。
// 本模块只放数据与判定，不碰 RN —— 所以判定函数能被真行为测试直接调用
// （跟 scene-category-entries.ts 的分工一样：纯模块 + 真测试，界面只负责画）。
//
// ⚠️ 数据来源（必须跟界面顶部那条常驻提示行一起读）
//
// 后端**没有**「运动陪打人」这个供给模型。查过的三条路都不是它：
//   · apps/api-go/internal/citycompanion —— 是**城市同行**（CITY_COMPANION 能力）。
//     候选来自 agent 的 CITY_COMPANION 服务与 seed 池（Linh / Mai / Minh），
//     字段是「本单报价 + 履约率 + 城市同行单量」，跟羽毛球无关；
//     拿它当陪打供给就是把城市导游冒充球友。
//   · apps/api-go/internal/socialspace 的 `badminton` —— 是**组局**（94 人兴趣圈子，
//     「每周组局 · 新手友好」），不是按小时计费的陪打供给；
//   · /v1/reality-scenes 的真实场景目录里**没有**羽毛球馆
//     （ACTION_SCENE_KEYWORDS 里也没有 sport）。
// 所以 RIDERS 是**演示数据**，界面顶部常驻提示行把它标出来（同 coffee-scenes 的做法）。
// 真数据接上以后：摘掉提示行、把 RIDERS 换成 client 拉取，
// 下面的判定函数一行都不用改 —— 这是把它们单独放一个文件的原因。
//
// ⚠️ 刻意**不**写进数据的两个东西
//   · 「已通过实名核验」这类核验结论：本仓库的核验是**有真实状态的**
//     （provider-application-client.ts：还没有完成 / 审核中 / 未通过 / 通过，
//     并且 ORDER-APPLY-KYC-GATE-001 真的拿它当接单闸）。给 6 个编出来的人
//     写一句「已通过核验」，就是 SUBPAGE-GENERIC-FABRICATED-001 禁的那种
//     「把一次没人做过的核验写成已完成态」。所以详情页那一行写的是**服务形态**
//     （场馆合作陪打 · 平台撮合），不是核验结论。
//   · 场馆资质：`venueLicense` 照原型留着（原型卡片上有「场馆持证」角标 + 执照号），
//     但顶部提示行把「资质」两个字明确列进演示范围 —— 提示行不是装饰，是这条数据的
//     免责边界。改提示行文案前先想清楚这一点。

export type BadmintonRegionId = "north" | "central" | "south";

export type BadmintonCityGroup = {
  id: BadmintonRegionId;
  label: string;
  cities: readonly string[];
};

// 越南中资企业集中的工业区城市（照原型 CITIES_DATA 原文）。
export const BADMINTON_CITY_GROUPS: readonly BadmintonCityGroup[] = [
  {
    id: "north",
    label: "北部",
    cities: ["河内", "北宁", "北江", "海防", "海阳", "兴安", "永福", "太原", "广宁", "清化", "南定", "宁平"]
  },
  { id: "central", label: "中部", cities: ["岘港", "义安", "顺化", "广义", "平定"] },
  {
    id: "south",
    label: "南部",
    cities: ["胡志明市", "同奈", "平阳", "隆安", "巴地头顿", "西宁", "平福", "前江"]
  }
];

export const BADMINTON_HOT_CITIES: readonly string[] = ["河内", "北宁", "北江", "海防", "胡志明市", "同奈", "平阳", "岘港"];

// 定位是**演示值**，不是真的读了 GPS —— 界面上的「当前」角标只是照原型画。
export const BADMINTON_LOCATED_CITY = "北宁";

export const BADMINTON_RECENT_CITIES: readonly string[] = ["北江", "海防", "河内"];

// 首屏默认选中的两个城市（原型 STATE.selectedCities）。
export const BADMINTON_DEFAULT_CITIES: readonly string[] = ["北宁", "北江"];

export const BADMINTON_ALL_CITIES: readonly string[] = BADMINTON_CITY_GROUPS.flatMap((group) => group.cities);

export type BadmintonLevel = "beginner" | "intermediate" | "advanced";
export type BadmintonLanguage = "vi" | "zh" | "en";

// 状态只有两种真实形态：有档期 / 被收藏。原型里第二种写的是 '3 人收藏' 这种
// **已经含数字的串**，同时又有一个 collected:3 字段 —— 两个数字来源迟早对不上，
// 所以这里只存 kind，数字从 collected 现算（见 badmintonStatusLabel）。
export type BadmintonStatus = { kind: "available"; at: string } | { kind: "saved" };

export type BadmintonRider = {
  id: string;
  /** 卡片主标题（原型 'Linh · 羽毛球陪打'）。 */
  name: string;
  /** 陪打人短名（头像下方那行）。 */
  rider: string;
  /** 头像字母。 */
  initial: string;
  /** 头像底色，映射到 theme 的 token（见 surface 里的 TONE）。 */
  tone: "magenta" | "violet" | "mint" | "lime";
  rating: number;
  orders: number;
  collected: number;
  venue: string;
  venueLicense: string;
  city: string;
  /** 距**当前定位**（BADMINTON_LOCATED_CITY）的公里数 —— 「最近」按它排。 */
  distanceFromLocatedKm: number;
  level: BadmintonLevel;
  languages: readonly BadmintonLanguage[];
  hours: number;
  status: BadmintonStatus;
  priceVnd: number;
  duration: string;
  place: string;
  includes: string;
  insurance: string;
  payNote: string;
};

// 6 条演示数据（照原型 RIDES 原文，另加 distanceFromLocatedKm ——
// 原型没有距离字段，而「最近」这个筛选必须有个真东西可排，
// 没有距离就只能假装排序，那是假控件）。
export const BADMINTON_RIDERS: readonly BadmintonRider[] = [
  {
    id: "r1",
    name: "Linh · 羽毛球陪打",
    rider: "Linh",
    initial: "L",
    tone: "magenta",
    rating: 4.9,
    orders: 128,
    collected: 1,
    venue: "Bắc Ninh Sports Center",
    venueLicense: "CN-TTTT-BN-0128/2026",
    city: "北宁",
    distanceFromLocatedKm: 3.2,
    level: "intermediate",
    languages: ["vi", "zh"],
    hours: 2,
    status: { kind: "available", at: "今晚 19:00" },
    priceVnd: 350000,
    duration: "2 小时 · 晚 19:00 – 21:00",
    place: "Bắc Ninh Sports Center · 3 号场",
    includes: "陪打 · 球拍租借 · 免费矿泉水",
    insurance: "场馆已购公众责任险",
    payNote: "现金支付 · 场地费另付场馆"
  },
  {
    id: "r2",
    name: "Hana · 羽毛球陪打",
    rider: "Hana",
    initial: "H",
    tone: "violet",
    rating: 5,
    orders: 87,
    collected: 3,
    venue: "Bắc Giang Badminton Club",
    venueLicense: "CN-TTTT-BG-0089/2026",
    city: "北江",
    distanceFromLocatedKm: 18,
    level: "advanced",
    languages: ["vi", "zh"],
    hours: 2,
    status: { kind: "saved" },
    priceVnd: 450000,
    duration: "2 小时 · 晚 20:00 – 22:00",
    place: "Bắc Giang Badminton Club · 1 号场",
    includes: "陪打 · 球拍租借 · 球拍线免费保养",
    insurance: "场馆已购公众责任险",
    payNote: "现金支付 · 场地费另付场馆"
  },
  {
    id: "r3",
    name: "Thảo · 羽毛球陪打",
    rider: "Thảo",
    initial: "T",
    tone: "lime",
    rating: 4.8,
    orders: 56,
    collected: 2,
    venue: "Hải Phòng Racket Center",
    venueLicense: "CN-TTTT-HP-0234/2026",
    city: "海防",
    distanceFromLocatedKm: 105,
    level: "intermediate",
    languages: ["vi", "zh"],
    hours: 1.5,
    status: { kind: "saved" },
    priceVnd: 280000,
    duration: "1.5 小时 · 晚 19:30 – 21:00",
    place: "Hải Phòng Racket Center · 5 号场",
    includes: "陪打 · 球拍租借",
    insurance: "场馆已购公众责任险",
    payNote: "现金支付 · 场地费另付场馆"
  },
  {
    id: "r4",
    name: "Anna · 羽毛球陪打",
    rider: "Anna",
    initial: "A",
    tone: "mint",
    rating: 4.9,
    orders: 92,
    collected: 5,
    venue: "Bắc Ninh Sports Center",
    venueLicense: "CN-TTTT-BN-0128/2026",
    city: "北宁",
    distanceFromLocatedKm: 6.4,
    level: "advanced",
    languages: ["vi", "zh", "en"],
    hours: 2,
    status: { kind: "saved" },
    priceVnd: 420000,
    duration: "2 小时 · 晚 18:00 – 20:00",
    place: "Bắc Ninh Sports Center · 2 号场",
    includes: "陪打 · 球拍租借 · 战术指导",
    insurance: "场馆已购公众责任险",
    payNote: "现金支付 · 场地费另付场馆"
  },
  {
    id: "r5",
    name: "Mai · 羽毛球陪打",
    rider: "Mai",
    initial: "M",
    tone: "magenta",
    rating: 4.7,
    orders: 43,
    collected: 1,
    venue: "Hà Nội Star Sports",
    venueLicense: "CN-TTTT-HN-0456/2026",
    city: "河内",
    distanceFromLocatedKm: 32,
    level: "beginner",
    languages: ["vi", "zh"],
    hours: 2,
    status: { kind: "available", at: "今晚 20:00" },
    priceVnd: 320000,
    duration: "2 小时 · 晚 20:00 – 22:00",
    place: "Hà Nội Star Sports · 8 号场",
    includes: "陪打 · 球拍租借",
    insurance: "场馆已购公众责任险",
    payNote: "现金支付 · 场地费另付场馆"
  },
  {
    id: "r6",
    name: "Trang · 羽毛球陪打",
    rider: "Trang",
    initial: "T",
    tone: "violet",
    rating: 4.9,
    orders: 76,
    collected: 3,
    venue: "HCMC Racket Arena",
    venueLicense: "CN-TTTT-HCM-0891/2026",
    city: "胡志明市",
    distanceFromLocatedKm: 1620,
    level: "advanced",
    languages: ["vi", "zh", "en"],
    hours: 2,
    status: { kind: "saved" },
    priceVnd: 480000,
    duration: "2 小时 · 晚 19:00 – 21:00",
    place: "HCMC Racket Arena · 6 号场",
    includes: "陪打 · 球拍租借 · 战术指导",
    insurance: "场馆已购公众责任险",
    payNote: "现金支付 · 场地费另付场馆"
  }
];

// 首屏收藏态（原型 r1.favorite = true，其余 false）。收藏是**用户状态**，
// 不属于那份数据，所以单独放这里由界面初始化一个 Set。
export const BADMINTON_INITIAL_FAVORITES: readonly string[] = ["r1"];

export type BadmintonFilterId = "recommended" | "nearest" | "chinese" | "advanced";

export const BADMINTON_FILTERS: readonly { id: BadmintonFilterId; label: string }[] = [
  { id: "recommended", label: "推荐" },
  { id: "nearest", label: "最近" },
  { id: "chinese", label: "会中文" },
  { id: "advanced", label: "水平高" }
];

// 语言标签：中英双语 / 会中文 / 越南语。
export function badmintonLanguageLabel(languages: readonly BadmintonLanguage[]): string {
  const zh = languages.includes("zh");
  const en = languages.includes("en");
  if (zh && en) return "中英双语";
  if (zh) return "会中文";
  return "越南语";
}

export function badmintonLevelLabel(level: BadmintonLevel): string {
  switch (level) {
    case "beginner":
      return "初级";
    case "intermediate":
      return "中级";
    case "advanced":
      return "高级";
  }
}

// 小时数去掉多余的 .0：2 → "2"，1.5 → "1.5"。
export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(hours);
}

// 卡片上的三个标签：语言 / 水平 / 时长。**从字段现算**，不另存一份 tags ——
// 存了就会出现「标签说中级、level 字段说高级」这种对不上的状态。
export function badmintonRiderTags(rider: BadmintonRider): readonly string[] {
  return [badmintonLanguageLabel(rider.languages), badmintonLevelLabel(rider.level), `${formatHours(rider.hours)} 小时`];
}

// 搜索用的字段集 = 上屏的文字 + **语义同义词**。
//
// 为什么要同义词：标签是按语言组合取词的，会说中文的人里，
// 只中越双语显示「会中文」，中英越三语显示「中英双语」。
// 如果搜索只扫上屏文字，那么搜「会中文」就搜不到「中英双语」那两位 ——
// 而点「会中文」这个筛选 chip 走的是 languages.includes("zh")，**会**搜到他们。
// 同一个意图，搜索框比 chip 少一半人，那是 bug 不是设计。
// 所以这里把「会说中文」这件事当成一个 token 补进去，两条路结果一致。
export function badmintonSearchTokens(rider: BadmintonRider): readonly string[] {
  return [
    rider.name,
    rider.rider,
    rider.venue,
    rider.city,
    rider.place,
    ...badmintonRiderTags(rider),
    ...(rider.languages.includes("zh") ? ["会中文", "中文"] : []),
    ...(rider.languages.includes("en") ? ["英文"] : [])
  ];
}

// 卡片左下角那行。saved 的数字从 collected 现算，不读写死的串。
export function badmintonStatusLabel(rider: BadmintonRider): string {
  return rider.status.kind === "available" ? `${rider.status.at} 有空` : `${rider.collected} 人收藏`;
}

// 千分位用 vi-VN 的「.」分隔。**手写**而不走 Intl.NumberFormat：
// 真机 Hermes 上 Intl 不保证带全 locale 数据，价格格式化不能靠运气。
export function formatVnd(amount: number): string {
  const negative = amount < 0;
  const digits = String(Math.abs(Math.trunc(amount)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negative ? `-${grouped}` : grouped;
}

export function badmintonRiderCountLabel(count: number): string {
  return `${count} 位`;
}

export type BadmintonSegment = { text: string; hit: boolean };

// 搜索命中高亮（原型把命中的字包成 <mark>）。
// 大小写不敏感、**全部**命中都要标（原型用 /g）—— 只标第一处的话，
// 标题里出现两次关键词时看起来像只匹配了一半。
export function badmintonHighlightSegments(text: string, keyword: string): readonly BadmintonSegment[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];

  const haystack = text.toLowerCase();
  const segments: BadmintonSegment[] = [];
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at < 0) break;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false });
    segments.push({ text: text.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  // 拼接回去必须等于原文 —— 高亮只允许切分，不允许改写。
  return segments.length > 0 ? segments : [{ text, hit: false }];
}

// 定位行：没选城市 → 「选择城市」；≤2 个 → 「A · B」；>2 个 → 「A · B +N」。
export function badmintonLocationLabel(cities: readonly string[]): string {
  if (cities.length === 0) return "选择城市";
  if (cities.length <= 2) return cities.join(" · ");
  return `${cities.slice(0, 2).join(" · ")} +${cities.length - 2}`;
}

// 城市选择页底部：未选 / 已选 N 个城市 · 名字（最多 3 个）+N。
export function badmintonCityFooterLabel(cities: readonly string[]): string {
  if (cities.length === 0) return "未选择城市";
  const names = cities.slice(0, 3).join("、");
  const extra = cities.length > 3 ? ` +${cities.length - 3}` : "";
  return `已选 ${cities.length} 个城市 · ${names}${extra}`;
}

// 城市搜索：跨全部地区组匹配（热门/最近都是组内子集，所以不用另搜）。
export function badmintonCityMatches(keyword: string): readonly string[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return [];
  return BADMINTON_ALL_CITIES.filter((city) => city.toLowerCase().includes(q));
}

export function badmintonCityExists(city: string): boolean {
  return BADMINTON_ALL_CITIES.includes(city);
}

export type BadmintonQuery = {
  cities: readonly string[];
  keyword: string;
  filter: BadmintonFilterId;
};

// 推荐序：评分降序 → 单量降序 → id 升序（**必须有最后这一级**，
// 否则同分同单的两条在两次渲染里可能换位，列表会自己抖）。
function byRecommended(a: BadmintonRider, b: BadmintonRider): number {
  if (b.rating !== a.rating) return b.rating - a.rating;
  if (b.orders !== a.orders) return b.orders - a.orders;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// 列表页的判定：城市 → 关键词 → 筛选 → 排序。
// 未知 filter id 落到推荐序（**不是**返回全部原序）—— 原序是数据文件的顺序，
// 那是实现细节，不该是给用户看的顺序。
export function badmintonRiders<T extends BadmintonRider>(riders: readonly T[], query: BadmintonQuery): readonly T[] {
  const { cities, keyword, filter } = query;
  const q = keyword.trim().toLowerCase();

  let list = riders.filter((rider) => {
    if (cities.length > 0 && !cities.includes(rider.city)) return false;
    if (!q) return true;
    // 匹配面照原型（标题 / 人名 / 场馆 / 城市 / 具体场地 / 标签），
    // 外加语义同义词 —— 见 badmintonSearchTokens 的说明。
    return badmintonSearchTokens(rider).some((field) => field.toLowerCase().includes(q));
  });

  if (filter === "chinese") list = list.filter((rider) => rider.languages.includes("zh"));
  if (filter === "advanced") list = list.filter((rider) => rider.level === "advanced");

  const sorted = [...list];
  if (filter === "nearest") {
    sorted.sort((a, b) => {
      if (a.distanceFromLocatedKm !== b.distanceFromLocatedKm) return a.distanceFromLocatedKm - b.distanceFromLocatedKm;
      return byRecommended(a, b);
    });
  } else {
    sorted.sort(byRecommended);
  }
  return sorted;
}
