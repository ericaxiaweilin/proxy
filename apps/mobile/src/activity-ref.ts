// activity-ref.ts — 「这条帖文引用了一个活动」的唯一词表。
//
// 为什么需要这个文件：`ACTIVITY` 这一个词在 contextRefs 里同时装着两种
// 完全不同的东西，而读端分不出来。
//
//   ① 分类标签（classification label）
//      服务端按正文关键词贴的，`relationType` 恒为 `AUTO_CLASSIFIED`，
//      `contextId` 是**人话**（"活动" / "需求" / "场所" / "周六新店开业"）。
//      它只表示「这条帖文跟活动有关」，不指向任何具体活动。
//      生产者：internal/localnet/classification.go 的 classifyPostFallback
//      和模型分类（两条路都写 AUTO_CLASSIFIED）。
//
//   ② 实体引用（entity ref）
//      客户端发的，`contextId` 是**真正的 activityId**，指向一个具体活动。
//      它必须能点开、能跳到活动详情。
//
// 两者混在同一个 contextType 里，于是历史上所有读端只能把 `contextId`
// 当**文字**用 —— chip 文案、搜索词堆、话题判定、场景图标关键词。
// 实体引用一旦进来，立刻会变成：一行裸 id 的 chip、污染搜索命中的词、
// 把帖文错判成摄影/创业话题。所以实体引用必须自带标记，让读端能区分。
//
// 标记用 `relationType`：这是**服务端已经在用的**区分位 ——
// mergeClassificationRefs（classification.go:93）就是靠
// `ref.RelationType == "AUTO_CLASSIFIED"` 决定「这条是分类标签、重算时丢掉」。
// 这里沿用同一根轴，值取 `REFERS_TO`，与既有的 `REALITY_SCENE` +
// `FEATURED_AT`（composer-publish.ts:112）、`QUOTE_POST` 同一套写法。
//
// ⚠️ 判定必须是**白名单**（明确带 REFERS_TO 才算实体引用），不能写成
// 「不是 AUTO_CLASSIFIED 就算实体引用」。因为 service.go 里有 10 处老 seed
// 的 ACTIVITY 行是「人话 contextId + 空 relationType」（"晨跑" / "拼饭" /
// "手工课" …）。按黑名单判定会把它们当成 activityId 去解析 → 解析不到 →
// chip 消失 → 这是回归，不是修复。白名单下它们继续按标签渲染，行为不变。

import type { FeedPost, PostContextRef } from "@proxy/contracts";

/**
 * 实体引用的标记：带这个 relationType 的 ref，`contextId` 是某个实体的 **id**
 * （不是给人看的文字）。活动是最先用上它的，但这条规矩跟具体实体无关 ——
 * 机会、场所、场景哪天要发真引用，同一个标记复用，读端不用再改一遍。
 */
export const ENTITY_REF_RELATION = "REFERS_TO";

/**
 * 活动引用的标记。与 ENTITY_REF_RELATION 同值 —— 活动就是一种实体引用，
 * 这个别名只是让活动相关的调用点读起来更明确。
 */
export const ACTIVITY_REF_RELATION = ENTITY_REF_RELATION;

/** 服务端分类器写死的标记（classification.go），读端只读不写。 */
export const AUTO_CLASSIFIED_RELATION = "AUTO_CLASSIFIED";

/** QUOTE_POST 已经有自己的渲染位（引用卡片），不进 chip 行。 */
const QUOTE_POST_CONTEXT = "QUOTE_POST";

type AnyRef = Pick<PostContextRef, "contextType" | "contextId"> & { relationType?: string | undefined };

/**
 * 这条 ref 是不是「实体引用」（contextId 是 id，不是文字）。
 *
 * ⚠️ 白名单：必须显式带 REFERS_TO。没有标记的 ACTIVITY 行一律当分类标签 ——
 * 包括服务端 seed 里那些人话 contextId 的老行（service.go 的 10 处），以及未来
 * 任何漏标的行。宁可把一条真引用降级成标签（看得见、只是不可点），也不要把一条
 * 标签升级成引用（去解析一个不存在的 id，然后静默什么都不显示）。
 */
export function isEntityRef(ref: AnyRef): boolean {
  return ref.relationType === ENTITY_REF_RELATION;
}

/**
 * 这条 ref 是不是「指向某个具体活动的实体引用」。
 */
export function isActivityEntityRef(ref: AnyRef): boolean {
  return ref.contextType === "ACTIVITY" && isEntityRef(ref);
}

/** 帖文引用的活动 id（没有实体引用时返回 undefined）。 */
export function referencedActivityId(post: Pick<FeedPost, "contextRefs">): string | undefined {
  const ref = post.contextRefs.find(isActivityEntityRef);
  return ref ? ref.contextId : undefined;
}

/**
 * 该按「文字标签」渲染成 chip 的 ref。
 *
 * 排除两类：
 *   - QUOTE_POST：走引用卡片，不重复出现在 chip 行（既有行为）。
 *   - 实体引用（带 REFERS_TO）：contextId 是 id，走各自的卡片（活动卡片…）。
 *
 * REALITY_SCENE 刻意**保留** —— 它本来就是 chip（渲染成「查看场景 ›」
 * 且可点），这是既有设计，不在这次改动范围内。
 */
export function labelContextRefs<T extends AnyRef>(post: { contextRefs: T[] }): T[] {
  return post.contextRefs.filter(
    (ref) => ref.contextType !== QUOTE_POST_CONTEXT && !isEntityRef(ref)
  );
}

/**
 * 可以拿去当**文本**用的 ref 文案（搜索命中、话题判定、场景图标关键词）。
 *
 * 实体引用的 contextId 是 id，不是给人看的词 —— 放进词堆会让
 * `includes("摄影")` / `includes("创业")` / 静音话题这类判定拿到
 * 用户根本没写过的字符串。这里把它们排除掉。
 */
export function contextRefLabels<T extends AnyRef>(post: { contextRefs: T[] }): string[] {
  return labelContextRefs(post).map((ref) => ref.contextId);
}

/** 上面那个数组的拼接版，给「正文 + 上下文」当搜索词堆用。 */
export function contextRefHaystack(post: { contextRefs: AnyRef[] }): string {
  return contextRefLabels(post).join(" ");
}
