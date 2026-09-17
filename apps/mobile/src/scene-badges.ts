// scene-badges.ts — 场景打卡徽章（SCENE-BADGE-001）。
//
// 打卡不是终点：打卡景点、集类别、留足迹都要有看得见的回报，才有人愿意
// 真的走到现场。本文件是徽章的**唯一规则源**（纯函数，可单测）；服务端
// 在 CheckInScene 成功后按同一套规则判定并 append-only 记录已获得徽章，
// 客户端只读展示 + 在打卡成功响应里拿到「新获得」提示。
//
// 徽章口径（与场景目录 realityscene/service.go 的 launchScenes 对齐）：
//   场景 Type 分类：湖边 / 街区 / 桥 / 古迹 / 艺术 / 咖啡 / 寺庙 / 公园
//   Xiaomei 绑定场景：ai_001→threebeans · ai_002→trucbach ·
//   ai_003→phunghung · ai_004→manzi（见 ai-companion-catalog）

/** 一个可获得的徽章定义。 */
export interface SceneBadge {
  id: string;
  name: string;
  desc: string;
  /** 徽章图标（ProxyIcon name 或 emoji）。 */
  icon: string;
}

/** 已获得徽章（服务端返回/本地同步）。 */
export interface EarnedBadge {
  badgeId: string;
  earnedAt: string; // ISO
  /** 获得时的触发场景（可选）。 */
  sceneId?: string;
}

/** 打卡/足迹状态（用于判定）。 */
export interface SceneBadgeInput {
  /** 已打卡（CheckInScene 成功过）的场景 id 集合。 */
  checkedInSceneIds: ReadonlyArray<string>;
  /** 已留足迹（privateVisited）的场景 id 集合。 */
  visitedSceneIds: ReadonlyArray<string>;
}

// ——— 徽章目录（服务端与客户端共用同一份） ———

export const SCENE_BADGES: ReadonlyArray<SceneBadge> = [
  { id: "first_checkin", name: "初到打卡", desc: "在任何场景完成第一次 GPS 打卡。", icon: "📍" },
  { id: "checkin_3", name: "打卡新秀", desc: "累计在 3 个不同场景打卡。", icon: "🥉" },
  { id: "checkin_5", name: "打卡常客", desc: "累计在 5 个不同场景打卡。", icon: "🥈" },
  { id: "checkin_10", name: "打卡达人", desc: "累计在 10 个不同场景打卡。", icon: "🥇" },
  { id: "lake_trio", name: "湖畔三连", desc: "打卡全部湖边场景（还剑湖、西湖寺畔、竹帛湖）。", icon: "🌊" },
  { id: "coffee_hunter", name: "咖啡猎手", desc: "打卡全部咖啡场景（Three Beans 河内 + 北宁）。", icon: "☕" },
  { id: "oldtown_walk", name: "老城漫步", desc: "打卡老城街区（还剑湖、壁画街、火车街、龙编桥）。", icon: "🏮" },
  { id: "landmark", name: "经典打卡", desc: "打卡一处经典景点（还剑湖 / 龙编桥 / 文庙 / 镇国寺）。", icon: "🏛️" },
  { id: "xiaomei_company", name: "与小美同框", desc: "在一位小美的绑定场景打卡，她也会常来这里。", icon: "✨" },
  { id: "footprint_10", name: "足迹地图", desc: "给 10 个不同场景留下足迹。", icon: "🗺️" },
];

export function sceneBadgeById(id: string): SceneBadge | undefined {
  return SCENE_BADGES.find((badge) => badge.id === id);
}

// ——— 分类/绑定映射（与 launchScenes 对齐） ———

/** 场景 Type → 分类组。 */
const SCENE_TYPE_GROUPS: Record<string, string> = {
  "公共景点 · 湖边": "lake",
  "公共景点 · 街区": "oldtown",
  "公共景点 · 桥": "oldtown",
  "公共景点 · 古迹": "landmark",
  "公共景点 · 寺庙": "lake",
  "公共景点 · 公园": "park",
  "艺术 · 展览": "art",
  "咖啡 · 动态场景": "coffee",
};

/** 各徽章要求的场景 id 集合。 */
export const SCENE_BADGE_REQUIREMENTS: Record<string, ReadonlyArray<string>> = {
  lake_trio: ["hoankiem", "tranquoc", "trucbach"],
  coffee_hunter: ["threebeans", "threebeans_bn"],
  oldtown_walk: ["hoankiem", "phunghung", "train", "longbien"],
  landmark: ["hoankiem", "longbien", "vanmieu", "tranquoc"],
  xiaomei_company: ["threebeans", "trucbach", "phunghung", "manzi"],
};

