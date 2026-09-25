/**
 * facet-home-model — FACET 首屏的纯读模型（无 react-native import，vitest 直接跑）。
 *
 * 为什么单独成 .ts：`FacetHomeSurface.tsx` 不能被 vitest import（RN 组件），
 * 所以「AI 今日建议选谁 / 对象怎么分组 / 时间怎么显示」这些**会算错**的逻辑
 * 必须放在这里，屏里只做渲染。
 *
 * 设计来源：deepseek_html_20260925_cb1dd9.html（FACET · AI 辅助内容发布）
 * 的首页信息层级 —— 首屏第一块是「AI 今日建议」，对象列表按关系分组。
 *
 * 一条硬规矩：**这里所有输出都必须能追到 server 字段**。
 * server（internal/facet/reasoning.go）真实提供的只有
 *   recommendedKind / reasoningConfidence / gap.summary / gap.nextShowAt /
 *   relation / currentState / goal / sideSpace*。
 * 原型里那些「准备了 N 张素材」「建议文案」「AI 生成」标签**没有数据源**，
 * 不许在这里编 —— 编出来就是 STATIC-COUNT-001 / FACET-HERO-FABRICATED-001
 * 那类假数据。
 */
import type { FacetObject } from "@proxy/contracts";

/** 关系分组的固定顺序：重点关系 → 朋友 → 合作（跟服务端枚举顺序一致）。 */
export const RELATION_ORDER = ["BUILDING_TRUST", "SHARED_INTEREST", "CREATOR_COLLAB"] as const;
export type FacetRelation = (typeof RELATION_ORDER)[number];

export const RELATION_LABEL: Record<FacetObject["relation"], string> = {
  BUILDING_TRUST: "重点关系",
  SHARED_INTEREST: "朋友",
  CREATOR_COLLAB: "合作"
};

// R15.43: FacetRecommendedKind 中文 label（副空间项 / 缺口推荐都用）
export const KIND_LABEL: Record<string, string> = {
  "personal/real-life": "真实日常",
  "personal/honest": "真实软肋",
  "city/travel": "城市 · 旅行",
  "photo": "摄影",
  "shared-experience": "共同回忆",
  "portfolio/capability": "作品 · 能力",
  "intro/services": "服务介绍"
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * formatNextShowAt — 把 `gap.nextShowAt` 变成人能读的时间。
 *
 * 为什么需要它：contracts 里这个字段的注释写「display 字符串，front-end 决定
 * 怎么显示」，但 server 实际发的是 **RFC3339**（reasoning.go 里
 * `r.now().Add(2 * time.Hour).UTC().Format(time.RFC3339)`）。屏上直接印就是
 * `2026-09-23T15:33:00Z` —— 用户看到一串 ISO。这里统一转掉。
 *
 * 解析不了就原样返回（server 改格式时不至于把屏变空）。
 */
export function formatNextShowAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const startOfDay = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `今天 ${hhmm}`;
  if (dayDiff === 1) return `明天 ${hhmm}`;
  if (dayDiff === -1) return `昨天 ${hhmm}`;
  if (dayDiff > 1 && dayDiff <= 6) return `${dayDiff} 天后 ${hhmm}`;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hhmm}`;
}

/**
 * 置信度分档。只用于给「AI 把握」配一句人话，**不改变数字本身** ——
 * 原型里没有这一项，是我们自己的取舍：把 server 的 reasoningConfidence
 * 如实露出来，用户才知道这条建议有多值得信。
 */
export type ConfidenceTier = "HIGH" | "MID" | "LOW";

export const CONFIDENCE_TIER_TEXT: Record<ConfidenceTier, string> = {
  HIGH: "把握较高",
  MID: "把握一般",
  LOW: "把握有限"
};

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 80) return "HIGH";
  if (confidence >= 60) return "MID";
  return "LOW";
}

export type DailySuggestion = {
  object: FacetObject;
  /** server 给的 recommendedKind（非空） */
  kind: string;
  kindText: string;
  /** server 给的 gap.summary —— AI 为什么这么建议 */
  rationale: string;
  /** gap.nextShowAt 的人话形式 */
  nextShowText: string;
  confidence: number;
  tier: ConfidenceTier;
};

/**
 * pickDailySuggestion — 挑「今天最该动的那一个对象」。
 *
 * 规则（全部基于 server 字段，无本地评分）：
 *   1. 只看 recommendedKind 非空、gap.summary 非空的对象 —— 空值等于
 *      server 没有给方向，不该被包装成一条建议；
 *   2. 取 reasoningConfidence 最高；
 *   3. 同分取 nextShowAt 更早的。
 * 一个都没有 → undefined，首屏不渲染这张卡（不编一条出来）。
 */
export function pickDailySuggestion(
  objects: readonly FacetObject[],
  now: Date = new Date()
): DailySuggestion | undefined {
  let best: FacetObject | undefined;
  for (const obj of objects) {
    if (!obj.recommendedKind) continue;
    if (!obj.gap.summary) continue;
    if (best === undefined) {
      best = obj;
      continue;
    }
    if (obj.reasoningConfidence > best.reasoningConfidence) {
      best = obj;
      continue;
    }
    if (obj.reasoningConfidence === best.reasoningConfidence) {
      const candidate = new Date(obj.gap.nextShowAt).getTime();
      const incumbent = new Date(best.gap.nextShowAt).getTime();
      if (Number.isFinite(candidate) && (!Number.isFinite(incumbent) || candidate < incumbent)) {
        best = obj;
      }
    }
  }
  if (best === undefined) return undefined;
  return {
    object: best,
    kind: best.recommendedKind,
    kindText: kindLabel(best.recommendedKind),
    rationale: best.gap.summary,
    nextShowText: formatNextShowAt(best.gap.nextShowAt, now),
    confidence: best.reasoningConfidence,
    tier: confidenceTier(best.reasoningConfidence)
  };
}

export type RelationGroup = {
  relation: FacetRelation;
  label: string;
  objects: FacetObject[];
};

/**
 * groupObjectsByRelation — 按关系分组，空组不出现。
 * 组内保持 server 返回的顺序（service.go 不排序，repository 的顺序就是顺序）。
 */
export function groupObjectsByRelation(objects: readonly FacetObject[]): RelationGroup[] {
  const groups: RelationGroup[] = [];
  for (const relation of RELATION_ORDER) {
    const members = objects.filter((obj) => obj.relation === relation);
    if (members.length === 0) continue;
    groups.push({ relation, label: RELATION_LABEL[relation], objects: members });
  }
  return groups;
}

/**
 * objectSuggestionHint — 对象卡上那一行 ✨。
 *
 * 原型是「AI 已准备 3 张素材」+ 一个未读数徽章。素材数没有数据源，所以换成
 * server 真给了的东西：**推荐方向**。刻意不带数字 —— 每个对象最多一条建议，
 * 徽章上的「1」是噪音。
 *
 * 空值保护是给契约漂移留的：当前 contracts 里 recommendedKind 是必填枚举，
 * 恒非空，所以今天每个对象都会有一行；但同一个仓库里 sideSpaceKind 就是
 * `FacetRecommendedKindSchema.or(z.literal(""))` —— 一旦 recommendedKind
 * 也允许 ""，「没方向」就不该被渲染成一条建议。
 */
export function objectSuggestionHint(obj: FacetObject): string | undefined {
  if (!obj.recommendedKind) return undefined;
  return `AI 建议 · ${kindLabel(obj.recommendedKind)}`;
}
