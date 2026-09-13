import type { FeedMediaItem, FeedPost } from "@proxy/contracts";

export interface ProfileMediaEntry {
  item: FeedMediaItem;
  index: number;
  postId: string;
}

export type ProfileTabKey = "POSTS" | "REPLIES" | "SAVED" | "TAGGED" | "ABOUT";

/** IG/Threads 标准 5 tabs 的固定顺序。 */
export const PROFILE_TAB_ORDER: readonly ProfileTabKey[] = [
  "POSTS",
  "REPLIES",
  "SAVED",
  "TAGGED",
  "ABOUT"
];

/**
 * PROFILE-TABS-001 — 收藏是私库，不是个人主页的一栏。
 *
 * 别人的收藏夹永远不该出现在他的公开主页上：那是他给自己留的书签，不是
 * 他愿意公开表达的内容。判断是 fail-closed 的 —— 只有明确知道「看的人就是
 * 本人」（viewerMode === "SELF"）才给 SAVED；viewer 身份未知（undefined）
 * 一律不给，宁可少一个 tab，也不能把别人的私库摆出来。
 */
export function visibleProfileTabs(
  viewerMode: "SELF" | "OTHER" | undefined
): ProfileTabKey[] {
  if (viewerMode !== "SELF") return PROFILE_TAB_ORDER.filter((key) => key !== "SAVED");
  return [...PROFILE_TAB_ORDER];
}

export function selectPinnedPostAndRest(
  posts: FeedPost[],
  pinnedIds: ReadonlyArray<string> | undefined
): { pinned: FeedPost | undefined; rest: FeedPost[] } {
  const pinnedId = pinnedIds?.[0];
  if (!pinnedId) return { pinned: undefined, rest: posts };
  const pinned = posts.find((post) => post.postId === pinnedId);
  if (!pinned) return { pinned: undefined, rest: posts };
  return { pinned, rest: posts.filter((post) => post.postId !== pinnedId) };
}

export function selectPostMedia(
  posts: FeedPost[],
  mediaByPost: Readonly<Record<string, FeedMediaItem[]>>
): ProfileMediaEntry[] {
  return posts.flatMap((post) =>
    (mediaByPost[post.postId] ?? []).map((item, index) => ({ item, index, postId: post.postId }))
  );
}
