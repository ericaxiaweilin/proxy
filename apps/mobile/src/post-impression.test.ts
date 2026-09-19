import { describe, expect, it } from "vitest";
import { createBehaviorAnalyticsStore } from "./behavior-analytics-settings";
import { beginMediaView, beginPostView, endMediaView, endPostView } from "./post-impression";

// TWIN-SIGNALS-001: 开关关了就不造事件；停留封顶 5 分钟；发送失败不抛。
function memoryDriver() {
  const map = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> { return map.get(key) ?? null; },
    async setItem(key: string, value: string): Promise<void> { map.set(key, value); },
    async deleteItem(key: string): Promise<void> { map.delete(key); },
  };
}

describe("behavior analytics gate", () => {
  it("默认开（从未设置），关了就短路", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await expect(store.read()).resolves.toBeUndefined();
    const sent: Array<{ postId: string; watchMs: number }> = [];
    const localNet = { recordPostImpression: async (postId: string, watchMs: number) => { sent.push({ postId, watchMs }); } };
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (!first) throw new Error("expected one impression");
    expect(first.postId).toBe("p1");
    await store.write(false);
    await endPostView(localNet, "p2", beginPostView(), store);
    expect(sent).toHaveLength(1);
  });

  it("停留封顶 5 分钟，发送失败不抛", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    const sent: Array<{ postId: string; watchMs: number }> = [];
    const localNet = { recordPostImpression: async (postId: string, watchMs: number) => { sent.push({ postId, watchMs }); } };
    await endPostView(localNet, "p1", Date.now() - 60 * 60 * 1000, store);
    const capped = sent[0];
    if (!capped) throw new Error("expected one impression");
    expect(capped.watchMs).toBe(5 * 60 * 1000);
    const failing = { recordPostImpression: async (): Promise<void> => { throw new Error("net down"); } };
    await expect(endPostView(failing, "p1", beginPostView(), store)).resolves.toBeUndefined();
    await expect(endPostView(localNet, "", beginPostView(), store)).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});

// MEDIA-DWELL-001: 单张照片的停留走同一个开关、同一个封顶——不是另一套
// 平行逻辑，测试结构照抄上面的帖子版本。
describe("media dwell gate", () => {
  it("同一个开关：关了就短路，空 mediaAssetId 直接短路", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    const sent: Array<{ mediaAssetId: string; watchMs: number }> = [];
    const localNet = { recordMediaImpression: async (mediaAssetId: string, watchMs: number) => { sent.push({ mediaAssetId, watchMs }); } };
    await endMediaView(localNet, "media_a", beginMediaView(), store);
    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (!first) throw new Error("expected one impression");
    expect(first.mediaAssetId).toBe("media_a");
    await store.write(false);
    await endMediaView(localNet, "media_b", beginMediaView(), store);
    expect(sent).toHaveLength(1);
    await store.write(true);
    await endMediaView(localNet, "", beginMediaView(), store);
    expect(sent).toHaveLength(1);
  });

  it("停留封顶 5 分钟，发送失败不抛", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    const sent: Array<{ mediaAssetId: string; watchMs: number }> = [];
    const localNet = { recordMediaImpression: async (mediaAssetId: string, watchMs: number) => { sent.push({ mediaAssetId, watchMs }); } };
    await endMediaView(localNet, "media_a", Date.now() - 60 * 60 * 1000, store);
    const capped = sent[0];
    if (!capped) throw new Error("expected one impression");
    expect(capped.watchMs).toBe(5 * 60 * 1000);
    const failing = { recordMediaImpression: async (): Promise<void> => { throw new Error("net down"); } };
    await expect(endMediaView(failing, "media_a", beginMediaView(), store)).resolves.toBeUndefined();
  });
});
