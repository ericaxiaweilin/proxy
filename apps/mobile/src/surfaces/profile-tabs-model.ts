import type { FeedMediaItem, FeedPost } from "@proxy/contracts";

export interface ProfileMediaEntry {
  item: FeedMediaItem;
  index: number;
  postId: string;
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
