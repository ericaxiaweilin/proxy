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

// FEED-FRESH-002: 上面这条只堵住了"发布后那一次重载"。App 冷启动/切回前台/
// 报错重试这几条路径原来都调 loadFeed() 不带 fresh，一样会撞上 /v1/feed 的
// `stale-if-error=86400`——网络稍微抖一下，缓存层直接吐一份最多 24h 前的
// 快照当正常 200 返回，JS 这边看不出区别（不进 catch，不报错），"动态"
// 首屏可以卡在很多天前的老帖上，个人主页（走的是同一个 /v1/feed，但profile
// 那次调用没受这个 bug 影响）却看得到新帖——实测复现过。
describe("FEED-FRESH-002 recovery paths also bypass the stale-if-error cache, not just post-publish", () => {
  it("busts the cache on first mount, not just after publishing", () => {
    expect(feedCode).toContain("if (!cancelled) await loadFeed(undefined, true);");
  });

  it("busts the cache when recovering from ERROR (backoff retry, AppState active, manual 重试)", () => {
    expect(feedCode).toContain("setTimeout(() => void loadFeed(undefined, true), delay)");
    expect(feedCode).toContain('state === "active" && (phase === "ERROR" || cachedPosts.length === 0)) void loadFeed(undefined, true)');
    expect(feedCode).toContain("onPress={() => void loadFeed(undefined, true)} style={styles.retryBtn}");
  });
});

// OWN-POST-TOP-001（FEED-TIME-SORT-001 已替代）：时间线按创建时间倒序 ——
// 刚发的（谁的都一样）自然在上面，不再需要给自己的帖子加分，也不按类目权重重排。
describe("OWN-POST-TOP-001 timeline is chronological, no own-post boost or category weights", () => {
  it("sorts visible posts by createdAt desc", () => {
    expect(feedCode).toContain("tb - ta");
  });
  it("no longer boosts own posts or scores categories", () => {
    expect(feedCode).not.toContain("feedWeightFor");
    expect(feedCode).not.toContain("Math.max(50, ...Object.values(feedPrefs.weights)) + 1");
  });
});
