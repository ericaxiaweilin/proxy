import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// FEED-FRESH-001: 自己刚发的帖子在动态看不到。两根因：①发布后重载撞上
// /v1/feed 的 15s HTTP 缓存（发帖前缓存的那一页里没有新帖）；②"展示最新"
// 把时间线整个换成 pending 页（老帖消失、游标过期、ids 只记新的导致
// 老帖反复被认成"新动态"）。注释剥掉再断言，只认代码。
const feed = readFileSync(fileURLToPath(new URL("./surfaces/feed.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const feedCode = stripComments(feed);
const client = readFileSync(fileURLToPath(new URL("./localnet-client.ts", import.meta.url)), "utf8");
const clientCode = stripComments(client);

describe("FEED-FRESH-001 own fresh post is visible in feed right after publishing", () => {
  it("reloads past the HTTP cache after publishing", () => {
    // 发布后那次重载必须穿透缓存，否则 15s 内看到的还是发帖前的页。
    expect(feedCode).toContain("await loadFeed(undefined, true)");
    expect(clientCode).toContain("_fresh=${Date.now()}");
  });

  it("merges pending into the timeline instead of replacing it", () => {
    // 替换会丢掉已滚出来的老帖，还会把游标停在过期位置。
    expect(feedCode).toContain("setPosts(cachedPosts)");
    expect(feedCode).toContain("setMedia(cachedMedia)");
    expect(feedCode).toContain("setNextCursor(pendingCursor)");
    expect(feedCode).toContain("setHasMore(pendingHasMore)");
    // ids 取并集：只记新帖，老帖下次又被认成"新动态"，pill 阴魂不散。
    expect(feedCode).toContain("...postIdsRef.current]");
  });
});
