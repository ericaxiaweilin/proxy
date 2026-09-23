import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InMemorySecureStorageDriver } from "./secure-session";
import { createSceneFavoritesStore, sceneFavoritesKeyFor } from "./scene-favorites";

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
    const discovery = readFileSync(new URL("./components/scene-activity-discovery.tsx", import.meta.url), "utf8");
    expect(discovery).toContain("viewerAccountId");
    expect(discovery).toContain("createSceneFavoritesStore");
    expect(discovery).toContain("toggleSavedMoment");
    expect(discovery).not.toContain("onPress={() => setSaved(");
  });

  it("favorites reads the store and resolves titles from the static catalog", () => {
    const orders = readFileSync(new URL("./surfaces/me-orders.tsx", import.meta.url), "utf8");
    expect(orders).toContain("createSceneFavoritesStore");
    expect(orders).toContain("sceneMomentById(");
    expect(orders).toContain("sceneMomentLabels(");
    // 绝不拿 id 当标题：未知 id 直接丢弃（sceneMomentById 回 undefined 即跳过）。
    expect(orders).not.toMatch(/\{moment\.id\}<\/Text>/);
    const me = readFileSync(new URL("./surfaces/me.tsx", import.meta.url), "utf8");
    expect(me).toContain("<FavoritesSurface onBack={() => setSubPage(undefined)} viewerAccountId={viewerAccountId} />");
    const home = readFileSync(new URL("./surfaces/requester-home.tsx", import.meta.url), "utf8");
    expect(home).toContain("viewerAccountId={viewerAccountId}");
  });
});
