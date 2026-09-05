import type { PostEngagement } from "@proxy/contracts";

export function mergePostEngagement(previous: Readonly<Record<string, PostEngagement>>, incoming: readonly PostEngagement[]): Record<string, PostEngagement> {
  const next = { ...previous };
  for (const item of incoming) next[item.postId] = item;
  return next;
}

export function mergeReactedPostIds(previous: ReadonlySet<string>, incoming: readonly PostEngagement[]): ReadonlySet<string> {
  const next = new Set(previous);
  for (const item of incoming) item.reacted ? next.add(item.postId) : next.delete(item.postId);
  return next;
}