/**
 * 判定当前应获得的全部徽章。规则：
 *  - 计数类：去重打卡数 ≥ 门槛；
 *  - 集合类：要求集合 ⊆ 已打卡集合（足迹不算打卡）；
 *  - 经典打卡/小美同框：要求集合 ∩ 已打卡 ≠ ∅；
 *  - 足迹类：去重足迹数 ≥ 门槛。
 * 返回按目录顺序，由调用方与服务端已记录做差集得到「新获得」。
 */
export function evaluateSceneBadges(input: SceneBadgeInput): ReadonlyArray<string> {
  const earned = new Set<string>();
  const checked = new Set(input.checkedInSceneIds);
  const visited = new Set(input.visitedSceneIds);
  const checkedCount = checked.size;

  if (checkedCount >= 1) earned.add("first_checkin");
  if (checkedCount >= 3) earned.add("checkin_3");
  if (checkedCount >= 5) earned.add("checkin_5");
  if (checkedCount >= 10) earned.add("checkin_10");

  const hasAll = (ids: ReadonlyArray<string>): boolean => ids.every((id) => checked.has(id));
  const hasAny = (ids: ReadonlyArray<string>): boolean => ids.some((id) => checked.has(id));

  if (hasAll(SCENE_BADGE_REQUIREMENTS.lake_trio!)) earned.add("lake_trio");
  if (hasAll(SCENE_BADGE_REQUIREMENTS.coffee_hunter!)) earned.add("coffee_hunter");
  if (hasAll(SCENE_BADGE_REQUIREMENTS.oldtown_walk!)) earned.add("oldtown_walk");
  if (hasAny(SCENE_BADGE_REQUIREMENTS.landmark!)) earned.add("landmark");
  if (hasAny(SCENE_BADGE_REQUIREMENTS.xiaomei_company!)) earned.add("xiaomei_company");

  if (visited.size >= 10) earned.add("footprint_10");

  return SCENE_BADGES.map((badge) => badge.id).filter((id) => earned.has(id));
}

/** 计算「新获得」（shouldHave - alreadyEarned），按目录顺序。 */
export function newlyEarnedBadges(
  shouldHave: ReadonlyArray<string>,
  alreadyEarned: ReadonlyArray<string>
): ReadonlyArray<string> {
  const have = new Set(alreadyEarned);
  return shouldHave.filter((id) => !have.has(id));
}

/** 集合类徽章（要求全集 —— hasAny 的 landmark / 小美同框不算进度，只看得没得）。 */
const SET_PROGRESS_BADGES: ReadonlyArray<string> = ["lake_trio", "coffee_hunter", "oldtown_walk"];
/** 计数类徽章：去重打卡数门槛（footprint_10 除外 —— 它要的是足迹数，不在打卡史里）。 */
const COUNT_PROGRESS_BADGES: Record<string, number> = { first_checkin: 1, checkin_3: 3, checkin_5: 5, checkin_10: 10 };

// BADGE-WALL-001: 单枚徽章的进度（给个人墙和场景主页用）。规则与
// evaluateSceneBadges 同构 —— 改规则必须两边一起改，测试钉住配对。
// 返回 undefined = 这枚没有进度概念（hasAny / 足迹类）：缺数据源就别算，
// 别拿打卡史去套足迹的门槛，那是两本账。
export function badgeProgress(badgeId: string, checkedInSceneIds: ReadonlyArray<string>): { total: number; done: number } | undefined {
  const checked = new Set(checkedInSceneIds);
  const threshold = COUNT_PROGRESS_BADGES[badgeId];
  if (threshold !== undefined) return { total: threshold, done: Math.min(checked.size, threshold) };
  if (!(SET_PROGRESS_BADGES as ReadonlyArray<string>).includes(badgeId)) return undefined;
  const needed = SCENE_BADGE_REQUIREMENTS[badgeId] ?? [];
  return { total: needed.length, done: needed.filter((id) => checked.has(id)).length };
}

// BADGE-WALL-001: 还缺哪几个场景 id（场景主页用来点名）。目录里没有的 id
// 不返回 —— 叫不上名字的店不点名，只计个数。
export function badgeMissingIds(badgeId: string, checkedInSceneIds: ReadonlyArray<string>, knownIds: ReadonlySet<string>): ReadonlyArray<string> {
  if (badgeProgress(badgeId, checkedInSceneIds) === undefined) return [];
  const checked = new Set(checkedInSceneIds);
  return (SCENE_BADGE_REQUIREMENTS[badgeId] ?? []).filter((id) => !checked.has(id) && knownIds.has(id));
}
