// SCENE-SHOP-DIRECTORY-001（2026-09-24，原型 deepseek_html_20260924_412dba
// 「Scene · 精修版」第 2/3 屏）：分类列表页 + 单店详情页的**纯逻辑**。
//
// 为什么单独一个 .ts：`components/*.tsx` 会被 react-native / Metro 的 asset
// require 拉进来，vitest 根本 import 不了，只能靠 grep 文本钉。而这里算的是
// **用户能看到的数字和排序**（「2 家」「1.2km / 步行约 15 分钟」「谁排前面」）
// —— 这是最不能只靠文本钉守着的部分。同 SCENE-HOME-ENTRY-001 /
// SCENE-FAVORITE-002 的做法：逻辑放纯模块，目录（图标 require）/ StyleSheet /
// JSX 留在 .tsx。
//
// ⚠️ 这一屏**没有**的东西，和有的东西一样重要。原型列表卡上是
// 「4.8 ★ · 本月热门」，详情是「4.8 ★ / 212 条评分」+ 一排
// 「湖边 / 带机位 / 可预约 / 安静」设施标签。本仓：
//   · 评分 —— **有真实来源，现在显示**（SCENE-RATING-CHIP-001，2026-09-27）。
//     SCENE-REVIEW-001 落地了「打过卡的人才能评」的场景评价域
//     （internal/scenereview + migrations/132_scene_reviews.sql），
//     cmd/api/main.go 里已经 SetRatingLookup 接上，所以公开目录
//     /v1/reality-scenes 返回的每条场景**本来就带** rating / ratingCount。
//     在这一屏之前把它丢掉，不是"没有数据源"，是"生产者有、消费者扔"
//     —— 那正是本仓最忌讳的半截接线。规矩不变：只有 ratingCount > 0 才画，
//     绝不拿 0 或假均分垫底（服务端两个字段也都是 omitempty）。
//   · 「本月热门」「最近新开」这类派生结论 —— 场景没有图片计数、也没有开业
//     时间列（只有 updated_at，那是行更新时间），继续不做。
//   · 价格 / 营业时间 / 设施标签（带机位/可预约/安静/营业中）—— 全是商家
//     自己页面上**一个月采一次**的数据，全仓没有生产者（migrations 与
//     internal 里 grep 不到 price / openHours 之类的列或字段）。用户已明确
//     「目前先不管」；`active` 又是个静态布尔，拿它渲染营业状态正是
//     SCENE-NO-FABRICATED-001 删掉「正在发生」的原因。所以运动卡上的
//     「₫/时」和封面「18:00-22:00」**不搬** —— 那两条在运动卡上也是演示值。
//   · 「N 位在此出图」—— 真实存在的是 SCENE-CHECKIN-001 的 hereCount
//     （此刻声明"在这里"的人），不是"出过图的人"。措辞按真实语义写。
// 排序项和筛选片也**只放数据真的支持的**：一个筛不掉任何东西的 chip 是死
// 按钮，本仓 placeholder-honest-actions.test.ts 就是专门钉这个的。

import { scenesForAction, type SceneCategoryBrief } from "./scene-category-entries";

/**
 * 列表/详情需要的真实字段 —— `realityscene.Scene` 公开列表（/v1/reality-scenes）
 * 的子集。可选的那些带显式 `| undefined`：本仓开了 exactOptionalPropertyTypes。
 */
export type SceneShopBrief = SceneCategoryBrief & {
  id: string;
  /** SCENE-ADDRESS-001：门牌/街道级地址，可选（老数据没有）。 */
  address?: string | undefined;
  latitude: number;
  longitude: number;
  /** SCENE-CONTRIB-001：数据来源（OSM = 坐标查过 / COMMUNITY = 用户提交）。 */
  source?: string | undefined;
  /** SCENE-REAL-COUNTS-001：真实派生计数。 */
  savedCount?: number | undefined;
  plannedCount?: number | undefined;
  /** SCENE-CHECKIN-001：此刻"在这里"的人数（会自己过期）。 */
  hereCount?: number | undefined;
  /**
   * SCENE-REVIEW-001 / SCENE-RATING-CHIP-001：真实评分聚合（打过卡的人评的）。
   *
   * 服务端两个字段都带 omitempty，count == 0 时整对都不出现 —— 所以这里
   * 两个都是可选的，而且**必须成对**判断：只看 rating 会把"没数据"看成 0 分。
   */
  rating?: number | undefined;
  ratingCount?: number | undefined;
};

