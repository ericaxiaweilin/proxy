import { describe, expect, it } from "vitest";
import { createBehaviorAnalyticsStore } from "./behavior-analytics-settings";
import { beginMediaView, beginPostView, endMediaView, endPostView, recordMediaZoom } from "./post-impression";

// TWIN-SIGNALS-001 / MEDIA-DWELL-001 —— 行为采集闸。
//
// ⛔ 2026-09-27 合规修正：这个文件原来钉的是**默认开**（「默认开（从未设置），
// 关了就短路」，断言 fresh store 也能造出 1 个事件）。那个断言把**违法状态
// 变成了受保护状态** —— 改代码就会红，于是没人敢改。
//
// 现在的语义（依据见 behavior-analytics-settings.ts 顶部的条文）：
//   * Nghị định 356/2025/NĐ-CP Art. 4.1(l)：社交网络上的行为与活动追踪数据
//     是**敏感个人数据**；
//   * Art. 6.3：**禁止默认同意机制**；
//   * Art. 6.1 / 6.2：同意须可验证，且举证责任在平台。
// ⇒ 只有用户**显式开启过**才采集；从未设置 / 关掉 / 读失败 一律不采集。
//
// 另：停留封顶 5 分钟、发送失败不抛 —— 这两条是原样保留的旧不变量。
function memoryDriver() {
  const map = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> { return map.get(key) ?? null; },
    async setItem(key: string, value: string): Promise<void> { map.set(key, value); },
    async deleteItem(key: string): Promise<void> { map.delete(key); },
  };
}

// 读失败的驱动：模拟存储抖动。旧实现「读失败也按开处理」，
// 新实现必须 fail-closed —— 用户没表达过同意，就不能采。
function brokenDriver() {
  return {
    async getItem(): Promise<string | null> { throw new Error("storage unavailable"); },
    async setItem(): Promise<void> { throw new Error("storage unavailable"); },
    async deleteItem(): Promise<void> { throw new Error("storage unavailable"); },
  };
}

function collecting() {
  const sent: Array<{ postId: string; watchMs: number }> = [];
  return {
    sent,
    localNet: { recordPostImpression: async (postId: string, watchMs: number) => { sent.push({ postId, watchMs }); } }
  };
}

describe("behavior analytics gate", () => {
  it("从未设置过 = 未同意：一个事件都不造（NĐ 356 Art. 6.3 禁默认同意）", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    // 未设置时必须返回 undefined —— undefined 表示「没表达过意愿」，
    // 绝不等于同意。
    await expect(store.read()).resolves.toBeUndefined();
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(0);
  });

  it("显式关掉 = 不采集", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await store.write(false);
    await expect(store.read()).resolves.toBe(false);
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(0);
  });

  it("读失败 = 不采集（fail-closed，旧实现是 fail-open）", async () => {
    const store = createBehaviorAnalyticsStore(brokenDriver());
    await expect(store.read()).resolves.toBeUndefined();
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(0);
  });

  it("显式开启才采集；停留封顶 5 分钟；发送失败不抛", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await store.write(true);
    await expect(store.read()).resolves.toBe(true);
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (!first) throw new Error("expected one impression");
    expect(first.postId).toBe("p1");
    // 封顶：一个小时的停留也只记 5 分钟。
    await endPostView(localNet, "p2", Date.now() - 60 * 60 * 1000, store);
    expect(sent[1]?.watchMs).toBe(5 * 60 * 1000);
    // 发送失败不抛；空 postId 直接短路。
    const failing = { recordPostImpression: async (): Promise<void> => { throw new Error("net down"); } };
    await expect(endPostView(failing, "p3", beginPostView(), store)).resolves.toBeUndefined();
    await expect(endPostView(localNet, "", beginPostView(), store)).resolves.toBeUndefined();
    expect(sent).toHaveLength(2);
  });

  it("关掉之后重新开启才恢复采集（同意可撤销、可重新给予）", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    const { sent, localNet } = collecting();
    await store.write(true);
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(1);
    await store.write(false);
    await endPostView(localNet, "p2", beginPostView(), store);
    expect(sent).toHaveLength(1);
    await store.write(true);
    await endPostView(localNet, "p3", beginPostView(), store);
    expect(sent).toHaveLength(2);
  });
});

// MEDIA-DWELL-001: 单张照片的停留走同一个开关、同一个封顶——不是另一套
// 平行逻辑，测试结构照抄上面的帖子版本。粒度更细（逐张照片 + 放大次数），
// 所以它比帖子级更属于 Art. 4.1(l) 说的「行为追踪数据」。
describe("media dwell gate", () => {
  function mediaCollecting() {
    const sent: Array<{ mediaAssetId: string; watchMs: number }> = [];
    const zooms: string[] = [];
    return {
      sent,
      zooms,
      localNet: {
        recordMediaImpression: async (mediaAssetId: string, watchMs: number) => { sent.push({ mediaAssetId, watchMs }); },
        recordMediaZoom: async (mediaAssetId: string) => { zooms.push(mediaAssetId); }
      }
    };
  }

  it("未同意时逐张停留与放大都不上报", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    const { sent, zooms, localNet } = mediaCollecting();
    await endMediaView(localNet, "media_a", beginMediaView(), store);
    await recordMediaZoom(localNet, "media_a", store);
    expect(sent).toHaveLength(0);
    expect(zooms).toHaveLength(0);
  });

  it("显式开启后：逐张停留上报、封顶 5 分钟、空 mediaAssetId 短路、发送失败不抛", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await store.write(true);
    const { sent, zooms, localNet } = mediaCollecting();
    await endMediaView(localNet, "media_a", beginMediaView(), store);
    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (!first) throw new Error("expected one impression");
    expect(first.mediaAssetId).toBe("media_a");
    await recordMediaZoom(localNet, "media_a", store);
    expect(zooms).toEqual(["media_a"]);
    await endMediaView(localNet, "media_b", Date.now() - 60 * 60 * 1000, store);
    expect(sent[1]?.watchMs).toBe(5 * 60 * 1000);
    await endMediaView(localNet, "", beginMediaView(), store);
    expect(sent).toHaveLength(2);
    const failing = { recordMediaImpression: async (): Promise<void> => { throw new Error("net down"); } };
    await expect(endMediaView(failing, "media_c", beginMediaView(), store)).resolves.toBeUndefined();
  });
});
