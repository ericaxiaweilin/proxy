import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InMemorySecureStorageDriver } from "./secure-session";
import {
  createSceneFavoritesStore,
  resolveSavedSceneIds,
  sceneFavoritesKeyFor,
  type SceneCatalogLookup,
} from "./scene-favorites";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// SCENE-FAVORITE-001 —— home 场景卡片 🤍 点了只翻 useState，退出重进就丢，
// 更到不了「我的 → 收藏」。hearts 按账号落本机，收藏页用静态目录回查标题。
describe("SCENE-FAVORITE-001 scene hearts persist and surface in favorites", () => {
  it("keys are scoped per account", () => {
    expect(sceneFavoritesKeyFor("user_1")).toBe("proxy.scene-favorites.v1.user_1");
    expect(sceneFavoritesKeyFor("user_2")).not.toBe(sceneFavoritesKeyFor("user_1"));
  });

  it("round-trips ids and sanitizes junk", async () => {
    const store = createSceneFavoritesStore(new InMemorySecureStorageDriver(), "user_1");
    expect(await store.read()).toEqual([]);
    await store.write(["sunset-coffee", "  ao-dai-ride ", "sunset-coffee", "", 42 as unknown as string]);
    expect(await store.read()).toEqual(["sunset-coffee", "ao-dai-ride"]);
  });

  it("discovery hydrates from disk and persists toggles (not bare setSaved)", () => {
    const discovery = read("./components/scene-activity-discovery.tsx");
    expect(discovery).toContain("viewerAccountId");
    expect(discovery).toContain("createSceneFavoritesStore");
    expect(discovery).toContain("toggleSavedMoment");
    expect(discovery).not.toContain("onPress={() => setSaved(");
  });

  it("favorites reads the store and resolves titles from the static catalog", () => {
    const orders = read("./surfaces/me-orders.tsx");
    expect(orders).toContain("createSceneFavoritesStore");
    // SCENE-FAVORITE-002: 解析改成共用实现 resolveSavedSceneIds(ids, savedSceneLookup)
    // —— 这里不再直接调 sceneMomentById/sceneMomentLabels（那是各写一遍的老形状）。
    expect(orders).toContain("resolveSavedSceneIds(");
    expect(orders).toContain("savedSceneLookup");
    expect(orders).not.toMatch(/\{scene\.id\}<\/Text>/);
    const me = read("./surfaces/me.tsx");
    expect(me).toContain("<FavoritesSurface onBack={() => setSubPage(undefined)} viewerAccountId={viewerAccountId} />");
    const home = read("./surfaces/requester-home.tsx");
    expect(home).toContain("viewerAccountId={viewerAccountId}");
  });
});

// SCENE-FAVORITE-002 —— 用户报「home 场景点🤍 在我的 收藏没有」。根因是「收藏」
// 这个词下面有两个互不相通的库：我的 → 收藏 读本机场景 hearts，个人主页 → 收藏
// tab 只读服务端帖子收藏（对场景收藏的引用数是 0）。用户在首页点了 🤍，去个人
// 主页的收藏 tab 找，永远找不到。
//
// 修法：两个面读同一份本机 hearts、用同一个解析函数；场景有独立页签，切页签不会
// 空掉；只有场景收藏时不能再显示「还没有收藏」。
describe("SCENE-FAVORITE-002 scene hearts reach both 收藏 surfaces", () => {
  // —— 行为守卫（主）：解析函数的真实行为，不是 grep ——
  it("resolves known ids, drops unknown ones, and de-duplicates", () => {
    const catalog: SceneCatalogLookup = (id) =>
      id === "sunset-coffee" ? { id, title: "日落咖啡", meta: "咖啡 · 湖边" }
        : id === "ao-dai-ride" ? { id, title: "奥黛骑行", meta: "骑行 · 老城区" }
          : undefined;

    // 目录里有的按原顺序留下；目录里没有的（"ghost"）直接丢弃 —— 绝不拿 id 当标题。
    expect(resolveSavedSceneIds(["ao-dai-ride", "ghost", "sunset-coffee"], catalog)).toEqual([
      { id: "ao-dai-ride", title: "奥黛骑行", meta: "骑行 · 老城区" },
      { id: "sunset-coffee", title: "日落咖啡", meta: "咖啡 · 湖边" },
    ]);
    // 重复 id 只留一条（store 侧已经 sanitize 过，但解析不能依赖上游）。
    expect(resolveSavedSceneIds(["sunset-coffee", "sunset-coffee"], catalog)).toHaveLength(1);
    // 全是未知 id ⇒ 空数组，不是一堆拿 id 当标题的幽灵卡。
    expect(resolveSavedSceneIds(["ghost", "phantom"], catalog)).toEqual([]);
    expect(resolveSavedSceneIds([], catalog)).toEqual([]);
  });

  // —— 反漂移守卫：两个面必须共用同一份解析 ——
  it("both 收藏 surfaces use the one shared resolver, not their own loop", () => {
    for (const surface of ["./surfaces/me.tsx", "./surfaces/me-orders.tsx"]) {
      const src = read(surface);
      expect(src, `${surface} must call the shared resolver`).toContain("resolveSavedSceneIds(ids, savedSceneLookup)");
      // 谁在自己这边再写一遍回查循环，两个面就会漂移 —— 这正是这个 bug 的形状。
      expect(src, `${surface} must not re-implement the catalog lookup`).not.toContain("sceneMomentById(");
    }
    // 目录回查只有一处实现（真目录所在的那个文件）。
    expect(read("./components/scene-activity-discovery.tsx")).toContain("export function savedSceneLookup(");
  });

  // —— 个人主页收藏 tab 真的把场景画出来 ——
  it("the profile 收藏 tab renders scene favorites instead of claiming an empty list", () => {
    const tabs = read("./surfaces/ProfileTabs.tsx");
    expect(tabs).toContain("savedScenes={props.savedScenes}");
    expect(tabs).toContain("场景灵感 · 来自首页收藏");
    // 空态必须要求**两边都空**：只有场景收藏时说「还没有收藏」就是原 bug。
    expect(tabs).toContain("props.saved.length === 0 && scenes.length === 0");
    // 调用方（me.tsx）必须把这份数据真的传下去。
    expect(read("./surfaces/me.tsx")).toContain("savedScenes={personalSavedScenes}");
  });

  // —— 场景有独立页签，切页签不会把这一页唯一的真内容藏起来 ——
  it("FavoritesSurface has a 场景 tab and keeps the section on it", () => {
    const orders = read("./surfaces/me-orders.tsx");
    expect(orders).toContain("['scene','场景']");
    expect(orders).toContain('tab === "all" || tab === "scene"');
  });
});