export type SceneOrigin = { latitude: number; longitude: number };

// ---------------------------------------------------------------------------
// 距离 / 步行时长
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * 两点球面距离（米）。**没有定位、或坐标非法就返回 undefined** —— 不返回 0，
 * 也不编一个距离。0 会被渲染成「0m」，看起来像"就在脚下"。
 *
 * 服务端也有一份（internal/realityscene 的 haversineMeters），但那条路是
 * POST /v1/reality-scenes/nearby，要登录 + 精确位置同意（LC-08）；公开目录
 * 不带距离。列表页走公开目录 + 本地定位，所以这里必须有自己的一份。
 */
export function sceneDistanceMeters(
  origin: SceneOrigin | undefined,
  scene: { latitude: number; longitude: number },
): number | undefined {
  if (!origin) return undefined;
  const values = [origin.latitude, origin.longitude, scene.latitude, scene.longitude];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return undefined;
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(scene.latitude - origin.latitude);
  const deltaLng = toRadians(scene.longitude - origin.longitude);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(scene.latitude)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 距离文案（原型口径：`1.2km` / `800m`）。
 * 拿不到距离返回**空串**，调用方整块不画 —— 不显示「—」，那看着像加载失败。
 */
export function formatShopDistance(meters: number | undefined): string {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters)}m`;
  // SCENE-DISTANCE-FAR-001：10km 以上不带小数、带千分位 —— 以前是「11730.3km」。
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000).toLocaleString("en-US")}km`;
}

/**
 * SCENE-DISTANCE-FAR-001（2026-09-24）：人不在这座城市时（模拟器、出差、还没到越南），
 * 直线距离是真的，但「11730km · 步行约 146628 分钟」对用户毫无意义。超过 50km 算「不在附近」：
 * 列表卡不画距离，详情说「你不在附近」，不算步行时长。
 */
export const FAR_AWAY_METERS = 50_000;

export function isFarAway(meters: number | undefined): boolean {
  return typeof meters === "number" && Number.isFinite(meters) && meters > FAR_AWAY_METERS;
}

/** 步行只在 3km 以内有意义；更远就只说直线距离，不给一个没人会走的分钟数。 */
export const WALKABLE_METERS = 3_000;

/** 步行速度口径：80 米/分钟（≈4.8km/h）。原型 1.2km → 「步行约 15 分钟」即此。 */
export const WALK_METERS_PER_MINUTE = 80;

/** 步行时长（分钟）。拿不到距离返回 undefined。不足 1 分钟按 1 分钟。 */
export function walkMinutes(meters: number | undefined): number | undefined {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) return undefined;
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
}

// ---------------------------------------------------------------------------
// 计数
// ---------------------------------------------------------------------------

/** 真实计数的统一取数：非数字/负数一律按 0。 */
function realCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * 列表卡上那一行信号（原型这里是「4.8 ★ · 本月热门」）。
 *
 * 只说我们真的知道的事，按"最像现场"的顺序取第一条：此刻在这里 > 收藏 >
 * 去过。三个都是 0 时返回**空串**（整行不画）—— 不是显示「0 人」，
 * 也不是补一句「本月热门」。
 */
export function shopCardSignal(scene: SceneShopBrief): string {
  const here = realCount(scene.hereCount);
  if (here > 0) return `${here} 人此刻在这里`;
  const saved = realCount(scene.savedCount);
  if (saved > 0) return `${saved} 人收藏`;
  const visited = realCount(scene.visitedCount);
  if (visited > 0) return `${visited} 人去过`;
  return "";
}

/**
 * 卡片底部「此刻在这里」那一行。
 *
 * 和 shopCardSignal 不是重复：那条是**累计**信号（收藏/去过），这条是**此刻**
 * 的现场信号。0 就明说没人 —— 藏起来会让"没人"和"没拉到"长得一样。
 */
export function shopHereLine(hereCount: number | undefined): string {
  const here = realCount(hereCount);
  return here > 0 ? `${here} 位此刻在这里` : "此刻无人在这里";
}

// ---------------------------------------------------------------------------
// SCENE-RATING-CHIP-001（2026-09-27，用户：「所有场景对齐运动」）
//
// 「运动 · 羽毛球」列表卡上有一行数据 chip：★ 评分 / N 单 / 城市。咖啡这一屏
// 之前只有一排无数据的类型标签。评分现在有真实来源（SCENE-REVIEW-001），
// 数量那一格场景没有订单域，所以按真实语义换成「N 人去过」。
// ---------------------------------------------------------------------------

