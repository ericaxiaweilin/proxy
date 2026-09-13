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

/** 是否值得渲染展开/收起控件：只有超出预览条数时才值得。 */
export function shouldOfferReplyToggle(
  total: number,
  limit: number = REPLY_PREVIEW_LIMIT
): boolean {
  return total > Math.max(0, limit);
}
