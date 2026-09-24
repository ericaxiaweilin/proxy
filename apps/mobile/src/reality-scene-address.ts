// SCENE-ADDRESS-001: 场景的「地址行」。
//
// reality.scenes 以前只有 area（"Cầu Giấy" 这种**区名**）+ lat/lng。地图 marker
// 的 description 拼的是 `area · type`，所以用户问"这家店在哪条街"答不上来 ——
// 区名不是地址。现在服务端多给一个 address（门牌/街道级），但它是**可选**的：
// 河内那几条老数据没有这个字段。
//
// 为什么单独一个纯 .ts：reality-scene-map.tsx 是 .tsx 且 import react-native-maps，
// vitest 里根本 import 不进来。把这段回退逻辑放这里，才能真正测到。
// 跟 location-options.ts / device-location.ts 是同一个取向。

export interface SceneAddressFields {
  /** 门牌/街道级地址。没有就是没有 —— 不许拿 area 冒充。 */
  address?: string | undefined;
  /** 区名（Cầu Giấy / Bắc Ninh …）。不是地址。 */
  area: string;
  type: string;
}

/**
 * 有地址用地址，没有退回「区 · 类型」。
 *
 * 三个不许：
 *   · 不许返回空串（空白会被读成"地址加载中 / 加载失败"）；
 *   · 不许在没地址时返回 undefined 让调用方自己拼（拼法会散落各处不一致）；
 *   · 不许把区名当地址 —— 回退时**带上了 type**，所以"没地址"和"地址是区名"
 *     在屏幕上长得不一样。
 */
export function sceneAddressLine(scene: SceneAddressFields): string {
  const address = scene.address?.trim();
  return address && address.length > 0 ? address : `${scene.area} · ${scene.type}`;
}

// ---------------------------------------------------------------------------
// SCENE-CONTRIB-001: 数据来源
// ---------------------------------------------------------------------------

export type SceneSource = "OSM" | "COMMUNITY";

/**
 * 来源角标。
 *
 * 目录里 11 条坐标是 OSM/Nominatim 查过的；用户提交的一条都没查过 —— 是别人
 * 随手点的。混在一起又不标，用户就没法判断该不该信，等于重犯刚删掉的那五个
 * 假数字的错。
 *
 * **没有 source 字段时返回「坐标来源未知」**，不是空串 —— 老数据没有这个字段，
 * 返回空串会让"来源不明"看起来跟"已核实"一模一样。
 */
export function sceneSourceLabel(source?: string): string {
  if (source === "COMMUNITY") return "社区提交 · 坐标未经核实";
  if (source === "OSM") return ""; // 已核实的不加角标，否则满屏噪音
  return "坐标来源未知";
}

/** 这个场景的坐标是不是查过的（只有 OSM 算）。 */
export function isVerifiedScene(source?: string): boolean {
  return source === "OSM";
}

/**
 * 拼在 `区 · 类型` 后面的来源尾巴；已核实的不加任何东西。
 *
 * 为什么要单独一个函数：在 JSX 里写
 * `{sceneSourceLabel(x) ? ` · ${sceneSourceLabel(x)}` : ""}`
 * 会把同一个表达式写两遍，改一处漏一处的概率翻倍 —— 而且让"这一行到底显示
 * 什么"变成读两遍才看得懂。
 */
export function sceneSourceSuffix(source?: string): string {
  const label = sceneSourceLabel(source);
  return label ? ` · ${label}` : "";
}

/** 这个场景到底有没有登记门牌地址（空串算没有）。 */
export function hasSceneAddress(scene: Pick<SceneAddressFields, "address">): boolean {
  return Boolean(scene.address && scene.address.trim().length > 0);
}

// ---------------------------------------------------------------------------
// SCENE-REAL-COUNTS-001: 真实派生的计数
// ---------------------------------------------------------------------------

// 计数是**可选**的（老数据没有这几个字段），所以显式带 `| undefined` ——
// 本仓开了 exactOptionalPropertyTypes，`savedCount?: number` 收不下
// `number | undefined`。
export interface SceneCountsFields {
  savedCount?: number | undefined;
  visitedCount?: number | undefined;
  plannedCount?: number | undefined;
  /** SCENE-CHECKIN-001: 当前"在这里"的人数（未过期 check-in 的真聚合）。 */
  hereCount?: number | undefined;
}

/**
 * 把真实计数拼成一行人话。
 *
 * 两个不许：
 *   · 不许显示写死的假数字（posts 312 那种）—— 只用服务端聚合出来的真数；
 *   · **一个都没有时不许显示 "0 人去过"** —— 那看起来像"加载失败"或"这地方
 *     没人要"。如实说"还没有人……"，空态和零态长得不一样。
 */
export function sceneCountsLine(scene: SceneCountsFields): string {
  const saved = Math.max(0, Math.trunc(scene.savedCount ?? 0));
  const visited = Math.max(0, Math.trunc(scene.visitedCount ?? 0));
  const planned = Math.max(0, Math.trunc(scene.plannedCount ?? 0));
  const here = Math.max(0, Math.trunc(scene.hereCount ?? 0));
  const parts: string[] = [];
  // 「在这里」排最前：它是唯一会自己变化的数，也是最像"现场"的信号。
  // 措辞是"人说在这里"而不是"现场有 N 人" —— 这是本人声明，不是定位证据。
  if (here > 0) parts.push(`${here} 人说在这里`);
  if (visited > 0) parts.push(`${visited} 人去过`);
  if (saved > 0) parts.push(`${saved} 人收藏`);
  if (planned > 0) parts.push(`${planned} 人计划去`);
  if (parts.length === 0) return "还没有人收藏或去过 · 你可以是第一个";
  return parts.join(" · ");
}

export interface SceneSignalFields extends SceneCountsFields {
  /** 当前用户自己的私人标记（与上面的 *Count 是两回事：那是所有人的聚合） */
  visited?: boolean;
  saved?: boolean;
  planned?: boolean;
}

/**
 * 场景列表行上那句"信号"。
 *
 * SCENE-NO-FABRICATED-001: 以前是
 *   `scene.active ? "正在发生" : visited ? "去过" : saved ? "已收藏" : Scene Quality 93`
 * 两个都是假的：
 *   · "正在发生" 是从 seed 里一个**静态布尔值**读出来的，跟此刻现场有没有人、
 *     有没有活动毫无关系；
 *   · "Scene Quality 93" 是迁移里手写死的整数，全仓没有任何评分来源。
 *
 * 现在只说**我们知道的事**：先看用户自己的标记，没有再看真实聚合的计数。
 */
export function sceneSignalLine(scene: SceneSignalFields): string {
  if (scene.visited) return "你标记过去过";
  if (scene.saved) return "你收藏了这里";
  if (scene.planned) return "你计划去这里";
  return sceneCountsLine(scene);
}

/**
 * 供热图的聚合分：只用服务端真聚合数，「在这里」权重最高（唯一活信号）。
 * 非法/负数按 0 计；0 分 = 无数据，调用方不渲染（热力不许编）。
 */
export function sceneHeatScore(scene: SceneCountsFields): number {
  const clamp = (v: number | undefined): number =>
    typeof v !== "number" || !Number.isFinite(v) ? 0 : Math.max(0, Math.trunc(v));
  return clamp(scene.hereCount) * 3 + clamp(scene.savedCount) + clamp(scene.visitedCount) + clamp(scene.plannedCount);
}