/**
 * 真实评分聚合。**只有 ratingCount > 0 才返回**，否则 undefined。
 *
 * 为什么两个字段必须成对判断：服务端 `rating` / `ratingCount` 都带 omitempty，
 * 没评价时整对都不出现；反序列化后 `rating` 却可能被读成 0。只看 `rating`
 * 就会把「还没有人评过」画成「0 分」—— 正是本仓禁止的「没有数据装成有数据」。
 * 所以 count 是闸，rating 是值，缺一个就当没有。
 */
export function shopRating(scene: SceneShopBrief): { stars: string; count: number } | undefined {
  const count = realCount(scene.ratingCount);
  if (count <= 0) return undefined;
  const average = scene.rating;
  if (typeof average !== "number" || !Number.isFinite(average) || average <= 0) return undefined;
  return { stars: average.toFixed(1), count };
}

/** 列表卡上的评分 chip（「★ 4.8」）。没有真实评价返回空串，整颗不画。 */
export function shopRatingChip(scene: SceneShopBrief): string {
  const rating = shopRating(scene);
  return rating ? `★ ${rating.stars}` : "";
}

/** 详情信息条里的评分格（4.8 / 「12 条评价」）。没有真实评价返回 undefined。 */
export function shopRatingCell(scene: SceneShopBrief): ShopInfoCell | undefined {
  const rating = shopRating(scene);
  return rating ? { value: rating.stars, label: `${rating.count} 条评价` } : undefined;
}

/**
 * 列表卡上的「去过」chip。
 *
 * 运动卡这一格是「87 单」（完成订单数）—— 场景**没有订单域**，所以不写"单"。
 * 真实存在的是 SCENE-REAL-COUNTS-001 的 visitedCount（去过的人），措辞就按它
 * 的真实语义写。0 返回空串，不是「0 人去过」。
 */
export function shopVisitedChip(scene: SceneShopBrief): string {
  const visited = realCount(scene.visitedCount);
  return visited > 0 ? `${visited} 人去过` : "";
}

// ---------------------------------------------------------------------------
// 封面角标：场景分类
// ---------------------------------------------------------------------------

/**
 * SCENE-CATEGORY-BADGE-001：封面左上角那枚分类角标（运动卡上是「场馆持证」，
 * 我们这里没有持证数据 —— 不许写）。能挂的只有真实的 `category` 枚举
 * （商家 / 景点 / 其他）。缺值或空串返回 **空串**，调用方整颗不画。
 *
 * 「场馆持证」「营业中」之类带资质/状态语义的角标**不要**在这里加 —— 它们
 * 都没有真实数据源，照搬就是把演示数据搬进真实列表（SCENE-NO-FABRICATED-001）。
 */
const SCENE_CATEGORY_LABEL: Readonly<Record<string, string>> = {
  "商家": "商家",
  "景点": "景点",
  "其他": "其他",
};

export function shopCategoryBadge(scene: { category?: string | undefined }): string {
  const raw = typeof scene.category === "string" ? scene.category.trim() : "";
  if (!SCENE_CATEGORY_LABEL[raw]) return "";
  return SCENE_CATEGORY_LABEL[raw];
}

/** chip 种类 —— 调用方靠它上色，跟运动卡那行三色 chip 一致。 */
export type ShopCardChipKind = "RATING" | "VISITED" | "AREA" | "TYPE";
export type ShopCardChip = { kind: ShopCardChipKind; text: string };

/**
 * 列表卡的 chip 行。顺序照运动卡：评分 → 数量 → 城市，然后才是类型标签。
 *
 * 每一颗都必须有真实来源，缺哪个就少哪颗（**不是**画一颗灰的占位，也不是
 * 写「—」）。文案按文本去重 —— area 单独成一颗之后就从类型标签里去重（同一行
 * 出现两次「Cầu Giấy」是噪音），同时保证调用方拿 text 当 key 是安全的。
 */
export function shopCardChips(scene: SceneShopBrief): readonly ShopCardChip[] {
  const chips: ShopCardChip[] = [];
  const seen = new Set<string>();
  const push = (kind: ShopCardChipKind, text: string): void => {
    if (text === "" || seen.has(text)) return;
    seen.add(text);
    chips.push({ kind, text });
  };
  push("RATING", shopRatingChip(scene));
  push("VISITED", shopVisitedChip(scene));
  push("AREA", scene.area.trim());
  for (const tag of shopDetailTags(scene)) push("TYPE", tag);
  return chips;
}

