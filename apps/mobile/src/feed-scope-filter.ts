// FEED-SCOPE-001 — the feed's time-scope filter, extracted so it can be tested.
//
// The scope window is measured against Date.now(), so it rolls forward every
// day: a post that was visible yesterday silently drops out of the timeline
// today. With the old default of "7D" that hid 24 of 39 posts (62%) with no
// indicator anywhere on screen, which reads exactly like data loss.
//
// Two copies of this predicate used to live inline in feed.tsx (one to filter,
// one to count what the filter hid) and they had already drifted apart — the
// counting copy ignored "hidden" and "muted" posts, so the banner over-reported.
// One shared predicate, with tests.
import type { FeedPrefsSnapshot } from "./expo-feed-prefs-store";

export type FeedScope = FeedPrefsSnapshot["scope"];

const DAY_MS = 86_400_000;

/** Window length in ms; 0 means "no window at all" (PERSISTENT). */
export function scopeWindowMs(scope: FeedScope): number {
  if (scope === "7D") return 7 * DAY_MS;
  if (scope === "30D") return 30 * DAY_MS;
  return 0;
}

export function isFeedScopeActive(scope: FeedScope): boolean {
  return scopeWindowMs(scope) > 0;
}

/**
 * True when the post is inside the scope window (or when no window applies).
 *
 * A post whose createdAt cannot be parsed is kept: dropping undated posts is a
 * second, silent way to lose content, and it is not what the user asked for.
 */
export function isPostWithinScope(createdAt: string, scope: FeedScope, now: number = Date.now()): boolean {
  const windowMs = scopeWindowMs(scope);
  if (windowMs <= 0) return true;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return true;
  return now - created <= windowMs;
}

/** Human label for the banner, so the two call sites cannot disagree. */
export function feedScopeLabel(scope: FeedScope): string {
  return scope === "7D" ? "近 7 天" : "近 30 天";
}
