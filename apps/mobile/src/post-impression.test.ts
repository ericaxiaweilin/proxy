import { describe, expect, it } from "vitest";
import { anyCaptureEnabled, CONSENT_PURPOSES, createBehaviorAnalyticsStore } from "./behavior-analytics-settings";
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
//
// COMP-CONSENT-PIPELINE-001（2026-10-08）：同意从**一个**总闸拆成**三个**
// 目的（RECOMMENDATION / TWIN_INSIGHT / OPERATOR_AUDIENCE_DETAIL），所以
// store 的 read/write 都收一个 purpose，采集闸问的是 anyCaptureEnabled。
// 下面的语义一条都没变，只是「那一个开关」换成了「那一个目的」——
//   * 从未设置过 / 显式关掉 / 读失败 ⇒ 一个事件都不造；
//   * 显式开过**某一项** ⇒ 造（服务端再按目的分派）。
// 最后一块是新钉的：三个目的**互不影响**，而且旧的单闸键（proxy.behavior-
// analytics-enabled.v1）永远不会被读成同意 —— 旧同意不能带过来。
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
    // 绝不等于同意。三个目的都要验一遍：漏掉任何一个就等于那一个还能默认开。
    for (const purpose of CONSENT_PURPOSES) {
      await expect(store.read(purpose)).resolves.toBeUndefined();
    }
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(0);
  });

  it("显式关掉 = 不采集", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await store.write("RECOMMENDATION", false);
    await expect(store.read("RECOMMENDATION")).resolves.toBe(false);
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(0);
  });

  it("读失败 = 不采集（fail-closed，旧实现是 fail-open）", async () => {
    const store = createBehaviorAnalyticsStore(brokenDriver());
    await expect(store.read("RECOMMENDATION")).resolves.toBeUndefined();
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(0);
  });

  it("显式开启才采集；停留封顶 5 分钟；发送失败不抛", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await store.write("RECOMMENDATION", true);
    await expect(store.read("RECOMMENDATION")).resolves.toBe(true);
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
    await store.write("TWIN_INSIGHT", true);
    await endPostView(localNet, "p1", beginPostView(), store);
    expect(sent).toHaveLength(1);
    await store.write("TWIN_INSIGHT", false);
    await endPostView(localNet, "p2", beginPostView(), store);
    expect(sent).toHaveLength(1);
    await store.write("TWIN_INSIGHT", true);
    await endPostView(localNet, "p3", beginPostView(), store);
    expect(sent).toHaveLength(2);
  });

  // COMP-CONSENT-PIPELINE-001：只要**有一项**开着就造事件（服务端再按目的
  // 分派）；只有全部关着才一个都不造。漏掉「有一项就够」这一半，
  // 就变成「必须三项全开」，那会让只想用推荐的人被迫同意运营明细。
  it("任意一项开启都采集；全部关闭才完全静默", async () => {
    for (const purpose of CONSENT_PURPOSES) {
      const store = createBehaviorAnalyticsStore(memoryDriver());
      await store.write(purpose, true);
      const { sent, localNet } = collecting();
      await endPostView(localNet, "p1", beginPostView(), store);
      expect(sent, `only ${purpose} on must still capture`).toHaveLength(1);
    }
    const allOff = createBehaviorAnalyticsStore(memoryDriver());
    for (const purpose of CONSENT_PURPOSES) await allOff.write(purpose, false);
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), allOff);
    expect(sent).toHaveLength(0);
  });
});

