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
//   · 评分 —— `reality.scenes` 没有任何评分列，全仓也没有评价域
//     （realityscene 包里 grep 不到 Rating/Review）；SCENE-NO-FABRICATED-001
//     删掉的「Scene Quality 93」就是这一类写死的数。用户已明确「评分肯定
//     是用户评价」——语义定了，但评价域还没落地，所以**今天不显示评分**，
//     也不显示「本月热门」「最近新开」这类派生结论。
//   · 设施标签（带机位/可预约/安静/营业中）—— 用户已明确：单店详情是
//     商家自己页面上**一个月采一次**的数据，目前先不管。
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
  return `${(meters / 1000).toFixed(1)}km`;
}

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
// 排序
// ---------------------------------------------------------------------------

export type ShopSortId = "recommended" | "nearest" | "saved" | "visited";

export type ShopSort = { id: ShopSortId; label: string };

/**
 * 排序项。原型是 推荐 / 最近 / 出图最多 / 评分最高 / 最近新开 —— 只有前两项
 * 有真实数据支撑：
 *   · 出图最多 —— 场景没有图片计数（SCENE-NO-FABRICATED-001 删掉的 posts 就是
 *     它）；hereCount 是"此刻在这里"，不是"出过图"。
 *   · 评分最高 —— 没有评分域（见文件头）。
 *   · 最近新开 —— `reality.scenes` 没有开业时间列，只有 updated_at（那是
 *     行更新时间，不是开业时间）。
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
 * 不写「3km 内」：公开目录**不按半径筛**，写上去就是假的。没有定位时也不
 * 假装有 —— 直接说清楚这一页不含距离。
 */
export function shopListLocationLine(hasOrigin: boolean): string {
  return hasOrigin
    ? "已按你的当前位置排序 · 距离为直线距离"
    : "未取得定位 · 不含距离，也没有「最近」排序";
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
export function shopDetailTags(scene: SceneShopBrief): readonly string[] {
  const typeParts = scene.type.split("·").map((part) => part.trim()).filter(Boolean);
  const tags = [...typeParts];
  const area = scene.area.trim();
  if (area && !tags.includes(area)) tags.push(area);
  return tags.slice(0, 4);
}

export type ShopInfoCell = { value: string; label: string };

/**
 * 详情页那张三格信息条（原型：评分 / 距离 / 在此出图）。
 *
 * 只放真的有数的格子，最多 3 格（布局就是三列）；一格都没有时返回空数组，
 * 调用方整条不画。评分那格没有数据源 ⇒ 不占位、不写「—」。
 */
export function shopInfoCells(scene: SceneShopBrief, origin?: SceneOrigin): readonly ShopInfoCell[] {
  const cells: ShopInfoCell[] = [];
  const meters = sceneDistanceMeters(origin, scene);
  const distance = formatShopDistance(meters);
  if (distance) {
    const minutes = walkMinutes(meters);
    cells.push({ value: distance, label: minutes === undefined ? "距离" : `步行约 ${minutes} 分钟` });
  }
  const here = realCount(scene.hereCount);
  if (here > 0) cells.push({ value: `${here} 位`, label: "此刻在这里" });
  const saved = realCount(scene.savedCount);
  if (saved > 0) cells.push({ value: `${saved} 人`, label: "收藏了这个场景" });
  const visited = realCount(scene.visitedCount);
  if (visited > 0) cells.push({ value: `${visited} 人`, label: "去过这个场景" });
  return cells.slice(0, 3);
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