// ---------------------------------------------------------------------------
// 排序
// ---------------------------------------------------------------------------

export type ShopSortId = "recommended" | "nearest" | "saved" | "visited";

export type ShopSort = { id: ShopSortId; label: string };

/**
 * 排序项。原型是 推荐 / 最近 / 出图最多 / 评分最高 / 最近新开 —— 只有前两项
 * 有真实数据支撑：
 *   · 出图最多 —— 场景没有图片计数（SCENE-NO-FABRICATED-001 删掉的 posts 就是
 *     它）；hereCount 是"此刻在这里"，不是"出过图"。
 *   · 最近新开 —— `reality.scenes` 没有开业时间列，只有 updated_at（那是
 *     行更新时间，不是开业时间）。
 *   · 评分最高 —— 评分域 2026-09-27 起落地了（SCENE-RATING-CHIP-001）；下面
 *     这条旧断言曾经对，现在不对。目录页暂不加它（排序项跟着那次改动走），
 *     热门场景页有评分排序（见 HOT-SCENES-PAGE-001 的 sortHotScenes）。
 * 换成两个**真的有数**的：收藏最多 / 去过最多（SCENE-REAL-COUNTS-001）。
 */
export const SHOP_SORTS: readonly ShopSort[] = [
  { id: "recommended", label: "推荐" },
  { id: "nearest", label: "最近" },
  { id: "saved", label: "收藏最多" },
  { id: "visited", label: "去过最多" },
] as const;

/**
 * 这一趟真正可用的排序项。
 *
 * **没有定位就不给「最近」**：按一个不存在的距离排，结果和"没排"一模一样，
 * 那是个点了没反应的按钮。
 */
export function availableShopSorts(hasOrigin: boolean): readonly ShopSort[] {
  return hasOrigin ? SHOP_SORTS : SHOP_SORTS.filter((sort) => sort.id !== "nearest");
}

/**
 * 推荐度 —— **和服务端同一个公式**，不是另发明一套。
 *
 * `internal/realityscene/service.go` 的 recommendationScore：
 *   log1p(saved + 2*visited + 2*planned) * 8.0 - (distanceMeters/1000) * 2.5
 * 只用真计数 + 真距离，没有任何热度常数。
 *
 * ⚠️ 公开目录（/v1/reality-scenes）其实**已经带一个 recommendationScore**，
 * 但那个值算的时候 DistanceMeters 恒为 0（目录路径没有用户坐标）—— 也就是
 * 只有 `log1p(engagement)*8` 那一半，且 omitempty（无互动时字段直接不出现）。
 * 拿它排序等于完全不看距离，和「最近」那一项重复；所以这里按同一条公式重算
 * 一遍，把真实的设备距离补上 —— 这正是服务端 ListNearbyScenes 里的算法。
 * 公式若在服务端变了，客户端的「推荐」顺序会悄悄分叉 ⇒
 * scene-shop-directory.test.ts 有一条钉直接读那个 Go 文件比对公式字符串。
 *
 * 没有定位时距离项按 0 算（等价于"只按真实互动量排"），这是有意的降级：
 * 总比不排或者编一个距离好。
 */
export function recommendationScore(scene: SceneShopBrief, origin?: SceneOrigin): number {
  const engagement = realCount(scene.savedCount) + 2 * realCount(scene.visitedCount) + 2 * realCount(scene.plannedCount);
  const meters = sceneDistanceMeters(origin, scene) ?? 0;
  return Math.log1p(engagement) * 8.0 - (meters / 1000) * 2.5;
}

/** 稳定兜底：同名同分时按 id 排，免得每次渲染顺序都变。 */
function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 排序。每一项都以 id 兜底，**同分时顺序是确定的** —— 否则列表会在两次渲染
 * 之间自己换位，用户会以为点错了。
 */
