import { describe, expect, it } from "vitest";
import {
  feedScopeLabel,
  isFeedScopeActive,
  isPostWithinScope,
  scopeWindowMs,
} from "./feed-scope-filter";

// FEED-SCOPE-001 — 逃逸于 2026-09-12。
//
// 时间窗是相对 Date.now() 滚动的，所以帖文会一天天无声消失。默认 "7D" 时实测
// 39 篇只剩 15 篇可见（隐藏 24 篇，62%），而时间线上完全不显示筛选状态。
//
// 这个判定以前在 feed.tsx 里内联了**两份**（一份过滤、一份数藏了多少），
// 而且已经漂移：数数那份不管 hidden/muted，横幅会多报。抽出来共用一份并加测。

const NOW = Date.parse("2026-09-12T20:00:00+07:00");
const daysAgo = (n: number): string => new Date(NOW - n * 86_400_000).toISOString();

describe("feed-scope-filter", () => {
  it("FEED-SCOPE-001: PERSISTENT hides nothing, ever", () => {
    expect(isFeedScopeActive("PERSISTENT")).toBe(false);
    expect(scopeWindowMs("PERSISTENT")).toBe(0);
    expect(isPostWithinScope(daysAgo(4000), "PERSISTENT", NOW)).toBe(true);
  });

  it("FEED-SCOPE-001: the rolling window is what made posts disappear", () => {
    // A post that is 6 days old is inside 7D today and outside it tomorrow.
    const sixDays = daysAgo(6.5);
    expect(isPostWithinScope(sixDays, "7D", NOW)).toBe(true);
    expect(isPostWithinScope(sixDays, "7D", NOW + 86_400_000)).toBe(false);
  });

  it("FEED-SCOPE-001: 7D and 30D boundaries", () => {
    expect(isPostWithinScope(daysAgo(6), "7D", NOW)).toBe(true);
    expect(isPostWithinScope(daysAgo(8), "7D", NOW)).toBe(false);
    expect(isPostWithinScope(daysAgo(29), "30D", NOW)).toBe(true);
    expect(isPostWithinScope(daysAgo(31), "30D", NOW)).toBe(false);
    expect(scopeWindowMs("7D")).toBe(7 * 86_400_000);
    expect(scopeWindowMs("30D")).toBe(30 * 86_400_000);
  });

  it("FEED-SCOPE-001: an undated post is kept, not silently dropped", () => {
    // Dropping unparseable dates would be a second silent way to lose content.
    expect(isPostWithinScope("", "7D", NOW)).toBe(true);
    expect(isPostWithinScope("not-a-date", "7D", NOW)).toBe(true);
  });

  it("FEED-SCOPE-001: reproduces the 62% loss the default caused", () => {
    // The real timeline as measured on 2026-09-12: 39 posts, of which 24 are
    // older than 7 days. This is the number that made it look like data loss.
    const ages = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, // 15 inside 7D
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
    expect(ages).toHaveLength(39);
    const inside = ages.filter((age) => isPostWithinScope(daysAgo(age), "7D", NOW));
    expect(inside).toHaveLength(15);
    expect(39 - inside.length).toBe(24);
    // And the fix: nothing is hidden by default.
    expect(ages.filter((age) => isPostWithinScope(daysAgo(age), "PERSISTENT", NOW))).toHaveLength(39);
  });

  it("FEED-SCOPE-001: banner label matches the scope", () => {
    expect(feedScopeLabel("7D")).toBe("近 7 天");
    expect(feedScopeLabel("30D")).toBe("近 30 天");
  });
});