// COMP-CONSENT-PIPELINE-001：三个目的的本地存储**必须互不串**。
//
// 为什么这条钉在存储层而不是界面层：三个开关如果共用一个键（或者键名靠
// 拼错凑出来相同），界面上三个开关会「一起亮」，用户想只开一个就开不出来，
// 而且这种 bug 在真机上看起来完全正常 —— 每个开关单独看都对。
describe("per-purpose consent store", () => {
  it("开一项不动另外两项：读写各自独立", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await store.write("RECOMMENDATION", true);
    await expect(store.read("RECOMMENDATION")).resolves.toBe(true);
    await expect(store.read("TWIN_INSIGHT")).resolves.toBeUndefined();
    await expect(store.read("OPERATOR_AUDIENCE_DETAIL")).resolves.toBeUndefined();

    // 再往中间那项写 false，也不能把已经开着的第一项拉下来。
    await store.write("TWIN_INSIGHT", false);
    await expect(store.read("RECOMMENDATION")).resolves.toBe(true);
    await expect(store.read("TWIN_INSIGHT")).resolves.toBe(false);

    // 反过来也一样：关掉中间那项后单独开第三项，前两项保持原状。
    await store.write("OPERATOR_AUDIENCE_DETAIL", true);
    await expect(store.read("RECOMMENDATION")).resolves.toBe(true);
    await expect(store.read("TWIN_INSIGHT")).resolves.toBe(false);
    await expect(store.read("OPERATOR_AUDIENCE_DETAIL")).resolves.toBe(true);
  });

  it("两个 store 实例不共用一份状态（各账号 / 各安装互不影响）", async () => {
    const one = createBehaviorAnalyticsStore(memoryDriver());
    const other = createBehaviorAnalyticsStore(memoryDriver());
    await one.write("TWIN_INSIGHT", true);
    await expect(other.read("TWIN_INSIGHT")).resolves.toBeUndefined();
  });

  it("每个目的一个独立的存储键", async () => {
    const seen: string[] = [];
    const driver = {
      async getItem(key: string): Promise<string | null> { seen.push(key); return null; },
      async setItem(key: string): Promise<void> { seen.push(key); },
      async deleteItem(key: string): Promise<void> { /* 旧键的清理，不该出现在目的键里 */ }
    };
    const store = createBehaviorAnalyticsStore(driver);
    for (const purpose of CONSENT_PURPOSES) {
      await store.read(purpose);
      await store.write(purpose, true);
    }
    const purposeKeys = seen.filter((key) => key.startsWith("proxy.consent."));
    expect(new Set(purposeKeys).size).toBe(CONSENT_PURPOSES.length);
    for (const purpose of CONSENT_PURPOSES) {
      expect(purposeKeys).toContain(`proxy.consent.${purpose}.v1`);
    }
  });

  // 旧的单闸键**永远不能**被读成同意：用户必须在三个目的上各自重新选择，
  // 一次覆盖三个用途的旧表态不能带过来（服务端也已把 BEHAVIOR_ANALYTICS 退役）。
  it("旧的单闸键从不被读成同意，而且第一次写就被清掉", async () => {
    const LEGACY = "proxy.behavior-analytics-enabled.v1";
    const driver = {
      map: new Map<string, string>([[LEGACY, "1"]]),
      readKeys: [] as string[],
      async getItem(key: string): Promise<string | null> { this.readKeys.push(key); return this.map.get(key) ?? null; },
      async setItem(key: string, value: string): Promise<void> { this.map.set(key, value); },
      async deleteItem(key: string): Promise<void> { this.map.delete(key); }
    };
    const store = createBehaviorAnalyticsStore(driver);
    // 旧键里明明是 "1"（旧实现会当成同意），三个目的都必须读成「没表过态」。
    for (const purpose of CONSENT_PURPOSES) {
      await expect(store.read(purpose)).resolves.toBeUndefined();
    }
    expect(driver.readKeys).not.toContain(LEGACY);
    await expect(anyCaptureEnabled(store)).resolves.toBe(false);

    // 写任一目的时顺手把旧键删掉，但它仍然不是同意的来源。
    await store.write("RECOMMENDATION", false);
    expect(driver.map.has(LEGACY)).toBe(false);
    await expect(store.read("RECOMMENDATION")).resolves.toBe(false);
    await expect(store.read("TWIN_INSIGHT")).resolves.toBeUndefined();
  });

  it("anyCaptureEnabled：全关=false，任一开=true", async () => {
    const store = createBehaviorAnalyticsStore(memoryDriver());
    // 从未设置过
    await expect(anyCaptureEnabled(store)).resolves.toBe(false);
    // 全部显式关掉
    for (const purpose of CONSENT_PURPOSES) await store.write(purpose, false);
    await expect(anyCaptureEnabled(store)).resolves.toBe(false);
    // 逐个打开：开哪一个都必须立刻变 true（只认 true，不认「存在」）
    for (const purpose of CONSENT_PURPOSES) {
      await store.write(purpose, true);
      await expect(anyCaptureEnabled(store), `${purpose} alone must enable capture`).resolves.toBe(true);
    }
    // 关掉两个，剩下一个开着 ⇒ 仍然 true
    await store.write("RECOMMENDATION", false);
    await store.write("TWIN_INSIGHT", false);
    await expect(anyCaptureEnabled(store)).resolves.toBe(true);
    // 全关 ⇒ 又回到 false
    await store.write("OPERATOR_AUDIENCE_DETAIL", false);
    await expect(anyCaptureEnabled(store)).resolves.toBe(false);
  });

  // fail-closed 在这一层也要成立：注入的 store 一读就抛，
  // anyCaptureEnabled 必须是 false，而不是把异常当成「开着」。
  it("anyCaptureEnabled：读抛错 = 不采集", async () => {
    const throwing = {
      read: async (): Promise<boolean | undefined> => { throw new Error("storage unavailable"); },
      write: async (): Promise<void> => { throw new Error("storage unavailable"); }
    };
    await expect(anyCaptureEnabled(throwing)).resolves.toBe(false);
    const { sent, localNet } = collecting();
    await endPostView(localNet, "p1", beginPostView(), throwing);
    expect(sent).toHaveLength(0);
  });

  it("anyCaptureEnabled：读到无法识别的值 = 不采集（不是同意）", async () => {
    const junk = createBehaviorAnalyticsStore({
      async getItem(): Promise<string | null> { return "yes"; },
      async setItem(): Promise<void> { /* 不写 */ },
      async deleteItem(): Promise<void> { /* 不删 */ }
    });
    await expect(anyCaptureEnabled(junk)).resolves.toBe(false);
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
    await store.write("RECOMMENDATION", true);
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