export function sortShops<T extends SceneShopBrief>(
  scenes: readonly T[],
  sortId: ShopSortId,
  origin?: SceneOrigin,
): readonly T[] {
  const rows = [...scenes];
  if (sortId === "nearest") {
    // 没定位的排在最后（undefined 不参与比较），不是排最前。
    return rows.sort((a, b) => {
      const left = sceneDistanceMeters(origin, a);
      const right = sceneDistanceMeters(origin, b);
      if (left === undefined || right === undefined) {
        if (left === undefined && right === undefined) return byId(a, b);
        return left === undefined ? 1 : -1;
      }
      return left === right ? byId(a, b) : left - right;
    });
  }
  const keyOf = (scene: T): number => {
    if (sortId === "recommended") return recommendationScore(scene, origin);
    if (sortId === "saved") return realCount(scene.savedCount);
    return realCount(scene.visitedCount);
  };
  return rows.sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    return left === right ? byId(a, b) : right - left;
  });
}

// ---------------------------------------------------------------------------
// 筛选（区域）
// ---------------------------------------------------------------------------

/**
 * 结果里真实存在的区域。少于 2 个就返回空 —— 一个只有唯一选项的筛选条不是
 * 筛选，是一片点不动的装饰。
 */
export function shopAreaFacets(scenes: readonly SceneShopBrief[]): readonly string[] {
  const areas = [...new Set(scenes.map((scene) => scene.area.trim()).filter(Boolean))];
  return areas.length >= 2 ? areas : [];
}

/** 按区域收窄。空数组 = 不筛（不是"筛到空"）。 */
export function filterShopsByAreas<T extends SceneShopBrief>(
  scenes: readonly T[],
  areas: readonly string[],
): readonly T[] {
  if (areas.length === 0) return scenes;
  return scenes.filter((scene) => areas.includes(scene.area.trim()));
}

// ---------------------------------------------------------------------------
// 列表头
// ---------------------------------------------------------------------------

/** 「附近咖啡 2 家」里的计数那半截。 */
export function shopCountText(count: number, unit: string): string {
  return `${Math.max(0, Math.trunc(count))} ${unit}`;
}

/**
 * 列表头下面那行定位说明（原型：「河内市区 · 3km 内 · 已按当前位置排序」）。
 *
 * 地址取当前列表真实覆盖的 area 派生；不写「3km 内」：公开目录**不按半径筛**，
 * 写上去就是假的。没有定位时也不假装有 —— 直接说清楚这一页不含距离。
 */
export function shopListLocationLine(hasOrigin: boolean, areas: readonly string[] = [], farAway = false): string {
  const zones = [...new Set(areas.map((area) => area.trim()).filter(Boolean))];
  const zoneText = zones.length <= 3
    ? zones.join(" · ")
    : `${zones.slice(0, 3).join(" · ")}等 ${zones.length} 个区域`;
  const tail = hasOrigin
    ? (farAway ? "你当前不在这些场景附近 · 不显示距离" : "已按你的当前位置排序 · 距离为直线距离")
    : "未取得定位 · 不含距离，也没有「最近」排序";
  return zoneText === "" ? tail : `${zoneText} · ${tail}`;
}

/** 列表尾部那行收尾（原型：「已加载附近全部 23 家」）。 */
export function shopListEndText(count: number, unit: string): string {
  return `已加载全部 ${shopCountText(count, unit)}`;
}

// ---------------------------------------------------------------------------
// 单店详情
// ---------------------------------------------------------------------------

/**
 * 标题下那排标签（原型：营业中 / 咖啡 / 湖边）。
 *
 * 真实来源只有 type（如「咖啡 · 动态场景」）和 area —— 拆开就是标签。**不含
 * 「营业中」**：`reality.scenes.active` 是个静态布尔（SCENE-NO-FABRICATED-001
 * 就是因为拿它渲染「正在发生」才被删的），它不代表此刻开门。
 */
// SCENE-TAG-HONEST-001：type 里有些词是内部分类（「动态场景」），对用户没有意义，不当标签显示。
const INTERNAL_TYPE_WORDS: ReadonlySet<string> = new Set(["动态场景"]);

export function shopDetailTags(scene: SceneShopBrief): readonly string[] {
  const typeParts = scene.type.split("·").map((part) => part.trim()).filter((part) => part !== "" && !INTERNAL_TYPE_WORDS.has(part));
  const tags = [...typeParts];
  const area = scene.area.trim();
  if (area && !tags.includes(area)) tags.push(area);
  return tags.slice(0, 4);
}

export type ShopInfoCell = { value: string; label: string };

