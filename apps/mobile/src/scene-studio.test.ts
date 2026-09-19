import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-STUDIO-001: 场景 Studio 出图 —— 选中的时段场景 × 点中的菜单 ×
// 绑定本场景的小美，三元素拼一张卡走系统分享。选什么出什么：缺元素就
// disabled + 明说，不许拿默认替身凑数。注释先剥掉再断言，只认代码。
const map = readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const mapCode = stripComments(map);

describe("SCENE-STUDIO-001 studio card composes scene, menu and xiaomei", () => {
  it("mounts one studio share card on the badge capture chain", () => {
    expect(mapCode).toContain("ref={studioShareRef}");
    expect(mapCode).toContain("captureRef(studioShareRef");
    expect(mapCode).toContain("Share.share");
  });

  it("reads the selected menu and the bound xiaomei, nothing else", () => {
    // 菜单必须是点中的那一款（selectedMenuId 在 menu/fullMenu 里找），
    // 小美必须是绑定本场景的那个（boundSceneId 对上 detail.sceneId）。
    expect(mapCode).toContain("item.id === selectedMenuId");
    expect(mapCode).toContain("boundSceneId === detail?.sceneId");
    expect(mapCode).toContain("aiAccountPhoto(studioXiaomei)");
  });

  it("stays disabled with an honest reason until all three are present", () => {
    // 缺菜单 / 缺小美各有一句人话，按钮同步 disabled —— 没选齐就出图
    // 等于替用户编选择。
    expect(mapCode).toContain("disabled={!studioReady}");
    expect(mapCode).toContain("先选一款菜单再出图");
    expect(mapCode).toContain("等小美绑定这个场景再出图");
  });
});
