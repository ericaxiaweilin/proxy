// SCENE-HOME-ENTRY-001（2026-09-24，原型 deepseek_html_20260924_412dba
// 「Scene · 精修版」首页）：首页场景入口卡的**纯逻辑** —— 一个主动作分类下
// 到底有多少真实场景、这些数字从哪来。
//
// 为什么单独一个 .ts：`components/*.tsx` 会被 react-native / Metro 的 asset
// require 拉进来，测试文件根本 import 不了它，只能靠 grep 文本钉。而这里算的
// 是**用户能看到的真实计数**（「N 家」「N 人去过」）—— 这是本仓最不能只靠
// 文本钉守着的部分。同 SCENE-FAVORITE-002 的做法：逻辑放纯模块、目录（图标
// require）留在 .tsx，让「没有真实场景就不出卡」「计数怎么算」这类行为有真的
// 行为测试守着。

/** 首页那一行放哪 6 个主动作（原型首页 action-row 的原文顺序）。 */
export const PRIMARY_ACTION_IDS = ["coffee", "dining", "city-walk", "photo", "cycling", "exhibition"] as const;

/**
 * 动作 → 真实场景的归属词。
 *
 * 后端**没有**「这个场景属于哪个动作」这张表：公开列表 /v1/reality-scenes
 * 里只有自由文本 type（如「咖啡 · 户外」）和 SCENE-CATEGORY-001 的封闭顶类
 * （商家/景点/其他）；场景详情里那三条 Actions 是邀请真人 / 发机会 / 报名
 * 三个**可执行动作**，不是分类。所以这里跟组件里既有的 sceneMatches 用同一
 * 套路：对 name/area/type 做子串归属。
 *
 * 匹配不到就是空 —— 不编场景、不拿本地 MOMENTS fixture 顶上。
 */
export const ACTION_SCENE_KEYWORDS: Record<string, readonly string[]> = {
  coffee: ["咖啡", "cafe", "coffee", "cà phê"],
  dining: ["餐", "restaurant", "bistro", "美食", "food", "quán ăn"],
  "city-walk": ["老城", "old quarter", "old town", "街", "street", "湖", "lake", "公园", "park"],
  photo: ["拍照", "photo", "观景", "景点", "viewpoint", "camera"],
  cycling: ["骑行", "cycling", "bike", "自行车", "xe đạp"],
  exhibition: ["美术馆", "画廊", "gallery", "museum", "展"],
};

/** 入口卡需要的那几个真实字段（`realityscene.Scene` 公开列表的子集）。 */
export type SceneCategoryBrief = {
  name: string;
  area: string;
  type: string;
  imageUrl: string;
  /** SCENE-CATEGORY-001 的封闭顶类（商家/景点/其他）。计数单位靠它。 */
  category: string;
  /** SCENE-REAL-COUNTS-001 的真实派生计数（不是热度）。 */
  visitedCount: number;
};

/** 调用方自己的动作目录（id + 展示名），标签不在这里抄第二份。 */
export type SceneCategoryAction = { id: string; label: string };

export type SceneCategoryEntry = {
  actionId: string;
  /** 来自调用方传入的动作目录，保证跟那一行上的文字一致。 */
  label: string;
  /** 命中的真实场景条数。 */
  count: number;
  /** 计数单位：命中里过半是「商家」顶类就用「家」，其余用「个」。 */
  unit: "家" | "个";
  /** 真实派生：命中场景 visitedCount 合计。0 就不显示（不是热度）。 */
  visitedTotal: number;
  /** 真实派生：命中场景的 area 去重，最多 2 个。 */
  areas: readonly string[];
  /** 命中里第一条有图的真实场景的 imageUrl（可能是相对路径，调用方拼 base）。 */
  imageUrl: string;
};

/**
 * 首页场景入口卡 —— 一张卡 = 一个**真的有场景**的主动作分类。
 *
 * 计数、去过人数、区域全部由 /v1/reality-scenes 的真实字段派生；没有真实
 * 场景的动作**不出卡**（不是显示「0 家」，更不是拿本地 MOMENTS 顶上）。
 * 原型卡片上另外那两行（本周活动 / 正在招募）没有数据源，一律不做。
 */
export function sceneCategoryEntries(
  scenes: readonly SceneCategoryBrief[],
  actions: readonly SceneCategoryAction[],
): readonly SceneCategoryEntry[] {
  return actions.flatMap((action) => {
    const words = ACTION_SCENE_KEYWORDS[action.id] ?? [];
    const matched = scenes.filter((scene) => {
      const haystack = `${scene.name} ${scene.area} ${scene.type}`.toLowerCase();
      return words.some((word) => haystack.includes(word.toLowerCase()));
    });
    if (matched.length === 0) return [];
    const merchantCount = matched.filter((scene) => scene.category === "商家").length;
    const visitedTotal = matched.reduce((sum, scene) => sum + (Number.isFinite(scene.visitedCount) ? scene.visitedCount : 0), 0);
    const areas = [...new Set(matched.map((scene) => scene.area).filter(Boolean))].slice(0, 2);
    return [{
      actionId: action.id,
      label: action.label,
      count: matched.length,
      unit: merchantCount * 2 >= matched.length ? "家" as const : "个" as const,
      visitedTotal,
      areas,
      imageUrl: matched.find((scene) => scene.imageUrl)?.imageUrl ?? "",
    }];
  });
}