/**
 * 详情页那张三格信息条 —— **照原型 deepseek_html_20260927_7fc18d 的 stats-card**：
 * 评分 / 去过 / 收藏（就这三格，就这个顺序）。
 *
 * 距离**不在这里** —— 原型把它单独放在动作按钮下面那条 dist-bar 里
 * （`距离你 X · 到现场 100 米内自动打卡`），所以本函数不再产出距离格。
 *
 * 诚实规矩不变：评分只有 ratingCount > 0 才出现（没有真实评价就整格不画，
 * 不写「—」、不拿 0 分垫底）；去过 / 收藏是真实聚合计数，0 就是 0，照常显示。
 */
export function shopInfoCells(scene: SceneShopBrief): readonly ShopInfoCell[] {
  const cells: ShopInfoCell[] = [];
  const rating = shopRatingCell(scene);
  if (rating) cells.push(rating);
  cells.push({ value: `${realCount(scene.visitedCount)}`, label: "去过" });
  cells.push({ value: `${realCount(scene.savedCount)}`, label: "收藏" });
  return cells;
}

/**
 * 原型 dist-bar 那一行：距离 + 100 米自动打卡说明。
 *
 * 拿不到定位/距离就返回空串（整条不画） —— 不写「距离未知」占位，那条信息
 * 对"我要不要去"没有帮助，反而像加载失败。
 */
