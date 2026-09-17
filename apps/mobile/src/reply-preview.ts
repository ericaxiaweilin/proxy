// reply-preview.ts — Threads 式评论预览：默认显示前 5 条，超出才折叠。
//
// FEED-REPLY-002。之前评论是「全折叠」的：不点一下「回复 N」就一条都看不到，
// 而点开了又会把全部评论一次性铺开，长帖子把整个 feed 顶走。Threads 的做法
// 是首屏固定给几条、剩下的收进「查看全部」。这里把这条规则抽成纯函数，
// 让 UI 只负责渲染，规则可测。

/** 首屏默认展示的评论行数。超过这个数才出现「查看全部」。 */
export const REPLY_PREVIEW_LIMIT = 5;

/**
 * 当前应该渲染的评论。未展开时只给前 `limit` 条；展开时给全部。
 * 传入的 `all` 应保持服务端顺序（时间正序），不要在这里重排。
 */
export function visibleReplies<T>(
  all: readonly T[],
  expanded: boolean,
  limit: number = REPLY_PREVIEW_LIMIT
): T[] {
  if (expanded) return [...all];
  return all.slice(0, Math.max(0, limit));
}

/** 还有多少条被折叠着。为 0 时不应该渲染「查看全部」。 */
export function hiddenReplyCount(total: number, limit: number = REPLY_PREVIEW_LIMIT): number {
  return Math.max(0, total - Math.max(0, limit));
}

/**
 * SEARCH-CORPUS-003：搜索态下把**命中的评论**排到最前面。
 *
 * 为什么需要：评论现在参与动态搜索，但卡片默认只显示前 5 条。一条帖子完全可能
 * 是因为第 17 条评论才出现在结果里的，用户把可见的几条看完也找不到自己搜的那个
 * 词 ——「这条为什么在这儿」没有答案，和搜不到一样让人不信任搜索。
 *
 * 只**重排**、不增删：命中与否不改变评论集合，一条都不会少。
 * 一条都没命中时原样返回（不做无意义的拷贝顺序变化）。
 */
export function repliesMatchingFirst<T>(
  all: readonly T[],
  matches: (reply: T) => boolean
): T[] {
  if (all.length <= 1) return [...all];
  const hit: T[] = [];
  const rest: T[] = [];
  for (const reply of all) {
    if (matches(reply)) hit.push(reply); else rest.push(reply);
  }
  return hit.length === 0 ? [...all] : [...hit, ...rest];
}

/** 是否值得渲染展开/收起控件：只有超出预览条数时才值得。 */
export function shouldOfferReplyToggle(
  total: number,
  limit: number = REPLY_PREVIEW_LIMIT
): boolean {
  return total > Math.max(0, limit);
}
