// feed-author.ts — viewer-relative author identity for feed surfaces.
//
// "你" is a viewer-relative label. It must never be stored on the wire and
// never be trusted from the wire: every client used to publish posts with a
// hardcoded authorDisplayName of "你", so foreign posts rendered as "你" for
// every viewer (FEED-OWN-001). The server-authoritative author is
// AuthorType + AuthorID; the display name is resolved per viewer here.

export type AuthoredItem = {
  authorId: string;
  authorDisplayName?: string | undefined;
};

/**
 * Resolve the author label for one viewer. Own posts render as "你";
 * everyone else sees the stored name — except legacy poisoned rows whose
 * stored name is literally "你", which fall back to the author id so one
 * user's posts are never labeled as another viewer's own.
 */
export function resolveAuthorDisplayName(
  post: AuthoredItem,
  viewerAccountId?: string | undefined
): string {
  if (viewerAccountId && post.authorId === viewerAccountId) return "你";
  const stored = (post.authorDisplayName ?? "").trim();
  if (stored !== "" && stored !== "你") return stored;
  return post.authorId;
}

/**
 * Strict own-post check. Unknown viewer (guest / unrestored session) is
 * fail-closed: never own. Name matching is forbidden here — display names
 * are not unique and legacy rows all say "你".
 */
export function isOwnPost(post: AuthoredItem, viewerAccountId?: string | undefined): boolean {
  return !!viewerAccountId && post.authorId === viewerAccountId;
}