export function shopDistanceBar(scene: SceneShopBrief, origin?: SceneOrigin): string {
  const meters = sceneDistanceMeters(origin, scene);
  const distance = formatShopDistance(meters);
  if (!distance) return "";
  return `距离你 ${distance} · 到现场 100 米内自动打卡`;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 一个动作分类下的完整列表页数据。
 *
 * 命中逻辑复用 scene-category-entries 的 scenesForAction —— 首页入口卡上的
 * 「N 家」和点进来这页的行数必须是同一个数，两处各写一遍子串匹配迟早对不上。
 */
export function shopDirectoryRows<T extends SceneShopBrief>(
  scenes: readonly T[],
  actionId: string,
  options?: { sortId?: ShopSortId | undefined; areas?: readonly string[] | undefined; origin?: SceneOrigin | undefined },
): readonly T[] {
  const matched = scenesForAction(scenes, actionId);
  const filtered = filterShopsByAreas(matched, options?.areas ?? []);
  return sortShops(filtered, options?.sortId ?? "recommended", options?.origin);
}

// ---------------------------------------------------------------------------
// HOT-SCENES-PAGE-001（2026-09-27，原型 deepseek_html_20260927_752586「热门场景」）
// 首页热榜「更多」进的那一页。原型排序菜单是 去过人数 / 评分 / 距离最近 /
// 最新添加 —— 只搬**真的有数**的三个：
//   · 去过人数 —— visitedCount（SCENE-REAL-COUNTS-001）。
//   · 评分 —— SCENE-REVIEW-001 / SCENE-RATING-CHIP-001 的评分域 2026-09-27
//     已落地（本文件头那条「没有评分域」的旧注释是历史遗留，勿信）。
//     没人评过的场景排最后，不冒充 0 分；同组内按去过人数稳定。
//   · 距离最近 —— 复用 sortShops 的 nearest（没定位就不给这一项）。
//   · 最新添加 —— reality.scenes 没有开业时间列（updated_at 是行更新时间），
//     和 SHOP_SORTS 的「最近新开」同一条红线，不搬。
// ---------------------------------------------------------------------------

// SCENE-TYPE-BUCKET-001（用户反馈"分类咖啡店 餐厅 你这实现的不对"）：分类 chip
// 原来按 Scene.Category 分（商家/景点/其他三桶封闭分类），太粗——两家咖啡店和
// 一整片湖边公园全挤进同一个"商家"或"景点"桶。Scene.Type 更细（"咖啡 ·
// 动态场景" / "公共景点 · 湖边" 这种"大类 · 子类"自由文本，服务端没有枚举
// 约束），取"·"前半段当桶名，就能把咖啡店从"商家"里挑出来单独一个 chip——
// 仍然是真实数据分出来的桶，不是编的固定列表（真实目录里现在没有餐厅/运动/
// 娱乐这几类场景，桶名跟着数据自然出现/消失，不硬摆一个空 chip）。
export function sceneTypeBucket(type: string): string {
  const trimmed = type.trim();
  if (trimmed === "") return "";
  const sep = trimmed.indexOf(" · ");
  return sep < 0 ? trimmed : trimmed.slice(0, sep).trim();
}

export type HotSortId = "visited" | "rating" | "nearest";

export function availableHotSorts(hasOrigin: boolean): readonly { id: HotSortId; label: string }[] {
  const sorts: readonly { id: HotSortId; label: string }[] = [
    { id: "visited", label: "去过人数" },
    { id: "rating", label: "评分" },
    { id: "nearest", label: "距离最近" },
  ];
  // 没定位的「最近」是个点了没反应的按钮（同 availableShopSorts 的口径）。
  return hasOrigin ? sorts : sorts.filter((sort) => sort.id !== "nearest");
}

/** 原型 TOP 1/2/3 角标 = 「去过人数」排序下的前 3 且 visitedCount > 0（0 去过挂 TOP 是冒充热榜）。 */
export function hotTopRank(scenes: readonly { id: string; visitedCount: number }[], sceneId: string): number | undefined {
  const ranked = [...scenes]
    .filter((scene) => scene.visitedCount > 0)
    .sort((a, b) => b.visitedCount - a.visitedCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = ranked.findIndex((scene) => scene.id === sceneId);
  return index >= 0 && index < 3 ? index : undefined;
}

export function sortHotScenes<T extends SceneShopBrief>(
  scenes: readonly T[],
  sortId: HotSortId,
  origin?: SceneOrigin,
): readonly T[] {
  if (sortId === "nearest") return sortShops(scenes, "nearest", origin);
  if (sortId === "visited") return sortShops(scenes, "visited", origin);
  // 评分：ratingCount > 0 才算有评分（rating 和 count 必须成对判断），
  // 有分的按分数降序，没分的整体排后面、组内按去过人数降序 —— 都以 id 兜底。
  const ranked = scenes.filter((scene) => (scene.ratingCount ?? 0) > 0 && typeof scene.rating === "number");
  const unranked = scenes.filter((scene) => !((scene.ratingCount ?? 0) > 0 && typeof scene.rating === "number"));
  return [
    ...[...ranked].sort((a, b) => (b.rating as number) - (a.rating as number) || (b.visitedCount ?? 0) - (a.visitedCount ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ...[...unranked].sort((a, b) => (b.visitedCount ?? 0) - (a.visitedCount ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  ];
}

// ---------------------------------------------------------------------------
// SCENE-SHOP-ADDRESS-001（2026-09-24，原型 deepseek_html_20260924_f05cb0「★ 新增：地址行」）
// ---------------------------------------------------------------------------

/**
 * 列表卡 / 详情头图上的地址行：门牌地址 · 街区。地址里已经带了街区名就不重复。
 * 没登记地址返回空串（整行不画）—— 不拿区名假装是门牌。
 */
export function shopAddressLine(scene: Pick<SceneShopBrief, "area"> & { address?: string | undefined }): string {
  const address = (scene.address ?? "").trim();
  if (address === "") return "";
  const area = scene.area.trim();
  return area !== "" && !address.includes(area) ? `${address} · ${area}` : address;
}

/** 详情头图地址行的尾巴：「距你 1.2km」；太远 / 没定位就不加。 */
export function shopHeroDistanceSuffix(meters: number | undefined): string {
  const distance = formatShopDistance(meters);
  return distance && !isFarAway(meters) ? ` · 距你 ${distance}` : "";
}

/** 列表卡信息行里的距离：太远就不画（列表头已经说明了）。 */
export function shopCardDistance(meters: number | undefined): string {
  return isFarAway(meters) ? "" : formatShopDistance(meters);
}

// ---------------------------------------------------------------------------
// SCENE-ACTION-TEXT-001：「这里能做的事」以前把服务端状态码原样给用户看
// （REQUIRES_HUMAN_ACCEPTANCE / ACCEPTS_APPLICATIONS / REGISTRATION_ONLY）。
// ---------------------------------------------------------------------------

const ACTION_STATE_TEXT: Readonly<Record<string, string>> = {
  REQUIRES_HUMAN_ACCEPTANCE: "需要对方同意",
  ACCEPTS_APPLICATIONS: "接受报名",
  REGISTRATION_ONLY: "报名即可参加",
};

/** 状态码 → 人话；认不出的状态不显示（返回空串），绝不把机器码露给用户。 */
export function sceneActionStateText(state: string): string {
  return ACTION_STATE_TEXT[state] ?? "";
}

/**
 * 一条「能做的事」的副标题。
 *
 * 用户反馈（2026-09-28，"邀请真人 发布机会 报名活动废话很多"）：以前拼的是
 * 「人话状态 · 钱的含义」，钱的含义那半句（"费用约定，不代表已付款或收入"
 * 这种）是三张卡拼出来的同款免责声明腔，不是帮用户判断的信息——去掉，只
 * 留状态这一句真正说清楚"点了会发生什么"的短句。
 */
export function sceneActionSubtitle(action: { state: string; moneyMeaning: string }): string {
  return sceneActionStateText(action.state);
}

// ---------------------------------------------------------------------------
// SCENE-PHOTO-WALL-001：场景照片墙。第一来源是「发帖时标记了这个场景」的帖子
// （服务端 ListPostsAtScene），每条帖子的每张图一格；视频取封面，音频不上墙。
// SCENE-PHOTO-WALL-002（2026-09-28）：帖子墙为空时回落到场景自己的照片资产
// （主图 + 菜单图）：传过菜单/招牌的场景墙不可能空白。回落只在空墙时补，不跟
// 帖子混排抢序；资产无作者，author 留空（墙上不印作者行）。
// ---------------------------------------------------------------------------

export type ScenePhotoTile = { key: string; postId: string; path: string; author: string };

type WallPost = { postId: string; authorId: string; authorDisplayName?: string | undefined };
type WallMedia = { mediaAssetId: string; mediaType: string; thumbnailUrl?: string | undefined; feedUrl?: string | undefined; placeholderUrl?: string | undefined };

export function scenePhotoWallTiles(
  model: { posts: readonly WallPost[]; media: Readonly<Record<string, readonly WallMedia[]>> },
  max = 30,
): readonly ScenePhotoTile[] {
  const out: ScenePhotoTile[] = [];
  for (const post of model.posts) {
    for (const item of model.media[post.postId] ?? []) {
      if (item.mediaType !== "IMAGE" && item.mediaType !== "VIDEO") continue;
      const path = item.thumbnailUrl || item.feedUrl || item.placeholderUrl || "";
      if (!path) continue;
      out.push({ key: `${post.postId}:${item.mediaAssetId}`, postId: post.postId, path, author: post.authorDisplayName?.trim() || "" });
      if (out.length >= max) return out;
    }
  }
  return out;
}

export const SCENE_PHOTO_WALL_EMPTY = "这里还没有照片。";

// SCENE-PHOTO-WALL-002：场景资产兜底。detail 为空/全空返回 []，调用方继续走空墙文案。
export function sceneAssetWallTiles(
  detail: { heroImageUrl?: string | undefined; menu?: ReadonlyArray<{ imageUrl?: string | undefined }> | undefined; fullMenu?: ReadonlyArray<{ imageUrl?: string | undefined }> | undefined } | undefined,
  max = 30,
): readonly ScenePhotoTile[] {
  if (!detail) return [];
  const seen = new Set<string>();
  const out: ScenePhotoTile[] = [];
  const push = (kind: string, raw: string | undefined): void => {
    const path = (raw ?? "").trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push({ key: `asset:${kind}:${seen.size}`, postId: "", path, author: "" });
  };
  push("hero", detail.heroImageUrl);
  for (const item of detail.menu ?? []) push("menu", item?.imageUrl);
  for (const item of detail.fullMenu ?? []) push("menu", item?.imageUrl);
  return out.slice(0, max);
}

// STORE-SCENE-LINK-001：认领了这个场景的店铺，真的传过的相册（不是 hero/
// menu 那种兜底占位图）。mediaAssetId 走跟 merchant-storefront.tsx 的
// thumbUrlFor 同一条 URL 规则——服务端只给资产 id，不在 wire 上拼公网 URL。
// 没有 apiBaseUrl 就没法拼 URL，跟没有照片一样返回空数组，不猜一个 base。
export function sceneMerchantWallTiles(
  merchantPhotos: ReadonlyArray<{ mediaAssetId: string; caption?: string | undefined }> | undefined,
  apiBaseUrl: string | undefined,
): readonly ScenePhotoTile[] {
  if (!merchantPhotos || merchantPhotos.length === 0 || !apiBaseUrl) return [];
  const base = apiBaseUrl.replace(/\/$/, "");
  const out: ScenePhotoTile[] = [];
  for (const photo of merchantPhotos) {
    const mediaAssetId = (photo.mediaAssetId ?? "").trim();
    if (!mediaAssetId) continue;
    out.push({
      key: `merchant:${mediaAssetId}`,
      postId: "",
      path: `${base}/v1/media/thumb/${encodeURIComponent(mediaAssetId)}`,
      author: photo.caption?.trim() || "",
    });
  }
  return out;
}
